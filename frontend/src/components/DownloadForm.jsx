import { useState } from 'react'
import { getVideoInfo, startDownload } from '../api'
import { SESSION_ID } from '../session'

const VIDEO_FORMATS = [
  { value: 'best',                    label: 'Best Quality (auto)' },
  { value: 'bestvideo[ext=mp4]+bestaudio/best', label: 'Best MP4' },
  { value: 'bestvideo[height<=1080]+bestaudio/best', label: '1080p HD' },
  { value: 'bestvideo[height<=720]+bestaudio/best',  label: '720p HD' },
  { value: 'bestvideo[height<=480]+bestaudio/best',  label: '480p SD' },
  { value: 'bestvideo[height<=360]+bestaudio/best',  label: '360p' },
  { value: 'bestaudio/best',          label: 'Audio only' },
]
const OUTPUT_EXTS = ['mp4','webm','mkv','avi','mp3','m4a','ogg','wav']

function fmtDuration(sec) {
  if (!sec) return ''
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  return `${m}:${String(s).padStart(2,'0')}`
}

export default function DownloadForm({ onDownloadStarted }) {
  const [url, setUrl]       = useState('')
  const [format, setFormat] = useState('best')
  const [ext, setExt]       = useState('mp4')
  const [info, setInfo]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [dlLoading, setDlLoading] = useState(false)
  const [error, setError]   = useState('')
  const [notice, setNotice] = useState('')
  const [pasteSupported, setPasteSupported] = useState(typeof navigator !== 'undefined' && !!navigator.clipboard)

  const fetchInfo = async (e) => {
    e.preventDefault()
    if (!url.trim()) { setError('Please enter a URL'); return }
    setError(''); setNotice(''); setInfo(null); setLoading(true)
    try {
      const data = await getVideoInfo(url.trim())
      setInfo(data)
    } catch (err) {
      setError(err.data?.error || err.message || 'Failed to fetch video info')
    } finally {
      setLoading(false)
    }
  }

  const download = async () => {
    setError(''); setNotice('')
    setDlLoading(true)
    try {
      const data = await startDownload(url.trim(), format, ext, SESSION_ID)
      setNotice(data.title)
      if (data.warning) setError(`⚠ ${data.warning}`)
      onDownloadStarted && onDownloadStarted({ download_id: data.download_id, title: data.title })
    } catch (err) {
      setError(err.data?.error || err.message || 'Failed to start download')
    } finally {
      setDlLoading(false)
    }
  }

  const clearAll = () => { setUrl(''); setInfo(null); setError(''); setNotice('') }

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) setUrl(text.trim())
    } catch (err) {
      // Clipboard API unavailable (non-HTTPS context or permission denied)
      console.debug('Clipboard paste unavailable:', err)
      setPasteSupported(false)
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-4">Download Video</h2>

      <form onSubmit={fetchInfo} className="flex gap-2">
        <div className="relative flex-1">
          <input
            className="input w-full pr-20"
            type="url"
            placeholder="https://youtube.com/watch?v=…"
            value={url}
            onChange={e => setUrl(e.target.value)}
            autoComplete="off"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {pasteSupported && !url && (
            <button
              type="button"
              onClick={handlePaste}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-white bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded transition-colors"
              title="Paste from clipboard"
            >
              📋 Paste
            </button>
          )}
        </div>
        <button type="submit" className="btn-primary shrink-0" disabled={loading}>
          {loading
            ? <><span className="spinner w-4 h-4" /> Fetching…</>
            : 'Get Info'
          }
        </button>
      </form>

      {/* Errors / notices */}
      {error  && <p className="mt-3 text-sm text-red-400 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">{error}</p>}
      {notice && (
        <div className="mt-3 bg-green-900/20 border border-green-800/50 rounded-lg px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <span className="text-green-400 text-xl dl-icon-bounce">⬇</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-green-400">Download queued</p>
              <p className="text-xs text-green-500/70 truncate">{notice}</p>
            </div>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-green-900/50 overflow-hidden relative">
            <div className="absolute top-0 left-0 h-full w-1/2 bg-green-500/70 rounded-full dl-bar-sweep" />
          </div>
        </div>
      )}

      {/* Video preview card */}
      {info && (
        <div className="mt-5 bg-gray-800/60 rounded-xl p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            {info.thumbnail && (
              <img
                src={info.thumbnail}
                alt="thumbnail"
                className="w-full sm:w-36 rounded-lg object-cover shrink-0 aspect-video"
                referrerPolicy="no-referrer"
              />
            )}
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-white leading-snug line-clamp-2">{info.title}</h3>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-400">
                {info.uploader && <span>👤 {info.uploader}</span>}
                {info.duration  && <span>⏱ {fmtDuration(info.duration)}</span>}
                {info.view_count && <span>👁 {Number(info.view_count).toLocaleString()}</span>}
              </div>
              {info.description && (
                <p className="mt-2 text-xs text-gray-500 line-clamp-2">{info.description}</p>
              )}
            </div>
          </div>

          {/* Format options */}
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Quality</label>
              <select
                className="input text-sm"
                value={format}
                onChange={e => setFormat(e.target.value)}
              >
                {/* Dynamic formats from API */}
                {info.formats?.length > 0 && (
                  <optgroup label="Available formats">
                    {info.formats.map(f => (
                      <option key={f.format_id || f.value} value={f.format_id || f.value}>
                        {f.label || f.format_note || f.ext || f.format_id}
                        {f.filesize_hr ? ` — ${f.filesize_hr}` : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Preset options">
                  {VIDEO_FORMATS.map(f => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Output format</label>
              <select
                className="input text-sm"
                value={ext}
                onChange={e => setExt(e.target.value)}
              >
                {OUTPUT_EXTS.map(e => (
                  <option key={e} value={e}>{e.toUpperCase()}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              className="btn-primary flex-1"
              onClick={download}
              disabled={dlLoading}
            >
              {dlLoading
                ? <><span className="spinner w-4 h-4" /> Starting…</>
                : '⬇ Download'
              }
            </button>
            <button className="btn-ghost btn-sm" onClick={clearAll}>Clear</button>
          </div>
        </div>
      )}

      {/* Supported sites hint */}
      <p className="mt-4 text-xs text-gray-600 text-center">
        Supports YouTube, TikTok, Instagram, Twitter/X, Facebook, Vimeo, Dailymotion &amp; 1,000+ more sites
      </p>
    </div>
  )
}
