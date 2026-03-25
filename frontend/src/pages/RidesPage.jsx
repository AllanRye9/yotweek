import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../App'
import RideShare from '../components/RideShare'
import RideShareMap from '../components/RideShareMap'
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

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Auth modal */}
      {showAuthModal && !appUser && (
        <UserAuth
          onSuccess={(u) => { setAppUser(u); setShowAuthModal(false) }}
          onClose={() => setShowAuthModal(false)}
        />
      )}

      {/* ── Navbar ── */}
      <nav className="sticky top-0 z-50 bg-gray-950/95 backdrop-blur border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 flex items-center h-14 gap-4">
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

          {/* User profile avatar */}
          {!userLoading && (
            <div className="relative" ref={profileRef}>
              {appUser ? (
                <>
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
                        onLogout={() => { setAppUser(false); setProfileOpen(false) }}
                        onLocationUpdate={() => {}}
                      />
                    </div>
                  )}
                </>
              ) : (
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-white transition-colors"
                >
                  Login / Register
                </button>
              )}
            </div>
          )}

          {admin && (
            <Link to="/const" className="btn-secondary btn-sm hidden sm:inline-flex">
              Dashboard
            </Link>
          )}
        </div>
      </nav>

      {/* ── Page header ── */}
      <div className="bg-gradient-to-b from-gray-900 to-gray-950 border-b border-gray-800 py-4 px-4">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            🚗 Ride Share &amp; Driver Alerts
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Post shared rides, find passengers, and receive real-time driver alerts.
          </p>
        </div>
      </div>

      {/* ── Main content ── */}
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-4">
        {userLoading ? (
          <div className="flex justify-center py-16">
            <div className="spinner w-10 h-10" />
          </div>
        ) : !appUser ? (
          /* ── Auth gate ── */
          <div className="flex flex-col items-center justify-center py-16 gap-6 text-center">
            <div className="text-5xl">🔒</div>
            <div>
              <h2 className="text-xl font-bold text-white mb-2">Login Required</h2>
              <p className="text-gray-400 text-sm max-w-xs">
                Please login or create a free account to view rides, post a ride, and receive driver alerts.
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
          /* ── Authenticated view ── */
          <div className="space-y-4">
            {/* Live map */}
            <RideShareMap
              userLocation={appUser?.lat != null ? { lat: appUser.lat, lng: appUser.lng } : null}
            />

            {/* Ride share panel */}
            <RideShare user={appUser} />
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-gray-800 py-4 px-4 text-center text-xs text-gray-600">
        <p>yotweek © {new Date().getFullYear()} — <Link to="/" className="hover:text-gray-400">Back to Home</Link></p>
      </footer>
    </div>
  )
}
