import { useState } from 'react'
import { startPlaylist, startBatch } from '../api'
import { SESSION_ID } from '../session'

const FORMATS = [
  { value: 'best', label: 'Best Quality' },
  { value: 'bestvideo[height<=1080]+bestaudio/best', label: '1080p' },
  { value: 'bestvideo[height<=720]+bestaudio/best',  label: '720p' },
  { value: 'bestvideo[height<=480]+bestaudio/best',  label: '480p' },
  { value: 'bestaudio/best', label: 'Audio only' },
]
const EXTS = ['mp4','webm','mkv','mp3','m4a']

export default function PlaylistForm({ onDownloadStarted }) {
  const [subTab, setSubTab] = useState('playlist')
  const [url,     setUrl]     = useState('')
  const [batchUrls, setBatchUrls] = useState('')
  const [format,  setFormat]  = useState('best')
  const [ext,     setExt]     = useState('mp4')
  const [startIdx, setStartIdx] = useState('')
  const [endIdx,   setEndIdx]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [notice,  setNotice]  = useState('')

  const submitPlaylist = async (e) => {
    e.preventDefault()
    if (!url.trim()) { setError('Please enter a playlist/channel URL'); return }
    setError(''); setNotice(''); setLoading(true)
    try {
      const data = await startPlaylist(url.trim(), format, ext, startIdx, endIdx, SESSION_ID)
      setNotice(`✓ Playlist download started — ${data.queued ?? ''} videos queued`)
      onDownloadStarted && onDownloadStarted()
    } catch (err) {
      setError(err.data?.error || err.message || 'Failed to start playlist')
    } finally {
      setLoading(false)
    }
  }

  const submitBatch = async (e) => {
    e.preventDefault()
    const lines = batchUrls.split('\n').map(l => l.trim()).filter(Boolean)
    if (!lines.length) { setError('Enter at least one URL'); return }
    setError(''); setNotice(''); setLoading(true)
    try {
      const data = await startBatch(lines.join('\n'), format, ext, SESSION_ID)
      setNotice(`✓ Batch started — ${data.queued ?? lines.length} downloads queued`)
      onDownloadStarted && onDownloadStarted()
    } catch (err) {
      setError(err.data?.error || err.message || 'Failed to start batch')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="flex gap-2 mb-5">
        <button
          className={subTab === 'playlist' ? 'tab-btn-active' : 'tab-btn-inactive'}
          onClick={() => { setSubTab('playlist'); setError(''); setNotice('') }}
        >📋 Playlist / Channel</button>
        <button
          className={subTab === 'batch' ? 'tab-btn-active' : 'tab-btn-inactive'}
          onClick={() => { setSubTab('batch'); setError(''); setNotice('') }}
        >📄 Batch URLs</button>
      </div>

      {error  && <p className="mb-3 text-sm text-red-400 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">{error}</p>}
      {notice && <p className="mb-3 text-sm text-green-400 bg-green-900/20 border border-green-800/50 rounded-lg px-3 py-2">{notice}</p>}

      {subTab === 'playlist' && (
        <form onSubmit={submitPlaylist} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Playlist or Channel URL</label>
            <input
              className="input"
              type="url"
              placeholder="https://youtube.com/playlist?list=…"
              value={url}
              onChange={e => setUrl(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Start index (optional)</label>
              <input
                className="input text-sm"
                type="number"
                min="1"
                placeholder="1"
                value={startIdx}
                onChange={e => setStartIdx(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">End index (optional)</label>
              <input
                className="input text-sm"
                type="number"
                min="1"
                placeholder="50"
                value={endIdx}
                onChange={e => setEndIdx(e.target.value)}
              />
            </div>
          </div>

          <FormatRow format={format} setFormat={setFormat} ext={ext} setExt={setExt} />

          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? <><span className="spinner w-4 h-4" /> Queuing…</> : '⬇ Download Playlist'}
          </button>
        </form>
      )}

      {subTab === 'batch' && (
        <form onSubmit={submitBatch} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              URLs (one per line, max 50)
            </label>
            <textarea
              className="input min-h-[120px] resize-y font-mono text-sm"
              placeholder={'https://youtube.com/watch?v=…\nhttps://tiktok.com/@user/video/…\nhttps://instagram.com/reel/…'}
              value={batchUrls}
              onChange={e => setBatchUrls(e.target.value)}
              required
            />
            <p className="text-xs text-gray-600 mt-1">
              {batchUrls.split('\n').filter(l => l.trim()).length} URLs entered
            </p>
          </div>

          <FormatRow format={format} setFormat={setFormat} ext={ext} setExt={setExt} />

          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? <><span className="spinner w-4 h-4" /> Starting…</> : '⬇ Start Batch Download'}
          </button>
        </form>
      )}
    </div>
  )
}

function FormatRow({ format, setFormat, ext, setExt }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="block text-xs text-gray-400 mb-1">Quality</label>
        <select className="input text-sm" value={format} onChange={e => setFormat(e.target.value)}>
          {FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Format</label>
        <select className="input text-sm" value={ext} onChange={e => setExt(e.target.value)}>
          {EXTS.map(e => <option key={e} value={e}>{e.toUpperCase()}</option>)}
        </select>
      </div>
    </div>
  )
}
