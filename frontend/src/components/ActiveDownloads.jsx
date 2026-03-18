import { useState, useEffect, useCallback, useRef } from 'react'
import socket from '../socket'
import { cancelDownload, cancelAll } from '../api'
import DownloadProgressPopup from './DownloadProgressPopup'

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
  const isActive = dl.status === 'downloading' || dl.status === 'queued'

  return (
    <div className="bg-gray-800/60 rounded-xl p-4">
      <div className="flex items-start gap-3">
        {/* Status icon */}
        <div className="mt-0.5 shrink-0">
          {dl.status === 'downloading' && <span className="spinner w-4 h-4 block" />}
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
            {dl.speed    && <span className="text-gray-500">⚡ {dl.speed}</span>}
            {dl.eta      && <span className="text-gray-500">⏱ {dl.eta}</span>}
            {dl.file_size_hr && <span className="text-gray-500">📦 {dl.file_size_hr}</span>}
          </div>

          {/* Progress bar */}
          {dl.status === 'downloading' && (
            <div className="mt-2">
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-xs text-gray-600 mt-0.5">{pct}%</p>
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

export default function ActiveDownloads({ onComplete }) {
  const [downloads, setDownloads] = useState({}) // id → dl
  const subscribedRef = useRef(new Set())
  // ID of the download currently shown in the centered progress popup
  const [popupId, setPopupId] = useState(null)

  const updateDl = (id, patch) => {
    setDownloads(prev => ({
      ...prev,
      [id]: { ...(prev[id] || {}), id, ...patch },
    }))
  }

  // Open the popup for `id` if nothing is already showing
  const openPopupFor = useCallback((id) => {
    setPopupId(prev => prev ?? id)
  }, [])

  // Subscribe to socket events
  useEffect(() => {
    const onProgress  = (data) => {
      if (data?.id) {
        updateDl(data.id, data)
        openPopupFor(data.id)
      }
    }
    const onCompleted = (data) => {
      if (data?.id) {
        updateDl(data.id, { ...data, status: 'completed' })
        onComplete && onComplete(data.id)
        openPopupFor(data.id)
        // Remove the card after the popup auto-close window has passed
        setTimeout(() => {
          setDownloads(prev => {
            const n = { ...prev }
            delete n[data.id]
            return n
          })
        }, 8000)
      }
    }
    const onFailed    = (data) => {
      if (data?.id) {
        updateDl(data.id, { ...data, status: 'failed' })
        openPopupFor(data.id)
      }
    }
    const onCancelled = (data) => {
      if (data?.id) {
        updateDl(data.id, { status: 'cancelled' })
        setTimeout(() => {
          setDownloads(prev => { const n = {...prev}; delete n[data.id]; return n })
        }, 4000)
      }
    }

    socket.on('progress',  onProgress)
    socket.on('completed', onCompleted)
    socket.on('failed',    onFailed)
    socket.on('cancelled', onCancelled)

    return () => {
      socket.off('progress',  onProgress)
      socket.off('completed', onCompleted)
      socket.off('failed',    onFailed)
      socket.off('cancelled', onCancelled)
    }
  }, [onComplete, openPopupFor])

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
    setPopupId(null)
    setDownloads(prev => {
      const next = Object.values(prev).find(
        d => d.status === 'downloading' || d.status === 'queued'
      )
      if (next) setPopupId(next.id)
      return prev
    })
  }, [])

  const dls     = Object.values(downloads)
  const active  = dls.filter(d => d.status === 'downloading' || d.status === 'queued')
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
}
