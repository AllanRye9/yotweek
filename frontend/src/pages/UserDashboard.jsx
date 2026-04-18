import { useState, useEffect, useRef, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import RideShare from '../components/RideShare'
import RideChat from '../components/RideChat'
import NavBar from '../components/NavBar'
import DMInbox from '../components/DMInbox'
import RideShareMap from '../components/RideShareMap'
import {
  getUserProfile, userLogout, getNotifications,
  markAllNotificationsRead, markNotificationRead, clearAllNotifications,
  getRideHistory, getTrackedRides,
  listRides, getConfirmedUsers, cancelRide,
  driverApply, getDriverApplication,
  getAllDriverLocations, dmStartConversation,
  aiChat,
  createTravelCompanion, listTravelCompanions, deleteTravelCompanion,
} from '../api'
import socket from '../socket'

// ─── Dashboard tabs ────────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview',    label: '🏠 Overview',          icon: '🏠' },
  { id: 'rides',       label: '🚗 Rides',              icon: '🚗' },
  { id: 'requests',    label: '🙋 Requests',           icon: '🙋' },
  { id: 'companions',  label: '🧳 Companions',         icon: '🧳' },
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

// ─── AI Assistant Widget ────────────────────────────────────────────────────────

function DashboardAIAssistant() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState([{
    role: 'bot',
    text: 'Hi! I\'m YotBot 🤖. I can help you find rides, match travel companions, check bookings, explain policies, and more. What can I do for you?',
  }])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [panelKey, setPanelKey] = useState(0) // remount panel on open for animation
  const bottomRef = useRef(null)

  // Drag state
  const panelRef    = useRef(null)
  const dragging    = useRef(false)
  const dragOffset  = useRef({ x: 0, y: 0 })
  const [position, setPosition] = useState(null) // null = default (fixed bottom-right)

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return
      const x = e.clientX - dragOffset.current.x
      const y = e.clientY - dragOffset.current.y
      setPosition({
        x: Math.max(0, Math.min(x, window.innerWidth - (open ? 320 : 56))),
        y: Math.max(0, Math.min(y, window.innerHeight - 56)),
      })
    }
    const onUp = () => { dragging.current = false }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [open])

  const handleDragStart = (e) => {
    if (e.button !== 0) return
    dragging.current = true
    const rect = panelRef.current.getBoundingClientRect()
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    e.preventDefault()
  }

  useEffect(() => {
    if (open) setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }, [msgs, open])

  const handleToggle = () => {
    setOpen(v => {
      if (!v) setPanelKey(k => k + 1) // trigger open animation
      return !v
    })
  }

  const send = async (text) => {
    const t = (text || input).trim()
    if (!t || loading) return
    setMsgs(p => [...p, { role: 'user', text: t }])
    setInput('')
    setLoading(true)
    try {
      const d = await aiChat(t, 'dashboard')
      setMsgs(p => [...p, { role: 'bot', text: d.reply || 'Sorry, no response.' }])
    } catch {
      setMsgs(p => [...p, { role: 'bot', text: 'Sorry, I couldn\'t process that right now.' }])
    } finally {
      setLoading(false)
    }
  }

  const SUGGESTIONS = [
    '🔍 Find a cheap ride',
    '📋 Check my booking',
    '💳 Payment policy',
    '❓ How to book a ride',
    '🧳 Find a travel companion',
    '🚗 Available rides today',
    '📍 How does seat booking work?',
  ]

  const posStyle = position
    ? { position: 'fixed', left: position.x, top: position.y }
    : { position: 'fixed', right: 20, bottom: 20 }

  return (
    <div
      ref={panelRef}
      className={!open ? 'yotbot-ring-pulse' : ''}
      style={{
        ...posStyle,
        zIndex: 200,
        width: open ? 340 : 58,
        maxHeight: open ? 520 : 58,
        borderRadius: open ? 18 : 29,
        overflow: 'hidden',
        boxShadow: open
          ? '0 12px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(245,158,11,0.2)'
          : '0 8px 32px rgba(0,0,0,0.45)',
        background: '#0d1117',
        border: '1px solid rgba(245,158,11,0.25)',
        transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1), max-height 0.25s cubic-bezier(0.4,0,0.2,1), border-radius 0.25s, box-shadow 0.25s',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header / toggle (drag handle) */}
      <div
        onMouseDown={handleDragStart}
        style={{ cursor: 'grab', userSelect: 'none', flexShrink: 0 }}
      >
        <button
          onClick={handleToggle}
          className="w-full flex items-center gap-3 px-3 py-3 hover:opacity-90 transition-opacity"
          style={{ pointerEvents: 'auto' }}
          title={open ? 'Collapse YotBot' : 'Open YotBot AI Assistant'}
        >
          <div className="relative shrink-0">
            {/* Animated shimmer avatar */}
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-base font-bold shrink-0 yotbot-avatar-shimmer"
              style={{ background: 'linear-gradient(135deg, #f59e0b, #fb923c)' }}
            >
              🤖
            </div>
            {/* Online dot */}
            <span
              className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2"
              style={{ background: '#4ade80', borderColor: '#0d1117', animation: 'driver-online-pulse 2s ease-in-out infinite' }}
            />
          </div>
          {open && (
            <>
              <div className="flex-1 text-left overflow-hidden">
                <p className="text-sm font-bold text-white truncate">YotBot AI</p>
                <p className="text-xs truncate" style={{ color: '#6ee7b7' }}>
                  <span style={{ animation: 'connecting-blink 2s ease-in-out infinite', display: 'inline-block' }}>●</span>
                  {' '}Rides · Companions · Policies
                </p>
              </div>
              <span className="text-xs text-gray-500 shrink-0">▼</span>
            </>
          )}
        </button>
      </div>

      {open && (
        <div key={panelKey} className="yotbot-panel-open flex flex-col" style={{ flex: 1, minHeight: 0 }}>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 scrollbar-thin" style={{ background: 'rgba(13,17,23,0.95)', minHeight: 0 }}>
            {msgs.map((m, i) => (
              <div key={i} className={`flex gap-2 items-end yotbot-msg-anim ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                   style={{ animationDelay: `${i * 0.02}s` }}>
                {m.role === 'bot' && (
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0"
                    style={{ background: 'linear-gradient(135deg, #f59e0b, #fb923c)' }}
                  >🤖</div>
                )}
                <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-xs leading-relaxed ${
                  m.role === 'user'
                    ? 'rounded-br-sm text-black'
                    : 'rounded-bl-sm text-gray-100'
                }`}
                  style={m.role === 'user'
                    ? { background: 'linear-gradient(135deg, #f59e0b, #f97316)' }
                    : { background: 'rgba(31,41,55,0.9)', border: '1px solid rgba(55,65,81,0.8)' }
                  }
                >
                  {m.text}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex gap-2 items-end yotbot-msg-anim">
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0"
                  style={{ background: 'linear-gradient(135deg, #f59e0b, #fb923c)' }}
                >🤖</div>
                <div className="px-3 py-2 rounded-2xl rounded-bl-sm text-gray-400 text-xs"
                     style={{ background: 'rgba(31,41,55,0.9)', border: '1px solid rgba(55,65,81,0.8)' }}>
                  <span className="inline-flex gap-1 items-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Suggestion chips (only shown before first user message) */}
          {msgs.length <= 1 && !loading && (
            <div className="px-3 py-2 flex gap-1.5 overflow-x-auto border-t scrollbar-none" style={{ borderColor: 'rgba(55,65,81,0.6)' }}>
              {SUGGESTIONS.map((s, i) => (
                <button key={i} onClick={() => send(s)}
                        className="yotbot-chip shrink-0 text-xs px-2.5 py-1 rounded-full whitespace-nowrap"
                        style={{ background: 'rgba(31,41,55,0.8)', color: '#d1d5db', border: '1px solid rgba(55,65,81,0.7)' }}>
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input bar */}
          <div className="flex gap-2 p-2.5 shrink-0" style={{ borderTop: '1px solid rgba(55,65,81,0.6)', background: 'rgba(13,17,23,0.98)' }}>
            <input value={input} onChange={e => setInput(e.target.value)}
                   onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                   placeholder="Ask YotBot…"
                   maxLength={300}
                   className="flex-1 rounded-xl px-3 py-1.5 text-xs outline-none text-white"
                   style={{ background: 'rgba(31,41,55,0.8)', border: '1px solid rgba(55,65,81,0.7)' }} />
            <button onClick={() => send()} disabled={!input.trim() || loading}
                    className="w-8 h-8 rounded-xl flex items-center justify-center text-xs text-black disabled:opacity-40 shrink-0 transition-all hover:scale-105"
                    style={{ background: input.trim() ? 'linear-gradient(135deg, #f59e0b, #f97316)' : '#374151' }}>
              ➤
            </button>
          </div>
        </div>
      )}
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
      {/* AI Assistant floating widget is rendered at the dashboard root level */}
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

// ─── Travel Companion Tab ───────────────────────────────────────────────────────

function TravelCompanionTab({ currentUser }) {
  const [companions,    setCompanions]    = useState([])
  const [loading,       setLoading]       = useState(true)
  const [posting,       setPosting]       = useState(false)
  const [showForm,      setShowForm]      = useState(false)
  const [error,         setError]         = useState('')
  const [aiMatches,     setAiMatches]     = useState(null)
  const [aiLoading,     setAiLoading]     = useState(false)
  const [search,        setSearch]        = useState({ origin: '', destination: '', date: '' })

  const [form, setForm] = useState({
    origin_country: '', destination_country: '', travel_date: '', preferences: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await listTravelCompanions(
        search.origin   || null,
        search.destination || null,
        search.date     || null,
      )
      setCompanions(d.companions || [])
    } catch {
      setCompanions([])
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => { load() }, [load])

  const handlePost = async (e) => {
    e.preventDefault()
    if (!form.origin_country.trim() || !form.destination_country.trim() || !form.travel_date) {
      setError('Please fill in origin, destination, and travel date.')
      return
    }
    setError('')
    setPosting(true)
    try {
      await createTravelCompanion(
        form.origin_country.trim(),
        form.destination_country.trim(),
        form.travel_date,
        form.preferences.trim(),
      )
      setForm({ origin_country: '', destination_country: '', travel_date: '', preferences: '' })
      setShowForm(false)
      await load()
    } catch (err) {
      setError(err.message || 'Failed to post listing.')
    } finally {
      setPosting(false)
    }
  }

  const handleDelete = async (id) => {
    try {
      await deleteTravelCompanion(id)
      await load()
    } catch {}
  }

  const handleAiMatch = async () => {
    setAiLoading(true)
    setAiMatches(null)
    try {
      const context = companions.length > 0
        ? `Current listings:\n${companions.slice(0, 8).map(c =>
            `- ${c.name || 'Traveler'}: ${c.origin_country} → ${c.destination_country} on ${c.travel_date}${c.preferences ? `, preferences: ${c.preferences}` : ''}`
          ).join('\n')}`
        : 'No listings yet.'
      const userInfo = `My name is ${currentUser?.name || 'User'}. I am looking for a travel companion.`
      const prompt = `${userInfo}\n\n${context}\n\nBased on the current listings above, who would be the best travel companion matches for me and why? Provide a short, friendly summary of top matches.`
      const d = await aiChat(prompt, 'companions')
      setAiMatches(d.reply || 'No suggestions available at the moment.')
    } catch {
      setAiMatches('Sorry, AI matching is unavailable right now. Please try again later.')
    } finally {
      setAiLoading(false)
    }
  }

  const inputSty = { background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }

  return (
    <div className="card space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">🧳 Travel Companions</h2>
          <p className="text-xs text-gray-400 mt-0.5">Find fellow travelers going your way — AI-powered matching</p>
        </div>
        <button
          onClick={() => { setShowForm(f => !f); setError('') }}
          className="text-xs px-3 py-2 rounded-xl font-semibold transition-all"
          style={{ background: showForm ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)', color: showForm ? '#f87171' : '#fbbf24', border: `1px solid ${showForm ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}` }}
        >
          {showForm ? '✕ Cancel' : '＋ Post Listing'}
        </button>
      </div>

      {/* Post form */}
      {showForm && (
        <form onSubmit={handlePost} className="rounded-xl p-4 space-y-3 companion-card"
              style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)' }}>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-400">New Travel Companion Listing</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>✈️ From (Country/City)</label>
              <input type="text" placeholder="e.g. London, UK" value={form.origin_country}
                     onChange={e => setForm(f => ({ ...f, origin_country: e.target.value }))}
                     required className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={inputSty} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>🏁 To (Country/City)</label>
              <input type="text" placeholder="e.g. Lagos, Nigeria" value={form.destination_country}
                     onChange={e => setForm(f => ({ ...f, destination_country: e.target.value }))}
                     required className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={inputSty} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>📅 Travel Date</label>
              <input type="date" value={form.travel_date}
                     onChange={e => setForm(f => ({ ...f, travel_date: e.target.value }))}
                     required className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={inputSty} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>✨ Preferences (optional)</label>
              <input type="text" placeholder="e.g. non-smoker, female only…" value={form.preferences}
                     onChange={e => setForm(f => ({ ...f, preferences: e.target.value }))}
                     className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={inputSty} />
            </div>
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button type="submit" disabled={posting}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #f59e0b, #f97316)', color: '#000' }}>
            {posting ? '⏳ Posting…' : '🧳 Post Listing'}
          </button>
        </form>
      )}

      {/* Search & filter bar */}
      <div className="flex flex-wrap gap-2 items-center p-3 rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
        <input type="text" placeholder="🛫 From…" value={search.origin}
               onChange={e => setSearch(s => ({ ...s, origin: e.target.value }))}
               className="text-xs rounded-lg px-2.5 py-1.5 outline-none flex-1 min-w-[90px]" style={inputSty} />
        <input type="text" placeholder="🛬 To…" value={search.destination}
               onChange={e => setSearch(s => ({ ...s, destination: e.target.value }))}
               className="text-xs rounded-lg px-2.5 py-1.5 outline-none flex-1 min-w-[90px]" style={inputSty} />
        <input type="date" value={search.date}
               onChange={e => setSearch(s => ({ ...s, date: e.target.value }))}
               className="text-xs rounded-lg px-2.5 py-1.5 outline-none" style={inputSty} />
        {(search.origin || search.destination || search.date) && (
          <button onClick={() => setSearch({ origin: '', destination: '', date: '' })}
                  className="text-xs text-amber-400 hover:text-amber-300">✕ Clear</button>
        )}
      </div>

      {/* AI Match button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleAiMatch}
          disabled={aiLoading}
          className="flex items-center gap-2 text-xs px-4 py-2 rounded-xl font-semibold transition-all disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.2))', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.3)' }}
        >
          {aiLoading ? (
            <>
              <span className="w-3 h-3 border border-violet-400 border-t-transparent rounded-full animate-spin inline-block" />
              Matching…
            </>
          ) : '🤖 AI Match Me'}
        </button>
        <p className="text-xs text-gray-500">Let YotBot suggest the best companion matches</p>
      </div>

      {/* AI match result */}
      {aiMatches && (
        <div className="rounded-xl p-4 space-y-2 companion-card"
             style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(139,92,246,0.25)' }}>
          <p className="text-xs font-semibold text-violet-300 flex items-center gap-1.5">🤖 YotBot Companion Matches</p>
          <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">{aiMatches}</p>
        </div>
      )}

      {/* Companion listings */}
      {loading ? (
        <div className="text-center py-8">
          <div className="spinner w-8 h-8 mx-auto" />
        </div>
      ) : companions.length === 0 ? (
        <div className="rounded-xl p-8 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <p className="text-3xl mb-2">🧳</p>
          <p className="text-sm text-gray-400">No travel companion listings yet.</p>
          <button onClick={() => setShowForm(true)}
                  className="mt-3 text-xs text-amber-400 hover:text-amber-300 transition-colors">
            Be the first to post →
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide">
            {companions.length} listing{companions.length !== 1 ? 's' : ''} found
          </p>
          {companions.map((c, idx) => {
            const isOwn = currentUser && c.user_id === currentUser.user_id
            return (
              <div key={c.companion_id || idx}
                   className="companion-card rounded-xl p-4 space-y-2"
                   style={{ animationDelay: `${idx * 0.04}s`, background: 'var(--bg-card)', border: `1px solid ${isOwn ? 'rgba(245,158,11,0.35)' : 'var(--border-color)'}` }}>
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-black shrink-0"
                       style={{ background: 'linear-gradient(135deg, #f59e0b, #f97316)' }}>
                    {(c.name || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {c.name || 'Traveler'}
                      </p>
                      {isOwn && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">You</span>
                      )}
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      ✈️ {c.origin_country} → {c.destination_country}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-semibold text-amber-400">📅 {c.travel_date}</p>
                  </div>
                </div>
                {c.preferences && (
                  <p className="text-xs pl-12" style={{ color: 'var(--text-secondary)' }}>
                    ✨ {c.preferences}
                  </p>
                )}
                {isOwn && (
                  <div className="flex justify-end pt-1">
                    <button
                      onClick={() => handleDelete(c.companion_id)}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors"
                      style={{ border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8, padding: '2px 10px' }}
                    >
                      Remove listing
                    </button>
                  </div>
                )}
              </div>
            )
          })}
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

  // Socket connection indicator + real-time unread chat count
  useEffect(() => {
    const onChatNotif = () => setUnreadChat(c => c + 1)
    const onDmNotif   = () => setUnreadChat(c => c + 1)
    socket.on('ride_chat_notification', onChatNotif)
    socket.on('dm_notification',        onDmNotif)
    return () => {
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
    <div className="min-h-screen bg-gray-950 flex flex-col page-transition">

      {/* ── Shared NavBar ── */}
      <NavBar user={appUser} onLogout={handleLogout} />

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

            {/* ── Requests tab (inline) ── */}
            {tab === 'requests' && (
              <div className="card space-y-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">🙋 Ride Requests</h2>
                  <div className="flex-1" />
                  <Link
                    to="/requests"
                    className="text-xs px-3 py-1.5 rounded-xl font-semibold transition-all hover:opacity-80"
                    style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.3)' }}
                  >
                    Open Full View ↗
                  </Link>
                </div>
                <p className="text-sm text-gray-400">Browse, post, or accept ride requests from all passengers.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Link
                    to="/requests"
                    className="flex items-center gap-3 rounded-xl p-4 transition-all hover:opacity-80"
                    style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}
                  >
                    <span className="text-2xl">🔍</span>
                    <div>
                      <p className="text-sm font-semibold text-green-300">Browse Requests</p>
                      <p className="text-xs text-gray-500">Find passengers needing a ride</p>
                    </div>
                  </Link>
                  <Link
                    to="/requests"
                    className="flex items-center gap-3 rounded-xl p-4 transition-all hover:opacity-80"
                    style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}
                  >
                    <span className="text-2xl">✏️</span>
                    <div>
                      <p className="text-sm font-semibold text-amber-300">Post a Request</p>
                      <p className="text-xs text-gray-500">Let drivers find you</p>
                    </div>
                  </Link>
                </div>
              </div>
            )}

            {/* ── Travel Companions tab ── */}
            {tab === 'companions' && (
              <TravelCompanionTab currentUser={appUser} />
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

      {/* ── Floating draggable AI assistant ── */}
      <DashboardAIAssistant />
    </div>
  )
}
