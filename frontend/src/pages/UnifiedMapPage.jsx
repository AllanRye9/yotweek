/**
 * UnifiedMapPage — Single interactive map for ride-share drivers and property listings.
 *
 * Features:
 *   - Mode toggle (Ride-Share / Properties) with segmented control
 *   - UnifiedMap component with real-time geolocation
 *   - Below-map list of nearest 4 items sorted by distance
 *   - "Show More" pagination (loads next 4 without page reload)
 *   - Map+list synchronization: click list item → center map, click pin → highlight list
 *   - Driver/Agent profile modal with chat initiation
 *   - Graceful fallback when geolocation is denied
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../App'
import UnifiedMap from '../components/UnifiedMap'
import UserAuth from '../components/UserAuth'
import UserProfile from '../components/UserProfile'
import ThemeSelector from '../components/ThemeSelector'
import { getUserProfile, getUnifiedMapNearby, getAllDriverLocations, listProperties } from '../api'
import socket from '../socket'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 4

const STATUS_COLOR = { active: '#22c55e', sold: '#ef4444', rented: '#f59e0b', empty: 'var(--text-secondary)', occupied: '#ef4444', soon_empty: '#22c55e' }
const STATUS_LABEL = { active: 'Active', sold: 'Sold', rented: 'Rented', empty: 'Empty', occupied: 'Occupied', soon_empty: 'Soon Empty' }

const AVAIL_COLOR = { available: '#22c55e', busy: '#f59e0b', offline: 'var(--text-secondary)' }
const AVAIL_LABEL = { available: 'Available', busy: 'Busy', offline: 'Offline' }

function _haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function _stars(rating) {
  if (!rating) return '☆☆☆☆☆'
  const full = Math.floor(rating)
  const half = rating - full >= 0.5 ? 1 : 0
  const empty = 5 - full - half
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty)
}

// ─── Item Card components ─────────────────────────────────────────────────────

function DriverCard({ item, isSelected, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-xl border transition-all ${isSelected ? 'border-blue-500 bg-blue-950/30' : 'border-gray-700 bg-gray-900/60 hover:border-gray-500 hover:bg-gray-800/60'}`}
      aria-selected={isSelected}
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center text-xl shrink-0">
          {item.avatar || '🚗'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white text-sm truncate">{item.name || 'Driver'}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded-full`} style={{ background: item.empty !== false ? '#16a34a33' : '#6b728033', color: item.empty !== false ? '#86efac' : 'var(--text-secondary)' }}>
              {item.empty !== false ? 'Available' : 'Occupied'}
            </span>
          </div>
          {item.rating != null && (
            <div className="text-xs text-yellow-400">{_stars(item.rating)} <span className="text-gray-400">{item.rating.toFixed(1)}</span></div>
          )}
          <div className="text-xs text-gray-400 flex gap-3 mt-0.5">
            {item.vehicle && <span>🚘 {item.vehicle}</span>}
            {item.seats != null && <span>💺 {item.seats} seat{item.seats !== 1 ? 's' : ''}</span>}
            {item.distance_km != null && <span>📍 {item.distance_km.toFixed(1)} km</span>}
          </div>
        </div>
      </div>
    </button>
  )
}

function PropertyCard({ item, isSelected, onClick }) {
  const color = STATUS_COLOR[item.status] ?? 'var(--text-secondary)'
  const label = STATUS_LABEL[item.status] ?? item.status
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-xl border transition-all ${isSelected ? 'border-blue-500 bg-blue-950/30' : 'border-gray-700 bg-gray-900/60 hover:border-gray-500 hover:bg-gray-800/60'}`}
      aria-selected={isSelected}
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0" style={{ background: color + '22' }}>
          🏠
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-white text-sm truncate">{item.title || item.address}</span>
            <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: color + '33', color }}>
              {label}
            </span>
          </div>
          {item.address && item.title && <div className="text-xs text-gray-400 truncate">{item.address}</div>}
          <div className="text-xs text-gray-400 flex gap-3 mt-0.5">
            {item.price && <span className="text-green-400 font-semibold">£{Number(item.price).toLocaleString('en-GB')}/mo</span>}
            {item.distance_km != null && <span>📍 {item.distance_km.toFixed(1)} km</span>}
          </div>
        </div>
      </div>
    </button>
  )
}

// ─── Detail Popup Panel ───────────────────────────────────────────────────────

function DetailPanel({ item, mode, onClose, onContact }) {
  if (!item) return null
  const isProperty = mode === 'properties' && item.property_id

  return (
    <div className="fixed inset-0 z-[2000] flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-5 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-full bg-gray-800 flex items-center justify-center text-3xl shrink-0">
              {isProperty ? '🏠' : (item.avatar || '🚗')}
            </div>
            <div>
              <h3 className="font-bold text-white text-lg leading-tight">{isProperty ? (item.title || item.address) : (item.name || 'Driver')}</h3>
              {isProperty ? (
                <div className="text-sm mt-0.5">
                  <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: (STATUS_COLOR[item.status] ?? 'var(--text-secondary)') + '33', color: STATUS_COLOR[item.status] ?? 'var(--text-secondary)' }}>
                    {STATUS_LABEL[item.status] ?? item.status}
                  </span>
                </div>
              ) : (
                item.rating != null && (
                  <div className="text-yellow-400 text-sm">{_stars(item.rating)} <span className="text-gray-400 text-xs">{item.rating.toFixed(1)}</span></div>
                )
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl leading-none shrink-0" aria-label="Close">✕</button>
        </div>

        <div className="space-y-2 text-sm text-gray-300">
          {isProperty ? (
            <>
              {item.address && <p className="flex gap-2"><span>📍</span><span>{item.address}</span></p>}
              {item.description && <p className="text-gray-400 text-xs leading-relaxed">{item.description}</p>}
              {item.price && <p className="flex gap-2"><span>💰</span><span className="text-green-400 font-semibold">£{Number(item.price).toLocaleString('en-GB')}/mo</span></p>}
              {item.distance_km != null && <p className="flex gap-2"><span>🗺</span><span>{item.distance_km.toFixed(1)} km away</span></p>}
            </>
          ) : (
            <>
              {item.vehicle && <p className="flex gap-2"><span>🚘</span><span>{item.vehicle}</span></p>}
              {item.seats != null && <p className="flex gap-2"><span>💺</span><span>{item.seats} seat{item.seats !== 1 ? 's' : ''} available</span></p>}
              <p className="flex gap-2">
                <span>🟢</span>
                <span style={{ color: item.empty !== false ? '#86efac' : 'var(--text-secondary)' }}>
                  {item.empty !== false ? 'Available for rides' : 'Currently occupied'}
                </span>
              </p>
              {item.distance_km != null && <p className="flex gap-2"><span>🗺</span><span>{item.distance_km.toFixed(1)} km away</span></p>}
            </>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onContact?.(item)}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
          >
            💬 {isProperty ? 'Contact Agent' : 'Request Ride'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const DEFAULT_LOCATION = { lat: 51.505, lng: -0.09 }  // London fallback

export default function UnifiedMapPage() {
  const { admin } = useAuth()
  const [appUser, setAppUser] = useState(null)
  const [userLoading, setUserLoading] = useState(true)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const profileRef = useRef(null)

  const [mode, setMode] = useState('drivers')   // 'drivers' | 'properties'
  const [allItems, setAllItems] = useState([])  // all fetched items (with distance_km)
  const [page, setPage] = useState(1)           // current pagination page
  const [loading, setLoading] = useState(false)
  const [locError, setLocError] = useState(false)
  const [userLocation, setUserLocation] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [selectedItem, setSelectedItem] = useState(null)
  const listRef = useRef(null)

  // Load platform user
  useEffect(() => {
    getUserProfile().then(u => setAppUser(u)).catch(() => setAppUser(false)).finally(() => setUserLoading(false))
  }, [])

  // Close profile dropdown on outside click
  useEffect(() => {
    const h = e => { if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // Obtain user geolocation on mount
  useEffect(() => {
    if (!navigator.geolocation) { setUserLocation(DEFAULT_LOCATION); setLocError(true); return }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => setUserLocation({ lat: coords.latitude, lng: coords.longitude }),
      () => { setUserLocation(DEFAULT_LOCATION); setLocError(true) },
      { enableHighAccuracy: false, timeout: 8000 }
    )
  }, [])

  // Fetch items when mode or userLocation changes
  const fetchItems = useCallback(async () => {
    const loc = userLocation || DEFAULT_LOCATION
    setLoading(true)
    try {
      if (mode === 'drivers') {
        const data = await getAllDriverLocations()
        const drivers = (data.drivers || []).map(d => ({
          ...d,
          id: d.user_id || d.name,
          distance_km: _haversineKm(loc.lat, loc.lng, d.lat, d.lng),
        })).sort((a, b) => a.distance_km - b.distance_km)
        setAllItems(drivers)
      } else {
        const data = await listProperties()
        const props = (data.properties || [])
          .filter(p => p.lat != null && p.lng != null)
          .map(p => ({ ...p, distance_km: _haversineKm(loc.lat, loc.lng, p.lat, p.lng) }))
          .sort((a, b) => a.distance_km - b.distance_km)
        setAllItems(props)
      }
    } catch {
      setAllItems([])
    } finally {
      setLoading(false)
    }
  }, [mode, userLocation])

  useEffect(() => { setPage(1); fetchItems() }, [fetchItems])

  // Auto-refresh drivers every 15s
  useEffect(() => {
    if (mode !== 'drivers') return
    const id = setInterval(fetchItems, 15_000)
    return () => clearInterval(id)
  }, [mode, fetchItems])

  // Listen for driver_nearby socket event
  useEffect(() => {
    if (mode !== 'drivers') return
    const h = () => fetchItems()
    socket.on('driver_nearby', h)
    return () => socket.off('driver_nearby', h)
  }, [mode, fetchItems])

  // When mode changes, reset pagination and selection
  useEffect(() => { setPage(1); setSelectedId(null); setSelectedItem(null) }, [mode])

  const visibleItems = allItems.slice(0, page * PAGE_SIZE)
  const hasMore = allItems.length > page * PAGE_SIZE

  const handleSelectItem = useCallback((item) => {
    if (!appUser) {
      setShowAuthModal(true)
      return
    }
    const id = item.property_id ?? item.id ?? item.user_id
    setSelectedId(id)
    setSelectedItem(item)
    // Scroll list item into view
    setTimeout(() => {
      const el = listRef.current?.querySelector(`[data-item-id="${id}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 100)
  }, [appUser])

  const handleListClick = (item) => {
    if (!appUser) {
      setShowAuthModal(true)
      return
    }
    const id = item.property_id ?? item.id ?? item.user_id
    setSelectedId(id)
    setSelectedItem(item)
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {showAuthModal && !appUser && (
        <UserAuth onSuccess={u => { setAppUser(u); setShowAuthModal(false) }} onClose={() => setShowAuthModal(false)} />
      )}

      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-gray-950/95 backdrop-blur border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 flex items-center h-14 gap-4">
          <Link to="/" className="flex items-center gap-2 text-xl font-bold text-white shrink-0">
            <img src="/yotweek.png" alt="" width={22} height={22} style={{ borderRadius: 4 }} aria-hidden="true" />
            <span className="gradient-text hidden sm:inline">yotweek</span>
            <span className="gradient-text sm:hidden">YOT</span>
          </Link>
          <Link to="/" className="text-xs text-gray-400 hover:text-white transition-colors flex items-center gap-1">← Home</Link>
          <div className="flex-1" />
          <ThemeSelector />
          {!userLoading && (
            <div className="relative" ref={profileRef}>
              {appUser ? (
                <>
                  <button
                    onClick={() => setProfileOpen(o => !o)}
                    className="nav-profile-btn flex items-center gap-2 rounded-full bg-blue-700 hover:bg-blue-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 pl-1 pr-3 py-1"
                    aria-label="Profile" title={appUser.name}
                  >
                    {appUser.avatar_url
                      ? <img src={appUser.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
                      : <span className="w-7 h-7 rounded-full bg-blue-800 flex items-center justify-center text-sm shrink-0">{appUser.role === 'driver' ? '🚗' : '🧍'}</span>
                    }
                    <span className="hidden sm:block text-white text-xs font-medium max-w-[100px] truncate">{appUser.name}</span>
                    <span className="hidden sm:block text-blue-300 text-xs">▾</span>
                  </button>
                  {profileOpen && (
                    <div className="nav-profile-dropdown absolute right-0 top-11 w-72 sm:w-80 lg:w-96 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50 max-h-[85vh] overflow-y-auto">
                      <UserProfile user={appUser} onLogout={() => { setAppUser(false); setProfileOpen(false) }} onLocationUpdate={() => {}} onUserUpdate={u => setAppUser(u)} />
                    </div>
                  )}
                </>
              ) : (
                <button onClick={() => setShowAuthModal(true)} className="text-xs px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-white transition-colors">
                  Login / Register
                </button>
              )}
            </div>
          )}
          {admin && <Link to="/const" className="btn-secondary btn-sm hidden sm:inline-flex">Dashboard</Link>}
        </div>
      </nav>

      {/* Page header */}
      <div className="bg-gradient-to-b from-gray-900 to-gray-950 py-4 px-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              🗺 Unified Map
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">Real-time drivers and property listings on one map.</p>
          </div>
          {/* Mode toggle */}
          <div className="flex items-center gap-1 bg-gray-800 rounded-xl p-1" role="group" aria-label="Map mode">
            <button
              onClick={() => setMode('drivers')}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${mode === 'drivers' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
              aria-pressed={mode === 'drivers'}
            >
              🚗 Ride-Share
            </button>
            <button
              onClick={() => setMode('properties')}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${mode === 'properties' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
              aria-pressed={mode === 'properties'}
            >
              🏠 Properties
            </button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-4 space-y-4">
        {/* Geolocation error banner */}
        {locError && (
          <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-xl px-4 py-2.5 text-sm text-yellow-300 flex items-center gap-2">
            <span>⚠️</span>
            <span>Location access denied — showing default location (London). Enable location for accurate nearest results.</span>
          </div>
        )}

        {/* Map */}
        <UnifiedMap
          mode={mode}
          items={allItems}
          selectedId={selectedId}
          onSelectItem={handleSelectItem}
          userLocation={userLocation}
          onLocationUpdate={setUserLocation}
          isAuth={!!appUser}
        />

        {/* Below-map list */}
        <section aria-label={mode === 'drivers' ? 'Nearest drivers' : 'Nearest properties'}>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-300">
              {mode === 'drivers' ? '🚗 Nearest Drivers' : '🏠 Nearest Properties'}
              {!loading && allItems.length > 0 && <span className="text-gray-500 font-normal ml-2">({allItems.length} total)</span>}
            </h2>
            {!loading && (
              <button onClick={fetchItems} className="text-xs text-gray-500 hover:text-gray-300 transition-colors" title="Refresh">⟳ Refresh</button>
            )}
          </div>

          {loading ? (
            <div className="flex justify-center py-8"><div className="spinner w-8 h-8" /></div>
          ) : allItems.length === 0 ? (
            <div className="text-center py-10 text-gray-500 text-sm">
              {mode === 'drivers' ? 'No active drivers nearby.' : 'No properties found.'}
            </div>
          ) : (
            <div ref={listRef} className="space-y-2">
              {visibleItems.map(item => {
                const id = item.property_id ?? item.id ?? item.user_id
                return (
                  <div key={id} data-item-id={id}>
                    {mode === 'drivers'
                      ? <DriverCard item={item} isSelected={selectedId === id} onClick={() => handleListClick(item)} />
                      : <PropertyCard item={item} isSelected={selectedId === id} onClick={() => handleListClick(item)} />
                    }
                  </div>
                )
              })}
              {hasMore && (
                <button
                  onClick={() => setPage(p => p + 1)}
                  className="w-full py-2.5 rounded-xl border border-gray-700 bg-gray-900/40 hover:bg-gray-800/60 text-gray-400 hover:text-white text-sm font-medium transition-all"
                >
                  Show More ({allItems.length - visibleItems.length} remaining)
                </button>
              )}
            </div>
          )}
        </section>
      </main>

      {/* Detail Panel Modal */}
      {selectedItem && (
        <DetailPanel
          item={selectedItem}
          mode={mode}
          onClose={() => { setSelectedItem(null); setSelectedId(null) }}
          onContact={(item) => {
            setSelectedItem(null)
            if (mode === 'drivers') {
              window.location.href = '/rides'
            } else {
              window.location.href = '/properties'
            }
          }}
        />
      )}

      <footer className="border-t border-gray-800 py-4 px-4 text-center text-xs text-gray-600">
        <p>yotweek © {new Date().getFullYear()} — <Link to="/" className="hover:text-gray-400">Back to Home</Link></p>
      </footer>
    </div>
  )
}
