import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getUserProfile, userLogout } from '../api'
import UserProfile from '../components/UserProfile'
import UserAuth from '../components/UserAuth'
import ThemeSelector from '../components/ThemeSelector'
import { useAuth } from '../App'

/**
 * ProfilePage — A dedicated full-page profile experience with animated hero section,
 * stats, and the full UserProfile component embedded below.
 */
export default function ProfilePage() {
  const { admin } = useAuth()
  const navigate = useNavigate()
  const [appUser, setAppUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showAuth, setShowAuth] = useState(false)
  const [heroVisible, setHeroVisible] = useState(false)
  const [statsVisible, setStatsVisible] = useState(false)
  const statsRef = useRef(null)

  useEffect(() => {
    getUserProfile()
      .then(u => setAppUser(u))
      .catch(() => setAppUser(false))
      .finally(() => setLoading(false))
  }, [])

  // Staggered entrance animation
  useEffect(() => {
    const t1 = setTimeout(() => setHeroVisible(true), 80)
    const t2 = setTimeout(() => setStatsVisible(true), 340)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  // Intersection observer for stats cards
  useEffect(() => {
    if (!statsRef.current) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setStatsVisible(true) },
      { threshold: 0.2 }
    )
    observer.observe(statsRef.current)
    return () => observer.disconnect()
  }, [])

  const handleLogout = async () => {
    try { await userLogout() } catch (_) {}
    setAppUser(false)
    navigate('/')
  }

  return (
    <div className="profile-page min-h-screen" style={{ background: 'var(--bg-page)', display: 'flex', flexDirection: 'column' }}>
      {/* Auth modal */}
      {showAuth && !appUser && (
        <UserAuth
          onSuccess={(u) => { setAppUser(u); setShowAuth(false) }}
          onClose={() => setShowAuth(false)}
        />
      )}

      {/* ── Navbar ── */}
      <nav className="sticky top-0 z-50 bg-gray-950/95 backdrop-blur border-b border-gray-800">
        <div className="max-w-full px-4 flex items-center h-14 gap-4">
          <Link to="/" className="flex items-center gap-2 text-xl font-bold text-white shrink-0">
            <img src="/yotweek.png" alt="" width={22} height={22} style={{ borderRadius: 4 }} />
            <span className="gradient-text hidden sm:inline">yotweek</span>
          </Link>
          <Link to="/" className="text-xs text-gray-400 hover:text-white transition-colors flex items-center gap-1">← Home</Link>
          <div className="flex-1" />
          <ThemeSelector />
          {admin && (
            <Link to="/const" className="btn-secondary btn-sm hidden sm:inline-flex">Dashboard</Link>
          )}
        </div>
      </nav>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="spinner w-10 h-10" />
        </div>
      ) : !appUser ? (
        /* ── Not logged in ── */
        <div className="flex-1 flex flex-col items-center justify-center py-16 gap-6 text-center px-4">
          <div
            className="profile-hero-enter"
            style={{
              opacity: heroVisible ? 1 : 0,
              transform: heroVisible ? 'translateY(0) scale(1)' : 'translateY(24px) scale(0.97)',
              transition: 'opacity 0.5s ease, transform 0.5s cubic-bezier(0.34,1.4,0.64,1)',
            }}
          >
            <div className="text-7xl mb-4 animate-bounce-slow">👤</div>
            <h1 className="text-3xl font-bold text-white mb-2">Your Profile</h1>
            <p className="text-gray-400 text-sm max-w-xs mb-6">
              Log in to view and edit your profile, track your ride history, and manage your driver settings.
            </p>
            <button
              onClick={() => setShowAuth(true)}
              className="px-8 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-base transition-all hover:scale-105 active:scale-95"
            >
              Login / Register
            </button>
          </div>
        </div>
      ) : (
        /* ── Logged in ── */
        <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-8 space-y-8">

          {/* ── Animated hero banner ── */}
          <div
            className="profile-hero-card relative overflow-hidden rounded-2xl border border-blue-800/40 p-6"
            style={{
              background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)',
              opacity: heroVisible ? 1 : 0,
              transform: heroVisible ? 'translateY(0)' : 'translateY(-20px)',
              transition: 'opacity 0.5s ease, transform 0.5s ease',
            }}
          >
            {/* Animated background blobs */}
            <div className="profile-bg-blob profile-bg-blob-1" />
            <div className="profile-bg-blob profile-bg-blob-2" />

            <div className="relative flex items-center gap-5">
              {/* Animated avatar ring */}
              <div className="profile-avatar-ring relative shrink-0">
                <div className="profile-avatar-ring-pulse absolute inset-0 rounded-full" />
                <div className="w-20 h-20 rounded-full overflow-hidden border-3 border-blue-500 bg-blue-900 flex items-center justify-center text-4xl z-10 relative">
                  {appUser.avatar_url ? (
                    <img src={appUser.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span>{appUser.role === 'driver' ? '🚗' : '🧍'}</span>
                  )}
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h1 className="text-2xl font-bold text-white truncate">{appUser.name}</h1>
                  {appUser.role === 'driver' && (
                    <span className="profile-verified-badge text-xs px-2 py-0.5 rounded-full bg-green-900/60 text-green-300 border border-green-700/50">
                      ✅ Verified Driver
                    </span>
                  )}
                </div>
                <p className="text-gray-400 text-sm">{appUser.email}</p>
                <p className="text-gray-500 text-xs capitalize mt-0.5">{appUser.role} · Member since {new Date(appUser.created_at).toLocaleDateString()}</p>
                <p className="text-gray-600 text-xs font-mono mt-1 truncate" title={appUser.user_id}>ID: {appUser.user_id}</p>
              </div>

              <button
                onClick={handleLogout}
                className="shrink-0 text-xs text-gray-500 hover:text-red-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-red-900/20"
              >
                Logout
              </button>
            </div>

            {appUser.bio && (
              <p className="relative mt-4 text-sm text-gray-300 bg-gray-800/40 rounded-xl px-4 py-3 border border-gray-700/40 profile-bio-text">
                "{appUser.bio}"
              </p>
            )}
          </div>

          {/* ── Quick stats ── */}
          <div
            ref={statsRef}
            className="grid grid-cols-3 gap-3"
            style={{
              opacity: statsVisible ? 1 : 0,
              transform: statsVisible ? 'translateY(0)' : 'translateY(16px)',
              transition: 'opacity 0.5s ease 0.15s, transform 0.5s ease 0.15s',
            }}
          >
            {[
              { icon: '🚗', label: 'Role', value: appUser.role === 'driver' ? 'Driver' : 'Passenger', color: 'text-blue-400' },
              { icon: '✅', label: 'Status', value: appUser.role === 'driver' ? 'Verified' : 'Active', color: 'text-green-400' },
              { icon: '📅', label: 'Joined', value: new Date(appUser.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }), color: 'text-purple-400' },
            ].map((stat, i) => (
              <div
                key={stat.label}
                className="profile-stat-card bg-gray-900/80 border border-gray-700/60 rounded-xl p-4 text-center"
                style={{
                  opacity: statsVisible ? 1 : 0,
                  transform: statsVisible ? 'translateY(0) scale(1)' : 'translateY(12px) scale(0.95)',
                  transition: `opacity 0.4s ease ${0.1 + i * 0.08}s, transform 0.4s cubic-bezier(0.34,1.4,0.64,1) ${0.1 + i * 0.08}s`,
                }}
              >
                <div className="text-2xl mb-1">{stat.icon}</div>
                <div className={`text-sm font-bold ${stat.color}`}>{stat.value}</div>
                <div className="text-xs text-gray-500 mt-0.5">{stat.label}</div>
              </div>
            ))}
          </div>

          {/* ── Full profile component ── */}
          <div
            style={{
              opacity: statsVisible ? 1 : 0,
              transform: statsVisible ? 'translateY(0)' : 'translateY(20px)',
              transition: 'opacity 0.5s ease 0.3s, transform 0.5s ease 0.3s',
            }}
          >
            <UserProfile
              user={appUser}
              onLogout={handleLogout}
              onLocationUpdate={(loc) => setAppUser(u => ({ ...u, ...loc }))}
              onUserUpdate={(u) => u && setAppUser(prev => ({ ...prev, ...u }))}
            />
          </div>

          {/* ── Quick links ── */}
          <div
            className="grid grid-cols-2 gap-3"
            style={{
              opacity: statsVisible ? 1 : 0,
              transition: 'opacity 0.5s ease 0.45s',
            }}
          >
            {[
              { to: '/rides',      icon: '✈️', label: 'Airport Rides',  desc: 'View & book rides' },
              { to: '/dashboard',  icon: '📊', label: 'Dashboard',      desc: 'Full control panel' },
              { to: '/properties', icon: '🏢', label: 'Properties',     desc: 'Browse listings'   },
              { to: '/',           icon: '🏠', label: 'Home',           desc: 'Back to main page'  },
            ].map(link => (
              <Link
                key={link.to}
                to={link.to}
                className="profile-quick-link bg-gray-900/60 hover:bg-gray-800 border border-gray-700/60 hover:border-gray-600 rounded-xl p-4 flex items-center gap-3 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                <span className="text-2xl">{link.icon}</span>
                <div>
                  <p className="text-sm font-semibold text-white">{link.label}</p>
                  <p className="text-xs text-gray-500">{link.desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <footer className="border-t border-gray-800 py-4 px-4 text-center text-xs text-gray-600">
        <p>yotweek © {new Date().getFullYear()} — <Link to="/" className="hover:text-gray-400">Back to Home</Link></p>
      </footer>
    </div>
  )
}
