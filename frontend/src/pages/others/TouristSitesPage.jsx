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
import { Link } from 'react-router-dom'
import NavBar from '../components/NavBar'
import UserAuth from '../components/UserAuth'
import TouristSitesContent from '../components/TouristSitesContent'
import { getUserProfile } from '../api'

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TouristSitesPage() {
  const [appUser,       setAppUser]       = useState(null)
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
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-page)', display: 'flex', flexDirection: 'column' }}>
      {showAuthModal && !appUser && (
        <UserAuth
          onSuccess={u => { setAppUser(u); setShowAuthModal(false) }}
          onClose={() => setShowAuthModal(false)}
        />
      )}

      {/* Shared NavBar */}
      <NavBar
        user={appUser}
        onLogin={() => setShowAuthModal(true)}
        title="Tourist Sites"
      />

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
