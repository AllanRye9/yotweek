import { useState, useRef } from 'react'
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

export default function DocConverter() {
  const [file, setFile] = useState(null)
  const [target, setTarget] = useState('pdf')
  const [dragging, setDragging] = useState(false)
  const [status, setStatus] = useState(null) // null | { type, msg }
  const fileInputRef = useRef(null)
  const btnRef = useRef(null)

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
      setStatus({ type: 'error', msg: err.message || 'Conversion failed' })
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
            onChange={(e) => setTarget(e.target.value)}
          >
            {FORMAT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <button ref={btnRef} className="btn-primary w-full sm:w-auto" onClick={handleConvert}>
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
