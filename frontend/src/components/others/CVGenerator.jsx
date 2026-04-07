import { useState, useRef, useCallback, useEffect } from 'react'
import { generateCV, generateCVTxt, extractCV, triggerBlobDownload, aiCvSuggest } from '../api'
import ATSScanner from './ATSScanner'

const INITIAL = {
  name: '', email: '', phone: '', location: '',
  link: '', summary: '', experience: '', education: '',
  skills: '', projects: '', publications: '',
}

const PREVIEW_BREAKPOINT_PX = 860
const PREVIEW_STICKY_TOP_PX = 80

const CV_THEMES = [
  { value: 'classic',   label: '🔵 Classic',   desc: 'Blue accent, professional',  accent: '#2563eb', bg: null,      fg: '#1e1e1e' },
  { value: 'modern',    label: '🌑 Modern',    desc: 'Dark header, sleek',         accent: '#0f172a', bg: '#0f172a', fg: '#ffffff' },
  { value: 'minimal',   label: '⬜ Minimal',   desc: 'Clean black & white',        accent: '#000000', bg: null,      fg: '#000000' },
  { value: 'executive', label: '🏅 Executive', desc: 'Navy & gold, authoritative', accent: '#162447', bg: '#162447', fg: '#d4af37' },
  { value: 'creative',  label: '🎨 Creative',  desc: 'Violet gradient, bold',      accent: '#7c3aed', bg: '#7c3aed', fg: '#ffffff' },
  { value: 'tech',      label: '💻 Tech',      desc: 'Dark slate, emerald',        accent: '#10b981', bg: '#0f172a', fg: '#10b981' },
  { value: 'elegant',   label: '🌹 Elegant',   desc: 'Burgundy, refined',          accent: '#9d174d', bg: null,      fg: '#9d174d' },
  { value: 'vibrant',   label: '🟠 Vibrant',   desc: 'Orange energy, modern',      accent: '#ea580c', bg: '#ea580c', fg: '#ffffff' },
]

const STEPS = [
  {
    id: 'personal', title: 'Personal Info', icon: '👤',
    fields: ['name', 'email', 'phone', 'location', 'link'],
    required: ['name', 'email'],
  },
  {
    id: 'summary', title: 'Professional Summary', icon: '📝',
    fields: ['summary'],
    required: [],
  },
  {
    id: 'experience', title: 'Work Experience', icon: '💼',
    fields: ['experience'],
    required: [],
  },
  {
    id: 'education', title: 'Education', icon: '🎓',
    fields: ['education'],
    required: [],
  },
  {
    id: 'skills', title: 'Skills', icon: '⭐',
    fields: ['skills'],
    required: [],
  },
  {
    id: 'extras', title: 'Projects & Publications', icon: '🧪',
    fields: ['projects', 'publications'],
    required: [],
  },
  {
    id: 'theme', title: 'Theme & Logo', icon: '🎨',
    fields: [],
    required: [],
  },
]

// ── Auto-formatters ───────────────────────────────────────────────────────────

function formatName(v) {
  return v.replace(/\b\w/g, c => c.toUpperCase())
}

function formatPhone(v) {
  return v.replace(/[^\d\s+\-().]/g, '')
}

