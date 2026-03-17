import { useState, useEffect, useRef } from 'react'
import { listFiles, deleteFile, downloadUrl, streamUrl, downloadZip } from '../api'
import { SESSION_ID } from '../session'
import { useAuth } from '../App'

const AUDIO_EXTS = new Set(['mp3','m4a','ogg','wav','opus','flac','aac','weba'])
const VIDEO_EXTS = new Set(['mp4','webm','mkv','avi','mov','ts','3gp'])

function isAudio(name) { return AUDIO_EXTS.has(name.split('.').pop()?.toLowerCase()) }
function isVideo(name) { return VIDEO_EXTS.has(name.split('.').pop()?.toLowerCase()) }
function isMedia(name) { return isAudio(name) || isVideo(name) }

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const k = 1024, sizes = ['B','KB','MB','GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / k**i).toFixed(1)} ${sizes[i]}`
}

function MediaPlayer({ file, onClose }) {
  const src = streamUrl(file.name)
  const audio = isAudio(file.name)
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 rounded-2xl shadow-2xl p-4 w-full max-w-3xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-white truncate flex-1 pr-4">{file.name}</p>
          <button className="btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        {audio
          ? <audio src={src} controls autoPlay className="w-full" />
          : <video src={src} controls autoPlay className="w-full rounded-lg max-h-[60vh]" />
        }
      </div>
    </div>
  )
}

export default function FileList({ version }) {
  const { admin } = useAuth()
  const [files, setFiles]       = useState([])
  const [loading, setLoading]   = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [player, setPlayer]     = useState(null)
  const [deleting, setDeleting] = useState(new Set())
  const [notice, setNotice]     = useState('')

  const load = async () => {
    setLoading(true)
    try {
      // Admin sees all files; regular users only see their session's files
      const data = await listFiles(admin ? '' : SESSION_ID)
      setFiles(Array.isArray(data) ? data : [])
    } catch {
      setFiles([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [version])

  const toggleSelect = (name) => {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(name) ? n.delete(name) : n.add(name)
      return n
    })
  }

  const handleDelete = async (name) => {
    if (!confirm(`Delete ${name}?`)) return
    setDeleting(prev => new Set([...prev, name]))
    try {
      await deleteFile(name)
      setFiles(f => f.filter(x => x.name !== name))
      setSelected(prev => { const n = new Set(prev); n.delete(name); return n })
    } catch (err) {
      alert(err.message || 'Delete failed')
    } finally {
      setDeleting(prev => { const n = new Set(prev); n.delete(name); return n })
    }
  }

  const handleZip = async () => {
    if (!selected.size) return
    try {
      const res = await downloadZip([...selected])
      if (res.ok || res.url) {
        window.open(res.url || '/downloads/archive.zip', '_blank')
      } else {
        const blob = await (res instanceof Response ? res.blob() : null)
        if (blob) {
          const a = document.createElement('a')
          a.href = URL.createObjectURL(blob)
          a.download = 'archive.zip'
          a.click()
        }
      }
    } catch (err) {
      alert(err.message || 'Failed to create ZIP')
    }
  }

  if (!files.length && !loading) return null

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-white">
          Downloaded Files
          <span className="ml-2 text-sm text-gray-500 font-normal">({files.length})</span>
        </h2>
        <div className="flex gap-2">
          {selected.size > 0 && (
            <button className="btn-secondary btn-sm text-xs" onClick={handleZip}>
              📦 ZIP ({selected.size})
            </button>
          )}
          <button className="btn-ghost btn-sm text-xs" onClick={load} disabled={loading}>
            {loading ? <span className="spinner w-3 h-3" /> : '↻ Refresh'}
          </button>
        </div>
      </div>

      {notice && (
        <p className="mb-3 text-sm text-green-400 bg-green-900/20 border border-green-800/50 rounded-lg px-3 py-2">{notice}</p>
      )}

      <div className="space-y-2">
        {files.map(file => (
          <div
            key={file.name}
            className={`bg-gray-900 border rounded-xl p-3 flex items-center gap-3 transition-all ${
              selected.has(file.name) ? 'border-red-600/50 bg-red-900/10' : 'border-gray-800'
            }`}
          >
            {/* Checkbox */}
            <input
              type="checkbox"
              className="accent-red-500 shrink-0"
              checked={selected.has(file.name)}
              onChange={() => toggleSelect(file.name)}
            />

            {/* Icon */}
            <span className="text-xl shrink-0">
              {isVideo(file.name) ? '🎬' : isAudio(file.name) ? '🎵' : '📄'}
            </span>

            {/* Name + meta */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{file.name}</p>
              <p className="text-xs text-gray-500">
                {file.size_hr || formatBytes(file.size)}
                {file.modified_str && ` · ${file.modified_str}`}
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-1.5 shrink-0">
              {isMedia(file.name) && (
                <button
                  className="btn-ghost btn-sm text-xs"
                  title="Play"
                  onClick={() => setPlayer(file)}
                >▶</button>
              )}
              <a
                href={downloadUrl(file.name)}
                download={file.name}
                className="btn btn-secondary btn-sm text-xs"
                title="Download"
              >⬇</a>
              <button
                className="btn-danger btn-sm text-xs"
                title="Delete"
                disabled={deleting.has(file.name)}
                onClick={() => handleDelete(file.name)}
              >
                {deleting.has(file.name) ? <span className="spinner w-3 h-3" /> : '🗑'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Media player modal */}
      {player && <MediaPlayer file={player} onClose={() => setPlayer(null)} />}
    </div>
  )
}
