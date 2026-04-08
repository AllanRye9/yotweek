import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { userRegister, userLogin, storePublicKey } from '../api'
import { generateKeyPair, getStoredPublicKeyJwk } from '../crypto'
import { getDashboardPath } from '../routing'

function passwordStrength(pw) {
  if (!pw) return { score: 0, label: '', color: '' }
  let score = 0
  if (pw.length >= 8)              score++
  if (/[A-Z]/.test(pw))           score++
  if (/[a-z]/.test(pw))           score++
  if (/[0-9]/.test(pw))           score++
  if (/[^A-Za-z0-9]/.test(pw))    score++
  const labels = ['', 'Weak', 'Weak', 'Fair', 'Good', 'Strong']
  const colors = ['', 'bg-red-500', 'bg-red-500', 'bg-yellow-500', 'bg-blue-500', 'bg-green-500']
  return { score, label: labels[score] || 'Weak', color: colors[score] || 'bg-red-500' }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export default function RegisterPage() {
  const navigate = useNavigate()

  const [name, setName]           = useState('')
  const [email, setEmail]         = useState('')
  const [phone, setPhone]         = useState('')
  const [password, setPass]       = useState('')
  const [confirmPass, setConfirm] = useState('')
  const [showPass, setShowPass]   = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [role, setRole]           = useState('passenger')
  const [rememberMe, setRemember] = useState(false)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [success, setSuccess]     = useState('')
  const [emailTouched, setEmailTouched] = useState(false)
  const [passTouched,  setPassTouched]  = useState(false)
  const [confirmTouched, setConfirmTouched] = useState(false)

  const pwStrength = passwordStrength(password)
  const emailOk    = isValidEmail(email)

  // If already logged in, redirect to the correct dashboard
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.user_id) navigate(getDashboardPath(data), { replace: true })
      })
      .catch(() => {})
  }, [navigate])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!emailOk) return setError('Please enter a valid email address.')
    if (pwStrength.score < 3)
      return setError('Password must be at least 8 chars with uppercase, lowercase, number, and/or symbol.')
    if (confirmPass !== password) return setError('Passwords do not match.')
    setLoading(true)
    try {
      const regData = await userRegister(name.trim(), email.trim(), password, role, phone.trim())
      if (regData.email_verified === false) {
        setSuccess('Account created! Please check your email to verify your account before signing in.')
        setLoading(false)
        return
      }
      const user = await userLogin(email.trim(), password, rememberMe)
      try {
        let pkJwk = getStoredPublicKeyJwk()
        if (!pkJwk) {
          const { publicKeyJwk } = await generateKeyPair()
          pkJwk = JSON.stringify(publicKeyJwk)
        }
        await storePublicKey(pkJwk)
      } catch (_) {}
      navigate(getDashboardPath(user), { replace: true })
    } catch (err) {
      setError(err.message || 'Registration failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b border-gray-700">
          <Link
            to="/login"
            className="flex-1 py-3 text-sm font-semibold text-center bg-gray-800/50 text-gray-400 hover:bg-gray-700 hover:text-white transition-colors"
          >
            Sign In
          </Link>
          <div className="flex-1 py-3 text-sm font-semibold text-center bg-blue-700 text-white">
            Create Account
          </div>
        </div>

        <div className="p-6 space-y-4">
          {success ? (
            <div className="space-y-4 text-center">
              <p className="text-green-400 text-sm bg-green-900/30 border border-green-800 rounded-lg px-4 py-3">{success}</p>
              <Link to="/login" className="block text-blue-400 hover:text-blue-300 text-sm">
                ← Back to Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                type="text"
                placeholder="Full name"
                value={name}
                onChange={e => setName(e.target.value)}
                required
                autoFocus
                className="w-full rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

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

              <input
                type="tel"
                placeholder="Phone number (optional)"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="w-full rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              <div>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    placeholder="Password (uppercase, lowercase, number, symbol)"
                    value={password}
                    onChange={e => setPass(e.target.value)}
                    onBlur={() => setPassTouched(true)}
                    required
                    className={`w-full rounded-lg bg-gray-800 border text-gray-100 text-sm p-2.5 pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      passTouched && pwStrength.score < 3 ? 'border-red-500' : 'border-gray-600'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 text-xs"
                    tabIndex={-1}
                  >
                    {showPass ? '🙈' : '👁️'}
                  </button>
                </div>
                {password && (
                  <div className="mt-1.5 space-y-1">
                    <div className="flex gap-1">
                      {[1,2,3,4,5].map(i => (
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

              <div>
                <div className="relative">
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    placeholder="Confirm password"
                    value={confirmPass}
                    onChange={e => setConfirm(e.target.value)}
                    onBlur={() => setConfirmTouched(true)}
                    required
                    className={`w-full rounded-lg bg-gray-800 border text-gray-100 text-sm p-2.5 pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      confirmTouched && confirmPass !== password ? 'border-red-500' : 'border-gray-600'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 text-xs"
                    tabIndex={-1}
                  >
                    {showConfirm ? '🙈' : '👁️'}
                  </button>
                </div>
                {confirmTouched && confirmPass !== password && (
                  <p className="text-red-400 text-xs mt-1">Passwords do not match.</p>
                )}
              </div>

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

              <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-400">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={e => setRemember(e.target.checked)}
                  className="accent-blue-500 w-4 h-4"
                />
                Remember me (stay signed in for 30 days)
              </label>

              {error && <p className="text-red-400 text-xs bg-red-900/30 border border-red-800 rounded-lg px-3 py-2">{error}</p>}

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
}
