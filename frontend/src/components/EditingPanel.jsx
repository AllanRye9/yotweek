import { useState, useEffect, useRef } from 'react'
import {
  convertFile, batchConvert, trimVideo, cropVideo,
  addWatermark, extractClip, mergeVideos, getJobStatus, listFiles, uploadLocalFile,
} from '../api'
import { SESSION_ID } from '../session'

const EDIT_TABS = [
  { id: 'convert',       label: '🔄 Convert' },
  { id: 'batch_convert', label: '📦 Batch' },
  { id: 'trim',          label: '✂ Trim' },
  { id: 'crop',          label: '⊞ Crop' },
  { id: 'watermark',     label: '💧 Watermark' },
  { id: 'extract',       label: '🎬 Extract Clip' },
  { id: 'merge',         label: '🔗 Merge' },
]
const CONVERT_FORMATS = ['mp4','webm','mkv','avi','mp3','m4a','wav','ogg']
const RESOLUTIONS = ['', '1920x1080', '1280x720', '854x480', '640x360']
const WATERMARK_POSITIONS = ['bottom-right','bottom-left','top-right','top-left','center']
const ACCEPTED_MEDIA = 'video/*,audio/*,.mkv,.webm,.avi,.flv,.wmv,.mp3,.wav,.aac,.ogg,.flac,.m4a,.m4v'

/** Small component for uploading a local file. After upload the parent's
 *  onUploaded(filename) callback is called and the file list is refreshed. */
