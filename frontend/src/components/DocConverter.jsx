import { useState, useRef, useEffect } from 'react'
import { convertDoc } from '../api'

const FORMAT_OPTIONS = [
  { value: 'pdf',  label: 'PDF (.pdf)' },
  { value: 'docx', label: 'Word (.docx)' },
  { value: 'xlsx', label: 'Excel (.xlsx)' },
  { value: 'pptx', label: 'PowerPoint (.pptx)' },
  { value: 'odt',  label: 'OpenDocument Text (.odt)' },
  { value: 'html', label: 'HTML (.html)' },
  { value: 'md',   label: 'Markdown (.md)' },
  { value: 'txt',  label: 'Plain Text (.txt)' },
  { value: 'csv',  label: 'CSV (.csv)' },
  { value: 'png',  label: 'Image PNG (.png)' },
  { value: 'jpg',  label: 'Image JPG (.jpg)' },
  { value: 'epub', label: 'e-Book (.epub)' },
]

// Supported target formats for each source file extension.
// Image files can only be converted to PDF; all other formats follow the
// backend strategy table.  Keeping this in sync with _doc_conv_strategy in
// api/app.py prevents users from selecting a combination that would fail.
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'tiff', 'bmp', 'gif', 'webp'])
const TEXT_LIKE_EXTS = new Set(['md', 'html', 'htm', 'txt', 'epub'])
// Image formats that can be converted to other image formats via Pillow
const IMG2IMG_FORMATS = ['png', 'jpg', 'jpeg']

function getSupportedTargets(srcExt) {
  if (!srcExt) return FORMAT_OPTIONS.map(o => o.value)
  const ext = srcExt.toLowerCase().replace(/^\./, '')
  if (IMAGE_EXTS.has(ext)) return ['pdf', ...IMG2IMG_FORMATS.filter(e => e !== ext)]
  if (ext === 'pdf') return ['docx', 'png', 'jpg', 'xlsx', 'txt', 'html', 'md', 'epub']
  if (TEXT_LIKE_EXTS.has(ext)) return ['pdf', 'docx', 'html', 'md', 'txt', 'epub', 'odt']
  if (['xlsx', 'xls'].includes(ext)) return ['pdf', 'csv', 'html', 'odt', 'docx']
  if (['pptx', 'ppt', 'odp'].includes(ext)) return ['pdf', 'txt', 'html']
  // Office / ODF text formats (docx, doc, odt, etc.) — include xlsx so Word → Excel works
  return ['pdf', 'docx', 'xlsx', 'odt', 'html', 'md', 'txt', 'epub']
}

export default function DocConverter() {
  const [file, setFile] = useState(null)
  const [target, setTarget] = useState('pdf')
  const [dragging, setDragging] = useState(false)
  const [status, setStatus] = useState(null) // null | { type, msg }
  const fileInputRef = useRef(null)
  const btnRef = useRef(null)

  const srcExt = file ? file.name.split('.').pop() : null
  const supportedTargets = getSupportedTargets(srcExt)
  const isUnsupported = file && !supportedTargets.includes(target)

  // When a new file is selected, reset target to the first supported format.
  useEffect(() => {
    if (!file) return
    const ext = file.name.split('.').pop()
    const supported = getSupportedTargets(ext)
    setTarget(prev => (supported.includes(prev) ? prev : (supported[0] || 'pdf')))
  }, [file])

  const setSelectedFile = (f) => {
    setFile(f || null)
    setStatus(null)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) setSelectedFile(dropped)
  }

  const handleConvert = async () => {
    if (!file) {
      setStatus({ type: 'error', msg: 'Please select a file to convert.' })
      return
    }
    if (isUnsupported) {
      const ext = srcExt ? `.${srcExt.toLowerCase()}` : 'this file type'
      setStatus({
        type: 'error',
        msg: `Converting ${ext} files to .${target} is not supported. Please choose a supported target format.`,
      })
      return
    }
    setStatus({ type: 'loading', msg: 'Converting…' })
    if (btnRef.current) btnRef.current.disabled = true
    try {
      const res = await convertDoc(file, target)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const origName = file.name.replace(/\.[^.]+$/, '')
      const a = document.createElement('a')
      a.href = url
      a.download = `${origName}.${target}`
      a.click()
      URL.revokeObjectURL(url)
      setStatus({ type: 'success', msg: 'Converted and downloaded!' })
    } catch (err) {
      setStatus({ type: 'error', msg: err.message || 'Conversion failed.' })
    } finally {
      if (btnRef.current) btnRef.current.disabled = false
    }
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          📁 Document Converter
        </h2>
        <p className="text-xs text-gray-400 mt-1">
          Convert between PDF, Word, Excel, PowerPoint, images, Markdown, HTML and more.
        </p>
      </div>

      <div className="space-y-4">
        {/* Drop zone */}
        <div className="space-y-1">
          <label className="form-label">
            📤 Upload File <span className="text-red-500">*</span>
          </label>
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              dragging
                ? 'border-blue-500 bg-blue-950/30'
                : 'border-gray-600 hover:border-gray-500'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click() }}
            aria-label="Upload file for conversion"
          >
            <div className="text-3xl mb-2">📂</div>
            <p className="text-sm text-gray-400">
              Drag &amp; drop a file here, or <strong className="text-gray-200">click to browse</strong>
            </p>
            {file && (
              <p className="mt-2 text-xs text-blue-400 font-medium">{file.name}</p>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => setSelectedFile(e.target.files[0])}
          />
        </div>

        {/* Target format */}
        <div className="space-y-1 max-w-xs">
          <label className="form-label">
            🔄 Convert To <span className="text-red-500">*</span>
          </label>
          <select
            className="input"
            value={target}
            onChange={(e) => { setTarget(e.target.value); setStatus(null) }}
          >
            {FORMAT_OPTIONS.map(opt => {
              const supported = supportedTargets.includes(opt.value)
              return (
                <option key={opt.value} value={opt.value} disabled={!supported}>
                  {supported ? opt.label : `${opt.label} — not supported for this file`}
                </option>
              )
            })}
          </select>
          {isUnsupported && (
            <p className="text-xs text-yellow-400 mt-1">
              ⚠ This combination is not supported. Please select a different target format.
            </p>
          )}
        </div>

        <button
          ref={btnRef}
          className="btn-primary w-full sm:w-auto"
          onClick={handleConvert}
          disabled={!!isUnsupported}
        >
          ⚙ Convert &amp; Download
        </button>

        {status && (
          <div className={`text-sm ${
            status.type === 'loading' ? 'text-gray-400' :
            status.type === 'success' ? 'text-green-400' : 'text-red-400'
          }`}>
            {status.type === 'loading' && '⏳ '}
            {status.type === 'success' && '✅ '}
            {status.type === 'error'   && '❌ '}
            {status.msg}
          </div>
        )}
      </div>
    </div>
  )
}
