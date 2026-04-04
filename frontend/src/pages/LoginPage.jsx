import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { userLogin, forgotPassword, storePublicKey } from '../api'
import { generateKeyPair, getStoredPublicKeyJwk } from '../crypto'
import { getDashboardPath } from '../routing'

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export default function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const verified = searchParams.get('verified') === '1'

  const [tab, setTab]           = useState('signin') // 'signin' | 'forgot'
  const [email, setEmail]       = useState('')
  const [password, setPass]     = useState('')
  const [rememberMe, setRemember] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [success, setSuccess]   = useState('')

  // If already logged in, redirect to the correct dashboard
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.user_id) navigate(getDashboardPath(data), { replace: true })
      })
      .catch(() => {})
  }, [navigate])

  const switchTab = (t) => {
    setError(''); setSuccess(''); setPass(''); setTab(t)
  }

  const handleSignIn = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
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
      setError(err.message || 'Authentication failed.')
    } finally {
      setLoading(false)
    }
  }

  const handleForgot = async (e) => {
    e.preventDefault()
    setError('')
    if (!isValidEmail(email)) return setError('Please enter a valid email address.')
    setLoading(true)
    try {
      const data = await forgotPassword(email.trim())
      setSuccess(data.message || 'If that address is registered, a reset link has been sent.')
    } catch (err) {
      setError(err.message || 'Failed to send reset link.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">
      {verified && (
        <div className="mb-4 w-full max-w-md bg-green-900/40 border border-green-700 rounded-xl px-4 py-3 text-green-300 text-sm text-center">
          ✅ Email verified! You can now sign in.
        </div>
      )}

      <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">
        {/* Tab bar */}
        {tab !== 'forgot' && (
          <div className="flex border-b border-gray-700">
            <div className="flex-1 py-3 text-sm font-semibold text-center bg-blue-700 text-white">
              Sign In
            </div>
            <Link
              to="/register"
              className="flex-1 py-3 text-sm font-semibold text-center bg-gray-800/50 text-gray-400 hover:bg-gray-700 hover:text-white transition-colors"
            >
              Create Account
            </Link>
          </div>
        )}

        <div className="p-6 space-y-4">
          {tab === 'signin' && (
            <form onSubmit={handleSignIn} className="space-y-3">
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                className="w-full rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={e => setPass(e.target.value)}
                required
                className="w-full rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
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
              <button
                type="button"
                onClick={() => switchTab('forgot')}
                className="w-full text-xs text-blue-400 hover:text-blue-300 text-center"
              >
                Forgot password?
              </button>
            </form>
          )}

          {tab === 'forgot' && (
            <form onSubmit={handleForgot} className="space-y-3">
              <p className="text-sm text-gray-400">Enter your email and we'll send you a reset link.</p>
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                className="w-full rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              {error   && <p className="text-red-400 text-xs bg-red-900/30 border border-red-800 rounded-lg px-3 py-2">{error}</p>}
              {success && <p className="text-green-400 text-xs bg-green-900/30 border border-green-800 rounded-lg px-3 py-2">{success}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-lg font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? '…' : 'Send Reset Link'}
              </button>
              <button
                type="button"
                onClick={() => switchTab('signin')}
                className="w-full text-xs text-blue-400 hover:text-blue-300 text-center"
              >
                ← Back to Sign In
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
