import { useState, useRef } from 'react'
import { convertDoc } from '../api'

// Conversion matrix: source extension → available target formats
const CONVERSION_MAP = {
  pdf:  [
    { value: 'word',  label: '📝 Word (.docx)',  icon: '📝' },
    { value: 'excel', label: '📊 Excel (.xlsx)', icon: '📊' },
    { value: 'jpeg',  label: '🖼 JPEG image',    icon: '🖼' },
    { value: 'png',   label: '🖼 PNG image',     icon: '🖼' },
  ],
  docx: [{ value: 'pdf', label: '📄 PDF', icon: '📄' }],
  doc:  [{ value: 'pdf', label: '📄 PDF', icon: '📄' }],
  xlsx: [{ value: 'pdf', label: '📄 PDF', icon: '📄' }],
  xls:  [{ value: 'pdf', label: '📄 PDF', icon: '📄' }],
  jpg:  [{ value: 'pdf', label: '📄 PDF', icon: '📄' }],
  jpeg: [{ value: 'pdf', label: '📄 PDF', icon: '📄' }],
  png:  [{ value: 'pdf', label: '📄 PDF', icon: '📄' }],
}

const SUPPORTED_EXTS = Object.keys(CONVERSION_MAP)

const ACCEPT_TYPES = [
  '.pdf', '.docx', '.doc', '.xlsx', '.xls',
  '.jpg', '.jpeg', '.png',
].join(',')

function getExt(filename) {
  return (filename || '').split('.').pop().toLowerCase()
}

function humanSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

