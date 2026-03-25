import { useState, useRef } from 'react'
import { convertDoc, extractDocText, triggerBlobDownload } from '../api'

// Conversion matrix: source extension → available target formats
const CONVERSION_MAP = {
  pdf:  [
    { value: 'word',        label: '📝 Word (.docx)',        icon: '📝' },
    { value: 'excel',       label: '📊 Excel (.xlsx)',       icon: '📊' },
    { value: 'powerpoint',  label: '📊 PowerPoint (.pptx)',  icon: '📊' },
    { value: 'jpeg',        label: '🖼 JPEG image',          icon: '🖼' },
    { value: 'png',         label: '🖼 PNG image',           icon: '🖼' },
    { value: 'text',        label: '📄 Plain Text (.txt)',   icon: '📄' },
  ],
  docx: [
    { value: 'pdf',         label: '📄 PDF',                 icon: '📄' },
    { value: 'excel',       label: '📊 Excel (.xlsx)',       icon: '📊' },
    { value: 'powerpoint',  label: '📊 PowerPoint (.pptx)',  icon: '📊' },
    { value: 'jpeg',        label: '🖼 JPEG image',          icon: '🖼' },
    { value: 'png',         label: '🖼 PNG image',           icon: '🖼' },
    { value: 'text',        label: '📄 Plain Text (.txt)',   icon: '📄' },
  ],
  doc: [
    { value: 'pdf',         label: '📄 PDF',                 icon: '📄' },
    { value: 'excel',       label: '📊 Excel (.xlsx)',       icon: '📊' },
    { value: 'powerpoint',  label: '📊 PowerPoint (.pptx)',  icon: '📊' },
    { value: 'jpeg',        label: '🖼 JPEG image',          icon: '🖼' },
    { value: 'png',         label: '🖼 PNG image',           icon: '🖼' },
    { value: 'text',        label: '📄 Plain Text (.txt)',   icon: '📄' },
  ],
  rtf:  [
    { value: 'pdf',         label: '📄 PDF',                 icon: '📄' },
    { value: 'text',        label: '📄 Plain Text (.txt)',   icon: '📄' },
  ],
  txt:  [
    { value: 'pdf',         label: '📄 PDF',                 icon: '📄' },
  ],
  xlsx: [
    { value: 'pdf',         label: '📄 PDF',                 icon: '📄' },
    { value: 'word',        label: '📝 Word (.docx)',        icon: '📝' },
    { value: 'powerpoint',  label: '📊 PowerPoint (.pptx)',  icon: '📊' },
    { value: 'jpeg',        label: '🖼 JPEG image',          icon: '🖼' },
    { value: 'png',         label: '🖼 PNG image',           icon: '🖼' },
  ],
  xls: [
    { value: 'pdf',         label: '📄 PDF',                 icon: '📄' },
    { value: 'word',        label: '📝 Word (.docx)',        icon: '📝' },
    { value: 'powerpoint',  label: '📊 PowerPoint (.pptx)',  icon: '📊' },
    { value: 'jpeg',        label: '🖼 JPEG image',          icon: '🖼' },
    { value: 'png',         label: '🖼 PNG image',           icon: '🖼' },
  ],
  pptx: [
    { value: 'pdf',         label: '📄 PDF',                 icon: '📄' },
    { value: 'word',        label: '📝 Word (.docx)',        icon: '📝' },
    { value: 'excel',       label: '📊 Excel (.xlsx)',       icon: '📊' },
    { value: 'jpeg',        label: '🖼 JPEG image',          icon: '🖼' },
    { value: 'png',         label: '🖼 PNG image',           icon: '🖼' },
  ],
  ppt: [
    { value: 'pdf',         label: '📄 PDF',                 icon: '📄' },
    { value: 'word',        label: '📝 Word (.docx)',        icon: '📝' },
    { value: 'excel',       label: '📊 Excel (.xlsx)',       icon: '📊' },
    { value: 'jpeg',        label: '🖼 JPEG image',          icon: '🖼' },
    { value: 'png',         label: '🖼 PNG image',           icon: '🖼' },
  ],
  odt: [
    { value: 'pdf',         label: '📄 PDF',                 icon: '📄' },
    { value: 'word',        label: '📝 Word (.docx)',        icon: '📝' },
    { value: 'excel',       label: '📊 Excel (.xlsx)',       icon: '📊' },
    { value: 'text',        label: '📄 Plain Text (.txt)',   icon: '📄' },
  ],
  ods: [
    { value: 'pdf',         label: '📄 PDF',                 icon: '📄' },
    { value: 'word',        label: '📝 Word (.docx)',        icon: '📝' },
    { value: 'excel',       label: '📊 Excel (.xlsx)',       icon: '📊' },
  ],
  jpg: [
    { value: 'pdf',         label: '📄 PDF',                 icon: '📄' },
    { value: 'word',        label: '📝 Word (.docx)',        icon: '📝' },
    { value: 'png',         label: '🖼 PNG image',           icon: '🖼' },
  ],
  jpeg: [
    { value: 'pdf',         label: '📄 PDF',                 icon: '📄' },
    { value: 'word',        label: '📝 Word (.docx)',        icon: '📝' },
    { value: 'png',         label: '🖼 PNG image',           icon: '🖼' },
  ],
  png: [
    { value: 'pdf',         label: '📄 PDF',                 icon: '📄' },
    { value: 'word',        label: '📝 Word (.docx)',        icon: '📝' },
    { value: 'jpeg',        label: '🖼 JPEG image',          icon: '🖼' },
  ],
}

