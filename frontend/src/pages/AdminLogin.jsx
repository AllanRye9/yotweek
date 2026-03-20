import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { adminLogin, adminRegister, checkAdminExists } from '../api'
import { useAuth } from '../App'

export default function AdminLogin({ register = false }) {
  const { admin, checkAuth } = useAuth()
  const navigate = useNavigate()
  const [hasAdmin, setHasAdmin] = useState(null)
  const [mode, setMode] = useState(register ? 'register' : 'login')
  const [form, setForm] = useState({ username: '', password: '', confirm_password: '' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (admin) navigate('/const', { replace: true })
    checkAdminExists().then(d => setHasAdmin(d.has_admin)).catch(() => setHasAdmin(false))
  }, [admin])

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)
    try {
      if (mode === 'login') {
        await adminLogin(form.username, form.password)
        await checkAuth()
        navigate('/const', { replace: true })
      } else {
        await adminRegister(form.username, form.password, form.confirm_password)
        setSuccess('Admin account created! You can now log in.')
        setMode('login')
        setForm(f => ({ ...f, password: '', confirm_password: '' }))
      }
    } catch (err) {
      setError(err.data?.error || err.message || 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-4">
      {/* Logo */}
      <div className="mb-8 text-center">
        <Link to="/" className="inline-flex items-center gap-2 text-2xl font-bold text-white">
          <span className="text-3xl">📥</span>
          <span className="gradient-text">yotweek</span>
        </Link>
        <p className="text-gray-500 text-sm mt-1">Admin Panel</p>
      </div>

      <div className="w-full max-w-sm">
        <div className="card">
          {/* Tabs */}
          <div className="flex gap-2 mb-6">
            <button
              className={mode === 'login' ? 'tab-btn-active flex-1' : 'tab-btn-inactive flex-1'}
              onClick={() => { setMode('login'); setError(''); setSuccess('') }}
            >
              Sign In
            </button>
            {(!hasAdmin || mode === 'register') && (
              <button
                className={mode === 'register' ? 'tab-btn-active flex-1' : 'tab-btn-inactive flex-1'}
                onClick={() => { setMode('register'); setError(''); setSuccess('') }}
              >
                Register
              </button>
            )}
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Username</label>
              <input
                className="input"
                type="text"
                value={form.username}
                onChange={set('username')}
                autoComplete="username"
                placeholder="admin"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Password</label>
              <input
                className="input"
                type="password"
                value={form.password}
                onChange={set('password')}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder="••••••••"
                required
              />
            </div>
            {mode === 'register' && (
              <div>
                <label className="block text-sm text-gray-400 mb-1">Confirm Password</label>
                <input
                  className="input"
                  type="password"
                  value={form.confirm_password}
                  onChange={set('confirm_password')}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  required
                />
              </div>
            )}

            {error   && <p className="text-red-400 text-sm bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">{error}</p>}
            {success && <p className="text-green-400 text-sm bg-green-900/20 border border-green-800/50 rounded-lg px-3 py-2">{success}</p>}

            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? <span className="spinner w-4 h-4" /> : null}
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          {hasAdmin === false && mode === 'login' && (
            <p className="mt-4 text-center text-sm text-gray-500">
              No admin account?{' '}
              <button
                className="text-red-400 hover:text-red-300 underline"
                onClick={() => { setMode('register'); setError('') }}
              >
                Register first
              </button>
            </p>
          )}
        </div>

        <p className="mt-6 text-center">
          <Link to="/" className="text-gray-500 hover:text-white text-sm transition-colors">
            ← Back to downloader
          </Link>
        </p>
      </div>
    </div>
  )
}
