import { useState, useEffect, useRef, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import RideShare from '../components/RideShare'
import RideChat from '../components/RideChat'
import ThemeSelector from '../components/ThemeSelector'
import UserProfile from '../components/UserProfile'
import DMInbox from '../components/DMInbox'
import RideShareMap from '../components/RideShareMap'
import {
  getUserProfile, userLogout, getNotifications,
  markAllNotificationsRead, markNotificationRead, clearAllNotifications,
  getRideHistory, getTrackedRides,
  listRides, getConfirmedUsers, cancelRide,
  driverApply, getDriverApplication,
  getAllDriverLocations, dmStartConversation,
} from '../api'
import socket from '../socket'

// ─── Dashboard tabs ────────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview',    label: '🏠 Overview',          icon: '🏠' },
  { id: 'rides',       label: '🚗 Rides',              icon: '🚗' },
  { id: 'requests',    label: '🙋 Requests',           icon: '🙋' },
  { id: 'map',         label: '🗺️ Map',                icon: '🗺️' },
  { id: 'tracking',    label: '📡 Ride Tracking',      icon: '📡' },
  { id: 'inbox',       label: '💬 Inbox',              icon: '💬', badge: 'chat' },
  { id: 'notifications', label: '🔔 Notifications',   icon: '🔔', badge: 'notif' },
  { id: 'history',     label: '📋 History',            icon: '📋' },
  { id: 'driver_reg',  label: '🚕 Driver Reg.',         icon: '🚕' },
  { id: 'profile',     label: '👤 Profile',             icon: '👤' },
]

// ─── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ icon, value, label, color = 'text-white' }) {
  return (
    <div className="themed-card rounded-xl p-4 flex flex-col gap-1">
      <span className="text-2xl">{icon}</span>
      <span className={`text-2xl font-bold tabular-nums ${color}`}>{value ?? '—'}</span>
      <span className="text-xs text-gray-400">{label}</span>
    </div>
  )
}

// ─── Welcome / overview panel ───────────────────────────────────────────────────

