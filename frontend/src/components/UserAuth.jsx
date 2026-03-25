import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { userRegister, userLogin } from '../api'

// ─── Password-strength helper ───────────────────────────────────────────────

function passwordStrength(pw) {
  if (!pw) return { score: 0, label: '', color: '' }
  let score = 0
  if (pw.length >= 8)              score++
  if (/[A-Z]/.test(pw))           score++
  if (/[0-9]/.test(pw))           score++
  if (/[^A-Za-z0-9]/.test(pw))    score++
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong']
  const colors = ['', 'bg-red-500', 'bg-yellow-500', 'bg-blue-500', 'bg-green-500']
  return { score, label: labels[score] || 'Weak', color: colors[score] || 'bg-red-500' }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// ─── Main component ──────────────────────────────────────────────────────────

/**
 * UserAuth — centered modal pop-up with tabbed Sign In / Create Account,
 * OAuth placeholders, Email Magic Link, real-time validation, and Remember Me.
 *
 * Props:
 *   onSuccess(userObj) — called when authentication succeeds
 *   onClose()          — called when the modal is dismissed
 *   defaultTab         — 'signin' | 'register' (default: 'signin')
 */
export default function UserAuth({ onSuccess, onClose, defaultTab = 'signin' }) {
  const [tab, setTab]             = useState(defaultTab) // 'signin' | 'register'
  const [name, setName]           = useState('')
  const [email, setEmail]         = useState('')
  const [password, setPass]       = useState('')
  const [role, setRole]           = useState('passenger')
  const [rememberMe, setRemember] = useState(false)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [success, setSuccess]     = useState('')

  // Real-time validation
  const [emailTouched, setEmailTouched]   = useState(false)
  const [passTouched,  setPassTouched]    = useState(false)
  const pwStrength = passwordStrength(password)
  const emailOk    = isValidEmail(email)
  const passwordOk = tab === 'register' ? pwStrength.score >= 2 : password.length >= 1

  const overlayRef = useRef(null)

  // Close on Escape key
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const reset = () => {
    setError(''); setSuccess(''); setName(''); setEmail(''); setPass('')
    setEmailTouched(false); setPassTouched(false)
  }

  const switchTab = (t) => { reset(); setTab(t) }

  // ── Standard auth ──────────────────────────────────────────────────────────

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (tab === 'register' && !emailOk)  return setError('Please enter a valid email address.')
    if (tab === 'register' && pwStrength.score < 2)
      return setError('Password must be at least 8 chars with uppercase, number, and/or symbol.')
    setLoading(true)
    try {
      let user
      if (tab === 'register') {
        await userRegister(name.trim(), email.trim(), password, role)
        user = await userLogin(email.trim(), password, rememberMe)
      } else {
        user = await userLogin(email.trim(), password, rememberMe)
      }
      onSuccess?.(user)
    } catch (err) {
      setError(err.message || 'Authentication failed.')
    } finally {
      setLoading(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      ref={overlayRef}
      onMouseDown={(e) => { if (e.target === overlayRef.current) onClose?.() }}
      role="dialog"
      aria-modal="true"
      aria-label="Authentication"
    >
      <div className="relative w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 text-gray-500 hover:text-gray-300 text-xl leading-none z-10"
          aria-label="Close"
        >
          ✕
        </button>

        {/* Tab bar */}
        <div className="flex border-b border-gray-700">
          {[['signin', 'Sign In'], ['register', 'Create Account']].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => switchTab(id)}
              className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                tab === id
                  ? 'bg-blue-700 text-white'
                  : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="p-6 space-y-4">
          {/* ── Sign In form ── */}
          {tab === 'signin' && (
            <form onSubmit={handleSubmit} className="space-y-3">
              {/* Email */}
              <div>
                <input
                  type="email"
                  placeholder="Email address"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onBlur={() => setEmailTouched(true)}
                  required
                  className={`w-full rounded-lg bg-gray-800 border text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    emailTouched && !emailOk ? 'border-red-500' : 'border-gray-600'
                  }`}
                />
                {emailTouched && !emailOk && (
                  <p className="text-red-400 text-xs mt-1">Enter a valid email address.</p>
                )}
              </div>

              {/* Password */}
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={e => setPass(e.target.value)}
                required
                className="w-full rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              {/* Remember Me */}
              <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-400">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={e => setRemember(e.target.checked)}
                  className="accent-blue-500 w-4 h-4"
                />
                Remember me (stay signed in for 30 days)
              </label>

              {error   && <p className="text-red-400 text-xs bg-red-900/30 border border-red-800 rounded-lg px-3 py-2">{error}</p>}
              {success && <p className="text-green-400 text-xs bg-green-900/30 border border-green-800 rounded-lg px-3 py-2">{success}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-lg font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? '…' : 'Sign In'}
              </button>
            </form>
          )}

          {/* ── Create Account form ── */}
          {tab === 'register' && (
            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                type="text"
                placeholder="Full name"
                value={name}
                onChange={e => setName(e.target.value)}
                required
                className="w-full rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              {/* Email with validation */}
              <div>
                <input
                  type="email"
                  placeholder="Email address"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onBlur={() => setEmailTouched(true)}
                  required
                  className={`w-full rounded-lg bg-gray-800 border text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    emailTouched && !emailOk ? 'border-red-500' : 'border-gray-600'
                  }`}
                />
                {emailTouched && !emailOk && (
                  <p className="text-red-400 text-xs mt-1">Enter a valid email address.</p>
                )}
              </div>

              {/* Password with strength meter */}
              <div>
                <input
                  type="password"
                  placeholder="Password (uppercase, number, symbol)"
                  value={password}
                  onChange={e => setPass(e.target.value)}
                  onBlur={() => setPassTouched(true)}
                  required
                  className={`w-full rounded-lg bg-gray-800 border text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    passTouched && pwStrength.score < 2 ? 'border-red-500' : 'border-gray-600'
                  }`}
                />
                {password && (
                  <div className="mt-1.5 space-y-1">
                    <div className="flex gap-1">
                      {[1,2,3,4].map(i => (
                        <div
                          key={i}
                          className={`h-1 flex-1 rounded-full transition-colors ${
                            pwStrength.score >= i ? pwStrength.color : 'bg-gray-700'
                          }`}
                        />
                      ))}
                    </div>
                    <p className="text-xs text-gray-500">{pwStrength.label} password</p>
                  </div>
                )}
              </div>

              {/* Role */}
              <div>
                <p className="text-xs text-gray-400 mb-1.5">I want to…</p>
                <div className="flex gap-3">
                  {[['passenger', '🧍 Passenger'], ['driver', '🚗 Driver']].map(([r, label]) => (
                    <label key={r} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="role"
                        value={r}
                        checked={role === r}
                        onChange={() => setRole(r)}
                        className="accent-blue-500"
                      />
                      <span className="text-sm text-gray-300">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Remember Me */}
              <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-400">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={e => setRemember(e.target.checked)}
                  className="accent-blue-500 w-4 h-4"
                />
                Remember me (stay signed in for 30 days)
              </label>

              {error   && <p className="text-red-400 text-xs bg-red-900/30 border border-red-800 rounded-lg px-3 py-2">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-lg font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? '…' : 'Create Account'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
