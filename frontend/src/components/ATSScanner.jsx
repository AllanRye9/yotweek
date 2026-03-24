import { useState, useRef } from 'react'
import { scanATS, extractCV } from '../api'

/**
 * ATS CV Scanner — lets users paste CV text (or upload a file) and a job
 * description to get an ATS compatibility score.
 */
export default function ATSScanner() {
  const [cvText, setCvText]     = useState('')
  const [jobDesc, setJobDesc]   = useState('')
  const [result, setResult]     = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [cvFile, setCvFile]     = useState(null)
  const [extracting, setExtracting] = useState(false)
  const fileRef = useRef(null)

  const handleFileChange = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setCvFile(f)
    setExtracting(true)
    setError('')
    try {
      const data = await extractCV(f)
      const fields = data.fields || {}
      const text = [
        fields.name, fields.email, fields.phone, fields.location,
        fields.summary, fields.experience, fields.education,
        fields.skills, fields.projects, fields.publications,
      ].filter(Boolean).join('\n\n')
      setCvText(text)
    } catch (err) {
      setError('Could not extract text from file. You can paste the CV text manually.')
    } finally {
      setExtracting(false)
    }
  }

  const handleScan = async () => {
    if (!cvText.trim() && !cvFile) {
      setError('Please enter your CV text or upload a file.')
      return
    }
    if (!jobDesc.trim()) {
      setError('Please enter the job description.')
      return
    }
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const data = await scanATS(cvText, jobDesc, null)
      setResult(data)
    } catch (err) {
      setError(err.message || 'ATS scan failed.')
    } finally {
      setLoading(false)
    }
  }

  const scoreColor = (s) => {
    if (s >= 80) return '#16a34a'
    if (s >= 55) return '#d97706'
    return '#dc2626'
  }

  const scoreLabel = (s) => {
    if (s >= 80) return 'Excellent match'
    if (s >= 55) return 'Good — improve with more keywords'
    return 'Low match — tailor your CV'
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-4 space-y-4">
        {/* CV Input */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Your CV Text
          </label>
          <div className="flex gap-2 mb-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="text-xs px-3 py-1 rounded bg-blue-700 hover:bg-blue-600 text-white transition-colors"
            >
              📎 Upload PDF / DOCX
            </button>
            {cvFile && (
              <span className="text-xs text-gray-400 self-center truncate max-w-[160px]">
                {cvFile.name}
              </span>
            )}
            {extracting && (
              <span className="text-xs text-gray-400 self-center animate-pulse">Extracting…</span>
            )}
          </div>
          <input ref={fileRef} type="file" accept=".pdf,.docx,.doc" className="hidden" onChange={handleFileChange} />
          <textarea
            value={cvText}
            onChange={e => setCvText(e.target.value)}
            placeholder="Paste your CV content here, or upload a PDF/DOCX above…"
            rows={8}
            className="w-full rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
          />
        </div>

        {/* Job Description */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Job Description
          </label>
          <textarea
            value={jobDesc}
            onChange={e => setJobDesc(e.target.value)}
            placeholder="Paste the full job description here…"
            rows={7}
            className="w-full rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
          />
        </div>

        {error && (
          <p className="text-red-400 text-sm bg-red-900/30 border border-red-800 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          onClick={handleScan}
          disabled={loading}
          className="w-full py-2.5 rounded-lg font-semibold text-white transition-colors bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? '🔍 Scanning…' : '🔍 Run ATS Scan'}
        </button>
      </div>

      {/* Results */}
      {result && (
        <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-5 space-y-4">
          {/* Score gauge */}
          <div className="flex flex-col items-center gap-1">
            <div
              className="text-5xl font-extrabold tabular-nums"
              style={{ color: scoreColor(result.score) }}
            >
              {result.score}%
            </div>
            <div className="text-sm font-medium" style={{ color: scoreColor(result.score) }}>
              {scoreLabel(result.score)}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {result.matched.length} / {result.keywords_total} keywords matched
            </div>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-gray-700 rounded-full h-3">
            <div
              className="h-3 rounded-full transition-all duration-500"
              style={{ width: `${result.score}%`, backgroundColor: scoreColor(result.score) }}
            />
          </div>

          {/* Tips */}
          {result.tips.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Improvement Tips</p>
              <ul className="space-y-1">
                {result.tips.map((tip, i) => (
                  <li key={i} className="flex gap-2 text-sm text-gray-300">
                    <span className="text-yellow-400 shrink-0">💡</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Keyword breakdown */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {result.matched.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-green-400 uppercase tracking-wide mb-2">
                  ✅ Matched ({result.matched.length})
                </p>
                <div className="flex flex-wrap gap-1">
                  {result.matched.slice(0, 40).map(kw => (
                    <span key={kw} className="text-xs px-2 py-0.5 rounded-full bg-green-900/50 text-green-300 border border-green-800">
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {result.missing.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-2">
                  ❌ Missing ({result.missing.length})
                </p>
                <div className="flex flex-wrap gap-1">
                  {result.missing.slice(0, 40).map(kw => (
                    <span key={kw} className="text-xs px-2 py-0.5 rounded-full bg-red-900/50 text-red-300 border border-red-800">
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
