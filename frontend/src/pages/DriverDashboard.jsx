import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getUserProfile, userLogout, getDriverDashboard, getRideChatInbox, getConfirmedUsers, driverConfirmBooking, repostSeat } from '../api'
import NavBar from '../components/NavBar'
import RideShare from '../components/RideShare'
import RideChat from '../components/RideChat'
import RideShareMap from '../components/RideShareMap'
import { getDashboardPath } from '../routing'

function fmtTs(ts) {
  if (!ts) return ''
  try {
    const d = typeof ts === 'number' && ts < 1e10 ? new Date(ts * 1000) : new Date(ts)
    const now  = new Date()
    const diff = now - d
    if (diff < 60000)    return 'now'
    if (diff < 3600000)  return Math.floor(diff / 60000)   + 'm'
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h'
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  } catch { return '' }
}

export default function DriverDashboard() {
  const navigate = useNavigate()

  const [driver, setDriver]         = useState(null)
  const [loading, setLoading]       = useState(true)
  const [dashData, setDashData]     = useState(null)
  const [tab, setTab]               = useState('overview')
  const [selectedRide, setSelectedRide] = useState(null)

  // Ride-chat inbox for drivers
  const [rideInbox, setRideInbox]   = useState([])
  const [inboxLoading, setInboxLoading] = useState(false)

  // Bookings tab: confirmed passengers per ride
  const [passengersMap, setPassengersMap] = useState({})
  const [confirmingMap, setConfirmingMap] = useState({})  // confirmationId → loading
  const [repostingMap, setRepostingMap] = useState({})    // rideId → loading

  useEffect(() => {
    getUserProfile()
      .then(u => {
        if (u.role !== 'driver') {
          navigate(getDashboardPath(u), { replace: true })
          return
        }
        setDriver(u)
        return getDriverDashboard()
          .then(d => setDashData(d))
          .catch(() => {})
      })
      .catch(() => {
        navigate('/login', { replace: true })
      })
      .finally(() => setLoading(false))
  }, [navigate])

  const loadRideInbox = () => {
    setInboxLoading(true)
    getRideChatInbox()
      .then(d => {
        const convs = d.conversations || d.inbox || []
        // Sort inbox descending: most recent message at top
        const sorted = [...convs].sort((a, b) => {
          const ta = a.ts || a.timestamp || 0
          const tb = b.ts || b.timestamp || 0
          const na = typeof ta === 'number' ? ta : new Date(ta).getTime() / 1000
          const nb = typeof tb === 'number' ? tb : new Date(tb).getTime() / 1000
          return nb - na
        })
        setRideInbox(sorted)
      })
      .catch(() => setRideInbox([]))
      .finally(() => setInboxLoading(false))
  }

  useEffect(() => {
    if (tab === 'inbox') loadRideInbox()
  }, [tab])

  const loadPassengers = async (rideId) => {
    try {
      const d = await getConfirmedUsers(rideId)
      setPassengersMap(m => ({ ...m, [rideId]: d.confirmed_users || [] }))
    } catch {
      setPassengersMap(m => ({ ...m, [rideId]: [] }))
    }
  }

  const handleDriverConfirm = async (rideId, confirmationId) => {
    setConfirmingMap(m => ({ ...m, [confirmationId]: true }))
    try {
      await driverConfirmBooking(rideId, confirmationId)
      // Mark locally as confirmed
      setPassengersMap(m => ({
        ...m,
        [rideId]: (m[rideId] || []).map(p =>
          p.confirmation_id === confirmationId ? { ...p, driver_confirmed: 1 } : p
        ),
      }))
    } catch { /* ignore */ }
    finally {
      setConfirmingMap(m => ({ ...m, [confirmationId]: false }))
    }
  }

  const handleRepostSeat = async (rideId) => {
    setRepostingMap(m => ({ ...m, [rideId]: true }))
    try {
      await repostSeat(rideId)
      // Refresh dashboard to update ride status
      const d = await getDriverDashboard().catch(() => null)
      if (d) setDashData(d)
    } catch { /* ignore */ }
    finally {
      setRepostingMap(m => ({ ...m, [rideId]: false }))
    }
  }

  const handleLogout = async () => {
    await userLogout()
    navigate('/login', { replace: true })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="spinner w-10 h-10" />
      </div>
    )
  }

  if (!driver) return null

  const stats = dashData?.stats || {}

  // Categorise recent rides by status
  const allRecentRides  = dashData?.posted_rides || []
  const openRides       = allRecentRides.filter(r => r.status === 'open')
  const cancelledRides  = allRecentRides.filter(r => r.status === 'cancelled')
  const completedRides  = allRecentRides.filter(r => r.status === 'completed')
  const otherRides      = allRecentRides.filter(r => !['open', 'cancelled', 'completed'].includes(r.status))

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-page)', color: 'var(--text-primary)' }}>
      {/* Shared NavBar */}
      <NavBar user={driver} onLogout={handleLogout} />

      {/* Tab bar */}
      <nav className="border-b flex px-4 gap-1 overflow-x-auto"
           style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}>
        {[
          ['overview',  '📊 Overview'],
          ['rides',     '🚘 My Rides'],
          ['bookings',  '👥 Bookings'],
          ['inbox',     '📬 Inbox'],
          ['chat',      '💬 Ride Chat'],
          ['map',       '🗺️ Map'],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap transition-colors border-b-2 ${
              tab === id
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent hover:opacity-80'
            }`}
            style={tab !== id ? { color: 'var(--text-secondary)' } : {}}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="flex-1 p-4 max-w-5xl mx-auto w-full">
        {/* Overview */}
        {tab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { icon: '🚘', value: stats.total_rides ?? '—', label: 'Total Rides Posted' },
                { icon: '✅', value: stats.open_rides ?? '—', label: 'Open Rides' },
                { icon: '👥', value: stats.total_passengers ?? '—', label: 'Confirmed Passengers' },
              ].map(({ icon, value, label }) => (
                <div key={label} className="rounded-xl p-4 text-center"
                     style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                  <div className="text-2xl mb-1">{icon}</div>
                  <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{value}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Recent rides — categorised by status */}
            {allRecentRides.length > 0 && (
              <div className="rounded-xl p-4 space-y-4"
                   style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                <h2 className="font-semibold text-sm" style={{ color: 'var(--text-secondary)' }}>Recent Rides</h2>

                {/* Open rides */}
                {openRides.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold mb-1.5 text-green-400">🟢 Open</p>
                    <div className="space-y-2">
                      {openRides.slice(0, 5).map(ride => (
                        <div
                          key={ride.ride_id}
                          className="flex items-center justify-between rounded-lg px-3 py-2 cursor-pointer transition-colors hover:opacity-80 border border-green-800/40"
                          style={{ background: 'var(--bg-surface)' }}
                          onClick={() => { setSelectedRide(ride); setTab('chat') }}
                        >
                          <div>
                            <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{ride.origin} → {ride.destination}</p>
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{ride.departure} · {ride.seats} seats</p>
                          </div>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/50 text-green-400">open</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Cancelled rides */}
                {cancelledRides.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold mb-1.5 text-red-400">🔴 Cancelled</p>
                    <div className="space-y-2">
                      {cancelledRides.slice(0, 5).map(ride => (
                        <div
                          key={ride.ride_id}
                          className="flex items-center justify-between rounded-lg px-3 py-2 border border-red-800/40 opacity-70"
                          style={{ background: 'var(--bg-surface)' }}
                        >
                          <div>
                            <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{ride.origin} → {ride.destination}</p>
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{ride.departure} · {ride.seats} seats</p>
                          </div>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/50 text-red-400">cancelled</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Other statuses (taken etc.) */}
                {otherRides.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-muted)' }}>Other</p>
                    <div className="space-y-2">
                      {otherRides.slice(0, 5).map(ride => (
                        <div
                          key={ride.ride_id}
                          className="flex items-center justify-between rounded-lg px-3 py-2 cursor-pointer transition-colors hover:opacity-80"
                          style={{ background: 'var(--bg-surface)' }}
                          onClick={() => { setSelectedRide(ride); setTab('chat') }}
                        >
                          <div>
                            <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{ride.origin} → {ride.destination}</p>
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{ride.departure} · {ride.seats} seats</p>
                          </div>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-700 text-gray-400">{ride.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Completed rides — seat sold out; Repost Seat available */}
                {completedRides.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold mb-1.5 text-amber-400">🟠 Completed (Full)</p>
                    <div className="space-y-2">
                      {completedRides.slice(0, 5).map(ride => (
                        <div
                          key={ride.ride_id}
                          className="flex items-center justify-between rounded-lg px-3 py-2 border border-amber-800/40"
                          style={{ background: 'var(--bg-surface)' }}
                        >
                          <div>
                            <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{ride.origin} → {ride.destination}</p>
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{ride.departure}</p>
                          </div>
                          <button
                            onClick={() => handleRepostSeat(ride.ride_id)}
                            disabled={repostingMap[ride.ride_id]}
                            className="text-xs px-2 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-medium disabled:opacity-50 transition-colors shrink-0"
                          >
                            {repostingMap[ride.ride_id] ? '…' : '+ Repost Seat'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="rounded-xl p-4"
                 style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <h2 className="font-semibold text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>Quick Actions</h2>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setTab('rides')}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black text-xs font-medium rounded-lg transition-colors"
                >
                  + Post New Ride
                </button>
                <button
                  onClick={() => setTab('bookings')}
                  className="px-3 py-1.5 text-xs rounded-lg transition-colors hover:opacity-80"
                  style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
                >
                  👥 Manage Bookings
                </button>
                <button
                  onClick={() => setTab('inbox')}
                  className="px-3 py-1.5 text-xs rounded-lg transition-colors hover:opacity-80"
                  style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
                >
                  View Messages
                </button>
              </div>
            </div>
          </div>
        )}

        {/* My Rides (driver's own rides only) */}
        {tab === 'rides' && (
          <RideShare
            user={driver}
            driverOnlyRides
            onOpenChat={(ride) => { setSelectedRide(ride); setTab('chat') }}
          />
        )}

        {/* Bookings — confirmed passengers with Confirm Booking & Repost Seat actions */}
        {tab === 'bookings' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm" style={{ color: 'var(--text-secondary)' }}>👥 Passenger Bookings</h2>
            </div>
            {!allRecentRides.length ? (
              <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>No rides posted yet.</p>
            ) : allRecentRides.map(ride => (
              <div key={ride.ride_id} className="rounded-xl p-4 space-y-3"
                   style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{ride.origin} → {ride.destination}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {ride.departure ? new Date(ride.departure).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                      {' · '}{ride.seats} seat(s) remaining
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      ride.status === 'open' ? 'bg-green-900/50 text-green-400'
                      : ride.status === 'completed' ? 'bg-red-900/50 text-red-400'
                      : 'bg-gray-700 text-gray-400'
                    }`}>{ride.status}</span>
                    {(ride.status === 'completed' || ride.status === 'taken') && (
                      <button
                        onClick={() => handleRepostSeat(ride.ride_id)}
                        disabled={repostingMap[ride.ride_id]}
                        className="px-2 py-1 rounded-lg text-xs font-medium bg-amber-500 hover:bg-amber-400 text-black disabled:opacity-50 transition-colors"
                        title="Increment seat count by 1 and re-open ride"
                      >
                        {repostingMap[ride.ride_id] ? '…' : '+ Repost Seat'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Passenger list with confirm buttons */}
                {!passengersMap[ride.ride_id] ? (
                  <button onClick={() => loadPassengers(ride.ride_id)}
                          className="text-xs text-amber-500 hover:text-amber-400 underline">
                    Load passengers →
                  </button>
                ) : passengersMap[ride.ride_id].length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No confirmed passengers yet.</p>
                ) : (
                  <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
                    {passengersMap[ride.ride_id].map((p, i) => (
                      <div key={i} className="py-2 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{p.real_name}</p>
                          <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{p.contact}</p>
                        </div>
                        {p.driver_confirmed ? (
                          <span className="text-xs text-green-400 shrink-0">✅ Confirmed</span>
                        ) : (
                          <button
                            onClick={() => handleDriverConfirm(ride.ride_id, p.confirmation_id)}
                            disabled={confirmingMap[p.confirmation_id]}
                            className="px-3 py-1 rounded-lg text-xs font-medium bg-amber-500 hover:bg-amber-400 text-black disabled:opacity-50 transition-colors shrink-0"
                          >
                            {confirmingMap[p.confirmation_id] ? '…' : 'Confirm Booking'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Ride Chat Inbox (driver-only: shows passenger conversations per ride) */}
        {tab === 'inbox' && (
          <div className="rounded-xl p-4 space-y-3"
               style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm" style={{ color: 'var(--text-secondary)' }}>📬 Ride Chat Inbox</h2>
              <button onClick={loadRideInbox} className="text-xs hover:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }}>
                ↻ Refresh
              </button>
            </div>
            {inboxLoading ? (
              <div className="flex justify-center py-6"><div className="spinner w-6 h-6" /></div>
            ) : rideInbox.length === 0 ? (
              <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>No ride conversations yet.</p>
            ) : (
              <div className="space-y-2">
                {rideInbox.map((item, i) => (
                  <button
                    key={item.ride_id || i}
                    onClick={() => { setSelectedRide(item); setTab('chat') }}
                    className="w-full text-left flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors hover:opacity-80"
                    style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)' }}
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                        {item.ride_info?.origin || item.origin || '?'} → {item.ride_info?.destination || item.destination || '?'}
                      </p>
                      <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {item.text || item.last_message || 'No messages yet'}
                      </p>
                    </div>
                    <div className="flex flex-col items-end shrink-0 ml-2 gap-1">
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{fmtTs(item.ts || item.timestamp)}</span>
                      {item.unread_count > 0 && (
                        <span className="w-4 h-4 rounded-full bg-amber-500 text-black text-xs flex items-center justify-center font-bold">
                          {item.unread_count}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Ride Chat */}
        {tab === 'chat' && (
          <div className="space-y-3">
            {selectedRide ? (
              <>
                <button
                  onClick={() => setSelectedRide(null)}
                  className="text-xs hover:opacity-70 transition-opacity"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  ← Back to ride list
                </button>
                <RideChat ride={selectedRide} user={driver} onClose={() => setSelectedRide(null)} />
              </>
            ) : (
              <div className="rounded-xl p-6 text-center text-sm"
                   style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                Select a ride to view its chat thread.
                <button
                  onClick={() => setTab('inbox')}
                  className="block mx-auto mt-3 text-xs text-amber-500 hover:text-amber-400"
                >
                  Go to Inbox →
                </button>
              </div>
            )}
          </div>
        )}

        {/* Map — shows driver's rides and their pickup locations */}
        {tab === 'map' && (
          <div className="rounded-xl overflow-hidden"
               style={{ border: '1px solid var(--border-color)' }}>
            <div className="px-4 py-2 border-b text-xs font-semibold"
                 style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
              🗺️ Pickup Map — your active ride locations
            </div>
            <RideShareMap
              rides={(dashData?.posted_rides || []).filter(r => r.status === 'open')}
              autoLoadDrivers={false}
              mapHeight={420}
              onOpenChat={(ride) => { setSelectedRide(ride); setTab('chat') }}
            />
          </div>
        )}
      </main>
    </div>
  )
}
