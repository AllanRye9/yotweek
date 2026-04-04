import { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { resetPassword } from '../api'

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

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''

  const [password, setPass]   = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState('')
  const [passTouched, setPassTouched] = useState(false)

  const pwStrength = passwordStrength(password)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!token) return setError('Invalid or missing reset token. Please request a new password reset.')
    if (pwStrength.score < 2)
      return setError('Password must be at least 8 chars with uppercase, number, and/or symbol.')
    if (password !== confirm)
      return setError('Passwords do not match.')
    setLoading(true)
    try {
      const data = await resetPassword(token, password)
      setSuccess(data.message || 'Password updated! You can now sign in.')
      setTimeout(() => navigate('/login', { replace: true }), 2000)
    } catch (err) {
      setError(err.message || 'Failed to reset password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">
        <div className="border-b border-gray-700 py-3 px-6">
          <h1 className="text-center text-sm font-semibold text-white">Reset Password</h1>
        </div>

        <div className="p-6 space-y-4">
          {success ? (
            <div className="space-y-4 text-center">
              <p className="text-green-400 text-sm bg-green-900/30 border border-green-800 rounded-lg px-4 py-3">{success}</p>
              <Link to="/login" className="block text-blue-400 hover:text-blue-300 text-sm">
                Go to Sign In →
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              {!token && (
                <p className="text-yellow-400 text-xs bg-yellow-900/30 border border-yellow-800 rounded-lg px-3 py-2">
                  No reset token found. Please use the link from your password reset email.
                </p>
              )}

              <div>
                <input
                  type="password"
                  placeholder="New password"
                  value={password}
                  onChange={e => setPass(e.target.value)}
                  onBlur={() => setPassTouched(true)}
                  required
                  autoFocus
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

              <input
                type="password"
                placeholder="Confirm new password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                className={`w-full rounded-lg bg-gray-800 border text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  confirm && password !== confirm ? 'border-red-500' : 'border-gray-600'
                }`}
              />
              {confirm && password !== confirm && (
                <p className="text-red-400 text-xs">Passwords do not match.</p>
              )}

              {error && <p className="text-red-400 text-xs bg-red-900/30 border border-red-800 rounded-lg px-3 py-2">{error}</p>}

              <button
                type="submit"
                disabled={loading || !token}
                className="w-full py-2.5 rounded-lg font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? '…' : 'Set New Password'}
              </button>

              <Link
                to="/login"
                className="block w-full text-xs text-blue-400 hover:text-blue-300 text-center"
              >
                ← Back to Sign In
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
