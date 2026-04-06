/**
 * RequestsPage — Ride request card feed.
 *
 * Shows open ride requests from all passengers.
 * Drivers can Accept (which opens a DM thread), Decline (hides card), or Message.
 * Passengers see their own requests with status indicators.
 * Filter/sort bar at the top.
 */
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getUserProfile, getRideRequests, createRideRequest, cancelRideRequest, acceptRideRequest, dmStartConversation } from '../api'
import NavBar from '../components/NavBar'

const SORT_OPTIONS = [
  { id: 'date',     label: '📅 Nearest Departure' },
  { id: 'location', label: '📍 Closest to Me'     },
  { id: 'price',    label: '💰 Price'              },
]

function fmtDate(s) {
  if (!s) return '—'
  try { return new Date(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) }
  catch { return s }
}

function RequestCard({ req, currentUser, onAccept, onDecline, onMessage, accepting, messaging }) {
  const isOwn  = currentUser && req.user_id === currentUser.user_id
  const isDriver = currentUser?.role === 'driver'

  return (
    <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
      {/* Header row: avatar + name + status */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-blue-700 flex items-center justify-center text-sm font-bold text-white shrink-0">
          {(req.passenger_name || req.user_name || '?').charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {req.passenger_name || req.user_name || 'Passenger'}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Ride Request
          </p>
        </div>
        <span
          className="text-xs px-2 py-0.5 rounded-full font-semibold shrink-0"
          style={req.status === 'open' ? { background: 'rgba(16,185,129,0.15)', color: '#6ee7b7' }
               : req.status === 'accepted' ? { background: 'rgba(59,130,246,0.15)', color: '#93c5fd' }
               : { background: 'rgba(107,114,128,0.2)', color: '#9ca3af' }}
        >
          {req.status}
        </span>
      </div>

      {/* Route */}
      <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-primary)' }}>
        <span>📍</span>
        <span className="font-medium">{req.origin}</span>
        <span style={{ color: 'var(--text-muted)' }}>→</span>
        <span className="font-medium text-amber-400">{req.destination}</span>
      </div>

      {/* Details row */}
      <div className="flex flex-wrap gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        <span>📅 {fmtDate(req.desired_date)}</span>
        <span>👥 {req.passengers} seat{req.passengers !== 1 ? 's' : ''}</span>
        {(req.price_max || req.price_min) && (
          <span>💰 {req.price_min ? `${req.price_min}–` : 'up to '}{req.price_max}</span>
        )}
      </div>

      {/* Action buttons */}
      {req.status === 'open' && !isOwn && isDriver && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onAccept(req)}
            disabled={accepting === req.request_id}
            className="flex-1 py-2 rounded-lg text-xs font-semibold bg-green-600 hover:bg-green-500 text-white disabled:opacity-50 transition-colors"
          >
            {accepting === req.request_id ? '…' : '✓ Accept'}
          </button>
          <button
            onClick={() => onDecline(req.request_id)}
            className="flex-1 py-2 rounded-lg text-xs font-semibold hover:opacity-80 transition-colors"
            style={{ border: '1px solid var(--border-color)', color: 'var(--text-secondary)', background: 'var(--bg-surface)' }}
          >
            ✕ Decline
          </button>
          <button
            onClick={() => onMessage(req.user_id)}
            disabled={messaging === req.user_id}
            className="flex-1 py-2 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-black disabled:opacity-50 transition-colors"
          >
            {messaging === req.user_id ? '…' : '💬 Message'}
          </button>
        </div>
      )}

      {/* Own request: cancel */}
      {isOwn && req.status === 'open' && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onDecline(req.request_id)}
            className="px-4 py-1.5 rounded-lg text-xs text-red-400 hover:text-red-300 transition-colors"
            style={{ border: '1px solid rgba(248,113,113,0.4)', background: 'transparent' }}
          >
            Cancel Request
          </button>
        </div>
      )}
    </div>
  )
}