function LocalFileUpload({ onUploaded }) {
  const inputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [status,    setStatus]    = useState('')

  const handleChange = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    setStatus('Uploading…')
    try {
      const data = await uploadLocalFile(file, SESSION_ID)
      setStatus(`✓ ${data.filename}`)
      onUploaded && onUploaded(data.filename)
    } catch (err) {
      setStatus(`✗ ${err.message || 'Upload failed'}`)
    } finally {
      setUploading(false)
      // Reset so the same file can be re-selected
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="flex items-center gap-2 mt-1 flex-wrap">
      <span className="text-xs text-gray-600 italic">or</span>
      <label className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-dashed text-xs cursor-pointer transition-colors
        ${uploading ? 'opacity-50 pointer-events-none' : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-300'}`}>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_MEDIA}
          className="hidden"
          onChange={handleChange}
          disabled={uploading}
        />
        {uploading ? <span className="spinner w-3 h-3" /> : '⬆'} Select from computer
      </label>
      {status && (
        <span className={`text-xs ${status.startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>
          {status}
        </span>
      )}
    </div>
  )
}

function FileSelect({ label, value, onChange, files, multi, selected, onUploaded }) {
  if (!files?.length) return (
    <div>
      <div className="text-sm text-gray-500 italic mb-1">No files available. Download some videos first.</div>
      <LocalFileUpload onUploaded={onUploaded} />
    </div>
  )
  if (multi) {
    return (
      <div>
        <label className="block text-sm text-gray-400 mb-2">{label}</label>
        <div className="space-y-1 max-h-48 overflow-y-auto pr-2 scrollbar-thin">
          {files.map(f => (
            <label key={f.name} className="flex items-center gap-2 text-sm cursor-pointer hover:text-white transition-colors">
              <input
                type="checkbox"
                className="accent-red-500"
                checked={selected?.includes(f.name)}
                onChange={e => {
                  if (e.target.checked) onChange([...(selected||[]), f.name])
                  else onChange((selected||[]).filter(n => n !== f.name))
                }}
              />
              <span className="text-gray-300">{f.name}</span>
              <span className="text-gray-600 ml-auto">{f.size_hr}</span>
            </label>
          ))}
        </div>
        <LocalFileUpload onUploaded={onUploaded} />
      </div>
    )
  }
  return (
    <div>
      <label className="block text-sm text-gray-400 mb-1">{label}</label>
      <select className="input text-sm" value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Select a file…</option>
        {files.map(f => (
          <option key={f.name} value={f.name}>{f.name} ({f.size_hr})</option>
        ))}
      </select>
      <LocalFileUpload onUploaded={onUploaded} />
    </div>
  )
}

function JobResult({ jobId, onDone }) {
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!jobId) return
    const poll = async () => {
      try {
        const data = await getJobStatus(jobId)
        if (data.status === 'completed' || data.status === 'failed') {
          setResult(data); setLoading(false)
          if (data.status === 'completed' && onDone) onDone()
          return
        }
        setTimeout(poll, 1500)
      } catch { setLoading(false) }
    }
    poll()
  }, [jobId])

  if (!jobId) return null
  if (loading) return (
    <div className="mt-3 flex items-center gap-2 text-sm text-gray-400">
      <span className="spinner w-4 h-4" /> Processing…
    </div>
  )
  if (!result) return null
  return result.status === 'completed'
    ? <p className="mt-3 text-sm text-green-400 bg-green-900/20 border border-green-800/50 rounded-lg px-3 py-2">✓ Done! Output: {result.filename}</p>
    : <p className="mt-3 text-sm text-red-400 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">✗ {result.error}</p>
}

export default function EditingPanel({ onJobDone }) {
  const [tab, setTab] = useState('convert')
  const [files, setFiles] = useState([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [jobId, setJobId] = useState(null)

  // Convert
  const [convFile, setConvFile]     = useState('')
  const [convFmt, setConvFmt]       = useState('mp4')
  const [convRes, setConvRes]       = useState('')
  const [convVBit, setConvVBit]     = useState('')
  const [convABit, setConvABit]     = useState('')
  // Batch convert
  const [batchFiles, setBatchFiles] = useState([])
  const [batchFmt, setBatchFmt]     = useState('mp4')
  // Trim
  const [trimFile, setTrimFile]     = useState('')
  const [trimStart, setTrimStart]   = useState('')
  const [trimEnd, setTrimEnd]       = useState('')
  // Crop
  const [cropFile, setCropFile]     = useState('')
  const [cropX, setCropX]           = useState('')
  const [cropY, setCropY]           = useState('')
  const [cropW, setCropW]           = useState('')
  const [cropH, setCropH]           = useState('')
  // Watermark
  const [wmFile, setWmFile]         = useState('')
  const [wmText, setWmText]         = useState('')
  const [wmPos, setWmPos]           = useState('bottom-right')
  const [wmSize, setWmSize]         = useState('24')
  // Extract
  const [exFile, setExFile]         = useState('')
  const [exStart, setExStart]       = useState('')
  const [exDur, setExDur]           = useState('10')
  // Merge
  const [mergeFiles, setMergeFiles] = useState([])
  const [mergeFmt, setMergeFmt]     = useState('mp4')

  useEffect(() => {
    listFiles(SESSION_ID).then(setFiles).catch(() => setFiles([]))
  }, [])

  const refreshFiles = () => listFiles(SESSION_ID).then(setFiles).catch(() => {})

  /** Called when a local file is successfully uploaded to the server.
   *  Refreshes the file list and auto-selects the newly uploaded file. */
  const handleUploaded = (editTab) => (filename) => {
    refreshFiles().then(() => {
      if (editTab === 'convert')   setConvFile(filename)
      if (editTab === 'trim')      setTrimFile(filename)
      if (editTab === 'crop')      setCropFile(filename)
      if (editTab === 'watermark') setWmFile(filename)
      if (editTab === 'extract')   setExFile(filename)
    })
  }

  const run = async (fn) => {
    setError(''); setNotice(''); setJobId(null); setLoading(true)
    try {
      const data = await fn()
      if (data.job_id) { setJobId(data.job_id) }
      else if (data.jobs) {
        setNotice(`✓ ${data.total} conversion job${data.total !== 1 ? 's' : ''} started`)
        onJobDone && onJobDone()
      } else if (data.success || data.filename) {
        setNotice(`✓ ${data.filename || 'Done!'}`)
        onJobDone && onJobDone()
      }
    } catch (err) {
      setError(err.data?.error || err.message || 'Operation failed')
    } finally {
      setLoading(false)
    }
  }

  const submitConvert = (e) => { e.preventDefault(); if (!convFile) { setError('Select a file'); return } run(() => convertFile(convFile, convFmt, convRes, convVBit, convABit, SESSION_ID)) }
  const submitBatch   = (e) => { e.preventDefault(); if (!batchFiles.length) { setError('Select files'); return } run(() => batchConvert(batchFiles, batchFmt, SESSION_ID)) }
  const submitTrim    = (e) => { e.preventDefault(); if (!trimFile||!trimStart||!trimEnd) { setError('Fill all fields'); return } run(() => trimVideo(trimFile, trimStart, trimEnd, SESSION_ID)) }
  const submitCrop    = (e) => { e.preventDefault(); if (!cropFile||!cropW||!cropH) { setError('Fill all fields'); return } run(() => cropVideo(cropFile, cropX||0, cropY||0, cropW, cropH, SESSION_ID)) }
  const submitWm      = (e) => { e.preventDefault(); if (!wmFile||!wmText) { setError('Fill all fields'); return } run(() => addWatermark(wmFile, wmText, wmPos, wmSize, SESSION_ID)) }
  const submitExtract = (e) => { e.preventDefault(); if (!exFile||!exStart) { setError('Fill all fields'); return } run(() => extractClip(exFile, exStart, exDur, SESSION_ID)) }
  const submitMerge   = (e) => { e.preventDefault(); if (mergeFiles.length < 2) { setError('Select at least 2 files'); return } run(() => mergeVideos(mergeFiles, mergeFmt, SESSION_ID)) }

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-4">Edit &amp; Convert</h2>

      {/* Sub-tabs (scrollable on mobile) */}
      <div className="flex gap-1.5 mb-5 overflow-x-auto pb-1 scrollbar-thin">
        {EDIT_TABS.map(t => (
          <button
            key={t.id}
            className={`${tab === t.id ? 'tab-btn-active' : 'tab-btn-inactive'} whitespace-nowrap text-xs px-3 py-1.5`}
            onClick={() => { setTab(t.id); setError(''); setNotice(''); setJobId(null) }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error  && <p className="mb-3 text-sm text-red-400 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">{error}</p>}
      {notice && <p className="mb-3 text-sm text-green-400 bg-green-900/20 border border-green-800/50 rounded-lg px-3 py-2">{notice}</p>}

      {/* ── Convert ── */}
      {tab === 'convert' && (
        <form onSubmit={submitConvert} className="space-y-3">
          <FileSelect label="Select file" value={convFile} onChange={setConvFile} files={files} onUploaded={handleUploaded('convert')} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Output format</label>
              <select className="input text-sm" value={convFmt} onChange={e => setConvFmt(e.target.value)}>
                {CONVERT_FORMATS.map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Resolution</label>
              <select className="input text-sm" value={convRes} onChange={e => setConvRes(e.target.value)}>
                {RESOLUTIONS.map(r => <option key={r} value={r}>{r || 'Keep original'}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Video bitrate (e.g. 2000k)</label>
              <input className="input text-sm" placeholder="auto" value={convVBit} onChange={e => setConvVBit(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Audio bitrate (e.g. 192k)</label>
              <input className="input text-sm" placeholder="auto" value={convABit} onChange={e => setConvABit(e.target.value)} />
            </div>
          </div>
          <button type="submit" className="btn-primary w-full" disabled={loading}>{loading ? 'Processing…' : '🔄 Convert'}</button>
          <JobResult jobId={jobId} onDone={onJobDone} />
        </form>
      )}

      {/* ── Batch Convert ── */}
      {tab === 'batch_convert' && (
        <form onSubmit={submitBatch} className="space-y-3">
          <FileSelect label="Select files (up to 20)" onChange={setBatchFiles} files={files} multi selected={batchFiles} onUploaded={refreshFiles} />
          <div>
            <label className="block text-xs text-gray-400 mb-1">Output format</label>
            <select className="input text-sm" value={batchFmt} onChange={e => setBatchFmt(e.target.value)}>
              {CONVERT_FORMATS.map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}
            </select>
          </div>
          <button type="submit" className="btn-primary w-full" disabled={loading}>{loading ? 'Processing…' : '📦 Batch Convert'}</button>
          <JobResult jobId={jobId} onDone={onJobDone} />
        </form>
      )}

      {/* ── Trim ── */}
      {tab === 'trim' && (
        <form onSubmit={submitTrim} className="space-y-3">
          <FileSelect label="Select file" value={trimFile} onChange={setTrimFile} files={files} onUploaded={handleUploaded('trim')} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Start time (HH:MM:SS)</label>
              <input className="input text-sm" placeholder="00:00:10" value={trimStart} onChange={e => setTrimStart(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">End time (HH:MM:SS)</label>
              <input className="input text-sm" placeholder="00:01:30" value={trimEnd} onChange={e => setTrimEnd(e.target.value)} />
            </div>
          </div>
          <button type="submit" className="btn-primary w-full" disabled={loading}>{loading ? 'Processing…' : '✂ Trim Video'}</button>
          <JobResult jobId={jobId} onDone={onJobDone} />
        </form>
      )}

      {/* ── Crop ── */}
      {tab === 'crop' && (
        <form onSubmit={submitCrop} className="space-y-3">
          <FileSelect label="Select file" value={cropFile} onChange={setCropFile} files={files} onUploaded={handleUploaded('crop')} />
          <div className="grid grid-cols-2 gap-3">
            {[['X offset', cropX, setCropX, '0'], ['Y offset', cropY, setCropY, '0'],
              ['Width (px)', cropW, setCropW, '1280'], ['Height (px)', cropH, setCropH, '720']].map(([lbl, val, set, ph]) => (
              <div key={lbl}>
                <label className="block text-xs text-gray-400 mb-1">{lbl}</label>
                <input className="input text-sm" type="number" placeholder={ph} value={val} onChange={e => set(e.target.value)} />
              </div>
            ))}
          </div>
          <button type="submit" className="btn-primary w-full" disabled={loading}>{loading ? 'Processing…' : '⊞ Crop Video'}</button>
          <JobResult jobId={jobId} onDone={onJobDone} />
        </form>
      )}

      {/* ── Watermark ── */}
      {tab === 'watermark' && (
        <form onSubmit={submitWm} className="space-y-3">
          <FileSelect label="Select file" value={wmFile} onChange={setWmFile} files={files} onUploaded={handleUploaded('watermark')} />
          <div>
            <label className="block text-xs text-gray-400 mb-1">Watermark text</label>
            <input className="input text-sm" placeholder="YOT Downloader" value={wmText} onChange={e => setWmText(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Position</label>
              <select className="input text-sm" value={wmPos} onChange={e => setWmPos(e.target.value)}>
                {WATERMARK_POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Font size</label>
              <input className="input text-sm" type="number" min="12" max="72" value={wmSize} onChange={e => setWmSize(e.target.value)} />
            </div>
          </div>
          <button type="submit" className="btn-primary w-full" disabled={loading}>{loading ? 'Processing…' : '💧 Add Watermark'}</button>
          <JobResult jobId={jobId} onDone={onJobDone} />
        </form>
      )}

      {/* ── Extract Clip ── */}
      {tab === 'extract' && (
        <form onSubmit={submitExtract} className="space-y-3">
          <FileSelect label="Select file" value={exFile} onChange={setExFile} files={files} onUploaded={handleUploaded('extract')} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Start time (HH:MM:SS)</label>
              <input className="input text-sm" placeholder="00:00:30" value={exStart} onChange={e => setExStart(e.target.value)} required />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Duration (10–60 sec)</label>
              <input className="input text-sm" type="number" min="10" max="60" value={exDur} onChange={e => setExDur(e.target.value)} />
            </div>
          </div>
          <button type="submit" className="btn-primary w-full" disabled={loading}>{loading ? 'Processing…' : '🎬 Extract Clip'}</button>
          <JobResult jobId={jobId} onDone={onJobDone} />
        </form>
      )}

      {/* ── Merge ── */}
      {tab === 'merge' && (
        <form onSubmit={submitMerge} className="space-y-3">
          <FileSelect label="Select files to merge (in order)" onChange={setMergeFiles} files={files} multi selected={mergeFiles} onUploaded={refreshFiles} />
          <div>
            <label className="block text-xs text-gray-400 mb-1">Output format</label>
            <select className="input text-sm" value={mergeFmt} onChange={e => setMergeFmt(e.target.value)}>
              {['mp4','webm','mkv','avi'].map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}
            </select>
          </div>
          <button type="submit" className="btn-primary w-full" disabled={loading}>{loading ? 'Processing…' : '🔗 Merge Videos'}</button>
          <JobResult jobId={jobId} onDone={onJobDone} />
        </form>
      )}
    </div>
  )
}
