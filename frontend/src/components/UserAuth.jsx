import { useState } from 'react'
import { userRegister, userLogin } from '../api'

/**
 * UserAuth — inline login / register card for the platform.
 * Calls onSuccess(userObj) when auth succeeds.
 */
export default function UserAuth({ onSuccess, defaultMode = 'login' }) {
  const [mode, setMode]       = useState(defaultMode) // 'login' | 'register'
  const [name, setName]       = useState('')
  const [email, setEmail]     = useState('')
  const [password, setPass]   = useState('')
  const [role, setRole]       = useState('passenger')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      let user
      if (mode === 'register') {
        user = await userRegister(name.trim(), email.trim(), password, role)
        // Auto-login after register
        user = await userLogin(email.trim(), password)
      } else {
        user = await userLogin(email.trim(), password)
      }
      onSuccess?.(user)
    } catch (err) {
      setError(err.message || 'Authentication failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900/70 p-6 max-w-sm mx-auto space-y-4">
      {/* Toggle */}
      <div className="flex rounded-lg overflow-hidden border border-gray-700">
        <button
          type="button"
          onClick={() => { setMode('login'); setError('') }}
          className={`flex-1 py-2 text-sm font-semibold transition-colors ${mode === 'login' ? 'bg-blue-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
        >
          Login
        </button>
        <button
          type="button"
          onClick={() => { setMode('register'); setError('') }}
          className={`flex-1 py-2 text-sm font-semibold transition-colors ${mode === 'register' ? 'bg-blue-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
        >
          Register
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        {mode === 'register' && (
          <input
            type="text"
            placeholder="Full name"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            className="w-full rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        )}

        <input
          type="email"
          placeholder="Email address"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          className="w-full rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <input
          type="password"
          placeholder="Password (min 6 chars)"
          value={password}
          onChange={e => setPass(e.target.value)}
          required
          className="w-full rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {mode === 'register' && (
          <div>
            <label className="block text-xs text-gray-400 mb-1">I am a…</label>
            <div className="flex gap-3">
              {['passenger', 'driver'].map(r => (
                <label key={r} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="role"
                    value={r}
                    checked={role === r}
                    onChange={() => setRole(r)}
                    className="accent-blue-500"
                  />
                  <span className="text-sm text-gray-300 capitalize">
                    {r === 'driver' ? '🚗 Driver' : '🧍 Passenger'}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p className="text-red-400 text-xs bg-red-900/30 border border-red-800 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded-lg font-semibold text-white transition-colors bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? '…' : mode === 'register' ? 'Create Account' : 'Login'}
        </button>
      </form>
    </div>
  )
}
