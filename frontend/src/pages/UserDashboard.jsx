import { useState, useEffect, useRef, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../App'
import DownloadForm from '../components/DownloadForm'
import ActiveDownloads from '../components/ActiveDownloads'
import FileList from '../components/FileList'
import CVGenerator from '../components/CVGenerator'
import DocConverter from '../components/DocConverter'
import RideShare from '../components/RideShare'
import ThemeSelector from '../components/ThemeSelector'
import UserProfile from '../components/UserProfile'
import PropertyManager from '../components/PropertyManager'
import DMInbox from '../components/DMInbox'
import {
  getUserProfile, userLogout, getStats, getNotifications,
  markAllNotificationsRead, markNotificationRead, clearAllNotifications,
  getRideHistory, getRideChatInbox,
  driverApply, getDriverApplication,
} from '../api'
import socket from '../socket'
import AgentRegistration from '../components/AgentRegistration'

// ─── Dashboard tabs ────────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview',    label: '🏠 Overview',          icon: '🏠' },
  { id: 'properties',  label: '🏢 Properties',         icon: '🏢' },
  { id: 'rides',       label: '🚗 Rides',              icon: '🚗' },
  { id: 'inbox',       label: '💬 Inbox',              icon: '💬', badge: 'chat' },
  { id: 'notifications', label: '🔔 Notifications',   icon: '🔔', badge: 'notif' },
  { id: 'history',     label: '📋 History',            icon: '📋' },
  { id: 'stats',       label: '📊 Stats',              icon: '📊' },
  { id: 'driver_reg',  label: '🚕 Driver Reg.',         icon: '🚕' },
  { id: 'download',    label: '⬇ Download',            icon: '⬇' },
  { id: 'cv',          label: '📄 CV Builder',          icon: '📄' },
  { id: 'convert',     label: '🔄 Converter',           icon: '🔄' },
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

  return (
    <div className="space-y-6">
      {/* Welcome banner */}
      <div className="rounded-2xl bg-gradient-to-br from-blue-900/60 to-gray-900/80 border border-blue-800/40 p-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-blue-700 flex items-center justify-center text-3xl shrink-0">
            {user?.role === 'driver' ? '🚗' : '🧍'}
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
      {dashStats && (
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
            { icon: '⬇️', title: 'Download Video',   desc: '1,000+ sites',           action: () => onSelectTab('download') },
            { icon: '📄', title: 'Build a CV',        desc: 'PDF with ATS scan',      action: () => onSelectTab('cv') },
            { icon: '🔄', title: 'Convert Docs',      desc: 'PDF, Word & more',       action: () => onSelectTab('convert') },
            { icon: '🚗', title: 'Share a Ride',       desc: 'Post or find rides',    action: () => onSelectTab('rides') },
            { icon: '🏢', title: 'Properties',         desc: 'Map & agent finder',    action: () => onSelectTab('properties') },
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
      {dashStats?.recent_rides?.length > 0 && (
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
                {dashStats.recent_rides.map(r => (
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
          <button
            onClick={() => onSelectTab('profile')}
            className="mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            View full profile &amp; ride history →
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Main Dashboard component ───────────────────────────────────────────────────

export default function UserDashboard() {
  const { admin } = useAuth()
  const navigate   = useNavigate()

  const [appUser,     setAppUser]     = useState(null)   // null=loading, false=not authed, object=authed
  const [userLoading, setUserLoading] = useState(true)
  const [tab,         setTab]         = useState('overview')
  const [stats,       setStats]       = useState(null)
  const [dashStats,   setDashStats]   = useState(null)
  const [connected,   setConnected]   = useState(false)
  const [fileListVersion, setFileListVersion] = useState(0)
  const [menuOpen,    setMenuOpen]    = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [unreadNotifs, setUnreadNotifs] = useState(0)
  const [unreadChat,  setUnreadChat]  = useState(0)
  const [notifications, setNotifications] = useState([])
  const [rideHistory, setRideHistory] = useState([])
  const [chatInbox,   setChatInbox]   = useState([])
  const [driverApp,   setDriverApp]   = useState(null)
  const [driverForm,  setDriverForm]  = useState({ vehicle_make:'', vehicle_model:'', vehicle_year:'', vehicle_color:'', license_plate:'' })
  const [driverApplying, setDriverApplying] = useState(false)
  const [driverApplyMsg, setDriverApplyMsg] = useState('')
  const profileRef     = useRef(null)
  const activeDownloadsRef = useRef(null)
  const fileListRef    = useRef(null)
  const scrollTimerRef = useRef(null)
  const tabPanelRef    = useRef(null)

  // Load current user; redirect to home if not logged in
  useEffect(() => {
    getUserProfile()
      .then(u => {
        setAppUser(u)
        // Fetch dashboard stats once we know the user
        return fetch('/api/user/dashboard', { credentials: 'include' })
          .then(r => r.ok ? r.json() : null)
          .then(d => {
            if (d) {
              // Merge in global site stats
              getStats().then(s => setDashStats({ ...d, site_stats: s })).catch(() => setDashStats(d))
            }
          })
          .catch(() => {})
      })
      .catch(() => {
        // Not logged in — go back to home
        navigate('/', { replace: true })
      })
      .finally(() => setUserLoading(false))
  }, [navigate])

  // Socket connection indicator
  useEffect(() => {
    const onConnect    = () => setConnected(true)
    const onDisconnect = () => setConnected(false)
    const onFilesUpdated = () => setFileListVersion(v => v + 1)
    // Real-time chat notification from ride poster
    const onChatNotif = () => setUnreadChat(c => c + 1)
    // Real-time DM notification
    const onDmNotif = () => setUnreadChat(c => c + 1)
    socket.on('connect',                onConnect)
    socket.on('disconnect',             onDisconnect)
    socket.on('files_updated',          onFilesUpdated)
    socket.on('ride_chat_notification', onChatNotif)
    socket.on('dm_notification',        onDmNotif)
    setConnected(socket.connected)
    return () => {
      socket.off('connect',                onConnect)
      socket.off('disconnect',             onDisconnect)
      socket.off('files_updated',          onFilesUpdated)
      socket.off('ride_chat_notification', onChatNotif)
      socket.off('dm_notification',        onDmNotif)
    }
  }, [])

  // Poll global stats
  useEffect(() => {
    const fetchStats = () => getStats().then(setStats).catch(() => {})
    fetchStats()
    const id = setInterval(fetchStats, 30_000)
    return () => clearInterval(id)
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

  // Close profile dropdown when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target))
        setProfileOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const refreshFiles = useCallback(() => setFileListVersion(v => v + 1), [])

  const handleDownloadStarted = useCallback(({ download_id, title } = {}) => {
    if (download_id) activeDownloadsRef.current?.subscribeToDownload(download_id, title)
    refreshFiles()
  }, [refreshFiles])

  const handleDownloadDone = useCallback(() => {
    refreshFiles()
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => {
      fileListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 600)
  }, [refreshFiles])

  const handleSelectTab = useCallback((id) => {
    setTab(id)
    // Load data for specific tabs when first opened
    if (id === 'history') {
      getRideHistory().then(d => setRideHistory(d.rides || [])).catch(() => {})
    }
    if (id === 'inbox') {
      setUnreadChat(0)
      getRideChatInbox().then(d => setChatInbox(d.conversations || [])).catch(() => {})
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
  }, [])

  const handleLogout = async () => {
    try { await userLogout() } catch {}
    navigate('/', { replace: true })
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

          {/* Stats badges */}
          <div className="hidden md:flex items-center gap-3 text-xs ml-2">
            {stats && (
              <>
                <span className="badge-info">{stats.active_downloads ?? 0} active</span>
                <span className="badge-gray">{stats.file_count ?? 0} files</span>
              </>
            )}
          </div>

          <div className="flex-1" />

          {/* Connection dot */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-500'}`} />
            <span className="text-gray-500 hidden sm:inline">{connected ? 'Live' : 'Offline'}</span>
          </div>

          <ThemeSelector />

          {/* Notification + Inbox quick-access buttons in navbar */}
          <button
            onClick={() => handleSelectTab('inbox')}
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
              onClick={() => setProfileOpen(o => !o)}
              className="nav-profile-btn w-8 h-8 rounded-full bg-blue-700 hover:bg-blue-600 flex items-center justify-center text-base transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Profile"
              title={appUser.name}
            >
              {appUser.role === 'driver' ? '🚗' : '🧍'}
            </button>
            {profileOpen && (
              <div className="nav-profile-dropdown absolute right-0 top-10 w-64 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden">
                <UserProfile
                  user={appUser}
                  onLogout={handleLogout}
                  onLocationUpdate={(loc) => setAppUser(u => ({ ...u, ...loc }))}
                  onUserUpdate={(u) => u && setAppUser(prev => ({ ...prev, ...u }))}
                />
              </div>
            )}
          </div>

          {/* Admin link */}
          {admin && (
            <Link to="/const" className="btn-secondary btn-sm hidden sm:inline-flex">
              Admin
            </Link>
          )}

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
            {admin && (
              <Link
                to="/const"
                className="block text-sm text-gray-400 hover:text-white py-1"
                onClick={() => setMenuOpen(false)}
              >
                🛠 Admin Dashboard
              </Link>
            )}
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
        <aside className="hidden lg:flex flex-col gap-1 w-52 shrink-0 pt-1">
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

            {tab === 'properties' && (
              <div className="card">
                {appUser?.can_post_properties ? (
                  <PropertyManager
                    userLocation={appUser?.lat != null ? { lat: appUser.lat, lng: appUser.lng } : null}
                  />
                ) : (
                  <div className="space-y-4">
                    <div className="bg-blue-900/20 border border-blue-800 rounded-xl p-4 text-sm text-blue-300">
                      <p className="font-semibold mb-1">🔒 Agent Access Required</p>
                      <p className="text-blue-400/80">
                        Only registered and approved agents can post properties. Register as an agent below to get started.
                      </p>
                    </div>
                    <AgentRegistration />
                  </div>
                )}
              </div>
            )}

            {tab === 'download' && (
              <div className="card">
                <DownloadForm onDownloadStarted={handleDownloadStarted} />
              </div>
            )}

            {tab === 'cv' && (
              <div className="card">
                <CVGenerator />
              </div>
            )}

            {tab === 'convert' && (
              <div className="card">
                <DocConverter />
              </div>
            )}

            {tab === 'rides' && (
              <div className="card">
                <div className="mb-4">
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">🚗 Ride Share</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Post shared rides, find passengers, and get driver alerts.</p>
                </div>
                <RideShare user={appUser} />
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

            {/* ── History tab ── */}
            {tab === 'history' && (
              <div className="card space-y-4">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">📋 Ride History</h2>
                {rideHistory.length === 0 ? (
                  <p className="text-sm text-gray-500 py-6 text-center">No ride history yet.</p>
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
                        {rideHistory.map(r => (
                          <tr key={r.ride_id} className="border-b border-gray-800/60 hover:bg-gray-800/30 text-gray-300">
                            <td className="py-2 pr-3">
                              <span className={`ride-status-tag ${r.status === 'open' ? 'ride-tag-open' : r.status === 'taken' ? 'ride-tag-taken' : 'ride-tag-cancelled'}`}>
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

            {/* ── Stats tab ── */}
            {tab === 'stats' && (
              <div className="card space-y-6">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">📊 Your Stats</h2>
                {dashStats ? (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                      <div className="rounded-xl border border-blue-800/40 bg-blue-900/20 p-4 text-center">
                        <p className="text-3xl font-bold text-blue-300">{dashStats.stats?.total_rides ?? 0}</p>
                        <p className="text-xs text-gray-400 mt-1">Total Rides</p>
                      </div>
                      <div className="rounded-xl border border-green-800/40 bg-green-900/20 p-4 text-center">
                        <p className="text-3xl font-bold text-green-300">{dashStats.stats?.open_rides ?? 0}</p>
                        <p className="text-xs text-gray-400 mt-1">Open Rides</p>
                      </div>
                      <div className="rounded-xl border border-amber-800/40 bg-amber-900/20 p-4 text-center">
                        <p className="text-3xl font-bold text-amber-300">{dashStats.stats?.taken_rides ?? 0}</p>
                        <p className="text-xs text-gray-400 mt-1">Taken Rides</p>
                      </div>
                      <div className="rounded-xl border border-purple-800/40 bg-purple-900/20 p-4 text-center">
                        <p className="text-3xl font-bold text-purple-300">{dashStats.site_stats?.total_downloads ?? 0}</p>
                        <p className="text-xs text-gray-400 mt-1">Site Downloads</p>
                      </div>
                    </div>
                    {dashStats.site_stats && (
                      <div className="grid grid-cols-2 gap-4 pt-2">
                        <div className="rounded-xl border border-gray-700 bg-gray-800/40 p-4 text-center">
                          <p className="text-2xl font-bold text-white">{dashStats.site_stats.total_visitors ?? 0}</p>
                          <p className="text-xs text-gray-400 mt-1">Total Visitors</p>
                        </div>
                        <div className="rounded-xl border border-gray-700 bg-gray-800/40 p-4 text-center">
                          <p className="text-2xl font-bold text-white">{dashStats.site_stats.total_files ?? 0}</p>
                          <p className="text-xs text-gray-400 mt-1">Files Available</p>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex justify-center py-8"><div className="spinner w-8 h-8" /></div>
                )}
              </div>
            )}

            {/* ── Inbox tab ── */}
            {tab === 'inbox' && (
              <div className="card">
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

          {/* Active downloads — only shown when on download tab */}
          {tab === 'download' && (
            <div className="mt-5">
              <ActiveDownloads ref={activeDownloadsRef} onComplete={refreshFiles} onDownloadDone={handleDownloadDone} />
            </div>
          )}

          {/* File list */}
          <div className="mt-5" ref={fileListRef}>
            <FileList version={fileListVersion} />
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