export default function RequestsPage() {
  const navigate = useNavigate()
  const [user,       setUser]       = useState(null)
  const [requests,   setRequests]   = useState([])
  const [declined,   setDeclined]   = useState(new Set())
  const [loading,    setLoading]    = useState(true)
  const [creating,   setCreating]   = useState(false)
  const [showForm,   setShowForm]   = useState(false)
  const [error,      setError]      = useState('')
  const [accepting,  setAccepting]  = useState(null)
  const [messaging,  setMessaging]  = useState(null)
  const [sortBy,     setSortBy]     = useState('date')
  const [search,     setSearch]     = useState('')

  const [form, setForm] = useState({ origin: '', destination: '', desired_date: '', passengers: 1, price_max: '' })

  const loadRequests = useCallback(async () => {
    try {
      const data = await getRideRequests('open')
      setRequests(data.requests || [])
    } catch {}
  }, [])

  useEffect(() => {
    getUserProfile()
      .then(u => { setUser(u); return loadRequests() })
      .catch(() => navigate('/login', { replace: true }))
      .finally(() => setLoading(false))
  }, [navigate, loadRequests])

  // Live refresh every 20 s
  useEffect(() => {
    const id = setInterval(loadRequests, 20_000)
    return () => clearInterval(id)
  }, [loadRequests])

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
        null,
        form.price_max ? parseFloat(form.price_max) : null,
      )
      setForm({ origin: '', destination: '', desired_date: '', passengers: 1, price_max: '' })
      setShowForm(false)
      await loadRequests()
    } catch (err) {
      setError(err.message || 'Failed to create request.')
    } finally {
      setCreating(false)
    }
  }

  const handleAccept = async (req) => {
    setAccepting(req.request_id)
    try {
      const res = await acceptRideRequest(req.request_id)
      await loadRequests()
      if (res?.conv_id) navigate('/inbox')
    } catch (err) {
      setError(err.message || 'Failed to accept request.')
    } finally {
      setAccepting(null)
    }
  }

  const handleDecline = async (requestId) => {
    // For own requests, cancel via API; for others, just hide locally
    const req = requests.find(r => r.request_id === requestId)
    if (req && user && req.user_id === user.user_id) {
      try { await cancelRideRequest(requestId); await loadRequests() }
      catch (err) { setError(err.message || 'Failed to cancel.') }
    } else {
      setDeclined(prev => new Set([...prev, requestId]))
    }
  }

  const handleMessage = async (toUserId) => {
    setMessaging(toUserId)
    try {
      await dmStartConversation(toUserId)
      navigate('/inbox')
    } catch (err) {
      setError(err.message || 'Failed to start conversation.')
    } finally {
      setMessaging(null)
    }
  }

  // Partition: accepted (active rides at top) + open
  const visible = requests.filter(r => !declined.has(r.request_id))
  const activeRides = visible.filter(r => r.status === 'accepted')
  const openRides   = visible.filter(r => r.status === 'open')

  // Apply search filter
  const searchLower = search.toLowerCase()
  const filterFn = (r) => {
    if (!searchLower) return true
    return (r.origin || '').toLowerCase().includes(searchLower) ||
           (r.destination || '').toLowerCase().includes(searchLower)
  }

  // Sort open rides
  const sortedOpen = [...openRides].filter(filterFn).sort((a, b) => {
    if (sortBy === 'date')  return (a.desired_date || '').localeCompare(b.desired_date || '')
    if (sortBy === 'price') return (a.price_max ?? 9999) - (b.price_max ?? 9999)
    return 0
  })

  const input = 'w-full rounded-lg px-3 py-2 text-sm outline-none'
  const inputSty = { background: 'var(--bg-input, var(--bg-surface))', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-page)' }}>
      <div className="spinner w-10 h-10" />
    </div>
  )

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-page)', color: 'var(--text-primary)' }}>
      <NavBar user={user || false} title="Ride Requests" />

      <main className="flex-1 max-w-3xl mx-auto w-full p-4 space-y-4">

        {/* Action bar */}
        <div className="flex items-center justify-between">
          <h1 className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>Ride Requests</h1>
          <button
            onClick={() => setShowForm(f => !f)}
            className="text-xs bg-amber-500 hover:bg-amber-400 text-black px-3 py-1.5 rounded-lg font-semibold transition-colors"
          >
            {showForm ? '✕ Close' : '+ New Request'}
          </button>
        </div>

        {/* ── Create form ── */}
        {showForm && (
          <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <h2 className="font-semibold text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>New Ride Request</h2>
            <form onSubmit={handleCreate} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input type="text" placeholder="From (origin)" value={form.origin} onChange={e => setForm(f => ({ ...f, origin: e.target.value }))} required className={input} style={inputSty} />
                <input type="text" placeholder="To (destination)" value={form.destination} onChange={e => setForm(f => ({ ...f, destination: e.target.value }))} required className={input} style={inputSty} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input type="date" value={form.desired_date} onChange={e => setForm(f => ({ ...f, desired_date: e.target.value }))} required className={input} style={inputSty} />
                <input type="number" placeholder="Passengers" min="1" value={form.passengers} onChange={e => setForm(f => ({ ...f, passengers: e.target.value }))} className={input} style={inputSty} />
                <input type="number" placeholder="Max price" min="0" step="0.01" value={form.price_max} onChange={e => setForm(f => ({ ...f, price_max: e.target.value }))} className={input} style={inputSty} />
              </div>
              {error && <p className="text-red-400 text-xs">{error}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={creating} className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black text-xs rounded-lg font-semibold disabled:opacity-50">
                  {creating ? '…' : 'Post Request'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-xs rounded-lg font-medium hover:opacity-80" style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {error && !showForm && <p className="text-red-400 text-xs px-1">{error}</p>}

        {/* ── Filter + Sort Bar ── */}
        <div className="flex flex-wrap gap-2 items-center p-3 rounded-xl sticky top-14 z-10" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          {/* Sort buttons */}
          {SORT_OPTIONS.map(s => (
            <button key={s.id} onClick={() => setSortBy(s.id)}
              className={`text-xs px-3 py-1 rounded-full font-semibold transition-colors ${sortBy === s.id ? 'bg-amber-500 text-black' : 'hover:opacity-80'}`}
              style={sortBy !== s.id ? { color: 'var(--text-secondary)', border: '1px solid var(--border-color)' } : {}}>
              {s.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-1">
            <input
              type="text"
              placeholder="Search city or route…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="text-xs rounded-lg px-2 py-1 outline-none w-44"
              style={inputSty}
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-xs text-amber-400 hover:text-amber-300">✕</button>
            )}
          </div>
        </div>

        {/* ── Active Rides (accepted) ── */}
        {activeRides.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wide" style={{ color: '#93c5fd' }}>
              🚗 Active Rides ({activeRides.length})
            </h2>
            {activeRides.map(req => (
              <RequestCard
                key={req.request_id}
                req={req}
                currentUser={user}
                onAccept={handleAccept}
                onDecline={handleDecline}
                onMessage={handleMessage}
                accepting={accepting}
                messaging={messaging}
              />
            ))}
          </section>
        )}

        {/* ── Open Request Feed ── */}
        {sortedOpen.length === 0 ? (
          <div className="rounded-xl p-8 text-center text-sm" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
            <p className="text-3xl mb-2">🚗</p>
            <p>{requests.length === 0 ? 'No ride requests yet.' : 'No requests match your search.'}</p>
            {requests.length === 0 && (
              <button onClick={() => setShowForm(true)} className="block mx-auto mt-3 text-xs text-amber-500 hover:text-amber-400">
                Post your first request →
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {sortedOpen.map(req => (
              <RequestCard
                key={req.request_id}
                req={req}
                currentUser={user}
                onAccept={handleAccept}
                onDecline={handleDecline}
                onMessage={handleMessage}
                accepting={accepting}
                messaging={messaging}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