const SUPPORTED_EXTS = Object.keys(CONVERSION_MAP)

const ACCEPT_TYPES = [
  '.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt',
  '.odt', '.ods', '.jpg', '.jpeg', '.png', '.rtf', '.txt',
].join(',')

function getExt(filename) {
  return (filename || '').split('.').pop().toLowerCase()
}

function humanSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

// ─── Text Extractor sub-component ─────────────────────────────────────────────

const TEXT_EXTRACT_EXTS = ['.pdf', '.docx', '.doc', '.odt', '.txt', '.rtf']
const TEXT_EXTRACT_ACCEPT = TEXT_EXTRACT_EXTS.join(',')

function TextExtractor() {
  const [file, setFile]         = useState(null)
  const [status, setStatus]     = useState(null) // null | 'loading' | 'done' | 'error'
  const [errMsg, setErrMsg]     = useState('')
  const [result, setResult]     = useState(null) // { text, filename, truncated }
  const [copied, setCopied]     = useState(false)
  const fileInputRef            = useRef(null)

  const ext       = file ? getExt(file.name) : null
  const supported = ext ? TEXT_EXTRACT_EXTS.includes('.' + ext) : false
  const unsupported = file && !supported

  const handleFileChange = (e) => {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    setStatus(null)
    setResult(null)
    setErrMsg('')
  }

  const handleExtract = async () => {
    if (!file) return
    setStatus('loading')
    setResult(null)
    setErrMsg('')
    try {
      const data = await extractDocText(file)
      setResult(data)
      setStatus('done')
    } catch (err) {
      setErrMsg(err.message || 'Extraction failed.')
      setStatus('error')
    }
  }

  const reset = () => {
    setFile(null)
    setStatus(null)
    setResult(null)
    setErrMsg('')
    setCopied(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleCopy = () => {
    if (!result?.text) return
    navigator.clipboard.writeText(result.text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleSave = () => {
    if (!result?.text) return
    const outName = (result.filename || 'extracted').replace(/\.[^.]+$/, '') + '.txt'
    const blob = new Blob([result.text], { type: 'text/plain;charset=utf-8' })
    triggerBlobDownload(blob, outName)
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400">
        Upload a PDF, Word, ODT or TXT file to extract clean, plain text — line breaks, emojis
        and bullet points are preserved.
      </p>

      {/* File picker */}
      <div
        style={{
          border: '2px dashed #374151', borderRadius: 10, padding: '20px 16px',
          textAlign: 'center', cursor: 'pointer', background: '#111827',
          transition: 'border-color 0.2s',
        }}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#dc2626' }}
        onDragLeave={e => { e.currentTarget.style.borderColor = '#374151' }}
        onDrop={e => {
          e.preventDefault()
          e.currentTarget.style.borderColor = '#374151'
          const f = e.dataTransfer.files?.[0]
          if (f) { setFile(f); setStatus(null); setResult(null); setErrMsg('') }
        }}
      >
        {file ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.5rem' }}>{ext === 'pdf' ? '📄' : ext === 'txt' ? '📝' : '📃'}</span>
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
            <div style={{ color: '#9ca3af', fontSize: '0.82rem' }}>Click to browse or drag &amp; drop</div>
            <div style={{ color: '#4b5563', fontSize: '0.72rem', marginTop: 4 }}>PDF, DOCX, DOC, ODT, TXT — up to 20 MB</div>
          </div>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept={TEXT_EXTRACT_ACCEPT}
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {unsupported && (
        <div style={{ color: '#f87171', fontSize: '0.78rem' }}>
          ⚠️ Unsupported file type ".{ext}". Supported: {TEXT_EXTRACT_EXTS.join(', ')}.
        </div>
      )}

      {file && supported && (
        <button
          type="button"
          onClick={handleExtract}
          disabled={status === 'loading'}
          className="btn-primary"
          style={{ width: '100%', fontSize: '0.9rem', padding: '10px 0' }}
        >
          {status === 'loading' ? '⏳ Extracting…' : '📄 Extract Text'}
        </button>
      )}

      {status === 'error' && (
        <div style={{
          borderRadius: 8, padding: '10px 14px',
          background: '#7f1d1d33', border: '1px solid #991b1b44',
          fontSize: '0.82rem', color: '#f87171', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span>❌</span>
          <span>{errMsg}</span>
          <button
            type="button"
            onClick={() => setStatus(null)}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '0.78rem', textDecoration: 'underline' }}
          >Dismiss</button>
        </div>
      )}

      {result && status === 'done' && (
        <div>
          {result.truncated && (
            <div style={{ color: '#fbbf24', fontSize: '0.75rem', marginBottom: 8 }}>
              ⚠️ Content was trimmed to 200,000 characters.
            </div>
          )}
          <div style={{
            background: '#111827', border: '1px solid #374151', borderRadius: 8,
            padding: '12px 14px', maxHeight: 320, overflowY: 'auto',
            fontFamily: 'monospace', fontSize: '0.78rem', color: '#e5e7eb',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6,
          }}>
            {result.text || '(no text found)'}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              type="button"
              onClick={handleCopy}
              style={{
                flex: 1, borderRadius: 8, padding: '8px 0', fontSize: '0.82rem',
                fontWeight: 600, cursor: 'pointer',
                border: '1px solid #374151', background: '#1f2937', color: '#d1d5db',
                transition: 'all 0.15s',
              }}
            >
              {copied ? '✅ Copied!' : '📋 Copy Text'}
            </button>
            <button
              type="button"
              onClick={handleSave}
              style={{
                flex: 1, borderRadius: 8, padding: '8px 0', fontSize: '0.82rem',
                fontWeight: 600, cursor: 'pointer',
                border: '1px solid #374151', background: '#1f2937', color: '#d1d5db',
                transition: 'all 0.15s',
              }}
            >
              💾 Save as .txt
            </button>
            <button
              type="button"
              onClick={reset}
              style={{
                borderRadius: 8, padding: '8px 16px', fontSize: '0.82rem',
                fontWeight: 600, cursor: 'pointer',
                border: '1px solid #374151', background: '#1f293780', color: '#9ca3af',
                transition: 'all 0.15s',
              }}
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main DocConverter with sub-tabs ──────────────────────────────────────────

export default function DocConverter() {
  const [subTab, setSubTab]           = useState('format')
  const [file, setFile]               = useState(null)
  const [target, setTarget]           = useState(null)
  const [status, setStatus]           = useState(null)
  // Preview-first state:
  //   null            = no result yet
  //   { blob, outName, textPreview? } = converted result ready to download
  const [result, setResult]           = useState(null)
  const [previewText, setPreviewText] = useState(null)   // editable text for text-output conversions
  const [copied, setCopied]           = useState(false)
  const fileInputRef                  = useRef(null)

  const ext       = file ? getExt(file.name) : null
  const options   = ext ? (CONVERSION_MAP[ext] || []) : []
  const unsupported = file && !CONVERSION_MAP[ext]

  const handleFileChange = (e) => {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    setTarget(null)
    setStatus(null)
    setResult(null)
    setPreviewText(null)
    if (f) {
      const fExt = getExt(f.name)
      const opts = CONVERSION_MAP[fExt] || []
      if (opts.length === 1) setTarget(opts[0].value)
    }
  }

  // Step 1: Convert and show preview — do NOT auto-download
  const handleConvert = async () => {
    if (!file || !target) return
    setStatus({ type: 'loading', msg: 'Converting… please wait.' })
    setResult(null)
    setPreviewText(null)
    try {
      const res = await convertDoc(file, target)
      if (!res.ok) {
        let msg = 'Server error (' + res.status + ')'
        try { const j = await res.json(); if (j.error) msg = j.error } catch {}
        throw new Error(msg)
      }
      const blob = await res.blob()
      if (blob.size === 0) throw new Error('Conversion produced an empty file.')

      // Determine output filename from Content-Disposition
      const cd = res.headers.get('content-disposition') || ''
      let outName = 'converted'
      const m = cd.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
      if (m) outName = m[1].replace(/['"]/g, '').trim()

      // For plain-text output, read the text so the user can preview / edit it
      let textContent = null
      if (target === 'text') {
        textContent = await blob.text()
      }

      setResult({ blob, outName })
      setPreviewText(textContent)
      setStatus({ type: 'ready', msg: `Conversion complete — review the preview, then click Download.` })
    } catch (err) {
      setStatus({ type: 'error', msg: err.message || 'Conversion failed.' })
    }
  }

  // Step 2: User explicitly triggers the download
  const handleDownload = () => {
    if (!result) return
    if (previewText !== null) {
      // Download the (possibly edited) text
      const blob = new Blob([previewText], { type: 'text/plain;charset=utf-8' })
      triggerBlobDownload(blob, result.outName)
    } else {
      triggerBlobDownload(result.blob, result.outName)
    }
    setStatus({ type: 'success', msg: `Downloaded as "${result.outName}".` })
  }

  const handleCopy = () => {
    if (!previewText) return
    navigator.clipboard.writeText(previewText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const reset = () => {
    setFile(null)
    setTarget(null)
    setStatus(null)
    setResult(null)
    setPreviewText(null)
    setCopied(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          🔄 Document Converter
        </h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Convert between formats, or extract clean text from any document.
        </p>
      </div>

      {/* Sub-tab bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[
          { id: 'format', label: '🔄 Format Converter' },
          { id: 'text',   label: '📄 Text Extractor' },
        ].map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubTab(t.id)}
            style={{
              borderRadius: 8, padding: '7px 16px', fontSize: '0.82rem',
              fontWeight: 600, cursor: 'pointer',
              border: subTab === t.id ? '2px solid #dc2626' : '1px solid #374151',
              background: subTab === t.id ? '#dc262622' : '#1f293780',
              color: subTab === t.id ? '#fff' : '#9ca3af',
              transition: 'all 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'text' && <TextExtractor />}

      {subTab === 'format' && (
      <div>
      <div style={{
        background: '#1f2937', border: '1px solid #374151',
        borderRadius: 10, padding: '10px 14px', marginBottom: 18,
      }}>
        <div style={{ fontSize: '0.72rem', color: '#6b7280', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Supported conversions
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {[
            { from: 'PDF',        to: 'Word / Excel / PowerPoint / JPEG / PNG / Text' },
            { from: 'Word / ODT', to: 'PDF / Text'                                    },
            { from: 'RTF',        to: 'PDF / Text'                                    },
            { from: 'TXT',        to: 'PDF'                                           },
            { from: 'Excel',      to: 'PDF / Word / PowerPoint / JPEG / PNG'          },
            { from: 'PowerPoint', to: 'PDF / Word / Excel / JPEG / PNG'               },
            { from: 'JPEG/PNG',   to: 'PDF / Word / JPEG↔PNG'                        },
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
                setResult(null)
                setPreviewText(null)
                const fExt = getExt(f.name)
                const opts = CONVERSION_MAP[fExt] || []
                if (opts.length === 1) setTarget(opts[0].value)
              }
            }}
          >
            {file ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <span style={{ fontSize: '1.5rem' }}>
                  {ext === 'pdf' ? '📄'
                    : ['jpg','jpeg','png'].includes(ext) ? '🖼'
                    : ['pptx','ppt'].includes(ext) ? '📊'
                    : '📝'}
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
                  PDF, DOCX, DOC, RTF, TXT, XLSX, XLS, PPTX, PPT, ODT, ODS, JPEG, PNG — up to 50 MB
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
                  onClick={() => { setTarget(opt.value); setStatus(null); setResult(null); setPreviewText(null) }}
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
        {file && target && !result && (
          <button
            type="button"
            onClick={handleConvert}
            disabled={status?.type === 'loading'}
            className="btn-primary"
            style={{ width: '100%', fontSize: '0.9rem', padding: '10px 0' }}
          >
            {status?.type === 'loading' ? '⏳ Converting…' : '🔄 Convert & Preview'}
          </button>
        )}

        {/* Step 4: Preview pane — shown after conversion, before download */}
        {result && (
          <div>
            {/* Status banner */}
            <div style={{
              borderRadius: 8, padding: '10px 14px', marginBottom: 12,
              background: '#1a3a2a33', border: '1px solid #065f4644',
              fontSize: '0.82rem', color: '#34d399',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span>✅</span>
              <span>Conversion ready — <strong>{result.outName}</strong></span>
              <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: '#6b7280' }}>
                {humanSize(previewText !== null ? new Blob([previewText]).size : result.blob.size)}
              </span>
            </div>

            {/* Text preview / editor (for text-output conversions) */}
            {previewText !== null && (
              <div style={{ marginBottom: 12 }}>
                <div style={{
                  fontSize: '0.72rem', color: '#6b7280', marginBottom: 4, fontWeight: 600,
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>
                  Preview — you can edit the text before downloading
                </div>
                <textarea
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    background: '#111827', border: '1px solid #374151',
                    borderRadius: 8, padding: '10px 12px',
                    fontFamily: 'monospace', fontSize: '0.78rem',
                    color: '#e5e7eb', whiteSpace: 'pre-wrap',
                    minHeight: 200, resize: 'vertical',
                    lineHeight: 1.6,
                  }}
                  value={previewText}
                  onChange={e => setPreviewText(e.target.value)}
                  aria-label="Converted text preview — editable"
                />
              </div>
            )}

            {/* For non-text outputs, show a file info card */}
            {previewText === null && (
              <div style={{
                background: '#1f2937', border: '1px solid #374151',
                borderRadius: 8, padding: '12px 14px', marginBottom: 12,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <span style={{ fontSize: '2rem' }}>
                  {['pdf'].includes(target) ? '📄'
                    : ['word'].includes(target) ? '📝'
                    : ['excel'].includes(target) ? '📊'
                    : ['jpeg', 'png'].includes(target) ? '🖼'
                    : '📁'}
                </span>
                <div>
                  <div style={{ color: '#f3f4f6', fontSize: '0.85rem', fontWeight: 600 }}>{result.outName}</div>
                  <div style={{ color: '#6b7280', fontSize: '0.72rem', marginTop: 2 }}>
                    {humanSize(result.blob.size)} — ready to download
                  </div>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={handleDownload}
                className="btn-primary"
                style={{ flex: 2, fontSize: '0.9rem', padding: '10px 0' }}
              >
                ⬇️ Download
              </button>
              {previewText !== null && (
                <button
                  type="button"
                  onClick={handleCopy}
                  style={{
                    flex: 1, borderRadius: 8, padding: '10px 0', fontSize: '0.82rem',
                    fontWeight: 600, cursor: 'pointer',
                    border: '1px solid #374151', background: '#1f2937', color: '#d1d5db',
                    transition: 'all 0.15s',
                  }}
                >
                  {copied ? '✅ Copied!' : '📋 Copy'}
                </button>
              )}
              <button
                type="button"
                onClick={reset}
                style={{
                  flex: 1, borderRadius: 8, padding: '10px 0', fontSize: '0.82rem',
                  fontWeight: 600, cursor: 'pointer',
                  border: '1px solid #374151', background: '#1f293780', color: '#9ca3af',
                  transition: 'all 0.15s',
                }}
              >
                🔄 New
              </button>
            </div>
          </div>
        )}

        {/* Status — error only; 'ready' state is shown inline above */}
        {status && status.type === 'error' && (
          <div style={{
            borderRadius: 8, padding: '10px 14px',
            background: '#7f1d1d33',
            border: '1px solid #991b1b44',
            fontSize: '0.82rem', color: '#f87171',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span>❌</span>
            <span>{status.msg}</span>
            <button
              type="button"
              onClick={() => setStatus(null)}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '0.78rem', textDecoration: 'underline' }}
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
      </div>
      )}
    </div>
  )
}
