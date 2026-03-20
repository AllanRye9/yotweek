import { useState, useRef, useCallback } from 'react'
import { generateCV } from '../api'

const INITIAL = {
  name: '', email: '', phone: '', location: '',
  link: '', summary: '', experience: '', education: '',
  skills: '', projects: '', publications: '',
}

const CV_THEMES = [
  { value: 'classic',   label: '🔵 Classic',   desc: 'Blue accent, professional' },
  { value: 'modern',    label: '🌑 Modern',    desc: 'Dark header band, sleek' },
  { value: 'minimal',   label: '⬜ Minimal',   desc: 'Clean black & white' },
  { value: 'executive', label: '🏅 Executive', desc: 'Navy & gold, authoritative' },
]

// ── Auto-formatters ───────────────────────────────────────────────────────────

/** Capitalise each word in a name (e.g. "jane smith" → "Jane Smith"). */
function formatName(v) {
  return v.replace(/\b\w/g, c => c.toUpperCase())
}

/**
 * Normalise a phone number to E.164-ish display format.
 * Strips everything except digits and + then groups them nicely.
 */
function formatPhone(v) {
  // Keep only digits, spaces, +, -, (, )
  let s = v.replace(/[^\d\s+\-().]/g, '')
  return s
}

/**
 * Normalise a skills string: trim each skill, deduplicate, sort, rejoin.
 * Fired on blur so typing isn't interrupted.
 */
