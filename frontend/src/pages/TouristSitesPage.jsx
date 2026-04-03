/**
 * TouristSitesPage — Discover tourist attractions near your location.
 *
 * Features:
 *   - Fetches live tourist/historic/natural attractions from Overpass API
 *   - Category filters: All, Museums, Parks, Historic, Religious, Viewpoints, Entertainment
 *   - Distance-sorted card grid with animated entrance
 *   - Fallback list when location is unavailable or API is down
 */

import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../App'
import UserAuth from '../components/UserAuth'
import ThemeSelector from '../components/ThemeSelector'
import TouristSitesContent from '../components/TouristSitesContent'
import { getUserProfile } from '../api'

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TouristSitesPage() {
  const { admin } = useAuth()
  const navigate  = useNavigate()

  const [appUser,       setAppUser]       = useState(null)
  const [userLoading,   setUserLoading]   = useState(true)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [userLat, setUserLat] = useState(null)
  const [userLng, setUserLng] = useState(null)

  // Load user (to seed initial lat/lng from profile)
  useEffect(() => {
    getUserProfile()
      .then(u => {
        setAppUser(u)
        if (u?.lat != null) { setUserLat(u.lat); setUserLng(u.lng) }
      })
      .catch(() => setAppUser(false))
      .finally(() => setUserLoading(false))
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-page)', display: 'flex', flexDirection: 'column' }}>
      {showAuthModal && !appUser && (
        <UserAuth
          onSuccess={u => { setAppUser(u); setShowAuthModal(false) }}
          onClose={() => setShowAuthModal(false)}
        />
      )}

      {/* ── Navbar ── */}
      <nav className="sticky top-0 z-50 bg-gray-950/95 backdrop-blur border-b border-gray-800">
        <div className="max-w-full px-4 flex items-center h-14 gap-4">
          <Link to="/" className="flex items-center gap-2 text-xl font-bold text-white shrink-0">
            <img src="/yotweek.png" alt="" width={22} height={22} style={{ borderRadius: 4 }} aria-hidden="true" />
            <span className="gradient-text hidden sm:inline">yotweek</span>
          </Link>
          <Link to="/" className="text-xs text-gray-400 hover:text-white transition-colors">← Home</Link>
          <div className="flex-1" />
          <ThemeSelector />
          {!userLoading && (appUser ? (
            <button
              onClick={() => navigate('/profile')}
              className="w-8 h-8 rounded-full bg-blue-700 hover:bg-blue-600 flex items-center justify-center text-base transition-colors overflow-hidden"
              aria-label="Profile"
            >
              {appUser.avatar_url
                ? <img src={appUser.avatar_url} alt="" className="w-full h-full object-cover" />
                : <span>🧍</span>
              }
            </button>
          ) : (
            <button
              onClick={() => setShowAuthModal(true)}
              className="text-xs px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-white transition-colors"
            >
              Login / Register
            </button>
          ))}
          {admin && (
            <Link to="/const" className="btn-secondary btn-sm hidden sm:inline-flex">Dashboard</Link>
          )}
        </div>
      </nav>

      {/* ── Page header ── */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)' }}>
        <h1 style={{ color: 'var(--text-primary)', fontSize: '1.5rem', fontWeight: 800, margin: '0 0 2px' }}>
          🗺️ Tourist Sites
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.83rem', margin: 0 }}>
          Discover tourist attractions, landmarks and places of interest near you.
        </p>
      </div>

      {/* ── Content ── */}
      <main style={{ flex: 1, padding: '20px', overflowY: 'auto' }}>
        <TouristSitesContent initialLat={userLat} initialLng={userLng} />
      </main>

      <footer className="border-t border-gray-800 py-3 px-4 text-center text-xs text-gray-600">
        <p>
          yotweek © {new Date().getFullYear()} ·{' '}
          <Link to="/" className="hover:text-gray-400">Back to Home</Link>
        </p>
      </footer>
    </div>
  )
}
