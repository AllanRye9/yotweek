/**
 * RequestsPage — Ride request card feed.
 *
 * Shows open ride requests from all passengers.
 * Drivers can Accept (which opens a DM thread), Decline (hides card), or Message.
 * Passengers see their own requests with status indicators.
 * Filter/sort bar at the top.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getUserProfile, getRideRequests, createRideRequest, cancelRideRequest, acceptRideRequest, dmStartConversation } from '../api'
import NavBar from '../components/NavBar'
import socket from '../socket'

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

function RequestCard({ req, currentUser, onAccept, onDecline, onMessage, accepting, messaging, isNew }) {
  const isOwn  = currentUser && req.user_id === currentUser.user_id
  const isDriver = currentUser?.role === 'driver'

  return (
    <div className={`rounded-xl p-4 space-y-3 ${isNew ? 'ride-request-new' : 'ride-request-card'}`}
      style={{ background: 'var(--bg-card)', border: `1px solid ${isNew ? 'rgba(245,158,11,0.5)' : 'var(--border-color)'}` }}>
      {/* Header row: avatar + name + status */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-blue-700 flex items-center justify-center text-sm font-bold text-white shrink-0">
          {(req.passenger_name || req.user_name || '?').charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {req.passenger_name || req.user_name || 'Passenger'}
            </p>
            {isNew && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-500 text-black font-bold animate-bounce">New</span>
            )}
          </div>
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
  const [newIds,     setNewIds]     = useState(new Set())
  const [loading,    setLoading]    = useState(true)
  const [creating,   setCreating]   = useState(false)
  const [showForm,   setShowForm]   = useState(false)
  const [error,      setError]      = useState('')
  const [accepting,  setAccepting]  = useState(null)
  const [messaging,  setMessaging]  = useState(null)
  const [sortBy,     setSortBy]     = useState('date')
  const [search,     setSearch]     = useState('')
  const [formStep,   setFormStep]   = useState(1)
  const prevIdsRef = useRef(new Set())

  const [form, setForm] = useState({
    origin: '', destination: '', desired_date: '', desired_time: '',
    passengers: 1, price_max: '', notes: '', luggage: 'none', ride_type: 'shared',
  })

  const loadRequests = useCallback(async () => {
    try {
      const data = await getRideRequests('open')
      const incoming = data.requests || []
      const incomingIds = new Set(incoming.map(r => r.request_id))

      const brandNew = new Set()
      incomingIds.forEach(id => {
        if (!prevIdsRef.current.has(id) && prevIdsRef.current.size > 0) {
          brandNew.add(id)
        }
      })

      prevIdsRef.current = incomingIds
      setRequests(incoming)
      if (brandNew.size > 0) {
        setNewIds(brandNew)
        setTimeout(() => setNewIds(new Set()), 6000)
      }
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

  // Real-time new ride request via socket
  useEffect(() => {
    const onNew = (req) => {
      setRequests(prev => {
        if (prev.some(r => r.request_id === req.request_id)) return prev
        return [req, ...prev]
      })
      setNewIds(prev => { const n = new Set(prev); n.add(req.request_id); return n })
      setTimeout(() => setNewIds(prev => { const n = new Set(prev); n.delete(req.request_id); return n }), 6000)
    }
    socket.on('new_ride_request', onNew)
    return () => socket.off('new_ride_request', onNew)
  }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    setError('')
    setCreating(true)
    try {
      // Combine date + time into ISO string if both provided
      const dateTime = form.desired_time
        ? `${form.desired_date}T${form.desired_time}:00`
        : form.desired_date
      await createRideRequest(
        form.origin.trim(),
        form.destination.trim(),
        dateTime,
        parseInt(form.passengers, 10) || 1,
        null,
        form.price_max ? parseFloat(form.price_max) : null,
      )
      setForm({ origin: '', destination: '', desired_date: '', desired_time: '', passengers: 1, price_max: '', notes: '', luggage: 'none', ride_type: 'shared' })
      setFormStep(1)
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
          <div>
            <h1 className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>🙋 Ride Requests</h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Find or post rides — matched with drivers in real time</p>
          </div>
          <button
            onClick={() => { setShowForm(f => !f); setFormStep(1); setError('') }}
            className="flex items-center gap-2 text-sm bg-amber-500 hover:bg-amber-400 text-black px-4 py-2 rounded-xl font-semibold transition-all shadow-md hover:shadow-amber-500/30"
          >
            {showForm ? '✕ Close' : '＋ New Request'}
          </button>
        </div>

        {/* ── Advanced Create form ── */}
        {showForm && (
          <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            {/* Form header with gradient */}
            <div className="px-5 py-4" style={{ background: 'linear-gradient(135deg, #f59e0b22 0%, #d9770622 100%)', borderBottom: '1px solid var(--border-color)' }}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-base flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <span className="w-8 h-8 rounded-full bg-amber-500 text-black flex items-center justify-center text-sm font-bold">🙋</span>
                    Request a Ride
                  </h2>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Drivers will see your request and contact you</p>
                </div>
                {/* Step indicator */}
                <div className="flex items-center gap-1.5">
                  {[1, 2].map(s => (
                    <button key={s} onClick={() => s < formStep && setFormStep(s)}
                      className={`w-7 h-7 rounded-full text-xs font-bold transition-all ${formStep === s ? 'bg-amber-500 text-black scale-110' : formStep > s ? 'bg-green-500 text-white' : 'text-white/40'}`}
                      style={formStep <= s && formStep !== s ? { background: 'var(--bg-surface)', border: '1px solid var(--border-color)' } : {}}>
                      {formStep > s ? '✓' : s}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <form onSubmit={handleCreate} className="p-5 space-y-4">
              {formStep === 1 && (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>Step 1 — Route & Schedule</p>

                  {/* Route row */}
                  <div className="relative">
                    <div className="space-y-2">
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-green-400 text-sm pointer-events-none">📍</span>
                        <input
                          type="text" placeholder="Pickup location  e.g. Manchester Airport"
                          value={form.origin} onChange={e => setForm(f => ({ ...f, origin: e.target.value }))}
                          required className="w-full rounded-xl pl-9 pr-3 py-2.5 text-sm outline-none"
                          style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
                      </div>
                      {/* Arrow connector */}
                      <div className="flex items-center gap-2 pl-3">
                        <div className="w-0.5 h-4 rounded" style={{ background: 'var(--border-color)' }} />
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>↓</span>
                      </div>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-400 text-sm pointer-events-none">🏁</span>
                        <input
                          type="text" placeholder="Destination  e.g. Liverpool City Centre"
                          value={form.destination} onChange={e => setForm(f => ({ ...f, destination: e.target.value }))}
                          required className="w-full rounded-xl pl-9 pr-3 py-2.5 text-sm outline-none"
                          style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
                      </div>
                    </div>
                  </div>

                  {/* Date + Time */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>📅 Date *</label>
                      <input type="date" value={form.desired_date} onChange={e => setForm(f => ({ ...f, desired_date: e.target.value }))}
                        required className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                        style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>🕐 Time (optional)</label>
                      <input type="time" value={form.desired_time} onChange={e => setForm(f => ({ ...f, desired_time: e.target.value }))}
                        className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                        style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
                    </div>
                  </div>

                  <button type="button"
                    onClick={() => {
                      if (!form.origin.trim() || !form.destination.trim() || !form.desired_date) {
                        setError('Please fill in pickup, destination, and date.')
                        return
                      }
                      setError('')
                      setFormStep(2)
                    }}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all bg-amber-500 hover:bg-amber-400 text-black">
                    Continue → Passengers &amp; Budget
                  </button>
                </>
              )}

              {formStep === 2 && (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>Step 2 — Passengers &amp; Preferences</p>

                  {/* Route summary */}
                  <div className="rounded-xl p-3 flex items-center gap-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)' }}>
                    <span className="text-green-400 text-sm">📍</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{form.origin}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>→ {form.destination}</p>
                    </div>
                    <div className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
                      {form.desired_date}{form.desired_time ? ` ${form.desired_time}` : ''}
                    </div>
                  </div>

                  {/* Passengers + Ride type */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>👥 Passengers</label>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => setForm(f => ({ ...f, passengers: Math.max(1, (f.passengers || 1) - 1) }))}
                          className="w-8 h-8 rounded-lg font-bold text-sm flex items-center justify-center hover:opacity-80"
                          style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>−</button>
                        <span className="flex-1 text-center text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{form.passengers}</span>
                        <button type="button" onClick={() => setForm(f => ({ ...f, passengers: Math.min(20, (f.passengers || 1) + 1) }))}
                          className="w-8 h-8 rounded-lg font-bold text-sm flex items-center justify-center hover:opacity-80"
                          style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>+</button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>🚗 Ride Type</label>
                      <select value={form.ride_type} onChange={e => setForm(f => ({ ...f, ride_type: e.target.value }))}
                        className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                        style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>
                        <option value="shared">Shared ride</option>
                        <option value="private">Private / solo</option>
                        <option value="express">Express</option>
                      </select>
                    </div>
                  </div>

                  {/* Budget + Luggage */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>💰 Max Budget ($)</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>$</span>
                        <input type="number" placeholder="0.00" min="0" step="0.50" value={form.price_max}
                          onChange={e => setForm(f => ({ ...f, price_max: e.target.value }))}
                          className="w-full rounded-xl pl-7 pr-3 py-2.5 text-sm outline-none"
                          style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>🧳 Luggage</label>
                      <select value={form.luggage} onChange={e => setForm(f => ({ ...f, luggage: e.target.value }))}
                        className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                        style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>
                        <option value="none">None</option>
                        <option value="light">Light (carry-on)</option>
                        <option value="medium">Medium (1–2 bags)</option>
                        <option value="heavy">Heavy (3+ bags)</option>
                      </select>
                    </div>
                  </div>

                  {error && <p className="text-red-400 text-xs">{error}</p>}
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setFormStep(1)}
                      className="px-4 py-2.5 rounded-xl text-sm font-medium hover:opacity-80"
                      style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
                      ← Back
                    </button>
                    <button type="submit" disabled={creating}
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all bg-amber-500 hover:bg-amber-400 text-black disabled:opacity-50">
                      {creating ? '⏳ Posting…' : '🙋 Post Request'}
                    </button>
                  </div>
                </>
              )}
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
                isNew={newIds.has(req.request_id)}
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
                isNew={newIds.has(req.request_id)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