function normalizeSkills(v) {
  const parts = v.split(',').map(s => s.trim()).filter(Boolean)
  const seen = new Set()
  const unique = parts.filter(s => { const k = s.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
  return unique.join(', ')
}

/**
 * Normalise multiline text blocks:
 * - Trim leading/trailing blank lines
 * - Collapse 3+ consecutive blank lines into 2
 * - Replace bullet-like prefixes (--, *) with •
 */
function normalizeMultiline(v) {
  return v
    .replace(/^[ \t]+|[ \t]+$/gm, '') // trim line-level whitespace
    .replace(/\n{3,}/g, '\n\n')       // max 1 blank line between blocks
    .replace(/^[\-\*]\s+/gm, '• ')    // normalise bullet chars
    .trim()
}

/** Ensure link has a protocol prefix. */
function normalizeLink(v) {
  const t = v.trim()
  if (t && !/^https?:\/\//i.test(t) && !t.startsWith('//')) {
    return `https://${t}`
  }
  return t
}

export default function CVGenerator() {
  const [fields, setFields] = useState(INITIAL)
  const [logoFile, setLogoFile] = useState(null)
  const [theme, setTheme] = useState('classic')
  const [status, setStatus] = useState(null) // null | { type: 'loading'|'success'|'error', msg: string }
  const submitRef = useRef(null)

  // Generic setter
  const set = (key) => (e) => setFields(f => ({ ...f, [key]: e.target.value }))

  // Setters with auto-format on change (lightweight, non-disruptive)
  const setName    = (e) => setFields(f => ({ ...f, name:    formatName(e.target.value) }))
  const setPhone   = (e) => setFields(f => ({ ...f, phone:   formatPhone(e.target.value) }))

  // On-blur formatters that run heavier normalisation after the user leaves the field
  const blurSkills     = useCallback(() => setFields(f => ({ ...f, skills:       normalizeSkills(f.skills) })), [])
  const blurExperience = useCallback(() => setFields(f => ({ ...f, experience:   normalizeMultiline(f.experience) })), [])
  const blurEducation  = useCallback(() => setFields(f => ({ ...f, education:    normalizeMultiline(f.education) })), [])
  const blurProjects   = useCallback(() => setFields(f => ({ ...f, projects:     normalizeMultiline(f.projects) })), [])
  const blurPublicatn  = useCallback(() => setFields(f => ({ ...f, publications: normalizeMultiline(f.publications) })), [])
  const blurSummary    = useCallback(() => setFields(f => ({ ...f, summary:      f.summary.trim() })), [])
  const blurLink       = useCallback(() => setFields(f => ({ ...f, link:         normalizeLink(f.link) })), [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setStatus({ type: 'loading', msg: 'Generating CV…' })
    if (submitRef.current) submitRef.current.disabled = true
    try {
      const res = await generateCV(fields, logoFile, theme)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'cv.pdf'
      a.click()
      URL.revokeObjectURL(url)
      setStatus({ type: 'success', msg: 'CV generated and downloaded!' })
    } catch (err) {
      setStatus({ type: 'error', msg: err.message || 'Generation failed' })
    } finally {
      if (submitRef.current) submitRef.current.disabled = false
    }
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          📄 CV Generator
        </h2>
        <p className="text-xs text-gray-400 mt-1">
          Fill in your details and download a professional PDF CV instantly.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Name + Email */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="form-label">
              👤 Full Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className="input"
              placeholder="e.g. Jane Smith"
              value={fields.name}
              onChange={setName}
              autoComplete="name"
              required
            />
          </div>
          <div className="space-y-1">
            <label className="form-label">
              ✉ Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              className="input"
              placeholder="jane@example.com"
              value={fields.email}
              onChange={set('email')}
              autoComplete="email"
              required
            />
          </div>
        </div>

        {/* Phone + Location */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="form-label">📞 Phone</label>
            <input
              type="text"
              className="input"
              placeholder="+1 555 123 4567"
              value={fields.phone}
              onChange={setPhone}
              inputMode="tel"
              autoComplete="tel"
            />
          </div>
          <div className="space-y-1">
            <label className="form-label">📍 Location</label>
            <input
              type="text"
              className="input"
              placeholder="City, Country"
              value={fields.location}
              onChange={set('location')}
              autoComplete="address-level2"
            />
          </div>
        </div>

        {/* LinkedIn / Website */}
        <div className="space-y-1">
          <label className="form-label">🔗 LinkedIn / Website</label>
          <input
            type="text"
            className="input"
            placeholder="https://linkedin.com/in/janesmith"
            value={fields.link}
            onChange={set('link')}
            onBlur={blurLink}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
          />
        </div>

        {/* Summary */}
        <div className="space-y-1">
          <label className="form-label">📝 Professional Summary</label>
          <textarea
            className="input resize-y"
            rows={3}
            placeholder="A brief professional summary…"
            value={fields.summary}
            onChange={set('summary')}
            onBlur={blurSummary}
          />
        </div>

        {/* Experience */}
        <div className="space-y-1">
          <label className="form-label">💼 Work Experience</label>
          <textarea
            className="input resize-y font-mono text-xs"
            rows={5}
            placeholder={"Company — Title — Start–End year\n• Achievement or responsibility\n\nCompany — Title — Start–End year\n• Achievement or responsibility"}
            value={fields.experience}
            onChange={set('experience')}
            onBlur={blurExperience}
          />
          <p className="text-xs text-gray-500">Separate entries with a blank line. Bullet lines start with • or -.</p>
        </div>

        {/* Education */}
        <div className="space-y-1">
          <label className="form-label">🎓 Education</label>
          <textarea
            className="input resize-y font-mono text-xs"
            rows={3}
            placeholder={"University — Degree — Year\nUniversity — Degree — Year"}
            value={fields.education}
            onChange={set('education')}
            onBlur={blurEducation}
          />
        </div>

        {/* Skills */}
        <div className="space-y-1">
          <label className="form-label">
            ⭐ Skills <span className="text-gray-500 text-xs">(comma-separated — duplicates removed on blur)</span>
          </label>
          <input
            type="text"
            className="input"
            placeholder="Python, FastAPI, React, Docker, …"
            value={fields.skills}
            onChange={set('skills')}
            onBlur={blurSkills}
          />
        </div>

        {/* Projects */}
        <div className="space-y-1">
          <label className="form-label">
            🧪 Projects <span className="text-gray-500 text-xs">(optional)</span>
          </label>
          <textarea
            className="input resize-y font-mono text-xs"
            rows={3}
            placeholder="Project Name — Description — URL (optional)"
            value={fields.projects}
            onChange={set('projects')}
            onBlur={blurProjects}
          />
        </div>

        {/* Publications */}
        <div className="space-y-1">
          <label className="form-label">
            📚 Publications <span className="text-gray-500 text-xs">(optional)</span>
          </label>
          <textarea
            className="input resize-y font-mono text-xs"
            rows={2}
            placeholder="Title — Journal — Year"
            value={fields.publications}
            onChange={set('publications')}
            onBlur={blurPublicatn}
          />
        </div>

        {/* Logo upload */}
        <div className="space-y-1">
          <label className="form-label">
            🖼 Logo / Branding Image <span className="text-gray-500 text-xs">(optional, PNG/JPG)</span>
          </label>
          <input
            type="file"
            className="input text-sm"
            accept="image/png,image/jpeg"
            onChange={(e) => setLogoFile(e.target.files[0] ?? null)}
          />
        </div>

        {/* Theme selector */}
        <div className="space-y-2">
          <label className="form-label">🎨 CV Theme</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {CV_THEMES.map(t => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTheme(t.value)}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  theme === t.value
                    ? 'border-blue-500 bg-blue-950/40 text-white'
                    : 'border-gray-600 bg-gray-800/40 text-gray-300 hover:border-gray-400'
                }`}
              >
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-xs text-gray-400 mt-0.5">{t.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <button ref={submitRef} type="submit" className="btn-primary w-full sm:w-auto">
          📄 Generate PDF CV
        </button>
      </form>

      {status && (
        <div className={`mt-3 text-sm ${
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
  )
}
