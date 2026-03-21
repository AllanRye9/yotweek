import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react'
import socket from '../socket'
import { cancelDownload, cancelAll, getActiveDownloads } from '../api'
import DownloadProgressPopup from './DownloadProgressPopup'
import { playStartSound, playCompleteSound, playErrorSound } from '../sounds'

function statusColor(status) {
  switch (status) {
    case 'downloading': return 'text-blue-400'
    case 'queued':      return 'text-yellow-400'
    case 'completed':   return 'text-green-400'
    case 'failed':      return 'text-red-400'
    case 'cancelled':   return 'text-gray-500'
    default:            return 'text-gray-400'
  }
}

function DownloadCard({ dl, onCancel }) {
  const pct = Math.round(dl.percent || 0)
  const isActive = ['starting', 'fetching_info', 'downloading', 'queued'].includes(dl.status)
  const isSpinning = ['starting', 'fetching_info', 'downloading'].includes(dl.status)

  return (
    <div className="bg-gray-800/60 rounded-xl p-4">
      <div className="flex items-start gap-3">
        {/* Status icon */}
        <div className="mt-0.5 shrink-0">
          {isSpinning                  && <span className="spinner w-4 h-4 block" />}
          {dl.status === 'queued'      && <span className="w-4 h-4 block rounded-full bg-yellow-500/30 border-2 border-yellow-500" />}
          {dl.status === 'completed'   && <span className="text-green-400 text-base">✓</span>}
          {dl.status === 'failed'      && <span className="text-red-400 text-base">✗</span>}
          {dl.status === 'cancelled'   && <span className="text-gray-500 text-base">⊘</span>}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate leading-snug">
            {dl.title || dl.url || dl.id}
          </p>
          <div className="mt-0.5 flex flex-wrap gap-2 text-xs">
            <span className={statusColor(dl.status)}>{dl.status}</span>
            {dl.status === 'queued' && dl.queue_position != null && (
              <span className="text-yellow-500/80">#{dl.queue_position} in queue</span>
            )}
            {dl.speed    && <span className="text-gray-500">⚡ {dl.speed}</span>}
            {dl.eta      && <span className="text-gray-500">⏱ {dl.eta}</span>}
            {dl.file_size_hr && <span className="text-gray-500">📦 {dl.file_size_hr}</span>}
          </div>

          {/* Progress bar */}
          {dl.status === 'downloading' && (
            <div className="mt-2">
              <div className="progress-bar relative overflow-hidden">
                <div className="progress-fill" style={{ width: `${pct}%` }} />
                {pct > 0 && pct < 100 && <div className="progress-shimmer" />}
              </div>
              <p className="text-xs text-gray-600 mt-0.5">{pct}%</p>
            </div>
          )}
          {(dl.status === 'starting' || dl.status === 'fetching_info' || dl.status === 'queued') && (
            <div className="mt-2">
              <div className="progress-bar relative overflow-hidden">
                <div className="progress-fill-indeterminate" />
              </div>
            </div>
          )}

          {/* Error */}
          {dl.error && (
            <p className="mt-1 text-xs text-red-400 line-clamp-2">{dl.error}</p>
          )}
        </div>

        {/* Cancel button */}
        {isActive && (
          <button
            className="btn-ghost btn-sm shrink-0 text-xs"
            onClick={() => onCancel(dl.id)}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

// How long (ms) to keep a completed card visible before removing it from the list.
// Must be longer than AUTO_CLOSE_SECONDS in DownloadProgressPopup (3 s = 3000 ms).
const COMPLETED_CARD_REMOVAL_DELAY_MS = 8000

const ActiveDownloads = forwardRef(function ActiveDownloads({ onComplete, onDownloadDone }, ref) {
  const [downloads, setDownloads] = useState({}) // id → dl
  const subscribedRef = useRef(new Set())
  // ID of the download currently shown in the centered progress popup
  const [popupId, setPopupId] = useState(null)
  // Keep a ref so handlers always see the latest downloads without stale closure
  const downloadsRef = useRef({})
  // Track which download IDs have already had their start / end sounds played
  const startedSoundRef   = useRef(new Set())
  const completedSoundRef = useRef(new Set())

  const updateDl = useCallback((id, patch) => {
    setDownloads(prev => {
      const next = { ...prev, [id]: { ...(prev[id] || {}), id, ...patch } }
      downloadsRef.current = next
      return next
    })
  }, [])

  // Open the popup for `id` if nothing is already showing
  const openPopupFor = useCallback((id) => {
    setPopupId(prev => prev ?? id)
  }, [])

  // Subscribe to socket.io room for a download, pre-populate state
  const subscribeToDownload = useCallback((id, title) => {
    if (!id) return
    if (!subscribedRef.current.has(id)) {
      subscribedRef.current.add(id)
      // Pre-populate state so the card/popup appears immediately
      setDownloads(prev => {
        if (prev[id]) return prev // already exists, don't overwrite
        const next = { ...prev, [id]: { id, title: title || `video_${id.slice(0, 8)}`, status: 'queued', percent: 0 } }
        downloadsRef.current = next
        return next
      })
      // Join the backend socket.io room so room-scoped events reach this client
      socket.emit('subscribe', { download_id: id })
    }
    openPopupFor(id)
  }, [openPopupFor])

  // Expose subscribeToDownload to parent via ref
  useImperativeHandle(ref, () => ({ subscribeToDownload }), [subscribeToDownload])

  // On socket reconnect, re-subscribe to all tracked download rooms
  useEffect(() => {
    const onReconnect = () => {
      for (const id of subscribedRef.current) {
        socket.emit('subscribe', { download_id: id })
      }
    }
    socket.on('connect', onReconnect)
    return () => socket.off('connect', onReconnect)
  }, [])

  // On mount, fetch any already-running downloads and subscribe to each.
  // subscribeToDownload and updateDl are stable (useCallback with no deps).
  useEffect(() => {
    getActiveDownloads()
      .then(data => {
        for (const dl of data.downloads || []) {
          subscribeToDownload(dl.id, dl.title)
          // Normalize size field and merge in live progress data
          const patch = { ...dl }
          if (dl.size && !dl.file_size_hr) patch.file_size_hr = dl.size
          updateDl(dl.id, patch)
        }
      })
      .catch(() => {})
  }, [subscribeToDownload, updateDl])

  // Subscribe to socket events
  useEffect(() => {
    const onStarted = (data) => {
      if (data?.id) updateDl(data.id, { status: 'starting' })
    }
    const onStatusUpdate = (data) => {
      if (data?.id) updateDl(data.id, { ...(data.status ? { status: data.status } : {}), message: data.message })
    }
    const onTitleUpdate = (data) => {
      if (data?.id && data.title) updateDl(data.id, { title: data.title })
    }
    const onProgress  = (data) => {
      if (data?.id) {
        // Play start sound once per download (first progress event)
        if (!startedSoundRef.current.has(data.id)) {
          startedSoundRef.current.add(data.id)
          playStartSound()
        }
        // Normalize: backend sends `size` in progress events; popup expects `file_size_hr`
        const patch = { ...data, status: 'downloading' }
        if (data.size && !data.file_size_hr) patch.file_size_hr = data.size
        updateDl(data.id, patch)
      }
    }
    const onCompleted = (data) => {
      if (data?.id) {
        // Play completion sound once per download
        if (!completedSoundRef.current.has(data.id)) {
          completedSoundRef.current.add(data.id)
          playCompleteSound()
        }
        updateDl(data.id, { ...data, status: 'completed' })
        onComplete && onComplete(data.id)
        openPopupFor(data.id)
        // Notify parent so it can scroll to the file list after a brief delay
        setTimeout(() => {
          onDownloadDone && onDownloadDone()
        }, 800)
        // Remove the card after the popup auto-close window has passed
        setTimeout(() => {
          setDownloads(prev => {
            const n = { ...prev }
            delete n[data.id]
            downloadsRef.current = n
            return n
          })
          subscribedRef.current.delete(data.id)
        }, COMPLETED_CARD_REMOVAL_DELAY_MS)
      }
    }
    const onFailed    = (data) => {
      if (data?.id) {
        playErrorSound()
        updateDl(data.id, { ...data, status: 'failed' })
        openPopupFor(data.id)
      }
    }
    const onCancelled = (data) => {
      if (data?.id) {
        updateDl(data.id, { status: 'cancelled' })
        setTimeout(() => {
          setDownloads(prev => {
            const n = { ...prev }
            delete n[data.id]
            downloadsRef.current = n
            return n
          })
          subscribedRef.current.delete(data.id)
        }, 4000)
      }
    }

    socket.on('started',       onStarted)
    socket.on('status_update', onStatusUpdate)
    socket.on('title_update',  onTitleUpdate)
    socket.on('progress',      onProgress)
    socket.on('completed',     onCompleted)
    socket.on('failed',        onFailed)
    socket.on('cancelled',     onCancelled)

    return () => {
      socket.off('started',       onStarted)
      socket.off('status_update', onStatusUpdate)
      socket.off('title_update',  onTitleUpdate)
      socket.off('progress',      onProgress)
      socket.off('completed',     onCompleted)
      socket.off('failed',        onFailed)
      socket.off('cancelled',     onCancelled)
    }
  }, [onComplete, onDownloadDone, openPopupFor, updateDl])

  const handleCancel = async (id) => {
    try {
      await cancelDownload(id)
    } catch {}
  }

  const handleCancelAll = async () => {
    try {
      await cancelAll()
    } catch {}
  }

  // When the popup closes, surface the next active download if any
  const handlePopupClose = useCallback(() => {
    setPopupId(() => {
      const next = Object.values(downloadsRef.current).find(
        d => ['starting', 'fetching_info', 'downloading', 'queued'].includes(d.status)
      )
      return next ? next.id : null
    })
  }, [])

  const dls     = Object.values(downloads)
  const active  = dls.filter(d => ['starting', 'fetching_info', 'downloading', 'queued'].includes(d.status))
  const popupDl = popupId ? downloads[popupId] : null

  if (!dls.length && !popupDl) return null

  return (
    <>
      {/* Centered progress popup – shown while a download is active or just finished */}
      {popupDl && (
        <DownloadProgressPopup
          dl={popupDl}
          onClose={handlePopupClose}
          onDelete={() => { handlePopupClose(); onComplete && onComplete() }}
        />
      )}

      {dls.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-white">
              Active Downloads
              {active.length > 0 && (
                <span className="ml-2 badge-info">{active.length}</span>
              )}
            </h2>
            {active.length > 1 && (
              <button className="btn-ghost btn-sm text-xs" onClick={handleCancelAll}>
                Cancel all
              </button>
            )}
          </div>

          <div className="space-y-2">
            {dls.map(dl => (
              <DownloadCard key={dl.id} dl={dl} onCancel={handleCancel} />
            ))}
          </div>
        </div>
      )}
    </>
  )
})

export default ActiveDownloads
