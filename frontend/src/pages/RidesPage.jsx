import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../App'
import RideChat from '../components/RideChat'
import RaiseRequest from '../components/RaiseRequest'
import TravelCompanion from '../components/TravelCompanion'
import UserAuth from '../components/UserAuth'
import ThemeSelector from '../components/ThemeSelector'
import UserProfile from '../components/UserProfile'
import {
  getUserProfile, getNotifications, markAllNotificationsRead,
  listRides, estimateFare, geocodeAddress, postRide, cancelRide,
} from '../api'
import socket from '../socket'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDep(dep) {
  if (!dep) return ''
  try { return new Date(dep).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return dep }
}

// ── Post Ride Modal ───────────────────────────────────────────────────────────

function PostRideModal({ onClose, onPosted }) {
  const [form, setForm] = useState({
    origin: '', destination: '', departure: '', seats: 1,
    fare: '', vehicle_type: 'sedan', vehicle_color: '', notes: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState('')
  const [originCoords, setOriginCoords]   = useState(null)
  const [destCoords, setDestCoords]       = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleGeocode = async (field) => {
    const addr = field === 'origin' ? form.origin : form.destination
    if (!addr.trim()) return
    try {
      const d = await geocodeAddress(addr)
      if (d?.lat && d?.lng) {
        field === 'origin' ? setOriginCoords(d) : setDestCoords(d)
      }
    } catch {}
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.origin || !form.destination || !form.departure) {
      setError('Origin, destination, and departure are required.')
      return
    }
    setSubmitting(true)
    try {
      await postRide(
        form.origin, form.destination, form.departure,
        parseInt(form.seats, 10),
        form.notes,
        originCoords?.lat || null, originCoords?.lng || null,
        destCoords?.lat || null,   destCoords?.lng || null,
        form.fare ? parseFloat(form.fare) : null,
        'shared',
        form.vehicle_color, form.vehicle_type, ''
      )
      onPosted()
      onClose()
    } catch (e) {
      setError(e?.message || 'Failed to post ride')
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls = 'w-full rounded-lg px-3 py-2 text-sm outline-none'
  const inputSty = { background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="w-full max-w-md rounded-xl border p-6 space-y-4"
           style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>🚗 Post a Ride</h3>
          <button onClick={onClose} className="text-lg leading-none opacity-60 hover:opacity-100">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input placeholder="Origin" value={form.origin}
                 onChange={e => set('origin', e.target.value)}
                 onBlur={() => handleGeocode('origin')}
                 className={inputCls} style={inputSty} />
          <input placeholder="Destination" value={form.destination}
                 onChange={e => set('destination', e.target.value)}
                 onBlur={() => handleGeocode('destination')}
                 className={inputCls} style={inputSty} />
          <input type="datetime-local" value={form.departure}
                 onChange={e => set('departure', e.target.value)}
                 className={inputCls} style={inputSty} />
          <div className="grid grid-cols-2 gap-3">
            <input type="number" min="1" max="20" placeholder="Seats" value={form.seats}
                   onChange={e => set('seats', e.target.value)}
                   className={inputCls} style={inputSty} />
            <input type="number" min="0" step="0.01" placeholder="Fare ($)" value={form.fare}
                   onChange={e => set('fare', e.target.value)}
                   className={inputCls} style={inputSty} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <select value={form.vehicle_type} onChange={e => set('vehicle_type', e.target.value)}
                    className={inputCls} style={inputSty}>
              <option value="sedan">Sedan</option>
              <option value="suv">SUV</option>
              <option value="van">Van</option>
              <option value="truck">Truck</option>
              <option value="minibus">Minibus</option>
              <option value="other">Other</option>
            </select>
            <input placeholder="Vehicle color" value={form.vehicle_color}
                   onChange={e => set('vehicle_color', e.target.value)}
                   className={inputCls} style={inputSty} />
          </div>
          <textarea placeholder="Notes (optional)" value={form.notes}
                    onChange={e => set('notes', e.target.value)}
                    rows={2} className={inputCls} style={inputSty} />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button type="submit" disabled={submitting}
                  className="w-full px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-amber-500 hover:bg-amber-400 text-black disabled:opacity-50">
            {submitting ? 'Posting…' : 'Post Ride'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Fare Estimator ────────────────────────────────────────────────────────────

function FareEstimator() {
  const [start, setStart]   = useState('')
  const [dest, setDest]     = useState('')
  const [seats, setSeats]   = useState(1)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr]       = useState('')

  const handleEstimate = async () => {
    if (!start || !dest) { setErr('Enter start and destination'); return }
    setErr('')
    setLoading(true)
    try {
      const d = await estimateFare(start, dest, seats)
      setResult(d)
    } catch (e) {
      setErr(e?.message || 'Failed to estimate')
    } finally {
      setLoading(false)
    }
  }

  const inputCls = 'w-full rounded-lg px-3 py-2 text-sm outline-none'
  const inputSty = { background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }

  return (
    <div className="rounded-xl border p-4 space-y-3"
         style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
      <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>💰 Fare Estimator</h4>
      <input placeholder="From" value={start} onChange={e => setStart(e.target.value)}
             className={inputCls} style={inputSty} />
      <input placeholder="To" value={dest} onChange={e => setDest(e.target.value)}
             className={inputCls} style={inputSty} />
      <input type="number" min="1" max="20" placeholder="Seats" value={seats}
             onChange={e => setSeats(parseInt(e.target.value, 10) || 1)}
             className={inputCls} style={inputSty} />
      {err && <p className="text-xs text-red-400">{err}</p>}
      <button onClick={handleEstimate} disabled={loading}
              className="w-full px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-amber-500 hover:bg-amber-400 text-black disabled:opacity-50">
        {loading ? 'Estimating…' : 'Estimate'}
      </button>
      {result && (
        <div className="rounded-lg p-3 text-sm space-y-1"
             style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
          <p><span style={{ color: 'var(--text-muted)' }}>Distance:</span> {result.distance_km?.toFixed(1)} km</p>
          <p><span style={{ color: 'var(--text-muted)' }}>Est. fare:</span> <strong>${result.estimated_fare?.toFixed(2)}</strong></p>
          {result.per_seat && <p><span style={{ color: 'var(--text-muted)' }}>Per seat:</span> ${result.per_seat?.toFixed(2)}</p>}
        </div>
      )}
    </div>
  )
}

// ── Main RidesPage ────────────────────────────────────────────────────────────

export default function RidesPage() {
  const navigate = useNavigate()
  const [appUser, setAppUser]             = useState(null)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [profileOpen, setProfileOpen]     = useState(false)
  const profileRef                        = useRef(null)

  // Rides
  const [rides, setRides]               = useState([])
  const [ridesLoading, setRidesLoading] = useState(true)
  const [ridesError, setRidesError]     = useState('')
  const [selectedRide, setSelectedRide] = useState(null)
  const [showPostForm, setShowPostForm] = useState(false)

  // Filters
  const [searchText, setSearchText] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [seatsFilter, setSeatsFilter] = useState('')

  // Right panel
  const [rightTab, setRightTab] = useState('rides')

  // Notifications
  const [notifs, setNotifs]       = useState([])
  const [showNotifs, setShowNotifs] = useState(false)
  const notifRef                   = useRef(null)
  const unread                     = notifs.filter(n => !n.read).length

  // Load user
  useEffect(() => {
    getUserProfile().then(u => setAppUser(u)).catch(() => setAppUser(null))
  }, [])

  // Load notifications
  useEffect(() => {
    getNotifications().then(d => setNotifs(d.notifications || [])).catch(() => {})
  }, [])

  // Real-time notifications
  useEffect(() => {
    const onNotif = (n) => setNotifs(prev => [n, ...prev])
    socket.on('dm_notification', onNotif)
    socket.on('ride_chat_notification', onNotif)
    return () => {
      socket.off('dm_notification', onNotif)
      socket.off('ride_chat_notification', onNotif)
    }
  }, [])

  // Load rides
  const loadRides = () => {
    setRidesLoading(true)
    setRidesError('')
    listRides()
      .then(d => setRides(d.rides || []))
      .catch(() => setRidesError('Failed to load rides'))
      .finally(() => setRidesLoading(false))
  }
  useEffect(() => { loadRides() }, [])

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false)
      if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotifs(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleCancelRide = async (rideId, e) => {
    e.stopPropagation()
    try { await cancelRide(rideId); loadRides() } catch {}
  }

  const handleMarkAllRead = async () => {
    try { await markAllNotificationsRead(); setNotifs(prev => prev.map(n => ({ ...n, read: true }))) } catch {}
  }

  // Filter rides
  const filteredRides = rides.filter(r => {
    const q = searchText.toLowerCase()
    const matchText = !q || r.origin?.toLowerCase().includes(q) || r.destination?.toLowerCase().includes(q)
    const matchDate = !dateFilter || (r.departure && r.departure.startsWith(dateFilter))
    const matchSeats = !seatsFilter || (r.seats >= parseInt(seatsFilter, 10))
    return matchText && matchDate && matchSeats
  })

  const inputCls = 'rounded-lg px-3 py-2 text-sm outline-none'
  const inputSty = { background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }

  return (
    <div style={{ background: 'var(--bg-page)', minHeight: '100vh' }}>
      {/* Header */}
      <header className="sticky top-0 z-30 border-b"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}>
        <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-4">
          <Link to="/rides" className="text-amber-500 font-bold text-lg leading-none whitespace-nowrap">
            🚗 YotRides
          </Link>

          {/* Nav */}
          <nav className="flex gap-1 ml-2">
            {[['rides', '🗺️ Rides'], ['requests', '🙋 Requests'], ['companions', '🌍 Companions']].map(([id, label]) => (
              <button key={id} onClick={() => setRightTab(id)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${rightTab === id ? 'bg-amber-500 text-black' : 'hover:opacity-80'}`}
                      style={rightTab !== id ? { color: 'var(--text-secondary)' } : {}}>
                {label}
              </button>
            ))}
          </nav>

          <div className="flex-1" />

          {/* Right controls */}
          <div className="flex items-center gap-2">
            <ThemeSelector />

            {/* Notifications */}
            <div className="relative" ref={notifRef}>
              <button onClick={() => setShowNotifs(v => !v)}
                      className="relative p-2 rounded-lg hover:opacity-80 transition-opacity"
                      style={{ color: 'var(--text-secondary)' }}>
                🔔
                {unread > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-xs flex items-center justify-center leading-none font-bold">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </button>
              {showNotifs && (
                <div className="absolute right-0 top-full mt-1 w-72 rounded-xl border shadow-xl z-50 overflow-hidden"
                     style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
                  <div className="flex items-center justify-between px-3 py-2 border-b"
                       style={{ borderColor: 'var(--border-color)' }}>
                    <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Notifications</span>
                    {unread > 0 && (
                      <button onClick={handleMarkAllRead} className="text-xs text-amber-500 hover:text-amber-400">Mark all read</button>
                    )}
                  </div>
                  <div className="max-h-64 overflow-y-auto divide-y" style={{ borderColor: 'var(--border-color)' }}>
                    {notifs.length === 0 ? (
                      <p className="text-xs px-3 py-4 text-center" style={{ color: 'var(--text-muted)' }}>No notifications</p>
                    ) : notifs.slice(0, 20).map((n, i) => (
                      <div key={n.id || i} className={`px-3 py-2 text-xs ${!n.read ? 'opacity-100' : 'opacity-60'}`}
                           style={{ color: 'var(--text-primary)' }}>
                        <p className="font-medium">{n.title || n.type || 'Notification'}</p>
                        <p style={{ color: 'var(--text-muted)' }}>{n.message || n.body || ''}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Inbox */}
            <button onClick={() => navigate('/inbox')}
                    className="p-2 rounded-lg hover:opacity-80 transition-opacity"
                    style={{ color: 'var(--text-secondary)' }}>
              💬
            </button>

            {/* Auth / avatar */}
            {appUser ? (
              <div className="relative" ref={profileRef}>
                <button onClick={() => setProfileOpen(v => !v)}
                        className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center text-sm font-bold text-black">
                  {appUser.name?.charAt(0)?.toUpperCase() || '?'}
                </button>
                {profileOpen && (
                  <div className="absolute right-0 top-full mt-1 z-50">
                    <UserProfile user={appUser} onLogout={() => { setAppUser(null); setProfileOpen(false) }}
                                 onUserUpdate={u => u && setAppUser(p => ({ ...p, ...u }))} />
                  </div>
                )}
              </div>
            ) : (
              <button onClick={() => setShowAuthModal(true)}
                      className="px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-500 hover:bg-amber-400 text-black">
                Sign in
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto p-4 flex gap-4">
        {/* Left — ride list */}
        <section className="flex-1 min-w-0 space-y-4">
          {/* Top bar */}
          <div className="flex flex-wrap items-center gap-2">
            {appUser?.role === 'driver' && (
              <button onClick={() => setShowPostForm(true)}
                      className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-amber-500 hover:bg-amber-400 text-black">
                + Post a Ride
              </button>
            )}
            <button onClick={loadRides}
                    className="px-3 py-2 rounded-lg text-sm transition-colors hover:opacity-80"
                    style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
              ↺ Refresh
            </button>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <input placeholder="Search origin / destination…" value={searchText}
                   onChange={e => setSearchText(e.target.value)}
                   className={`${inputCls} flex-1 min-w-40`} style={inputSty} />
            <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)}
                   className={inputCls} style={inputSty} />
            <input type="number" min="1" max="20" placeholder="Min seats" value={seatsFilter}
                   onChange={e => setSeatsFilter(e.target.value)}
                   className={`${inputCls} w-28`} style={inputSty} />
          </div>

          {/* Ride list */}
          {ridesLoading ? (
            <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading rides…</p>
          ) : ridesError ? (
            <p className="text-sm py-4 text-center text-red-400">{ridesError}</p>
          ) : filteredRides.length === 0 ? (
            <div className="rounded-xl border p-8 text-center space-y-3"
                 style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
              <p className="text-4xl">🚗</p>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No rides found.</p>
              <button onClick={() => setRightTab('requests')}
                      className="text-sm text-amber-500 hover:text-amber-400 underline">
                Raise a request →
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredRides.map(ride => (
                <div key={ride.ride_id}
                     className="rounded-xl border p-4 flex items-start justify-between gap-3 hover:opacity-90 transition-opacity"
                     style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="font-semibold text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                      {ride.origin} → {ride.destination}
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                      <span>💰 {ride.fare ? '$' + ride.fare : 'Ask driver'}</span>
                      <span>🪑 {ride.seats} seat(s)</span>
                      {(ride.vehicle_color || ride.vehicle_type) && (
                        <span>🚙 {[ride.vehicle_color, ride.vehicle_type].filter(Boolean).join(' ')}</span>
                      )}
                      {ride.driver_name && <span>👤 {ride.driver_name}</span>}
                      <span>🕐 {fmtDep(ride.departure)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => setSelectedRide(ride)}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500 hover:bg-amber-400 text-black transition-colors">
                      💬 Book
                    </button>
                    {appUser?.user_id === ride.user_id && (
                      <button onClick={(e) => handleCancelRide(ride.ride_id, e)}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:opacity-80"
                              style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
                        🗑️
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Fare estimator at bottom */}
          <FareEstimator />
        </section>

        {/* Right — tabs */}
        <aside className="w-80 flex-shrink-0 space-y-3">
          <div className="flex rounded-xl overflow-hidden border"
               style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
            {[['rides', '🗺️'], ['requests', '🙋'], ['companions', '🌍']].map(([id, icon]) => (
              <button key={id} onClick={() => setRightTab(id)}
                      className={`flex-1 py-2 text-xs font-medium transition-colors ${rightTab === id ? 'bg-amber-500 text-black' : 'hover:opacity-80'}`}
                      style={rightTab !== id ? { color: 'var(--text-secondary)' } : {}}>
                {icon}
              </button>
            ))}
          </div>

          {rightTab === 'rides' && (
            <div className="space-y-3">
              {appUser?.role === 'driver' ? (
                <div className="rounded-xl border p-4"
                     style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
                  <p className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Driver Tools</p>
                  <button onClick={() => setShowPostForm(true)}
                          className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-amber-500 hover:bg-amber-400 text-black transition-colors">
                    + Post a New Ride
                  </button>
                </div>
              ) : (
                <FareEstimator />
              )}
            </div>
          )}

          {rightTab === 'requests' && <RaiseRequest user={appUser} />}
          {rightTab === 'companions' && <TravelCompanion user={appUser} />}
        </aside>
      </main>

      {/* Chat overlay */}
      {selectedRide && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.7)' }}
             onClick={() => setSelectedRide(null)}>
          <div className="w-full max-w-lg h-[80vh]" onClick={e => e.stopPropagation()}>
            <RideChat ride={selectedRide} user={appUser} onClose={() => setSelectedRide(null)} />
          </div>
        </div>
      )}

      {/* Post ride modal */}
      {showPostForm && (
        <PostRideModal onClose={() => setShowPostForm(false)} onPosted={loadRides} />
      )}

      {/* Auth modal */}
      {showAuthModal && (
        <UserAuth onClose={() => setShowAuthModal(false)}
                  onLogin={u => { setAppUser(u); setShowAuthModal(false) }} />
      )}
    </div>
  )
}
