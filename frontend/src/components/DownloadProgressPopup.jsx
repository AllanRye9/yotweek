import { useState, useEffect, useRef } from 'react'
import { cancelDownload, downloadUrl, streamUrl, deleteFile } from '../api'

const AUDIO_EXTS = new Set(['mp3','m4a','ogg','wav','opus','flac','aac','weba'])
const VIDEO_EXTS = new Set(['mp4','webm','mkv','avi','mov','ts','3gp'])
function isMedia(name) {
  const ext = name?.split('.').pop()?.toLowerCase()
  return AUDIO_EXTS.has(ext) || VIDEO_EXTS.has(ext)
}

const AUTO_CLOSE_SECONDS = 5

/**
 * Centered popup shown during an active download.
 * Progress bar is animated to match the real download percentage.
 * Auto-closes after the download finishes.
 *
 * Props:
 *   dl       – download record (id, title, percent, speed, eta, status, filename, file_size_hr, error)
 *   onClose  – called when the popup is dismissed (manually or automatically)
 *   onDelete – called after the downloaded file is deleted so FileList can refresh
 */
export default function DownloadProgressPopup({ dl, onClose, onDelete }) {
  const [countdown, setCountdown] = useState(null)
  const timerRef = useRef(null)

  const pct          = Math.round(dl?.percent || 0)
  const isQueued     = dl?.status === 'queued' || dl?.status === null || dl?.status === undefined
  const isDownloading = dl?.status === 'downloading'
  const isCompleted  = dl?.status === 'completed'
  const isFailed     = dl?.status === 'failed'
  const isCancelled  = dl?.status === 'cancelled'
  const isDone       = isCompleted || isFailed || isCancelled

  // Auto-close countdown once the download finishes
  useEffect(() => {
    if (!isDone) return
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
  }, [isDone, onClose])

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
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={isDone ? onClose : undefined}
    >
      <div
        className="popup-card w-full max-w-sm"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            {isCompleted   && <span className="text-green-400 text-xl">✓</span>}
            {isFailed      && <span className="text-red-400 text-xl">✗</span>}
            {isCancelled   && <span className="text-gray-500 text-xl">⊘</span>}
            {isDownloading && <span className="spinner w-5 h-5 block" />}
            {isQueued      && (
              <span className="w-5 h-5 block rounded-full bg-yellow-500/30 border-2 border-yellow-500" />
            )}
            <h2 className="text-base font-semibold text-white">
              {isCompleted  ? 'Download Complete'
               : isFailed   ? 'Download Failed'
               : isCancelled? 'Download Cancelled'
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
        <p className="text-sm text-white truncate mb-4" title={title}>{title}</p>

        {/* ── Progress bar ── */}
        <div className="mb-3">
          <div className="progress-bar relative overflow-hidden">
            {isQueued
              ? <div className="progress-fill-indeterminate" />
              : <div className="progress-fill" style={{ width: `${fillPct}%` }} />
            }
          </div>
          {!isQueued && (
            <p className="text-xs text-gray-400 mt-1">{fillPct}%</p>
          )}
        </div>

        {/* ── Metadata (speed / ETA / size) ── */}
        {(dl.speed || dl.eta || dl.file_size_hr) && (
          <div className="flex flex-wrap gap-3 text-xs text-gray-400 mb-4">
            {dl.speed        && <span>⚡ {dl.speed}</span>}
            {dl.eta          && <span>⏱ {dl.eta}</span>}
            {dl.file_size_hr && <span>📦 {dl.file_size_hr}</span>}
          </div>
        )}

        {/* ── Error ── */}
        {dl.error && (
          <p className="text-xs text-red-400 mb-3 line-clamp-2">{dl.error}</p>
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
            className="btn-ghost w-full text-red-400 hover:text-red-300"
            onClick={handleCancel}
          >
            Cancel Download
          </button>
        )}
      </div>
    </div>
  )
}
