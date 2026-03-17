import { downloadUrl, streamUrl, deleteFile } from '../api'

const AUDIO_EXTS = new Set(['mp3','m4a','ogg','wav','opus','flac','aac','weba'])
const VIDEO_EXTS = new Set(['mp4','webm','mkv','avi','mov','ts','3gp'])

function isAudio(name) { return AUDIO_EXTS.has(name?.split('.').pop()?.toLowerCase()) }
function isVideo(name) { return VIDEO_EXTS.has(name?.split('.').pop()?.toLowerCase()) }
function isMedia(name) { return isAudio(name) || isVideo(name) }

/**
 * Popup shown when a download completes.
 *
 * Props:
 *   dl       – download record from ActiveDownloads (has .filename, .title, etc.)
 *   onClose  – called when the popup is dismissed
 *   onDelete – called after successful deletion so FileList can refresh
 */
export default function DownloadCompletePopup({ dl, onClose, onDelete }) {
  if (!dl) return null

  const filename = dl.filename
  const title    = dl.title || filename || 'Download complete'
  const hasMedia = filename && isMedia(filename)

  const handleWatch = () => {
    if (!filename) return
    // Open in a new tab using the stream URL so the browser can play it inline
    window.open(streamUrl(filename), '_blank')
  }

  const handleDownload = () => {
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
    try {
      await deleteFile(filename)
      onDelete && onDelete(filename)
    } catch {
      // ignore – file may already be gone
    }
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="popup-card w-full max-w-md"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <span className="text-green-400 text-xl">✓</span>
            <h2 className="text-base font-semibold text-white">Download Complete</h2>
          </div>
          <button
            className="btn-ghost btn-sm shrink-0"
            onClick={onClose}
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* File info */}
        <div className="bg-gray-800/60 rounded-lg px-4 py-3 mb-5">
          <p className="text-sm font-medium text-white truncate" title={title}>{title}</p>
          {filename && (
            <p className="text-xs text-gray-500 mt-0.5 truncate">{filename}</p>
          )}
          {dl.file_size_hr && (
            <p className="text-xs text-gray-500 mt-0.5">📦 {dl.file_size_hr}</p>
          )}
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-2">
          {hasMedia && (
            <button
              className="btn-primary col-span-1"
              onClick={handleWatch}
            >
              ▶ Watch
            </button>
          )}
          <button
            className={`btn-secondary ${hasMedia ? 'col-span-1' : 'col-span-2'}`}
            onClick={handleDownload}
            disabled={!filename}
          >
            ⬇ Save to device
          </button>
          <button
            className="btn-danger col-span-1"
            onClick={handleDelete}
          >
            🗑 Delete
          </button>
          <button
            className="btn-ghost col-span-1"
            onClick={onClose}
          >
            ✕ Exit
          </button>
        </div>
      </div>
    </div>
  )
}
