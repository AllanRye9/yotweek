import { useState, useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../App'
import RideShare from '../components/RideShare'
import DMInbox from '../components/DMInbox'
import ThemeSelector from '../components/ThemeSelector'
import UserAuth from '../components/UserAuth'
import UserProfile from '../components/UserProfile'
import TravelCompanion from '../components/TravelCompanion'
import RaiseRequest from '../components/RaiseRequest'
import { getUserProfile, getNotifications } from '../api'
import socket from '../socket'

export default function RidesPage() {
  const { admin } = useAuth()
  const location  = useLocation()
  const navigate  = useNavigate()
  const [appUser, setAppUser]         = useState(null)
  const [userLoading, setUserLoading] = useState(true)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [rides, setRides]             = useState([])
  // Active right-panel tab: 'rides' | 'requests' | 'companions'
  const [rightTab, setRightTab]       = useState('rides')
  // Inbox dropdown state
  const [inboxOpen, setInboxOpen]     = useState(false)
  const [unreadChat, setUnreadChat]   = useState(0)
  const inboxRef                      = useRef(null)
  // State for opening chat from the map with a pre-filled default message
  const [mapChatRequest, setMapChatRequest] = useState(null)
  // Deep-link chat open from notification links (?chat=<ride_id>)
  const [pendingChatRideId, setPendingChatRideId] = useState(null)
  const profileRef = useRef(null)

  // Load platform user session
  useEffect(() => {
    getUserProfile()
      .then(u => setAppUser(u))
      .catch(() => setAppUser(false))
      .finally(() => setUserLoading(false))
  }, [])

  // Handle ?chat=<ride_id> deep-link from notification clicks
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const chatRideId = params.get('chat')
    if (chatRideId) {
      setPendingChatRideId(chatRideId)
      setRightTab('rides')
      // Remove query param without full reload
      navigate(location.pathname, { replace: true })
    }
  }, [location.search]) // eslint-disable-line react-hooks/exhaustive-deps

  // Poll unread message count
  useEffect(() => {
    const fetchUnread = () =>
      getNotifications().then(d => setUnreadChat(d.unread || 0)).catch(() => {})
    fetchUnread()
    const id = setInterval(fetchUnread, 30_000)
    return () => clearInterval(id)
  }, [])

  // Real-time DM / chat notification
  useEffect(() => {
    const onNotif = () => setUnreadChat(c => c + 1)
    socket.on('dm_notification',        onNotif)
    socket.on('ride_chat_notification', onNotif)
    return () => {
      socket.off('dm_notification',        onNotif)
      socket.off('ride_chat_notification', onNotif)
    }
  }, [])

  // Close profile dropdown when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false)
      if (inboxRef.current && !inboxRef.current.contains(e.target)) setInboxOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const openRides = rides.filter(r => r.status === 'open')

  const RIGHT_TABS = [
    { id: 'rides',      label: '🗺️ Rides' },
    { id: 'requests',   label: '🙋 Requests' },
    { id: 'companions', label: '🌍 Companions' },
  ]

  return (
    <div style={{ height: '100vh', background: 'var(--bg-page)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Auth modal */}
      {showAuthModal && !appUser && (
        <UserAuth
          onSuccess={(u) => { setAppUser(u); setShowAuthModal(false) }}
          onClose={() => setShowAuthModal(false)}
        />
      )}

      {/* ── Navbar ── */}
      <nav className="sticky top-0 z-50 bg-gray-950/95 backdrop-blur border-b border-gray-800">
        <div className="max-w-full px-4 flex items-center h-14 gap-4">
          {/* Back to home */}
          <Link
            to="/"
            className="flex items-center gap-2 text-xl font-bold text-white shrink-0"
          >
            <img src="/yotweek.png" alt="" width={22} height={22} style={{ borderRadius: 4 }} aria-hidden="true" />
            <span className="gradient-text hidden sm:inline">yotweek</span>
            <span className="gradient-text sm:hidden">YOT</span>
          </Link>

          <Link
            to="/"
            className="text-xs text-gray-400 hover:text-white transition-colors flex items-center gap-1"
          >
            ← Home
          </Link>

          <div className="flex-1" />

          <ThemeSelector />

          {/* ── Animated 💬 Inbox button ── */}
          {appUser && (
            <div ref={inboxRef} style={{ position: 'relative' }}>
              <button
                onClick={() => { setInboxOpen(o => !o); setUnreadChat(0) }}
                className="relative text-gray-400 hover:text-white transition-colors"
                title="Inbox"
                aria-label="Chat Inbox"
              >
                <span className="text-xl">💬</span>
                {unreadChat > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full bg-green-500 border border-gray-950 flex items-center justify-center text-white text-[9px] font-bold px-0.5 pointer-events-none notif-badge-green">
                    {unreadChat > 9 ? '9+' : unreadChat}
                  </span>
                )}
              </button>

              {/* Inbox dropdown */}
              {inboxOpen && (
                <div style={{
                  position: 'absolute', right: 0, top: 'calc(100% + 8px)',
                  width: 320, maxHeight: '70vh',
                  background: 'var(--bg-surface)', border: '1px solid var(--border-color)',
                  borderRadius: 14, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                  display: 'flex', flexDirection: 'column',
                  overflow: 'hidden', zIndex: 200,
                  animation: 'ride-card-in 0.25s cubic-bezier(0.34,1.56,0.64,1) both',
                }}>
                  <div style={{
                    padding: '10px 14px', borderBottom: '1px solid var(--border-color)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.85rem' }}>💬 Messages</span>
                    <button onClick={() => setInboxOpen(false)}
                      style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.9rem' }}>✕</button>
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
                    <DMInbox currentUser={appUser} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* User profile avatar */}
          {!userLoading && !appUser && (
            <button
              onClick={() => setShowAuthModal(true)}
              className="text-xs px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-white transition-colors"
            >
              Login / Register
            </button>
          )}

          {admin && (
            <Link to="/const" className="btn-secondary btn-sm hidden sm:inline-flex">
              Dashboard
            </Link>
          )}
        </div>
      </nav>

      {/* ── Page header ── */}
      <div style={{ padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <h1 style={{ color: 'var(--text-primary)', fontSize: '1.2rem', fontWeight: 800, margin: 0 }}>🚗 Ride Share</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', margin: '1px 0 0' }}>
            Find drivers, book rides, and get real-time alerts.
          </p>
        </div>
      </div>

      {/* ── Main content ── */}
      {userLoading ? (
        <div className="flex justify-center py-16 flex-1">
          <div className="spinner w-10 h-10" />
        </div>
      ) : !appUser ? (
        /* ── Auth gate ── */
        <div className="flex flex-col items-center justify-center py-16 gap-6 text-center flex-1">
          <div className="text-5xl">🔒</div>
          <div>
            <h2 className="text-xl font-bold text-white mb-2">Login Required</h2>
            <p className="text-gray-400 text-sm max-w-xs">
              Please login or create a free account to view pickups, post a ride, and receive driver alerts.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowAuthModal(true)}
              className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-colors"
            >
              Login / Register
            </button>
            <Link
              to="/"
              className="px-5 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 hover:text-white text-sm transition-colors"
            >
              Back to Home
            </Link>
          </div>
        </div>
      ) : (
        /* ── 2-column authenticated layout ── */
        <div className="rides-page-layout" style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden', position: 'relative' }}>

          {/* ── Left: Post Ride — Drivers Only ── */}
          <aside className="rides-left-sidebar" style={{
            width: 300, flexShrink: 0,
            borderRight: '1px solid var(--border-color)',
            background: 'var(--bg-surface)',
            height: '100%',
            overflowY: 'auto',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
              <div style={{ color: 'var(--text-primary)', fontSize: '0.82rem', fontWeight: 700 }}>🚗 Post Ride — Drivers Only</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.7rem', marginTop: 2 }}>Verified drivers: set your route, fare is auto-calculated.</div>
            </div>
            <div style={{ flex: 1, padding: '10px', overflowY: 'auto' }}>
              <RideShare
                user={appUser}
                onRidesChange={() => {}}
                requestedRide={mapChatRequest}
                onRequestedRideHandled={() => setMapChatRequest(null)}
                showSections={{ form: true, dashboard: false, driverBroadcast: true, list: false }}
              />
            </div>
          </aside>

          {/* ── Right: Tabbed panel ── */}
          <aside className="rides-right-sidebar" style={{
            flexGrow: 1,
            overflowY: 'auto',
            background: 'var(--bg-surface)',
            display: 'flex', flexDirection: 'column',
            position: 'relative',
          }}>
            {/* Top-right profile header */}
            <div
              ref={profileRef}
              style={{ position: 'absolute', top: 10, right: 20, zIndex: 20 }}
            >
              {appUser && (
                <>
                  <button
                    onClick={() => setProfileOpen(o => !o)}
                    className="flex items-center gap-2 rounded-full bg-blue-700 hover:bg-blue-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 pl-1 pr-3 py-1"
                    aria-label="Profile"
                    title={appUser.name}
                  >
                    {appUser.avatar_url ? (
                      <img
                        src={appUser.avatar_url}
                        alt=""
                        style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                      />
                    ) : (
                      <span style={{ width: 30, height: 30, borderRadius: '50%', background: '#1e40af', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', flexShrink: 0 }}>
                        {appUser.role === 'driver' ? '🚗' : '🧍'}
                      </span>
                    )}
                    <span className="hidden sm:block text-white text-xs font-medium max-w-[100px] truncate">{appUser.name}</span>
                    <span className="hidden sm:block text-blue-300 text-xs">▾</span>
                  </button>
                  {profileOpen && (
                    <div className="absolute right-0 top-11 w-72 sm:w-80 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50 max-h-[80vh] overflow-y-auto">
                      <UserProfile
                        user={appUser}
                        onLogout={() => { setAppUser(false); setProfileOpen(false) }}
                        onLocationUpdate={() => {}}
                        onUserUpdate={(u) => setAppUser(u)}
                      />
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Tab bar */}
            <div style={{ padding: '10px 14px 0', borderBottom: '1px solid var(--border-color)', flexShrink: 0, paddingRight: 180 }}>
              <div className="flex items-center gap-1 mb-0">
                {RIGHT_TABS.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setRightTab(tab.id)}
                    className={`text-xs px-3 py-1.5 rounded-t-lg font-medium transition-colors border-b-2 ${
                      rightTab === tab.id
                        ? 'border-blue-500 text-blue-300 bg-blue-900/20'
                        : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-800/40'
                    }`}
                  >
                    {tab.label}
                    {tab.id === 'rides' && openRides.length > 0 && (
                      <span className="ml-1.5 text-[10px] bg-blue-700/60 text-blue-200 rounded-full px-1.5 py-0.5">{openRides.length}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
              {rightTab === 'rides' && (
                <RideShare
                  user={appUser}
                  onRidesChange={setRides}
                  requestedRide={mapChatRequest}
                  onRequestedRideHandled={() => setMapChatRequest(null)}
                  showSections={{ list: true, dashboard: false, driverBroadcast: false, form: false }}
                  openChatRideId={pendingChatRideId}
                  onChatOpened={() => setPendingChatRideId(null)}
                />
              )}
              {rightTab === 'requests' && (
                <RaiseRequest
                  user={appUser}
                  onConvCreated={(convId) => {
                    setInboxOpen(true)
                  }}
                />
              )}
              {rightTab === 'companions' && (
                <TravelCompanion
                  user={appUser}
                  onOpenDM={(convId) => {
                    setInboxOpen(true)
                  }}
                />
              )}
            </div>
          </aside>

        </div>
      )}

      {/* ── Footer ── */}
      <footer className="border-t border-gray-800 py-3 px-4 text-center text-xs text-gray-600" style={{ flexShrink: 0 }}>
        <p>yotweek © {new Date().getFullYear()} — <Link to="/" className="hover:text-gray-400">Back to Home</Link></p>
      </footer>
    </div>
  )
}
