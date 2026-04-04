import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { getUserProfile, getRideRequests, createRideRequest, cancelRideRequest } from '../api'
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
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center gap-3">
        <Link to={dashPath} className="text-gray-400 hover:text-gray-200 text-sm">
          ← Dashboard
        </Link>
        <h1 className="flex-1 font-semibold text-white text-sm">Ride Requests</h1>
        <button
          onClick={() => setShowForm(f => !f)}
          className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg transition-colors"
        >
          + New Request
        </button>
      </header>

      <main className="flex-1 p-4 max-w-3xl mx-auto w-full space-y-4">
        {/* Create form */}
        {showForm && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h2 className="font-semibold text-sm text-gray-300 mb-3">New Ride Request</h2>
            <form onSubmit={handleCreate} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="From (origin)"
                  value={form.origin}
                  onChange={e => setForm(f => ({ ...f, origin: e.target.value }))}
                  required
                  className="col-span-1 rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="text"
                  placeholder="To (destination)"
                  value={form.destination}
                  onChange={e => setForm(f => ({ ...f, destination: e.target.value }))}
                  required
                  className="col-span-1 rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <input
                  type="date"
                  value={form.desired_date}
                  onChange={e => setForm(f => ({ ...f, desired_date: e.target.value }))}
                  required
                  className="col-span-1 rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="number"
                  placeholder="Passengers"
                  min="1"
                  value={form.passengers}
                  onChange={e => setForm(f => ({ ...f, passengers: e.target.value }))}
                  className="col-span-1 rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="number"
                  placeholder="Max price"
                  min="0"
                  step="0.01"
                  value={form.price_max}
                  onChange={e => setForm(f => ({ ...f, price_max: e.target.value }))}
                  className="col-span-1 rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {error && <p className="text-red-400 text-xs">{error}</p>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {creating ? '…' : 'Post Request'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Request list */}
        {requests.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-500 text-sm">
            No ride requests yet.
            <button
              onClick={() => setShowForm(true)}
              className="block mx-auto mt-3 text-xs text-blue-400 hover:text-blue-300"
            >
              Post your first request →
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {requests.map(req => (
              <div key={req.request_id || req.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-200">
                      {req.origin} → {req.destination}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
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
