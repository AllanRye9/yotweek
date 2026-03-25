import { useState, useEffect, useRef, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../App'
import DownloadForm from '../components/DownloadForm'
import ActiveDownloads from '../components/ActiveDownloads'
import FileList from '../components/FileList'
import CVGenerator from '../components/CVGenerator'
import DocConverter from '../components/DocConverter'
import RideShare from '../components/RideShare'
import RideShareMap from '../components/RideShareMap'
import ThemeSelector from '../components/ThemeSelector'
import UserProfile from '../components/UserProfile'
import { getUserProfile, userLogout, getStats } from '../api'
import socket from '../socket'

// ─── Dashboard tabs ────────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview',  label: '🏠 Overview',      icon: '🏠' },
  { id: 'download',  label: '⬇ Download',        icon: '⬇' },
  { id: 'cv',        label: '📄 CV Generator',    icon: '📄' },
  { id: 'convert',   label: '🔄 Doc Converter',   icon: '🔄' },
  { id: 'rides',     label: '🚗 Ride Share',       icon: '🚗' },
  { id: 'profile',   label: '👤 My Profile',       icon: '👤' },
]

// ─── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ icon, value, label, color = 'text-white' }) {
  return (
    <div className="bg-gray-800/60 border border-gray-700/60 rounded-xl p-4 flex flex-col gap-1">
      <span className="text-2xl">{icon}</span>
      <span className={`text-2xl font-bold tabular-nums ${color}`}>{value ?? '—'}</span>
      <span className="text-xs text-gray-400">{label}</span>
    </div>
  )
}

// ─── Welcome / overview panel ───────────────────────────────────────────────────

function OverviewPanel({ user, dashStats, onSelectTab }) {
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { id: 'download', icon: '⬇️', title: 'Download Video',   desc: '1,000+ sites' },
            { id: 'cv',       icon: '📄', title: 'Build a CV',        desc: 'PDF with ATS scan' },
            { id: 'convert',  icon: '🔄', title: 'Convert Docs',      desc: 'PDF, Word & more' },
            { id: 'rides',    icon: '🚗', title: 'Share a Ride',       desc: 'Post or find rides' },
          ].map(tile => (
            <button
              key={tile.id}
              onClick={() => onSelectTab(tile.id)}
              className="group bg-gray-800/60 hover:bg-gray-700/80 border border-gray-700 hover:border-gray-500 rounded-xl p-4 text-left transition-all duration-200"
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
    socket.on('connect',       onConnect)
    socket.on('disconnect',    onDisconnect)
    socket.on('files_updated', onFilesUpdated)
    setConnected(socket.connected)
    return () => {
      socket.off('connect',       onConnect)
      socket.off('disconnect',    onDisconnect)
      socket.off('files_updated', onFilesUpdated)
    }
  }, [])

  // Poll global stats
  useEffect(() => {
    const fetchStats = () => getStats().then(setStats).catch(() => {})
    fetchStats()
    const id = setInterval(fetchStats, 30_000)
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
                  onLocationUpdate={() => {}}
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
        <aside className="hidden lg:flex flex-col gap-1 w-48 shrink-0 pt-1">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => handleSelectTab(t.id)}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left ${
                tab === t.id
                  ? 'bg-blue-700/40 text-blue-300 border border-blue-700/60'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <span>{t.icon}</span>
              <span>{t.label.split(' ').slice(1).join(' ')}</span>
            </button>
          ))}
        </aside>

        {/* ── Main panel ── */}
        <main className="flex-1 min-w-0">
          {/* Mobile tab pills */}
          <div className="flex gap-2 overflow-x-auto pb-3 lg:hidden">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => handleSelectTab(t.id)}
                className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  tab === t.id
                    ? 'bg-blue-700 border-blue-600 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700 hover:text-white'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab panels */}
          <div ref={tabPanelRef}>
            {tab === 'overview' && (
              <OverviewPanel user={appUser} dashStats={dashStats} onSelectTab={handleSelectTab} />
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
                <div className="mb-4">
                  <RideShareMap
                    userLocation={appUser?.lat != null ? { lat: appUser.lat, lng: appUser.lng } : null}
                  />
                </div>
                <RideShare user={appUser} />
              </div>
            )}

            {tab === 'profile' && (
              <div className="card">
                <UserProfile
                  user={appUser}
                  onLogout={handleLogout}
                  onLocationUpdate={() => {}}
                />
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
