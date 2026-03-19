import { useState, useEffect, useRef } from 'react'
import { cancelDownload, downloadUrl, streamUrl, deleteFile } from '../api'

const AUDIO_EXTS = new Set(['mp3','m4a','ogg','wav','opus','flac','aac','weba'])
const VIDEO_EXTS = new Set(['mp4','webm','mkv','avi','mov','ts','3gp'])
function isMedia(name) {
  const ext = name?.split('.').pop()?.toLowerCase()
  return AUDIO_EXTS.has(ext) || VIDEO_EXTS.has(ext)
}

const AUTO_CLOSE_SECONDS = 5 // seconds after a successful completion before auto-close
// Width (%) of the shimmer overlay that sweeps across the active progress fill
const SHIMMER_WIDTH_PCT = 20

/**
 * Centered popup shown during an active download.
 * Monitors real-time progress received via Socket.IO from the backend.
 * Auto-closes after the download finishes with a brief completion popup.
 *
 * Props:
 *   dl       – download record (id, title, percent, speed, eta, status, filename, file_size_hr, error)
 *   onClose  – called when the popup is dismissed (manually or automatically)
 *   onDelete – called after the downloaded file is deleted so FileList can refresh
 */
export default function DownloadProgressPopup({ dl, onClose, onDelete }) {
  const [countdown, setCountdown] = useState(null)
  const timerRef = useRef(null)

  const pct           = Math.round(dl?.percent || 0)
  const isQueued      = !dl?.status || dl.status === 'queued'
  const isFetching    = dl?.status === 'starting' || dl?.status === 'fetching_info'
  const isDownloading = dl?.status === 'downloading'
  const isCompleted   = dl?.status === 'completed'
  const isFailed      = dl?.status === 'failed'
  const isCancelled   = dl?.status === 'cancelled'
  const isDone        = isCompleted || isFailed || isCancelled
  const isIndeterminate = isQueued || isFetching

  // Auto-close countdown once the download finishes
  useEffect(() => {
    if (!isCompleted) return
    let remaining = AUTO_CLOSE_SECONDS
    setCountdown(remaining)
    timerRef.current = setInterval(() => {
      remaining -= 1
      if (remaining <= 0) {
        clearInterval(timerRef.current)
        onClose()
      } else {
        setCountdown(remaining)
      }
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [isCompleted, onClose])

  if (!dl) return null

  const filename = dl.filename
  const title    = dl.title || dl.url || dl.id
  const hasMedia = filename && isMedia(filename)

  const handleCancel = async () => {
    try { await cancelDownload(dl.id) } catch {
      // ignore – cancellation may fail if the download already finished
    }
  }

  const handleWatch = () => {
    if (!filename) return
    window.open(streamUrl(filename), '_blank')
  }

  const handleSave = () => {
    if (!filename) return
    const a = document.createElement('a')
    a.href     = downloadUrl(filename)
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const handleDelete = async () => {
    if (!filename) { onClose(); return }
    try { await deleteFile(filename); onDelete && onDelete(filename) } catch {
      // ignore – file may already be gone
    }
    onClose()
  }

  // The displayed fill width – jump to 100% on completion so bar looks complete
  const fillPct = isCompleted ? 100 : pct

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onClick={isDone ? onClose : undefined}
    >
      <div
        className="dl-popup-card w-full max-w-sm"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            {isCompleted   && <span className="dl-status-icon dl-status-done">✓</span>}
            {isFailed      && <span className="dl-status-icon dl-status-fail">✗</span>}
            {isCancelled   && <span className="dl-status-icon dl-status-cancel">⊘</span>}
            {isDownloading && <span className="spinner dl-status-spin" />}
            {(isQueued || isFetching) && (
              <span className="dl-status-icon dl-status-queued" />
            )}
            <h2 className="text-base font-semibold text-white">
              {isCompleted  ? '✅ Download Complete!'
               : isFailed   ? 'Download Failed'
               : isCancelled? 'Download Cancelled'
               : isFetching ? 'Preparing download…'
               : isQueued   ? 'Queued…'
               :              'Downloading…'}
            </h2>
          </div>
          <button
            className="btn-ghost btn-sm shrink-0"
            onClick={onClose}
            title="Close"
          >✕</button>
        </div>

        {/* ── Title ── */}
        <p className="text-sm text-white/80 truncate mb-5" title={title}>{title}</p>

        {/* ── Progress bar ── */}
        <div className="mb-4">
          <div className="dl-progress-track">
            {isIndeterminate ? (
              <div className="dl-progress-indeterminate" />
            ) : (
              <>
                <div
                  className={`dl-progress-fill${isCompleted ? ' dl-progress-complete' : ''}`}
                  style={{ width: `${fillPct}%` }}
                />
                {isDownloading && fillPct > 0 && fillPct < 100 && (
                  <div className="dl-progress-shimmer" style={{ left: `${Math.max(0, fillPct - SHIMMER_WIDTH_PCT)}%`, width: `${Math.min(SHIMMER_WIDTH_PCT, fillPct)}%` }} />
                )}
              </>
            )}
          </div>
          <div className="flex justify-between mt-1.5">
            {!isIndeterminate && (
              <p className="text-xs font-semibold" style={{ color: isCompleted ? '#4ade80' : '#f87171' }}>
                {fillPct}%
              </p>
            )}
            {isIndeterminate && <p className="text-xs text-gray-500">{isFetching ? 'Fetching info…' : 'Waiting…'}</p>}
          </div>
        </div>

        {/* ── Metadata (speed / ETA / size) ── */}
        {(dl.speed || dl.eta || dl.file_size_hr) && (
          <div className="dl-meta-row mb-5">
            {dl.speed        && (
              <span className="dl-meta-pill">
                <span className="dl-meta-label">Speed</span>
                <span className="dl-meta-value">⚡ {dl.speed}</span>
              </span>
            )}
            {dl.eta          && (
              <span className="dl-meta-pill">
                <span className="dl-meta-label">ETA</span>
                <span className="dl-meta-value">⏱ {dl.eta}</span>
              </span>
            )}
            {dl.file_size_hr && (
              <span className="dl-meta-pill">
                <span className="dl-meta-label">Size</span>
                <span className="dl-meta-value">📦 {dl.file_size_hr}</span>
              </span>
            )}
          </div>
        )}

        {/* ── Error ── */}
        {dl.error && (
          <p className="text-xs text-red-400 mb-4 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2 line-clamp-3">{dl.error}</p>
        )}

        {/* ── Action buttons ── */}
        {isCompleted ? (
          <>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {hasMedia && (
                <button className="btn-primary col-span-1" onClick={handleWatch}>
                  ▶ Watch
                </button>
              )}
              <button
                className={`btn-secondary ${hasMedia ? 'col-span-1' : 'col-span-2'}`}
                onClick={handleSave}
                disabled={!filename}
              >
                ⬇ Save to device
              </button>
              <button className="btn-danger col-span-1" onClick={handleDelete}>
                🗑 Delete
              </button>
              <button className="btn-ghost col-span-1" onClick={onClose}>
                ✕ Exit
              </button>
            </div>
            {countdown !== null && (
              <p className="text-xs text-center text-gray-500">
                Closing in {countdown}s…
              </p>
            )}
          </>
        ) : isDone ? (
          <button className="btn-ghost w-full" onClick={onClose}>Close</button>
        ) : (
          <button
            className="btn-ghost w-full text-red-400 hover:text-red-300 border border-red-800/40"
            onClick={handleCancel}
          >
            ✕ Cancel Download
          </button>
        )}
      </div>
    </div>
  )
}
