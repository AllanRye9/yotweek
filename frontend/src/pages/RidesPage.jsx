import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../App'
import RideShare from '../components/RideShare'
import DMInbox from '../components/DMInbox'
import ThemeSelector from '../components/ThemeSelector'
import UserAuth from '../components/UserAuth'
import UserProfile from '../components/UserProfile'
import { getUserProfile } from '../api'

export default function RidesPage() {
  const { admin } = useAuth()
  const [appUser, setAppUser]         = useState(null)   // null=loading, false=not logged in, object=logged in
  const [userLoading, setUserLoading] = useState(true)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [rides, setRides]             = useState([])
  // State for opening chat from the map with a pre-filled default message
  const [mapChatRequest, setMapChatRequest] = useState(null) // { ride, defaultMsg }
  // Active center panel tab: 'post' | 'broadcast' | 'dashboard'
  const [centerTab, setCenterTab] = useState('post')
  const profileRef = useRef(null)

  // Load platform user session
  useEffect(() => {
    getUserProfile()
      .then(u => setAppUser(u))
      .catch(() => setAppUser(false))
      .finally(() => setUserLoading(false))
  }, [])

  // Close profile dropdown when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setProfileOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const openRides = rides.filter(r => r.status === 'open')

  return (
    <div style={{ height: '100vh', background: '#030712', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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

          {/* User profile avatar (shown in navbar when not logged in or loading) */}
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
      <div style={{ padding: '8px 20px', borderBottom: '1px solid #1f2937', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <h1 style={{ color: '#f3f4f6', fontSize: '1.2rem', fontWeight: 800, margin: 0 }}>🚗 Ride Share</h1>
          <p style={{ color: '#6b7280', fontSize: '0.75rem', margin: '1px 0 0' }}>
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
        /* ── 3-column authenticated layout ── */
        <div className="rides-page-layout" style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden', position: 'relative' }}>

          {/* ── Left: Inbox & Chat (fixed) ── */}
          <aside className="rides-left-sidebar" style={{
            width: 280, flexShrink: 0,
            borderRight: '1px solid #1f2937',
            background: '#111827',
            height: '100%',
            overflowY: 'auto',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
              <div style={{ color: '#d1d5db', fontSize: '0.82rem', fontWeight: 700 }}>💬 Inbox</div>
            </div>
            <div style={{ flex: 1, padding: '10px', overflowY: 'auto' }}>
              <DMInbox currentUser={appUser} />
            </div>
          </aside>

          {/* ── Center: Post / Broadcast / Dashboard (compact) ── */}
          <main className="rides-center-col" style={{
            flexBasis: '25%', flexShrink: 0,
            overflowY: 'auto',
            background: '#030712',
            display: 'flex', flexDirection: 'column',
            borderRight: '1px solid #1f2937',
          }}>
            {/* Compact tab bar with icons */}
            <div style={{ display: 'flex', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
              {[
                { key: 'post',      icon: '🚗', label: 'Post Ride' },
                { key: 'broadcast', icon: '📡', label: 'Broadcast' },
                { key: 'dashboard', icon: '📊', label: 'Dashboard' },
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setCenterTab(tab.key)}
                  style={{
                    flex: 1,
                    padding: '8px 4px',
                    background: centerTab === tab.key ? '#1f2937' : 'transparent',
                    border: 'none',
                    borderBottom: centerTab === tab.key ? '2px solid #3b82f6' : '2px solid transparent',
                    color: centerTab === tab.key ? '#f3f4f6' : '#6b7280',
                    cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ fontSize: '1rem' }}>{tab.icon}</span>
                  <span style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.03em' }}>{tab.label}</span>
                </button>
              ))}
            </div>
            {/* Active tab content */}
            <div style={{ flex: 1, padding: '10px', overflowY: 'auto' }}>
              {centerTab === 'post' && (
                <RideShare
                  user={appUser}
                  onRidesChange={() => {}}
                  requestedRide={mapChatRequest}
                  onRequestedRideHandled={() => setMapChatRequest(null)}
                  showSections={{ form: true, dashboard: false, driverBroadcast: false, list: false }}
                />
              )}
              {centerTab === 'broadcast' && (
                <RideShare
                  user={appUser}
                  onRidesChange={() => {}}
                  requestedRide={null}
                  onRequestedRideHandled={() => {}}
                  showSections={{ form: false, dashboard: false, driverBroadcast: true, list: false }}
                />
              )}
              {centerTab === 'dashboard' && (
                <RideShare
                  user={appUser}
                  onRidesChange={setRides}
                  requestedRide={null}
                  onRequestedRideHandled={() => {}}
                  showSections={{ form: false, dashboard: true, driverBroadcast: false, list: false }}
                />
              )}
            </div>
          </main>

          {/* ── Right: All Rides (expanded) ── */}
          <aside className="rides-right-sidebar" style={{
            flexGrow: 1,
            overflowY: 'auto',
            background: '#111827',
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

            <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid #1f2937', flexShrink: 0, paddingRight: 180 }}>
              <div style={{ color: '#d1d5db', fontSize: '0.85rem', fontWeight: 700 }}>🗺️ All Rides</div>
              <div style={{ color: '#6b7280', fontSize: '0.72rem', marginTop: 2 }}>
                {rides.filter(r => r.status === 'open').length} open · fares shown per person for shared rides
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
              <RideShare
                user={appUser}
                onRidesChange={setRides}
                requestedRide={mapChatRequest}
                onRequestedRideHandled={() => setMapChatRequest(null)}
                showSections={{ list: true, dashboard: false, driverBroadcast: false, form: false }}
              />
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