function normalizeSkills(v) {
  const parts = v.split(',').map(s => s.trim()).filter(Boolean)
  const seen = new Set()
  const unique = parts.filter(s => { const k = s.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
  return unique.join(', ')
}

function normalizeMultiline(v) {
  return v
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[-*]\s+/gm, '• ')
    .trim()
}

function normalizeLink(v) {
  const t = v.trim()
  if (t && !/^https?:\/\//i.test(t) && !t.startsWith('//')) {
    return 'https://' + t
  }
  return t
}

// ── CV Preview Component ──────────────────────────────────────────────────────

function CVPreview({ fields, theme: themeKey, logoFile }) {
  const t = CV_THEMES.find(x => x.value === themeKey) || CV_THEMES[0]
  const [logoUrl, setLogoUrl] = useState(null)

  useEffect(() => {
    if (!logoFile) { setLogoUrl(null); return }
    const url = URL.createObjectURL(logoFile)
    setLogoUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [logoFile])

  const hasDark = !!t.bg
  const skillList = fields.skills ? fields.skills.split(',').map(s => s.trim()).filter(Boolean) : []

  const sectionStyle = {
    marginTop: 10,
    paddingTop: 6,
    borderTop: '1.5px solid ' + t.accent,
  }
  const sectionTitle = {
    fontSize: 9,
    fontWeight: 700,
    color: t.accent,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 4,
  }
  const bodyText = {
    fontSize: 8.5,
    color: '#333',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
  }

  return (
    <div style={{
      background: '#fff',
      borderRadius: 6,
      boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
      fontFamily: 'Helvetica, Arial, sans-serif',
      width: '100%',
      maxWidth: 380,
      margin: '0 auto',
      overflow: 'hidden',
      fontSize: 9,
      color: '#222',
    }}>
      {/* Header */}
      <div style={{
        background: hasDark ? t.bg : 'transparent',
        padding: hasDark ? '14px 16px 12px' : '14px 16px 0',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
      }}>
        {logoUrl && (
          <img
            src={logoUrl}
            alt="logo"
            style={{ width: 36, height: 36, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 16,
            fontWeight: 700,
            color: hasDark ? t.fg : '#1a1a1a',
            lineHeight: 1.2,
            marginBottom: 3,
          }}>
            {fields.name || <span style={{ color: '#aaa' }}>Your Name</span>}
          </div>
          <div style={{ fontSize: 8.5, color: hasDark ? '#ccc' : '#666', lineHeight: 1.6 }}>
            {[fields.email, fields.phone, fields.location].filter(Boolean).join('  |  ') || (
              <span style={{ color: '#bbb' }}>email | phone | location</span>
            )}
          </div>
          {fields.link && (
            <div style={{ fontSize: 8, color: hasDark ? t.fg : t.accent, marginTop: 1 }}>
              {fields.link}
            </div>
          )}
        </div>
      </div>

      {/* Separator */}
      {!hasDark && (
        <div style={{ height: 2, background: t.accent, margin: '6px 16px 0' }} />
      )}

      <div style={{ padding: '8px 16px 14px' }}>
        {fields.summary && (
          <div style={sectionStyle}>
            <div style={sectionTitle}>Professional Summary</div>
            <div style={bodyText}>{fields.summary}</div>
          </div>
        )}

        {skillList.length > 0 && (
          <div style={sectionStyle}>
            <div style={sectionTitle}>Skills</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {skillList.slice(0, 12).map((sk, i) => (
                <span key={i} style={{
                  background: t.accent + '22',
                  color: t.accent,
                  borderRadius: 3,
                  padding: '1px 5px',
                  fontSize: 7.5,
                  fontWeight: 600,
                }}>
                  {sk}
                </span>
              ))}
              {skillList.length > 12 && (
                <span style={{ color: '#999', fontSize: 7.5 }}>+{skillList.length - 12} more</span>
              )}
            </div>
          </div>
        )}

        {fields.experience && (
          <div style={sectionStyle}>
            <div style={sectionTitle}>Work Experience</div>
            <div style={bodyText}>{fields.experience}</div>
          </div>
        )}

        {fields.education && (
          <div style={sectionStyle}>
            <div style={sectionTitle}>Education</div>
            <div style={bodyText}>{fields.education}</div>
          </div>
        )}

        {fields.projects && (
          <div style={sectionStyle}>
            <div style={sectionTitle}>Projects</div>
            <div style={bodyText}>{fields.projects}</div>
          </div>
        )}

        {fields.publications && (
          <div style={sectionStyle}>
            <div style={sectionTitle}>Publications</div>
            <div style={bodyText}>{fields.publications}</div>
          </div>
        )}

        {!fields.summary && !fields.experience && !fields.education && !fields.skills && (
          <div style={{ color: '#bbb', fontSize: 8, marginTop: 10, textAlign: 'center', padding: '10px 0' }}>
            Fill in the form — your CV preview updates here live ✨
          </div>
        )}
      </div>
    </div>
  )
}

// ── Progress stepper ─────────────────────────────────────────────────────────

function StepDots({ steps, current, onGoto }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
      {steps.map((s, i) => (
        <button
          key={s.id}
          type="button"
          title={s.title}
          onClick={() => i < current && onGoto(i)}
          style={{
            width: i === current ? 22 : 10,
            height: 10,
            borderRadius: 5,
            border: 'none',
            cursor: i < current ? 'pointer' : 'default',
            background: i === current ? '#dc2626' : i < current ? '#6b7280' : '#374151',
            transition: 'width 0.3s, background 0.3s',
            flexShrink: 0,
            padding: 0,
          }}
          aria-label={s.title}
          aria-current={i === current ? 'step' : undefined}
        />
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

// AI suggestions panel shown below text areas
function AiPanel({ field, aiState, onSuggest, onApply, onDismiss, onAutoFill, autoFillLoading, autoFillError }) {
  const { loading, suggestions, sampleVerbs, enhancedText, source, error } = aiState
  const sourceLabel = source === 'groq' ? '⚡ Groq AI' : source === 'huggingface' ? '🤗 HuggingFace AI' : '🧠 Smart Tips'
  const hasResults = suggestions.length > 0 || sampleVerbs.length > 0 || enhancedText
  const isBusy = loading || autoFillLoading

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => onSuggest(field)}
          disabled={isBusy}
          style={{
            background: '#1f2937', border: '1px solid #374151', borderRadius: 6,
            padding: '5px 12px', fontSize: '0.75rem', color: isBusy ? '#6b7280' : '#a78bfa',
            cursor: isBusy ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5,
            transition: 'all 0.15s',
          }}
        >
          {loading ? '⏳ Getting AI suggestions…' : '✨ AI Enhance'}
        </button>
        <button
          type="button"
          onClick={() => onAutoFill(field)}
          disabled={isBusy}
          style={{
            background: autoFillLoading ? '#1f2937' : '#065f46', border: '1px solid #047857', borderRadius: 6,
            padding: '5px 12px', fontSize: '0.75rem', color: isBusy ? '#6b7280' : '#6ee7b7',
            cursor: isBusy ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5,
            transition: 'all 0.15s', fontWeight: 600,
          }}
        >
          {autoFillLoading ? '⏳ Auto-filling…' : '🪄 Auto-fill'}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 6, fontSize: '0.72rem', color: '#f87171' }}>❌ {error}</div>
      )}

      {autoFillError && (
        <div style={{ marginTop: 6, fontSize: '0.72rem', color: '#f87171' }}>❌ {autoFillError}</div>
      )}

      {hasResults && !loading && (
        <div style={{
          marginTop: 8, background: '#111827', border: '1px solid #374151',
          borderRadius: 8, padding: '10px 14px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: '0.72rem', color: '#6b7280', fontWeight: 600 }}>{sourceLabel}</span>
            <button type="button" onClick={onDismiss}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: '0.8rem', padding: 0 }}>
              ✕
            </button>
          </div>

          {suggestions.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginBottom: 4, fontWeight: 600 }}>💡 Suggestions:</div>
              <ul style={{ margin: 0, padding: '0 0 0 14px', listStyle: 'disc' }}>
                {suggestions.map((s, i) => (
                  <li key={i} style={{ fontSize: '0.75rem', color: '#d1d5db', lineHeight: 1.6 }}>{s}</li>
                ))}
              </ul>
            </div>
          )}

          {sampleVerbs.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginBottom: 4, fontWeight: 600 }}>🎯 Action Verbs:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {sampleVerbs.map((v, i) => (
                  <span key={i} style={{
                    background: '#1f2937', border: '1px solid #374151', borderRadius: 4,
                    padding: '2px 8px', fontSize: '0.72rem', color: '#a78bfa', cursor: 'pointer',
                  }}>
                    {v}
                  </span>
                ))}
              </div>
            </div>
          )}

          {enhancedText && (
            <div>
              <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginBottom: 4, fontWeight: 600 }}>✍️ AI-Enhanced Version:</div>
              <div style={{
                background: '#1f2937', border: '1px solid #374151', borderRadius: 6,
                padding: '8px 10px', fontSize: '0.75rem', color: '#e5e7eb',
                whiteSpace: 'pre-wrap', maxHeight: 120, overflowY: 'auto',
              }}>
                {enhancedText}
              </div>
              <button
                type="button"
                onClick={() => onApply(field)}
                style={{
                  marginTop: 6, background: '#7c3aed', border: 'none', borderRadius: 6,
                  padding: '5px 12px', fontSize: '0.75rem', color: '#fff',
                  cursor: 'pointer', fontWeight: 600,
                }}
              >
                ✅ Apply Enhancement
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CVBuilder() {
  const [fields, setFields]       = useState(INITIAL)
  const [logoFile, setLogoFile]   = useState(null)
  const [theme, setTheme]         = useState('classic')
  const [layout, setLayout]       = useState('chronological')
  const [step, setStep]           = useState(0)
  const [status, setStatus]       = useState(null)
  const [stepError, setStepError] = useState(null)
  const [slideDir, setSlideDir]   = useState('right')
  const [animKey, setAnimKey]     = useState(0)
  const [cvUploadStatus, setCvUploadStatus] = useState(null)
  const [aiState, setAiState]     = useState({ loading: false, suggestions: [], sampleVerbs: [], enhancedText: '', source: '', error: '' })
  const [autoFillField, setAutoFillField] = useState(null)
  const [autoFillError, setAutoFillError] = useState({ field: null, msg: null })
  const [copied, setCopied]       = useState(false)
  const submitRef    = useRef(null)
  const cvUploadRef  = useRef(null)

  const totalSteps = STEPS.length

  const set = (key) => (e) => setFields(f => ({ ...f, [key]: e.target.value }))
  const setName  = (e) => setFields(f => ({ ...f, name:  formatName(e.target.value) }))
  const setPhone = (e) => setFields(f => ({ ...f, phone: formatPhone(e.target.value) }))

  const blurSkills    = useCallback(() => setFields(f => ({ ...f, skills:       normalizeSkills(f.skills) })), [])
  const blurExperience= useCallback(() => setFields(f => ({ ...f, experience:   normalizeMultiline(f.experience) })), [])
  const blurEducation = useCallback(() => setFields(f => ({ ...f, education:    normalizeMultiline(f.education) })), [])
  const blurProjects  = useCallback(() => setFields(f => ({ ...f, projects:     normalizeMultiline(f.projects) })), [])
  const blurPublicatn = useCallback(() => setFields(f => ({ ...f, publications: normalizeMultiline(f.publications) })), [])
  const blurSummary   = useCallback(() => setFields(f => ({ ...f, summary:      f.summary.trim() })), [])
  const blurLink      = useCallback(() => setFields(f => ({ ...f, link:         normalizeLink(f.link) })), [])

  const gotoStep = useCallback((idx, dir) => {
    if (idx < 0 || idx >= totalSteps) return
    setStepError(null)
    setSlideDir(dir)
    setAnimKey(k => k + 1)
    setStep(idx)
  }, [totalSteps])

  /** Validate required fields for the current step. Returns error message or null. */
  const validateCurrentStep = useCallback(() => {
    const s = STEPS[step]
    const labelMap = {
      name: 'Full Name', email: 'Email', phone: 'Phone',
      location: 'Location', link: 'LinkedIn / Website',
      summary: 'Professional Summary', experience: 'Work Experience',
      education: 'Education', skills: 'Skills',
      projects: 'Projects', publications: 'Publications',
    }
    for (const key of s.required) {
      if (!fields[key]?.trim()) {
        return `${labelMap[key] || key} is required before continuing.`
      }
    }
    if (step === 0 && fields.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(fields.email.trim())) {
      return 'Please enter a valid email address.'
    }
    return null
  }, [step, fields])

  const goNext = useCallback(() => {
    const err = validateCurrentStep()
    if (err) { setStepError(err); return }
    gotoStep(step + 1, 'left')
  }, [step, gotoStep, validateCurrentStep])

  const goPrev = useCallback(() => gotoStep(step - 1, 'right'), [step, gotoStep])

  const validate = () => {
    if (!fields.name.trim()) return 'Full Name is required.'
    if (!fields.email.trim()) return 'Email is required.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(fields.email.trim())) return 'Please enter a valid email address.'
    return null
  }

  // CV Upload handler
  const handleCvUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCvUploadStatus({ type: 'loading', msg: 'Extracting CV content…' })
    try {
      const data = await extractCV(file)
      if (data.fields) {
        setFields(prev => {
          const merged = { ...prev }
          Object.entries(data.fields).forEach(([k, v]) => {
            if (v && v.trim()) merged[k] = v.trim()
          })
          return merged
        })
        setCvUploadStatus({ type: 'success', msg: 'CV content extracted! Review and edit the fields below.' })
      } else {
        setCvUploadStatus({ type: 'error', msg: 'Could not extract fields from this file.' })
      }
    } catch (err) {
      setCvUploadStatus({ type: 'error', msg: err.message || 'Extraction failed.' })
    } finally {
      // Reset file input so the same file can be re-uploaded if needed
      if (cvUploadRef.current) cvUploadRef.current.value = ''
    }
  }

  // AI suggestion handler
  const handleAiSuggest = useCallback(async (field) => {
    const text = fields[field] || ''
    setAiState({ loading: true, suggestions: [], sampleVerbs: [], enhancedText: '', source: '', error: '' })
    try {
      const data = await aiCvSuggest(field, text, fields.name, fields.job_title || '', {
        summary:      fields.summary,
        experience:   fields.experience,
        skills:       fields.skills,
        education:    fields.education,
        projects:     fields.projects,
        publications: fields.publications,
      })
      setAiState({
        loading: false,
        suggestions: data.suggestions || [],
        sampleVerbs: data.sample_verbs || [],
        enhancedText: data.enhanced_text || '',
        source: data.source || 'offline',
        error: '',
      })
    } catch (err) {
      setAiState({ loading: false, suggestions: [], sampleVerbs: [], enhancedText: '', source: '', error: err.message || 'AI suggestion failed.' })
    }
  }, [fields])

  const applyAiEnhancement = useCallback((field) => {
    if (!aiState.enhancedText) return
    setFields(f => ({ ...f, [field]: aiState.enhancedText }))
    setAiState(s => ({ ...s, enhancedText: '' }))
  }, [aiState.enhancedText])

  const dismissAi = useCallback(() => {
    setAiState({ loading: false, suggestions: [], sampleVerbs: [], enhancedText: '', source: '', error: '' })
  }, [])

  const handleAutoFill = useCallback(async (field) => {
    setAutoFillField(field)
    setAutoFillError({ field: null, msg: null })
    try {
      const data = await aiCvSuggest(field, fields[field] || '', fields.name, fields.job_title || '', {
        inline_modify: true,
        summary:      fields.summary,
        experience:   fields.experience,
        skills:       fields.skills,
        education:    fields.education,
        projects:     fields.projects,
        publications: fields.publications,
      })
      const fillText = data.inline_modified || data.enhanced_text || data.suggestions?.[0] || ''
      if (fillText) {
        setFields(f => ({ ...f, [field]: fillText }))
      } else {
        setAutoFillError({ field, msg: 'No AI content available to auto-fill. Try AI Enhance instead.' })
      }
    } catch (err) {
      setAutoFillError({ field, msg: err.message || 'Auto-fill failed. Try AI Enhance instead.' })
    } finally {
      setAutoFillField(null)
    }
  }, [fields])

  const handleGenerate = async () => {
    const err = validate()
    if (err) { setStatus({ type: 'error', msg: err }); return }
    setStatus({ type: 'loading', msg: 'Generating CV… please wait.' })
    if (submitRef.current) submitRef.current.disabled = true
    try {
      const res = await generateCV(fields, logoFile, theme, layout)
      if (!res.ok) {
        let errMsg = 'Server error (' + res.status + ')'
        try { const json = await res.json(); if (json.error) errMsg = json.error } catch {}
        throw new Error(errMsg)
      }
      const blob = await res.blob()
      if (blob.size === 0) throw new Error('CV generation produced an empty file.')
      triggerBlobDownload(blob, 'cv.pdf')
      setStatus({ type: 'success', msg: 'CV generated and downloaded!' })
    } catch (err) {
      setStatus({ type: 'error', msg: err.message || 'Generation failed' })
    } finally {
      if (submitRef.current) submitRef.current.disabled = false
    }
  }

  const handleGenerateTxt = async () => {
    const err = validate()
    if (err) { setStatus({ type: 'error', msg: err }); return }
    setStatus({ type: 'loading', msg: 'Generating plain-text CV…' })
    try {
      const res = await generateCVTxt(fields, layout)
      if (!res.ok) {
        let errMsg = 'Server error (' + res.status + ')'
        try { const json = await res.json(); if (json.error) errMsg = json.error } catch {}
        throw new Error(errMsg)
      }
      const blob = await res.blob()
      if (blob.size === 0) throw new Error('CV generation produced an empty file.')
      triggerBlobDownload(blob, 'cv.txt')
      setStatus({ type: 'success', msg: 'Plain-text CV downloaded!' })
    } catch (err) {
      setStatus({ type: 'error', msg: err.message || 'Generation failed' })
    }
  }

  const handleCopyToClipboard = async () => {
    const err = validate()
    if (err) { setStatus({ type: 'error', msg: err }); return }
    setStatus({ type: 'loading', msg: 'Building CV text…' })
    try {
      const res = await generateCVTxt(fields, layout)
      if (!res.ok) {
        let errMsg = 'Server error (' + res.status + ')'
        try { const json = await res.json(); if (json.error) errMsg = json.error } catch {}
        throw new Error(errMsg)
      }
      const text = await res.text()
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
      setStatus({ type: 'success', msg: 'CV copied to clipboard!' })
    } catch (err) {
      setStatus({ type: 'error', msg: err.message || 'Copy failed' })
    }
  }

  const isFirst = step === 0
  const isLast  = step === totalSteps - 1
  const cur     = STEPS[step]

  useEffect(() => {
    const id = 'cv-wizard-anim'
    if (document.getElementById(id)) return
    const style = document.createElement('style')
    style.id = id
    style.textContent = [
      '@keyframes cvSlideInLeft  { from { opacity:0; transform:translateX(32px) } to { opacity:1; transform:translateX(0) } }',
      '@keyframes cvSlideInRight { from { opacity:0; transform:translateX(-32px)} to { opacity:1; transform:translateX(0) } }',
      '.cv-slide-left  { animation: cvSlideInLeft  0.28s cubic-bezier(.4,0,.2,1) both }',
      '.cv-slide-right { animation: cvSlideInRight 0.28s cubic-bezier(.4,0,.2,1) both }',
    ].join('\n')
    document.head.appendChild(style)
  }, [])

  return (
    <div>
      <div className="mb-3">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          📄 CV Generator
        </h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Step through the form and see your CV update live — then download as PDF.
        </p>
      </div>

      {/* CV Upload for extraction */}
      <div style={{
        background: '#1f2937', border: '1px solid #374151',
        borderRadius: 10, padding: '12px 16px', marginBottom: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.82rem', color: '#d1d5db', fontWeight: 600 }}>
            📂 Upload existing CV to auto-fill fields
          </span>
          <label style={{
            cursor: 'pointer', background: '#374151',
            border: '1px solid #4b5563', borderRadius: 6,
            padding: '5px 12px', fontSize: '0.78rem', color: '#e5e7eb',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            📄 Choose PDF or DOCX
            <input
              ref={cvUploadRef}
              type="file"
              accept=".pdf,.docx,.doc"
              style={{ display: 'none' }}
              onChange={handleCvUpload}
            />
          </label>
          {cvUploadStatus && (
            <span style={{
              fontSize: '0.75rem',
              color: cvUploadStatus.type === 'loading' ? '#9ca3af' :
                     cvUploadStatus.type === 'success' ? '#34d399' : '#f87171',
            }}>
              {cvUploadStatus.type === 'loading' && '⏳ '}
              {cvUploadStatus.type === 'success' && '✅ '}
              {cvUploadStatus.type === 'error'   && '❌ '}
              {cvUploadStatus.msg}
            </span>
          )}
        </div>
      </div>

      {/* Two-column layout: form left, preview right */}
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>

        {/* ── LEFT: Wizard form ── */}
        <div style={{ flex: '0 0 auto', width: '100%', maxWidth: 460, minWidth: 0 }}>

          <StepDots steps={STEPS} current={step} onGoto={(i) => gotoStep(i, i < step ? 'right' : 'left')} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: '1.15rem' }}>{cur.icon}</span>
            <div>
              <div style={{ color: '#f3f4f6', fontWeight: 600, fontSize: '0.95rem', lineHeight: 1.2 }}>
                {cur.title}
              </div>
              <div style={{ color: '#6b7280', fontSize: '0.72rem' }}>
                Step {step + 1} of {totalSteps}
              </div>
            </div>
          </div>

          {/* Animated step panel */}
          <div
            key={animKey}
            className={slideDir === 'left' ? 'cv-slide-left' : 'cv-slide-right'}
            style={{ minHeight: 180 }}
          >
            {/* Step 0: Personal Info */}
            {step === 0 && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="form-label">👤 Full Name <span className="text-red-500">*</span></label>
                    <input type="text" className="input" placeholder="Jane Smith"
                      value={fields.name} onChange={setName} autoComplete="name" />
                  </div>
                  <div className="space-y-1">
                    <label className="form-label">✉ Email <span className="text-red-500">*</span></label>
                    <input type="email" className="input" placeholder="jane@example.com"
                      value={fields.email} onChange={set('email')} autoComplete="email" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="form-label">📞 Phone</label>
                    <input type="text" className="input" placeholder="+1 555 123 4567"
                      value={fields.phone} onChange={setPhone} inputMode="tel" autoComplete="tel" />
                  </div>
                  <div className="space-y-1">
                    <label className="form-label">📍 Location</label>
                    <input type="text" className="input" placeholder="City, Country"
                      value={fields.location} onChange={set('location')} autoComplete="address-level2" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="form-label">🔗 LinkedIn / Website</label>
                  <input type="text" className="input" placeholder="https://linkedin.com/in/janesmith"
                    value={fields.link} onChange={set('link')} onBlur={blurLink}
                    inputMode="url" autoCapitalize="none" autoCorrect="off" />
                </div>
              </div>
            )}

            {/* Step 1: Summary */}
            {step === 1 && (
              <div className="space-y-1">
                <label className="form-label">📝 Professional Summary</label>
                <textarea className="input resize-y" rows={5}
                  placeholder="A brief professional summary highlighting your key strengths and career goals…"
                  value={fields.summary} onChange={set('summary')} onBlur={blurSummary} />
                <p className="text-xs text-gray-500">2–4 sentences work best.</p>
                <AiPanel field="summary" aiState={aiState} onSuggest={handleAiSuggest} onApply={applyAiEnhancement} onDismiss={dismissAi} onAutoFill={handleAutoFill} autoFillLoading={autoFillField === 'summary'} autoFillError={autoFillError.field === 'summary' ? autoFillError.msg : null} />
              </div>
            )}

            {/* Step 2: Experience */}
            {step === 2 && (
              <div className="space-y-1">
                <label className="form-label">💼 Work Experience</label>
                <textarea className="input resize-y font-mono text-xs" rows={7}
                  placeholder={"Company — Title — Start–End\n• Achievement or responsibility\n\nCompany — Title — Start–End\n• Achievement"}
                  value={fields.experience} onChange={set('experience')} onBlur={blurExperience} />
                <p className="text-xs text-gray-500">Separate roles with a blank line. Bullet lines start with • or -.</p>
                <AiPanel field="experience" aiState={aiState} onSuggest={handleAiSuggest} onApply={applyAiEnhancement} onDismiss={dismissAi} onAutoFill={handleAutoFill} autoFillLoading={autoFillField === 'experience'} autoFillError={autoFillError.field === 'experience' ? autoFillError.msg : null} />
              </div>
            )}

            {/* Step 3: Education */}
            {step === 3 && (
              <div className="space-y-1">
                <label className="form-label">🎓 Education</label>
                <textarea className="input resize-y font-mono text-xs" rows={4}
                  placeholder={"University — Degree — Year\nUniversity — Degree — Year"}
                  value={fields.education} onChange={set('education')} onBlur={blurEducation} />
                <AiPanel field="education" aiState={aiState} onSuggest={handleAiSuggest} onApply={applyAiEnhancement} onDismiss={dismissAi} onAutoFill={handleAutoFill} autoFillLoading={autoFillField === 'education'} autoFillError={autoFillError.field === 'education' ? autoFillError.msg : null} />
              </div>
            )}

            {/* Step 4: Skills */}
            {step === 4 && (
              <div className="space-y-1">
                <label className="form-label">⭐ Skills <span className="text-gray-500 text-xs">(comma-separated)</span></label>
                <input type="text" className="input"
                  placeholder="Python, FastAPI, React, Docker, Kubernetes, …"
                  value={fields.skills} onChange={set('skills')} onBlur={blurSkills} />
                <p className="text-xs text-gray-500">Duplicates are removed automatically.</p>
                <AiPanel field="skills" aiState={aiState} onSuggest={handleAiSuggest} onApply={applyAiEnhancement} onDismiss={dismissAi} onAutoFill={handleAutoFill} autoFillLoading={autoFillField === 'skills'} autoFillError={autoFillError.field === 'skills' ? autoFillError.msg : null} />
              </div>
            )}

            {/* Step 5: Extras */}
            {step === 5 && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="form-label">🧪 Projects <span className="text-gray-500 text-xs">(optional)</span></label>
                  <textarea className="input resize-y font-mono text-xs" rows={3}
                    placeholder="Project Name — Description — URL (optional)"
                    value={fields.projects} onChange={set('projects')} onBlur={blurProjects} />
                </div>
                <div className="space-y-1">
                  <label className="form-label">📚 Publications <span className="text-gray-500 text-xs">(optional)</span></label>
                  <textarea className="input resize-y font-mono text-xs" rows={2}
                    placeholder="Title — Journal — Year"
                    value={fields.publications} onChange={set('publications')} onBlur={blurPublicatn} />
                </div>
              </div>
            )}

            {/* Step 6: Theme & Logo */}
            {step === 6 && (
              <div className="space-y-4">
                {/* Layout selector */}
                <div className="space-y-2">
                  <label className="form-label">📐 CV Layout</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[
                      { value: 'chronological', label: '📅 Chronological', desc: 'Experience → Education → Skills' },
                      { value: 'functional',    label: '⭐ Functional',    desc: 'Skills → Experience → Education' },
                    ].map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setLayout(opt.value)}
                        style={{
                          flex: 1, borderRadius: 8, textAlign: 'left', cursor: 'pointer', transition: 'all 0.15s',
                          border: layout === opt.value ? '2px solid #dc2626' : '1px solid #374151',
                          background: layout === opt.value ? '#dc262622' : '#1f293780',
                          padding: '8px 12px',
                        }}
                      >
                        <div style={{ fontSize: '0.82rem', fontWeight: 600, color: layout === opt.value ? '#fff' : '#d1d5db' }}>
                          {opt.label}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#6b7280', marginTop: 1 }}>{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="form-label">🎨 CV Theme</label>
                  <div className="grid grid-cols-2 gap-2">
                    {CV_THEMES.map(t => (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => setTheme(t.value)}
                        style={theme === t.value ? {
                          borderRadius: 8,
                          border: '2px solid ' + t.accent,
                          background: t.accent + '22',
                          padding: '7px 10px',
                          textAlign: 'left',
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                        } : {
                          borderRadius: 8,
                          border: '1px solid #374151',
                          background: '#1f293780',
                          padding: '7px 10px',
                          textAlign: 'left',
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                        }}
                      >
                        <div style={{ fontSize: '0.82rem', fontWeight: 600, color: theme === t.value ? '#fff' : '#d1d5db' }}>
                          {t.label}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#6b7280', marginTop: 1 }}>{t.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="form-label">🖼 Logo / Branding <span className="text-gray-500 text-xs">(optional, PNG/JPG)</span></label>
                  <input type="file" className="input text-sm" accept="image/png,image/jpeg"
                    onChange={(e) => setLogoFile(e.target.files[0] ?? null)} />
                </div>
              </div>
            )}
          </div>

          {/* Navigation */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
            {!isFirst && (
              <button type="button" onClick={goPrev} className="btn-secondary" style={{ minWidth: 90 }}>
                ← Previous
              </button>
            )}
            {!isLast && (
              <button type="button" onClick={goNext} className="btn-primary" style={{ flex: 1 }}>
                Next →
              </button>
            )}
            {isLast && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                <button ref={submitRef} type="button" onClick={handleGenerate} className="btn-primary" style={{ width: '100%' }}>
                  📄 Download PDF CV
                </button>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={handleGenerateTxt}
                    style={{
                      flex: 1, borderRadius: 8, padding: '8px 0', fontSize: '0.82rem', fontWeight: 600,
                      cursor: 'pointer', border: '1px solid #374151', background: '#1f2937', color: '#d1d5db',
                      transition: 'all 0.15s',
                    }}
                  >
                    📝 Download .txt
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyToClipboard}
                    style={{
                      flex: 1, borderRadius: 8, padding: '8px 0', fontSize: '0.82rem', fontWeight: 600,
                      cursor: 'pointer', border: '1px solid #374151', background: '#1f2937', color: '#d1d5db',
                      transition: 'all 0.15s',
                    }}
                  >
                    {copied ? '✅ Copied!' : '📋 Copy to Clipboard'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Step validation error */}
          {stepError && (
            <div className="mt-2 text-sm text-red-400">
              ⚠️ {stepError}
            </div>
          )}

          {/* Status */}
          {status && (
            <div className={'mt-3 text-sm ' + (
              status.type === 'loading' ? 'text-gray-400' :
              status.type === 'success' ? 'text-green-400' : 'text-red-400'
            )}>
              {status.type === 'loading' && '⏳ '}
              {status.type === 'success' && '✅ '}
              {status.type === 'error'   && '❌ '}
              {status.msg}
              {status.type === 'error' && (
                <button
                  type="button"
                  className="ml-3 text-xs underline text-gray-400 hover:text-gray-200"
                  onClick={() => { setStatus(null); if (submitRef.current) submitRef.current.disabled = false }}
                >
                  ↩ Try Again
                </button>
              )}
            </div>
          )}

          {/* Skip to generate */}
          {!isLast && validate() === null && (
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                onClick={handleGenerate}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#6b7280', fontSize: '0.72rem', textDecoration: 'underline', padding: 0,
                }}
              >
                Skip to generate PDF ↗
              </button>
            </div>
          )}
        </div>

        {/* ── RIGHT: Live CV Preview ── */}
        <div
          style={{
            flex: '1 1 0',
            minWidth: 260,
            position: 'sticky',
            top: PREVIEW_STICKY_TOP_PX,
            alignSelf: 'flex-start',
            display: 'none',
          }}
          className="cv-preview-panel"
        >
          <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#9ca3af', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              Live Preview
            </span>
            <span style={{ flex: 1, height: 1, background: '#1f2937' }} />
            <span style={{ color: '#374151', fontSize: '0.68rem' }}>
              {CV_THEMES.find(x => x.value === theme)?.label}
            </span>
          </div>
          <CVPreview fields={fields} theme={theme} logoFile={logoFile} />
          <p style={{ color: '#4b5563', fontSize: '0.68rem', marginTop: 6, textAlign: 'center' }}>
            Updates live as you fill in the form
          </p>
        </div>
      </div>

      {/* Mobile preview toggle */}
      <MobilePreview fields={fields} theme={theme} logoFile={logoFile} />

      <style>{`
        @media (min-width: ${PREVIEW_BREAKPOINT_PX}px) {
          .cv-preview-panel { display: block !important; }
          .cv-mobile-preview { display: none !important; }
        }
      `}</style>
    </div>
  )
}

function MobilePreview({ fields, theme, logoFile }) {
  const [open, setOpen] = useState(false)
  const hasContent = fields.name || fields.summary || fields.experience || fields.skills
  if (!hasContent) return null
  return (
    <div className="cv-mobile-preview" style={{ marginTop: 14 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', background: '#1f2937', border: '1px solid #374151',
          borderRadius: 8, padding: '8px 14px', cursor: 'pointer',
          color: '#d1d5db', fontSize: '0.82rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <span>👁 Preview CV</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          <CVPreview fields={fields} theme={theme} logoFile={logoFile} />
        </div>
      )}
    </div>
  )
}

// ─── Tab wrapper ─────────────────────────────────────────────────────────────

const CV_TABS = [
  { id: 'builder', label: '📄 CV Builder' },
  { id: 'ats',     label: '🎯 ATS Scanner' },
]

export default function CVGenerator() {
  const [tab, setTab] = useState('builder')
  return (
    <div>
      {/* Sub-tabs */}
      <div className="flex rounded-lg overflow-hidden border border-gray-700 mb-4">
        {CV_TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2 text-sm font-semibold transition-colors ${tab === t.id ? 'bg-blue-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'builder' ? <CVBuilder /> : <ATSScanner />}
    </div>
  )
}
