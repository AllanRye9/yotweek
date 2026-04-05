import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { getUserProfile, getRideRequests, createRideRequest, cancelRideRequest } from '../api'
import NavBar from '../components/NavBar'
import { getDashboardPath } from '../routing'

export default function RequestsPage() {
  const navigate = useNavigate()

  const [user, setUser]         = useState(null)
  const [requests, setRequests] = useState([])
  const [loading, setLoading]   = useState(true)
  const [creating, setCreating] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [error, setError]       = useState('')

  const [form, setForm] = useState({
    origin: '', destination: '', desired_date: '', passengers: 1,
    price_min: '', price_max: '',
  })

  useEffect(() => {
    getUserProfile()
      .then(u => {
        setUser(u)
        return getRideRequests()
      })
      .then(data => setRequests(data.requests || []))
      .catch(() => navigate('/login', { replace: true }))
      .finally(() => setLoading(false))
  }, [navigate])

  const loadRequests = () =>
    getRideRequests()
      .then(data => setRequests(data.requests || []))
      .catch(() => {})

  const handleCreate = async (e) => {
    e.preventDefault()
    setError('')
    setCreating(true)
    try {
      await createRideRequest(
        form.origin.trim(),
        form.destination.trim(),
        form.desired_date,
        parseInt(form.passengers, 10) || 1,
        form.price_min ? parseFloat(form.price_min) : null,
        form.price_max ? parseFloat(form.price_max) : null,
      )
      setForm({ origin: '', destination: '', desired_date: '', passengers: 1, price_min: '', price_max: '' })
      setShowForm(false)
      await loadRequests()
    } catch (err) {
      setError(err.message || 'Failed to create request.')
    } finally {
      setCreating(false)
    }
  }

  const handleCancel = async (requestId) => {
    try {
      await cancelRideRequest(requestId)
      await loadRequests()
    } catch (err) {
      setError(err.message || 'Failed to cancel request.')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="spinner w-10 h-10" />
      </div>
    )
  }

  const dashPath = user ? getDashboardPath(user) : '/login'

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-page)', color: 'var(--text-primary)' }}>
      {/* Shared NavBar */}
      <NavBar user={user || false} title="Ride Requests" />

      <main className="flex-1 p-4 max-w-3xl mx-auto w-full space-y-4">
        {/* Create button bar */}
        <div className="flex items-center justify-between">
          <h1 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Ride Requests</h1>
          <button
            onClick={() => setShowForm(f => !f)}
            className="text-xs bg-amber-500 hover:bg-amber-400 text-black px-3 py-1.5 rounded-lg font-medium transition-colors"
          >
            + New Request
          </button>
        </div>
        {/* Create form */}
        {showForm && (
          <div className="rounded-xl p-4"
               style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <h2 className="font-semibold text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>New Ride Request</h2>
            <form onSubmit={handleCreate} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="From (origin)"
                  value={form.origin}
                  onChange={e => setForm(f => ({ ...f, origin: e.target.value }))}
                  required
                  className="input"
                />
                <input
                  type="text"
                  placeholder="To (destination)"
                  value={form.destination}
                  onChange={e => setForm(f => ({ ...f, destination: e.target.value }))}
                  required
                  className="input"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  type="date"
                  value={form.desired_date}
                  onChange={e => setForm(f => ({ ...f, desired_date: e.target.value }))}
                  required
                  className="input"
                />
                <input
                  type="number"
                  placeholder="Passengers"
                  min="1"
                  value={form.passengers}
                  onChange={e => setForm(f => ({ ...f, passengers: e.target.value }))}
                  className="input"
                />
                <input
                  type="number"
                  placeholder="Max price"
                  min="0"
                  step="0.01"
                  value={form.price_max}
                  onChange={e => setForm(f => ({ ...f, price_max: e.target.value }))}
                  className="input"
                />
              </div>
              {error && <p className="text-red-400 text-xs">{error}</p>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black text-xs rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {creating ? '…' : 'Post Request'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-xs rounded-lg font-medium transition-colors hover:opacity-80"
                  style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Request list */}
        {requests.length === 0 ? (
          <div className="rounded-xl p-8 text-center text-sm"
               style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
            No ride requests yet.
            <button
              onClick={() => setShowForm(true)}
              className="block mx-auto mt-3 text-xs text-amber-500 hover:text-amber-400"
            >
              Post your first request →
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {requests.map(req => (
              <div key={req.request_id || req.id} className="rounded-xl p-4"
                   style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {req.origin} → {req.destination}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {req.desired_date} · {req.passengers} passenger(s)
                      {(req.price_max || req.price_min) && ` · Budget: ${req.price_min ?? 0}–${req.price_max ?? '∞'}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      req.status === 'open'
                        ? 'bg-green-900/50 text-green-400'
                        : req.status === 'accepted'
                        ? 'bg-blue-900/50 text-blue-400'
                        : 'bg-gray-700 text-gray-400'
                    }`}>
                      {req.status}
                    </span>
                    {req.status === 'open' && (
                      <button
                        onClick={() => handleCancel(req.request_id || req.id)}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