function OverviewPanel({ user, dashStats, onSelectTab, onNavigate }) {
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const roleLabel = user?.role === 'driver' ? '🚗 Verified Driver' : '🧍 Passenger'
  const [showAllRides, setShowAllRides] = useState(false)
  const recentRides = dashStats?.recent_rides || []
  const visibleRides = showAllRides ? recentRides : recentRides.slice(0, 3)

  return (
    <div className="space-y-6">
      {/* Welcome banner */}
      <div className="rounded-2xl bg-gradient-to-br from-blue-900/60 to-gray-900/80 border border-blue-800/40 p-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-blue-600 bg-blue-800 shrink-0 flex items-center justify-center">
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="avatar" className="w-full h-full object-cover" />
            ) : (
              <span className="text-3xl">{user?.role === 'driver' ? '🚗' : '🧍'}</span>
            )}
          </div>
          <div>
            <p className="text-gray-400 text-sm">{greeting},</p>
            <h2 className="text-xl font-bold text-white">{user?.name}</h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-900/60 border border-blue-700 text-blue-300 mt-1 inline-block capitalize">
              {roleLabel}
            </span>
          </div>
        </div>
      </div>

      {/* Quick stats */}
      {dashStats && false && (
        <div>
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Your Stats</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard icon="🚗" value={dashStats.stats?.total_rides ?? 0} label="Total Rides" />
            <StatCard icon="📍" value={dashStats.stats?.open_rides ?? 0} label="Active Rides" color="text-green-400" />
            <StatCard icon="⬇" value={dashStats.site_stats?.total_downloads ?? 0} label="Site Downloads" color="text-blue-400" />
            <StatCard icon="👥" value={dashStats.site_stats?.total_visitors ?? 0} label="Site Visitors" color="text-purple-400" />
          </div>
        </div>
      )}

      {/* Quick action tiles */}
      <div>
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Quick Actions</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { icon: '✈️', title: 'Airport Pickup',    desc: 'Book a driver now',      action: () => onNavigate ? onNavigate('/rides') : onSelectTab('rides') },
          ].map(tile => (
            <button
              key={tile.title}
              onClick={tile.action}
              className="group bg-gray-800/60 hover:bg-gray-700/80 border border-gray-700 hover:border-gray-500 rounded-xl p-4 text-left transition-all duration-200 quick-action-tile"
            >
              <span className="text-2xl">{tile.icon}</span>
              <p className="text-sm font-semibold text-white mt-2 group-hover:text-blue-300 transition-colors">{tile.title}</p>
              <p className="text-xs text-gray-500 mt-0.5">{tile.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Recent rides */}
      {recentRides.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Recent Rides</h3>
          <div className="rounded-xl border border-gray-700 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-800/80 text-gray-400">
                <tr>
                  <th className="px-3 py-2 text-left">From</th>
                  <th className="px-3 py-2 text-left">To</th>
                  <th className="px-3 py-2 text-left">Departure</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleRides.map(r => (
                  <tr key={r.ride_id} className="border-t border-gray-700/60 hover:bg-gray-800/40">
                    <td className="px-3 py-2 text-gray-300 max-w-[100px] truncate">{r.origin}</td>
                    <td className="px-3 py-2 text-gray-300 max-w-[100px] truncate">{r.destination}</td>
                    <td className="px-3 py-2 text-gray-400">{r.departure}</td>
                    <td className={`px-3 py-2 capitalize font-medium ${
                      r.status === 'open' ? 'text-blue-400'
                      : r.status === 'taken' ? 'text-green-400'
                      : 'text-red-400'
                    }`}>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-2">
            {recentRides.length > 3 && (
              <button
                onClick={() => setShowAllRides(v => !v)}
                className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
              >
                {showAllRides ? '▲ Show less' : `▼ Show more (${recentRides.length - 3} more)`}
              </button>
            )}
            <button
              onClick={() => onSelectTab('history')}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors ml-auto"
            >
              View full profile &amp; ride history →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Rides Dashboard Tab ────────────────────────────────────────────────────────

function RidesDashboardTab({ user }) {
  const isDriver = user?.role === 'driver'
  const [subTab, setSubTab]         = useState(isDriver ? 'posted' : 'bookings')
  const [rides, setRides]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [selectedRide, setSelectedRide] = useState(null)

  // Confirmed passengers per ride
  const [passengersMap, setPassengersMap] = useState({})

  // Journey history (passengers)
  const [history, setHistory]       = useState([])
  const [histLoading, setHistLoading] = useState(false)

  const loadRides = () => {
    setLoading(true)
    listRides()
      .then(d => setRides(d.rides || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadRides() }, [])

  useEffect(() => {
    if (!isDriver && subTab === 'history') {
      setHistLoading(true)
      getRideHistory()
        .then(d => setHistory(d.rides || []))
        .catch(() => {})
        .finally(() => setHistLoading(false))
    }
  }, [subTab, isDriver])

  const myPostedRides = rides.filter(r => r.user_id === user?.user_id)

  const loadPassengers = async (rideId) => {
    if (passengersMap[rideId]) return
    try {
      const d = await getConfirmedUsers(rideId)
      setPassengersMap(m => ({ ...m, [rideId]: d.confirmed_users || [] }))
    } catch {
      setPassengersMap(m => ({ ...m, [rideId]: [] }))
    }
  }

  const handleCancel = async (rideId) => {
    try { await cancelRide(rideId); loadRides() } catch {}
  }

  const inputSty = { background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }
  const statusBadge = (s) => {
    const cls = s === 'open' ? 'ride-tag-open' : s === 'taken' ? 'ride-tag-taken' : 'ride-tag-cancelled'
    return <span className={`ride-status-tag ${cls}`}>{s}</span>
  }

  const driverSubTabs = [
    { id: 'posted',   label: '🚗 My Rides' },
    { id: 'bookings', label: '👥 Bookings' },
    { id: 'stats',    label: '📊 Statistics' },
  ]
  const passengerSubTabs = [
    { id: 'bookings', label: '🎫 My Bookings' },
    { id: 'history',  label: '📋 Journey History' },
  ]
  const subTabs = isDriver ? driverSubTabs : passengerSubTabs

  // Stats
  const totalFare = myPostedRides.reduce((sum, r) => sum + (r.fare || 0), 0)
  const totalPax  = Object.values(passengersMap).reduce((s, a) => s + a.length, 0)

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">🚗 Rides</h2>
        <button onClick={loadRides} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">↺ Refresh</button>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 flex-wrap">
        {subTabs.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${subTab === t.id ? 'bg-amber-500 text-black' : 'text-gray-400 hover:text-white'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Driver — My Posted Rides */}
      {isDriver && subTab === 'posted' && (
        <div className="space-y-3">
          {loading ? <p className="text-sm text-gray-500 py-4 text-center">Loading…</p>
          : myPostedRides.length === 0 ? <p className="text-sm text-gray-500 py-4 text-center">No rides posted yet.</p>
          : myPostedRides.map(ride => (
            <div key={ride.ride_id} className="rounded-xl border border-gray-700 bg-gray-800/50 p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-white">{ride.origin} → {ride.destination}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {ride.departure ? new Date(ride.departure).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                    {' · '}{ride.seats} seat(s)
                    {ride.fare ? ` · $${ride.fare}` : ''}
                  </p>
                </div>
                {statusBadge(ride.status)}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setSelectedRide(ride)}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500 hover:bg-amber-400 text-black transition-colors">
                  💬 Chat
                </button>
                {ride.status === 'open' && (
                  <button onClick={() => handleCancel(ride.ride_id)}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-white border border-gray-700 transition-colors">
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Driver — Confirmed Bookings */}
      {isDriver && subTab === 'bookings' && (
        <div className="space-y-4">
          {myPostedRides.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">No posted rides.</p>
          ) : myPostedRides.map(ride => (
            <div key={ride.ride_id} className="rounded-xl border border-gray-700 bg-gray-800/50 p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-white">{ride.origin} → {ride.destination}</p>
                <button onClick={() => loadPassengers(ride.ride_id)}
                        className="text-xs text-blue-400 hover:text-blue-300">
                  Load passengers
                </button>
              </div>
              {passengersMap[ride.ride_id] ? (
                passengersMap[ride.ride_id].length === 0 ? (
                  <p className="text-xs text-gray-500">No confirmed passengers yet.</p>
                ) : (
                  <ul className="divide-y divide-gray-700">
                    {passengersMap[ride.ride_id].map((p, i) => (
                      <li key={i} className="py-1.5 flex gap-4 text-xs">
                        <span className="text-white font-medium">{p.real_name}</span>
                        <span className="text-gray-400">{p.contact}</span>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <p className="text-xs text-gray-600">Click "Load passengers" to view.</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Driver — Statistics */}
      {isDriver && subTab === 'stats' && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { icon: '🚗', value: myPostedRides.length, label: 'Rides Posted' },
            { icon: '👥', value: totalPax, label: 'Passengers' },
            { icon: '💰', value: `$${totalFare.toFixed(2)}`, label: 'Total Fare' },
          ].map((s, i) => (
            <div key={i} className="rounded-xl border border-gray-700 bg-gray-800/50 p-4 flex flex-col gap-1">
              <span className="text-2xl">{s.icon}</span>
              <span className="text-xl font-bold text-white">{s.value}</span>
              <span className="text-xs text-gray-400">{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Passenger — My Bookings */}
      {!isDriver && subTab === 'bookings' && (
        <div className="space-y-3">
          {loading ? <p className="text-sm text-gray-500 py-4 text-center">Loading…</p>
          : rides.length === 0 ? <p className="text-sm text-gray-500 py-4 text-center">No bookings found.</p>
          : rides.map(ride => (
            <div key={ride.ride_id} className="rounded-xl border border-gray-700 bg-gray-800/50 p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-white">{ride.origin} → {ride.destination}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {ride.departure ? new Date(ride.departure).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                    {ride.driver_name ? ` · ${ride.driver_name}` : ''}
                  </p>
                </div>
                {statusBadge(ride.status)}
              </div>
              <button onClick={() => setSelectedRide(ride)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500 hover:bg-amber-400 text-black transition-colors">
                💬 Open Chat
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Passenger — Journey History */}
      {!isDriver && subTab === 'history' && (
        <div>
          {histLoading ? <p className="text-sm text-gray-500 py-4 text-center">Loading…</p>
          : history.length === 0 ? <p className="text-sm text-gray-500 py-4 text-center">No journey history.</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="text-gray-500 border-b border-gray-700">
                  <tr>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Route</th>
                    <th className="py-2 pr-3">Departure</th>
                    <th className="py-2">Seats</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(r => (
                    <tr key={r.ride_id} className="border-b border-gray-800/60 hover:bg-gray-800/30 text-gray-300">
                      <td className="py-2 pr-3">{statusBadge(r.status)}</td>
                      <td className="py-2 pr-3 max-w-[200px] truncate">{r.origin} → {r.destination}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{r.departure ? new Date(r.departure).toLocaleString() : ''}</td>
                      <td className="py-2">{r.seats}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Chat overlay */}
      {selectedRide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.7)' }}
             onClick={() => setSelectedRide(null)}>
          <div className="w-full max-w-lg h-[80vh]" onClick={e => e.stopPropagation()}>
            <RideChat ride={selectedRide} user={user} onClose={() => setSelectedRide(null)} />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Dashboard component ───────────────────────────────────────────────────

export default function UserDashboard() {
  const navigate   = useNavigate()

  const [appUser,     setAppUser]     = useState(null)   // null=loading, false=not authed, object=authed
  const [userLoading, setUserLoading] = useState(true)
  const [tab,         setTab]         = useState('overview')
  const [dashStats,   setDashStats]   = useState(null)
  const [connected,   setConnected]   = useState(false)
  const [menuOpen,    setMenuOpen]    = useState(false)
  const [unreadNotifs, setUnreadNotifs] = useState(0)
  const [unreadChat,  setUnreadChat]  = useState(0)
  const [notifications, setNotifications] = useState([])
  const [rideHistory, setRideHistory] = useState([])
  const [trackedRides, setTrackedRides] = useState([])
  const [trackingLoading, setTrackingLoading] = useState(false)
  const [mapDrivers,  setMapDrivers]  = useState([])
  const [mapLoading,  setMapLoading]  = useState(false)
  const [trackingDriverLocations, setTrackingDriverLocations] = useState([])
  const [driverApp,   setDriverApp]   = useState(null)
  const [driverForm,  setDriverForm]  = useState({ vehicle_make:'', vehicle_model:'', vehicle_year:'', vehicle_color:'', license_plate:'' })
  const [driverApplying, setDriverApplying] = useState(false)
  const [driverApplyMsg, setDriverApplyMsg] = useState('')
  const profileRef     = useRef(null)
  const tabPanelRef    = useRef(null)

  // Load current user; redirect to login if not logged in, or driver dashboard if role=driver
  useEffect(() => {
    getUserProfile()
      .then(u => {
        // Drivers belong on the driver dashboard
        if (u.role === 'driver') {
          navigate('/driver/dashboard', { replace: true })
          return
        }
        setAppUser(u)
        // Fetch dashboard stats once we know the user
        return fetch('/api/user/dashboard', { credentials: 'include' })
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d) setDashStats(d) })
          .catch(() => {})
      })
      .catch(() => {
        // Not logged in — redirect to login page
        navigate('/login', { replace: true })
      })
      .finally(() => setUserLoading(false))
  }, [navigate])

  // Socket connection indicator
  useEffect(() => {
    const onConnect    = () => setConnected(true)
    const onDisconnect = () => setConnected(false)
    // Real-time chat notification from ride poster
    const onChatNotif = () => setUnreadChat(c => c + 1)
    // Real-time DM notification
    const onDmNotif = () => setUnreadChat(c => c + 1)
    socket.on('connect',                onConnect)
    socket.on('disconnect',             onDisconnect)
    socket.on('ride_chat_notification', onChatNotif)
    socket.on('dm_notification',        onDmNotif)
    setConnected(socket.connected)
    return () => {
      socket.off('connect',                onConnect)
      socket.off('disconnect',             onDisconnect)
      socket.off('ride_chat_notification', onChatNotif)
      socket.off('dm_notification',        onDmNotif)
    }
  }, [])

  // Poll unread notification count
  useEffect(() => {
    const fetchUnread = () =>
      getNotifications().then(d => {
        setUnreadNotifs(d.unread || 0)
        setNotifications(d.notifications || [])
      }).catch(() => {})
    fetchUnread()
    const id = setInterval(fetchUnread, 30_000)
    return () => clearInterval(id)
  }, [])

  // Close profile dropdown when clicking outside (unused now, kept for safety)
  useEffect(() => {
    const handler = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target))
        void e // no-op
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const fetchMapDrivers = useCallback(() => {
    setMapLoading(true)
    getAllDriverLocations()
      .then(d => setMapDrivers(d.drivers || []))
      .catch(() => {})
      .finally(() => setMapLoading(false))
  }, [])

  const handleSelectTab = useCallback((id) => {
    if (id === 'inbox') {
      navigate('/inbox')
      return
    }
    if (id === 'profile') {
      navigate('/profile')
      return
    }
    if (id === 'requests') {
      navigate('/requests')
      return
    }
    setTab(id)
    // Load data for specific tabs when first opened
    if (id === 'history') {
      getRideHistory().then(d => setRideHistory(d.rides || [])).catch(() => {})
    }
    if (id === 'tracking') {
      setTrackingLoading(true)
      Promise.all([
        getTrackedRides(),
        getAllDriverLocations(),
      ]).then(([td, ld]) => {
        setTrackedRides(td.rides || [])
        setTrackingDriverLocations(ld.drivers || [])
      }).catch(() => {}).finally(() => setTrackingLoading(false))
    }
    if (id === 'map') {
      fetchMapDrivers()
    }
    if (id === 'notifications') {
      setUnreadNotifs(0)
      getNotifications().then(d => {
        setNotifications(d.notifications || [])
        markAllNotificationsRead().catch(() => {})
      }).catch(() => {})
    }
    if (id === 'driver_reg') {
      getDriverApplication().then(d => setDriverApp(d)).catch(() => {})
    }
    setTimeout(() => {
      tabPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }, [navigate, fetchMapDrivers])

  const handleLogout = async () => {
    try { await userLogout() } catch {}
    navigate('/login', { replace: true })
  }

  // Loading state
  if (userLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="spinner w-10 h-10" />
      </div>
    )
  }

  // Should not happen (redirect handled above), but guard anyway
  if (!appUser) return null

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">

      {/* ── Navbar ── */}
      <nav className="sticky top-0 z-50 bg-gray-950/95 backdrop-blur border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 flex items-center h-14 gap-4">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 text-xl font-bold text-white shrink-0">
            <img src="/yotweek.png" alt="" width={22} height={22} style={{ borderRadius: 4 }} aria-hidden="true" />
            <span className="gradient-text hidden sm:inline">yotweek</span>
            <span className="gradient-text sm:hidden">YOT</span>
          </Link>

          {/* Dashboard label */}
          <span className="hidden sm:inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-blue-900/50 border border-blue-700/60 text-blue-300">
            Dashboard
          </span>

          <div className="flex-1" />

          {/* Connection dot */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-500'}`} />
            <span className="text-gray-500 hidden sm:inline">{connected ? 'Live' : 'Offline'}</span>
          </div>

          <ThemeSelector />

          {/* Notification + Inbox quick-access buttons in navbar */}
          <button
            onClick={() => navigate('/inbox')}
            className="relative text-gray-400 hover:text-white transition-colors"
            title="Chat Inbox"
            aria-label="Chat inbox"
          >
            <span className="text-lg">💬</span>
            {unreadChat > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full bg-green-500 border border-gray-950 flex items-center justify-center text-white text-[9px] font-bold px-0.5 pointer-events-none notif-badge-green">
                {unreadChat > 9 ? '9+' : unreadChat}
              </span>
            )}
          </button>

          <button
            onClick={() => handleSelectTab('notifications')}
            className="relative text-gray-400 hover:text-white transition-colors"
            title="Notifications"
            aria-label="Notifications"
          >
            <span className="text-lg">🔔</span>
            {unreadNotifs > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full bg-green-500 border border-gray-950 flex items-center justify-center text-white text-[9px] font-bold px-0.5 pointer-events-none notif-badge-green">
                {unreadNotifs > 9 ? '9+' : unreadNotifs}
              </span>
            )}
          </button>

          {/* Profile button */}
          <div className="relative" ref={profileRef}>
            <button
              onClick={() => navigate('/profile')}
              className="nav-profile-btn w-8 h-8 rounded-full bg-blue-700 hover:bg-blue-600 flex items-center justify-center text-base transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 overflow-hidden"
              aria-label="Profile"
              title={appUser.name}
            >
              {appUser.avatar_url ? (
                <img src={appUser.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <span>{appUser.role === 'driver' ? '🚗' : '🧍'}</span>
              )}
            </button>
          </div>

          {/* Logout button */}
          <button
            onClick={handleLogout}
            className="hidden sm:inline-flex text-xs px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-white transition-colors items-center gap-1"
          >
            Sign out
          </button>

          {/* Mobile menu toggle */}
          <button
            className="btn-ghost btn-sm sm:hidden"
            onClick={() => setMenuOpen(m => !m)}
            aria-label="Menu"
          >
            {menuOpen ? '✕' : '☰'}
          </button>
        </div>

        {/* Mobile dropdown */}
        {menuOpen && (
          <div className="sm:hidden border-t border-gray-800 bg-gray-900 px-4 py-3 space-y-2">
            <button
              onClick={() => { setMenuOpen(false); handleLogout() }}
              className="block w-full text-left text-sm text-gray-400 hover:text-white py-1"
            >
              Sign out
            </button>
          </div>
        )}
      </nav>

      {/* ── Sidebar + Content layout ── */}
      <div className="flex-1 max-w-7xl mx-auto w-full px-4 pt-6 pb-20 sm:pb-8 flex gap-6">

        {/* ── Sidebar tabs (desktop) ── */}
        <aside className="hidden lg:flex flex-col gap-1 w-52 shrink-0 pt-1 sticky top-16 self-start max-h-[calc(100vh-5rem)] overflow-y-auto">
          {TABS.map(t => {
            const badgeCount = t.badge === 'chat' ? unreadChat : t.badge === 'notif' ? unreadNotifs : 0
            return (
              <button
                key={t.id}
                onClick={() => handleSelectTab(t.id)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left relative ${
                  tab === t.id
                    ? 'bg-blue-700/40 text-blue-300 border border-blue-700/60'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                }`}
              >
                <span>{t.icon}</span>
                <span className="flex-1">{t.label.split(' ').slice(1).join(' ')}</span>
                {badgeCount > 0 && (
                  <span className="min-w-[18px] h-[18px] rounded-full bg-green-500 text-white text-[9px] font-bold flex items-center justify-center px-0.5 notif-badge-green">
                    {badgeCount > 9 ? '9+' : badgeCount}
                  </span>
                )}
              </button>
            )
          })}
        </aside>

        {/* ── Main panel ── */}
        <main className="flex-1 min-w-0">
          {/* Mobile tab pills */}
          <div className="flex gap-2 overflow-x-auto pb-3 lg:hidden scrollbar-none">
            {TABS.map(t => {
              const badgeCount = t.badge === 'chat' ? unreadChat : t.badge === 'notif' ? unreadNotifs : 0
              return (
                <button
                  key={t.id}
                  onClick={() => handleSelectTab(t.id)}
                  className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1 ${
                    tab === t.id
                      ? 'bg-blue-700 border-blue-600 text-white'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700 hover:text-white'
                  }`}
                >
                  {t.label}
                  {badgeCount > 0 && (
                    <span className="min-w-[16px] h-4 rounded-full bg-green-500 text-white text-[9px] font-bold flex items-center justify-center px-0.5 notif-badge-green">
                      {badgeCount > 9 ? '9+' : badgeCount}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Tab panels */}
          <div ref={tabPanelRef}>
            {tab === 'overview' && (
              <OverviewPanel user={appUser} dashStats={dashStats} onSelectTab={handleSelectTab} onNavigate={navigate} />
            )}

            {tab === 'rides' && (
              <RidesDashboardTab user={appUser} />
            )}

            {/* ── Map tab (left-nav only) ── */}
            {tab === 'map' && (
              <div className="card space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">🗺 Rideshare Map</h2>
                    <p className="text-xs text-gray-400 mt-0.5">Live drivers within 10 km of your location.</p>
                  </div>
                  <button onClick={fetchMapDrivers} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
                    {mapLoading ? '⏳' : '⟳ Refresh'}
                  </button>
                </div>
                <RideShareMap
                  rides={[]}
                  driverLocations={mapDrivers}
                  autoLoadDrivers={true}
                  onRequestRide={() => navigate('/rides')}
                  mapHeight={380}
                />
                {/* Driver list */}
                <div className="space-y-2 mt-2">
                  <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide">
                    🚗 Drivers nearby {mapDrivers.length > 0 && <span className="font-normal text-gray-500 ml-1">({mapDrivers.length} found)</span>}
                  </p>
                  {mapLoading ? (
                    <p className="text-xs text-gray-500 py-4 text-center">Loading drivers…</p>
                  ) : mapDrivers.length === 0 ? (
                    <p className="text-xs text-gray-500 py-4 text-center">No active drivers found.</p>
                  ) : mapDrivers.map((d, i) => (
                    <div key={d.user_id || d.name || i}
                      className="rounded-xl border border-gray-700 bg-gray-800/50 p-3 flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-blue-900 flex items-center justify-center text-lg shrink-0">🚗</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{d.name || 'Driver'}</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-400 mt-0.5">
                          {d.vehicle && <span>🚘 {d.vehicle}</span>}
                          {d.seats != null && <span>💺 {d.seats} seat{d.seats !== 1 ? 's' : ''}</span>}
                        </div>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold shrink-0 ${d.empty !== false ? 'bg-green-900/40 text-green-300' : 'bg-gray-700/60 text-gray-400'}`}>
                        {d.empty !== false ? '🟢 Available' : '⚫ Occupied'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Ride Tracking tab ── */}
            {tab === 'tracking' && (
              <div className="card space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">📡 Ride Tracking</h2>
                  <div className="flex gap-2">
                    <button onClick={() => {
                      setTrackingLoading(true)
                      Promise.all([getTrackedRides(), getAllDriverLocations()])
                        .then(([td, ld]) => { setTrackedRides(td.rides || []); setTrackingDriverLocations(ld.drivers || []) })
                        .catch(() => {}).finally(() => setTrackingLoading(false))
                    }} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">↺ Refresh</button>
                  </div>
                </div>
                <p className="text-xs text-gray-500">Rides you have confirmed via "Confirm Journey". See your driver's live status below.</p>
                {trackingLoading ? (
                  <p className="text-sm text-gray-500 py-6 text-center">Loading…</p>
                ) : trackedRides.length === 0 ? (
                  <p className="text-sm text-gray-500 py-6 text-center">No tracked rides yet. Confirm a journey to start tracking.</p>
                ) : (
                  <div className="space-y-4">
                    {trackedRides.map(r => {
                      // Find driver's live location (driver user_id is r.user_id which is the ride poster)
                      const liveDriver = trackingDriverLocations.find(d => d.user_id === r.user_id)
                      const isOnline   = !!liveDriver
                      const seats      = liveDriver?.seats ?? r.seats ?? null
                      const seatsEmpty = liveDriver?.empty !== false

                      const handleInboxDriver = async () => {
                        if (!r.user_id) return
                        try {
                          await dmStartConversation(r.user_id)
                          navigate('/inbox')
                        } catch {}
                      }

                      return (
                        <div key={r.ride_id} className="rounded-xl border border-gray-700 bg-gray-800/50 p-4 space-y-3">
                          {/* Route + status */}
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-white">{r.origin} → {r.destination}</p>
                              <p className="text-xs text-gray-400 mt-0.5">
                                🕐 {r.departure ? new Date(r.departure).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                              </p>
                            </div>
                            <span className={`ride-status-tag shrink-0 ${r.status === 'open' ? 'ride-tag-open' : r.status === 'taken' ? 'ride-tag-taken' : 'ride-tag-cancelled'}`}>
                              {r.status}
                            </span>
                          </div>

                          {/* Driver info row */}
                          <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-900/60 border border-gray-700/50">
                            <div className="w-9 h-9 rounded-full bg-blue-900 flex items-center justify-center text-base shrink-0">🚗</div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-semibold text-white truncate">{r.driver_name || 'Driver'}</p>
                                {/* Online/Offline status */}
                                <span className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                                  isOnline ? 'bg-green-900/50 text-green-300' : 'bg-gray-700/60 text-gray-400'
                                }`}>
                                  <span className={`w-1.5 h-1.5 rounded-full inline-block ${isOnline ? 'bg-green-400 driver-online-pulse' : 'bg-gray-500'}`} />
                                  {isOnline ? 'Online' : 'Offline'}
                                </span>
                              </div>
                              {/* Seats available */}
                              <div className="flex items-center gap-2 mt-0.5">
                                {seats != null && (
                                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                                    seats === 0 ? 'bg-red-900/40 text-red-300'
                                    : seatsEmpty ? 'bg-green-900/40 text-green-300 animate-pulse'
                                    : 'bg-amber-900/40 text-amber-300'
                                  }`}>
                                    💺 {seats === 0 ? 'Fully booked' : `${seats} seat${seats !== 1 ? 's' : ''} available`}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Live location map (only when driver is online and has location) */}
                          {isOnline && liveDriver.lat != null && liveDriver.lng != null && (
                            <div className="rounded-xl overflow-hidden border border-gray-700" style={{ height: 160 }}>
                              <iframe
                                title="driver location"
                                width="100%"
                                height="160"
                                src={`https://www.openstreetmap.org/export/embed.html?bbox=${liveDriver.lng - 0.015},${liveDriver.lat - 0.015},${liveDriver.lng + 0.015},${liveDriver.lat + 0.015}&layer=mapnik&marker=${liveDriver.lat},${liveDriver.lng}`}
                                style={{ border: 'none', display: 'block' }}
                              />
                            </div>
                          )}
                          {isOnline && (liveDriver.lat == null || liveDriver.lng == null) && (
                            <p className="text-xs text-green-400/70 bg-green-900/20 rounded-lg px-3 py-2">
                              📍 Driver is online — location not yet shared.
                            </p>
                          )}

                          {/* Confirmation details */}
                          <div className="space-y-0.5">
                            <p className="text-xs text-gray-500">Confirmed as: {r.real_name} · {r.contact}</p>
                            <p className="text-xs text-gray-600">Confirmed on: {r.confirmed_at ? new Date(r.confirmed_at).toLocaleString() : ''}</p>
                          </div>

                          {/* Inbox driver button */}
                          {r.user_id && (
                            <button
                              onClick={handleInboxDriver}
                              className="w-full py-2 rounded-xl text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-black transition-colors flex items-center justify-center gap-2"
                            >
                              💬 Message Driver
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {tab === 'profile' && (
              <div className="card">
                <UserProfile
                  user={appUser}
                  onLogout={handleLogout}
                  onLocationUpdate={(loc) => setAppUser(u => ({ ...u, ...loc }))}
                  onUserUpdate={(u) => u && setAppUser(prev => ({ ...prev, ...u }))}
                />
              </div>
            )}

            {/* ── History tab — shows completed (taken) and cancelled rides only ── */}
            {tab === 'history' && (
              <div className="card space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">📋 Ride History</h2>
                  <button onClick={() => handleSelectTab('overview')} className="text-xs text-gray-400 hover:text-gray-200 transition-colors">← Back</button>
                </div>
                {rideHistory.filter(r => r.status === 'taken' || r.status === 'cancelled').length === 0 ? (
                  <p className="text-sm text-gray-500 py-6 text-center">No completed or cancelled rides yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead className="text-gray-500 border-b border-gray-700">
                        <tr>
                          <th className="py-2 pr-3">Status</th>
                          <th className="py-2 pr-3">From → To</th>
                          <th className="py-2 pr-3">Departure</th>
                          <th className="py-2 pr-3">Seats</th>
                          <th className="py-2">Posted</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rideHistory.filter(r => r.status === 'taken' || r.status === 'cancelled').map(r => (
                          <tr key={r.ride_id} className="border-b border-gray-800/60 hover:bg-gray-800/30 text-gray-300">
                            <td className="py-2 pr-3">
                              <span className={`ride-status-tag ${r.status === 'taken' ? 'ride-tag-taken' : 'ride-tag-cancelled'}`}>
                                {r.status}
                              </span>
                            </td>
                            <td className="py-2 pr-3 max-w-[200px] truncate">{r.origin} → {r.destination}</td>
                            <td className="py-2 pr-3 whitespace-nowrap">{new Date(r.departure).toLocaleString()}</td>
                            <td className="py-2 pr-3">{r.seats}</td>
                            <td className="py-2 text-gray-500">{new Date(r.created_at).toLocaleDateString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <button
                  onClick={() => getRideHistory().then(d => setRideHistory(d.rides || [])).catch(() => {})}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  ↺ Refresh
                </button>
              </div>
            )}

            {/* ── Inbox tab ── */}
            {tab === 'inbox' && (
              <div className="card p-0 overflow-hidden">
                <DMInbox currentUser={appUser} />
              </div>
            )}

            {/* ── Notifications tab ── */}
            {tab === 'notifications' && (
              <div className="card space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">🔔 Notifications</h2>
                  {notifications.length > 0 && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => markAllNotificationsRead().then(() => {
                          setNotifications(prev => prev.map(n => ({ ...n, read: 1 })))
                          setUnreadNotifs(0)
                        }).catch(() => {})}
                        className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        Mark all read
                      </button>
                      <button
                        onClick={() => {
                          if (!window.confirm('Clear all notifications? This cannot be undone.')) return
                          clearAllNotifications().then(() => {
                            setNotifications([])
                            setUnreadNotifs(0)
                          }).catch(() => {})
                        }}
                        className="text-xs text-red-400 hover:text-red-300 transition-colors"
                      >
                        Clear all
                      </button>
                    </div>
                  )}
                </div>
                {notifications.length === 0 ? (
                  <div className="text-center text-sm text-gray-500 py-8">
                    <p className="text-3xl mb-2">🔔</p>
                    <p>No notifications yet.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {notifications.map((n, i) => (
                      <div key={n.notif_id || i}
                        className={`flex items-start gap-3 rounded-xl px-4 py-3 border transition-colors cursor-pointer ${
                          n.read ? 'bg-gray-800/30 border-gray-700/50' : 'bg-blue-900/20 border-blue-700/50'
                        }`}
                        onClick={() => {
                          if (!n.read) {
                            markNotificationRead(n.notif_id).catch(() => {})
                            setNotifications(prev => prev.map(x => x.notif_id === n.notif_id ? { ...x, read: 1 } : x))
                            setUnreadNotifs(c => Math.max(0, c - 1))
                          }
                        }}
                      >
                        <div className="mt-0.5 shrink-0">
                          {n.type === 'chat_message' ? '💬' : n.type === 'ride_taken' ? '✅' : '🔔'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${n.read ? 'text-gray-300' : 'text-white'}`}>{n.title}</p>
                          <p className="text-xs text-gray-400 truncate">{n.body}</p>
                          <p className="text-xs text-gray-600 mt-0.5">{new Date(n.created_at).toLocaleString()}</p>
                          {n.link && (
                            <a
                              href={n.link}
                              onClick={e => {
                                e.stopPropagation()
                                // If the link is a hash fragment (e.g., #inbox), navigate to that tab
                                if (n.link.startsWith('#')) {
                                  e.preventDefault()
                                  handleSelectTab(n.link.slice(1))
                                  if (!n.read) {
                                    markNotificationRead(n.notif_id).catch(() => {})
                                    setNotifications(prev => prev.map(x => x.notif_id === n.notif_id ? { ...x, read: 1 } : x))
                                    setUnreadNotifs(c => Math.max(0, c - 1))
                                  }
                                }
                              }}
                              className="inline-flex items-center gap-1 mt-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                            >
                              {n.link_label || 'View'} →
                            </a>
                          )}
                        </div>
                        {!n.read && <span className="w-2 h-2 bg-blue-400 rounded-full shrink-0 mt-1.5" />}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Driver Registration tab ── */}
            {tab === 'driver_reg' && (
              <div className="card space-y-4">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">🚕 Driver Registration</h2>
                {appUser?.role === 'driver' ? (
                  <div className="bg-green-900/30 border border-green-700/60 rounded-xl p-4 flex items-center gap-3">
                    <span className="text-2xl">✅</span>
                    <div>
                      <p className="text-green-300 font-semibold">You are a verified driver!</p>
                      <p className="text-xs text-green-400/70 mt-0.5">Your driver application has been approved.</p>
                    </div>
                  </div>
                ) : driverApp?.status === 'pending' ? (
                  <div className="bg-amber-900/20 border border-amber-700/40 rounded-xl p-4 flex items-center gap-3">
                    <span className="text-2xl">⏳</span>
                    <div>
                      <p className="text-amber-300 font-semibold">Application Pending</p>
                      <p className="text-xs text-amber-400/70 mt-0.5">Your driver application is under review.</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-gray-400">Apply to become a verified driver and start offering rides.</p>
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault()
                        setDriverApplyMsg('')
                        setDriverApplying(true)
                        try {
                          await driverApply(
                            driverForm.vehicle_make, driverForm.vehicle_model,
                            parseInt(driverForm.vehicle_year), driverForm.vehicle_color,
                            driverForm.license_plate,
                          )
                          setDriverApplyMsg('✅ Application submitted! Awaiting admin approval.')
                          setDriverApp({ status: 'pending' })
                        } catch (err) {
                          setDriverApplyMsg(err.message || 'Application failed.')
                        } finally {
                          setDriverApplying(false)
                        }
                      }}
                      className="space-y-3"
                    >
                      <div className="grid grid-cols-2 gap-3">
                        {[
                          { key: 'vehicle_make',  label: 'Vehicle Make',  placeholder: 'e.g. Toyota' },
                          { key: 'vehicle_model', label: 'Vehicle Model', placeholder: 'e.g. Corolla' },
                          { key: 'vehicle_year',  label: 'Year',          placeholder: 'e.g. 2020', type: 'number' },
                          { key: 'vehicle_color', label: 'Color',         placeholder: 'e.g. White' },
                        ].map(f => (
                          <div key={f.key}>
                            <label className="text-xs text-gray-400 mb-1 block">{f.label}</label>
                            <input
                              type={f.type || 'text'}
                              placeholder={f.placeholder}
                              value={driverForm[f.key]}
                              onChange={e => setDriverForm(d => ({ ...d, [f.key]: e.target.value }))}
                              required
                              className="w-full rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                        ))}
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 mb-1 block">License Plate</label>
                        <input
                          type="text"
                          placeholder="e.g. ABC 123"
                          value={driverForm.license_plate}
                          onChange={e => setDriverForm(d => ({ ...d, license_plate: e.target.value }))}
                          required
                          className="w-full rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      {driverApplyMsg && (
                        <p className={`text-sm ${driverApplyMsg.startsWith('✅') ? 'text-green-400' : 'text-red-400'}`}>
                          {driverApplyMsg}
                        </p>
                      )}
                      <button type="submit" disabled={driverApplying}
                        className="w-full py-2.5 rounded-lg font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition-all">
                        {driverApplying ? 'Submitting…' : '🚕 Submit Application'}
                      </button>
                    </form>
                  </>
                )}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* ── Footer ── */}
      <footer className="border-t border-gray-800 py-6 px-4 pb-safe text-center text-xs text-gray-600">
        <p>
          yotweek © {new Date().getFullYear()} — Download responsibly. Respect copyright laws.
        </p>
        <p className="mt-1">
          <a href="mailto:support@yotweek.com" className="hover:text-gray-400 transition-colors">
            support@yotweek.com
          </a>
          {' · '}
          <Link to="/" className="hover:text-gray-400 transition-colors">Home</Link>
        </p>
      </footer>
    </div>
  )
}