export default function DocConverter() {
  const [file, setFile]           = useState(null)
  const [target, setTarget]       = useState(null)
  const [status, setStatus]       = useState(null)
  const fileInputRef              = useRef(null)

  const ext       = file ? getExt(file.name) : null
  const options   = ext ? (CONVERSION_MAP[ext] || []) : []
  const unsupported = file && !CONVERSION_MAP[ext]

  const handleFileChange = (e) => {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    setTarget(null)
    setStatus(null)
    if (f) {
      const fExt = getExt(f.name)
      const opts = CONVERSION_MAP[fExt] || []
      if (opts.length === 1) setTarget(opts[0].value)
    }
  }

  const handleConvert = async () => {
    if (!file || !target) return
    setStatus({ type: 'loading', msg: 'Converting… please wait.' })
    try {
      const res = await convertDoc(file, target)
      if (!res.ok) {
        let msg = 'Server error (' + res.status + ')'
        try { const j = await res.json(); if (j.error) msg = j.error } catch {}
        throw new Error(msg)
      }
      const blob = await res.blob()
      if (blob.size === 0) throw new Error('Conversion produced an empty file.')

      // Determine output filename
      const cd = res.headers.get('content-disposition') || ''
      let outName = 'converted'
      const m = cd.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
      if (m) outName = m[1].replace(/['"]/g, '').trim()

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = outName; a.click()
      URL.revokeObjectURL(url)
      setStatus({ type: 'success', msg: `Converted and downloaded as "${outName}".` })
    } catch (err) {
      setStatus({ type: 'error', msg: err.message || 'Conversion failed.' })
    }
  }

  const reset = () => {
    setFile(null)
    setTarget(null)
    setStatus(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          🔄 Document Converter
        </h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Convert PDF, Word, Excel, JPEG, and PNG files between formats.
        </p>
      </div>

      {/* Supported conversions legend */}
      <div style={{
        background: '#1f2937', border: '1px solid #374151',
        borderRadius: 10, padding: '10px 14px', marginBottom: 18,
      }}>
        <div style={{ fontSize: '0.72rem', color: '#6b7280', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Supported conversions
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {[
            { from: 'PDF',       to: 'Word / Excel / JPEG / PNG' },
            { from: 'Word',      to: 'PDF' },
            { from: 'Excel',     to: 'PDF' },
            { from: 'JPEG/PNG',  to: 'PDF' },
          ].map(({ from, to }) => (
            <span key={from} style={{
              background: '#374151', borderRadius: 6,
              padding: '3px 10px', fontSize: '0.75rem', color: '#d1d5db',
            }}>
              {from} <span aria-label="to">→</span> {to}
            </span>
          ))}
        </div>
      </div>

      {/* Step 1: File picker */}
      <div className="space-y-4">
        <div>
          <label className="form-label mb-1 block">1. Choose a file</label>
          <div style={{
            border: '2px dashed #374151',
            borderRadius: 10, padding: '20px 16px',
            textAlign: 'center', cursor: 'pointer',
            background: '#111827',
            transition: 'border-color 0.2s',
          }}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#dc2626' }}
            onDragLeave={e => { e.currentTarget.style.borderColor = '#374151' }}
            onDrop={e => {
              e.preventDefault()
              e.currentTarget.style.borderColor = '#374151'
              const f = e.dataTransfer.files?.[0]
              if (f) {
                setFile(f)
                setTarget(null)
                setStatus(null)
                const fExt = getExt(f.name)
                const opts = CONVERSION_MAP[fExt] || []
                if (opts.length === 1) setTarget(opts[0].value)
              }
            }}
          >
            {file ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <span style={{ fontSize: '1.5rem' }}>
                  {ext === 'pdf' ? '📄' : ['jpg','jpeg','png'].includes(ext) ? '🖼' : '📝'}
                </span>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ color: '#f3f4f6', fontSize: '0.85rem', fontWeight: 600 }}>{file.name}</div>
                  <div style={{ color: '#6b7280', fontSize: '0.72rem' }}>{humanSize(file.size)}</div>
                </div>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); reset() }}
                  style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '1rem', marginLeft: 8 }}
                  aria-label="Remove file"
                >✕</button>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: '2rem', marginBottom: 6 }}>📂</div>
                <div style={{ color: '#9ca3af', fontSize: '0.82rem' }}>
                  Click to browse or drag &amp; drop a file here
                </div>
                <div style={{ color: '#4b5563', fontSize: '0.72rem', marginTop: 4 }}>
                  PDF, DOCX, DOC, XLSX, XLS, JPEG, PNG — up to 50 MB
                </div>
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_TYPES}
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          {unsupported && (
            <div style={{ color: '#f87171', fontSize: '0.78rem', marginTop: 6 }}>
              ⚠️ Unsupported file type ".{ext}". Supported: {SUPPORTED_EXTS.join(', ')}.
            </div>
          )}
        </div>

        {/* Step 2: Target format */}
        {file && options.length > 0 && (
          <div>
            <label className="form-label mb-2 block">2. Convert to</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {options.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { setTarget(opt.value); setStatus(null) }}
                  style={{
                    borderRadius: 8, padding: '8px 16px',
                    fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer',
                    border: target === opt.value ? '2px solid #dc2626' : '1px solid #374151',
                    background: target === opt.value ? '#dc262622' : '#1f293780',
                    color: target === opt.value ? '#fff' : '#d1d5db',
                    transition: 'all 0.15s',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Convert button */}
        {file && target && (
          <button
            type="button"
            onClick={handleConvert}
            disabled={status?.type === 'loading'}
            className="btn-primary"
            style={{ width: '100%', fontSize: '0.9rem', padding: '10px 0' }}
          >
            {status?.type === 'loading' ? '⏳ Converting…' : '🔄 Convert & Download'}
          </button>
        )}

        {/* Status */}
        {status && status.type !== 'loading' && (
          <div style={{
            borderRadius: 8, padding: '10px 14px',
            background: status.type === 'success' ? '#064e3b33' : '#7f1d1d33',
            border: `1px solid ${status.type === 'success' ? '#065f4644' : '#991b1b44'}`,
            fontSize: '0.82rem',
            color: status.type === 'success' ? '#34d399' : '#f87171',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span>{status.type === 'success' ? '✅' : '❌'}</span>
            <span>{status.msg}</span>
            {status.type === 'error' && (
              <button
                type="button"
                onClick={() => setStatus(null)}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '0.78rem', textDecoration: 'underline' }}
              >
                Dismiss
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
