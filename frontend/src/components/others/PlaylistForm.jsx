import { useState } from 'react'
import { startPlaylist, startBatch } from '../api'
import { SESSION_ID } from '../session'

/** Matches any http/https URL starting from https?:// to the next whitespace. */
const URL_REGEX = /https?:\/\/\S+/gi

/** Extract up to `limit` unique URLs from arbitrary text.
 *  Correctly strips trailing punctuation while preserving balanced parentheses
 *  (e.g. Wikipedia-style URLs like https://en.wikipedia.org/wiki/A_(B)).
 */
function extractUrls(text, limit = 50) {
  URL_REGEX.lastIndex = 0
  const found = []
  const seen = new Set()
  let m
  while ((m = URL_REGEX.exec(text)) !== null) {
    let url = m[0]
    // Strip trailing punctuation that is unlikely to be part of a URL
    url = url.replace(/[.,;!?\]>'"]+$/, '')
    // Strip unbalanced trailing ')' — keep ')' that close an '(' inside the URL
    while (url.endsWith(')')) {
      const opens  = (url.match(/\(/g) || []).length
      const closes = (url.match(/\)/g) || []).length
      if (closes > opens) url = url.slice(0, -1)
      else break
    }
    if (url.length > 8 && !seen.has(url)) { seen.add(url); found.push(url) }
    if (found.length >= limit) break
  }
  return found
}

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
  const [pasteSupported, setPasteSupported] = useState(
    typeof navigator !== 'undefined' && !!navigator.clipboard
  )

  const urlCount = extractUrls(batchUrls).length

  // Paste helpers -------------------------------------------------------
  const pasteToPlaylistUrl = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) setUrl(text.trim())
    } catch {
      setPasteSupported(false)
    }
  }

  const pasteToBatch = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (!text) return
      const found = extractUrls(text)
      setBatchUrls(found.length > 0 ? found.join('\n') : text.trim())
    } catch {
      setPasteSupported(false)
    }
  }

  const submitPlaylist = async (e) => {
    e.preventDefault()
    if (!url.trim()) { setError('Please enter a playlist/channel URL'); return }
    setError(''); setNotice(''); setLoading(true)
    try {
      const data = await startPlaylist(url.trim(), format, ext, startIdx, endIdx, SESSION_ID)
      setNotice(`✓ Playlist download started — ${data.queued ?? ''} videos queued`)
      onDownloadStarted && onDownloadStarted({ download_id: data.download_id, title: data.title || 'Playlist Download' })
    } catch (err) {
      setError(err.data?.error || err.message || 'Failed to start playlist')
    } finally {
      setLoading(false)
    }
  }

  const submitBatch = async (e) => {
    e.preventDefault()
    // Extract all valid http(s) URLs from the textarea (normalise before submit)
    const found = extractUrls(batchUrls)
    if (!found.length) { setError('Enter at least one valid URL'); return }
    setError(''); setNotice(''); setLoading(true)
    try {
      const data = await startBatch(found.join('\n'), format, ext, SESSION_ID)
      setNotice(`✓ Batch started — ${data.total ?? found.length} downloads queued (sequential)`)
      for (const dl of data.started || []) {
        onDownloadStarted && onDownloadStarted({ download_id: dl.download_id, title: dl.title })
      }
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
          className={`${subTab === 'playlist' ? 'tab-btn-active' : 'tab-btn-inactive'} flex-1`}
          onClick={() => { setSubTab('playlist'); setError(''); setNotice('') }}
        >📋 Playlist / Channel</button>
        <button
          className={`${subTab === 'batch' ? 'tab-btn-active' : 'tab-btn-inactive'} flex-1`}
          onClick={() => { setSubTab('batch'); setError(''); setNotice('') }}
        >📄 Batch URLs</button>
      </div>

      {error  && <p className="mb-3 text-sm text-red-400 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">{error}</p>}
      {notice && <p className="mb-3 text-sm text-green-400 bg-green-900/20 border border-green-800/50 rounded-lg px-3 py-2">{notice}</p>}

      {subTab === 'playlist' && (
        <form onSubmit={submitPlaylist} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Playlist or Channel URL</label>
            <div className="relative">
              <input
                className="input w-full pr-20"
                type="url"
                placeholder="https://youtube.com/playlist?list=…"
                value={url}
                onChange={e => setUrl(e.target.value)}
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
              />
              {pasteSupported && !url && (
                <button
                  type="button"
                  onClick={pasteToPlaylistUrl}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-white bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded transition-colors"
                  title="Paste from clipboard"
                >
                  📋 Paste
                </button>
              )}
            </div>
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
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm text-gray-400">
                URLs — paste freely, detected automatically (max 50)
              </label>
              {pasteSupported && (
                <button
                  type="button"
                  onClick={pasteToBatch}
                  className="text-xs text-gray-400 hover:text-white bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded transition-colors"
                  title="Paste URLs from clipboard"
                >
                  📋 Paste
                </button>
              )}
            </div>
            <textarea
              className="input min-h-[120px] resize-y font-mono text-sm"
              placeholder={'Paste one or more URLs here — from YouTube, TikTok, Instagram, Twitter/X, Facebook or any of 1,000+ sites.\nURLs are detected and arranged automatically regardless of how they are pasted.'}
              value={batchUrls}
              onChange={e => setBatchUrls(e.target.value)}
              onPaste={e => {
                // Normalise pasted content after React has updated state
                setTimeout(() => {
                  const raw = e.target.value
                  const found = extractUrls(raw)
                  if (found.length > 0 && raw.trim() !== found.join('\n')) {
                    setBatchUrls(found.join('\n'))
                  }
                }, 0)
              }}
              required
            />
            <p className="text-xs mt-1" style={{ color: urlCount > 0 ? '#4ade80' : '#6b7280' }}>
              {urlCount === 0 ? '0 URLs detected' : urlCount === 1 ? '1 URL detected' : `${urlCount} URLs detected${urlCount >= 50 ? ' (max)' : ''}`}
            </p>
            {urlCount > 1 && (
              <p className="text-xs mt-0.5 text-gray-500">
                Downloads will run sequentially — one at a time until all finish.
              </p>
            )}
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
