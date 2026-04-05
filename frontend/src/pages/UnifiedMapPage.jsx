/**
 * UnifiedMapPage — Rideshare-only live radius map.
 *
 * Features:
 *   - 10 km radius circle centred on user's position
 *   - Live driver markers with auto-refresh every 15 s
 *   - Dual-panel location card: map tile + real photo
 *   - Graceful fallback when geolocation is denied
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import NavBar from '../components/NavBar'
import RideShareMap from '../components/RideShareMap'
import UserAuth from '../components/UserAuth'
import { getUserProfile, getAllDriverLocations } from '../api'
import socket from '../socket'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RADIUS_KM   = 10
const PAGE_SIZE   = 4
const DEFAULT_LOC = { lat: 51.505, lng: -0.09 }

function _haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function _stars(rating) {
  if (!rating) return '☆☆☆☆☆'
  const full  = Math.floor(rating)
  const half  = rating - full >= 0.5 ? 1 : 0
  const empty = 5 - full - half
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty)
}

// ─── Driver Card ─────────────────────────────────────────────────────────────

function DriverCard({ item, isSelected, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-xl border transition-all ${
        isSelected
          ? 'border-blue-500 bg-blue-950/30'
          : 'border-gray-700 bg-gray-900/60 hover:border-gray-500 hover:bg-gray-800/60'
      }`}
      aria-selected={isSelected}
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center text-xl shrink-0">
          🚗
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white text-sm truncate">{item.name || 'Driver'}</span>
            <span
              className="text-xs px-1.5 py-0.5 rounded-full"
              style={{
                background: item.empty !== false ? '#16a34a33' : '#6b728033',
                color:      item.empty !== false ? '#86efac'   : 'var(--text-secondary)',
              }}
            >
              {item.empty !== false ? 'Available' : 'Occupied'}
            </span>
          </div>
          {item.rating != null && (
            <div className="text-xs text-yellow-400">
              {_stars(item.rating)} <span className="text-gray-400">{item.rating.toFixed(1)}</span>
            </div>
          )}
          <div className="text-xs text-gray-400 flex gap-3 mt-0.5">
            {item.vehicle   && <span>🚘 {item.vehicle}</span>}
            {item.seats != null && <span>💺 {item.seats} seat{item.seats !== 1 ? 's' : ''}</span>}
            {item.distance_km != null && <span>📍 {item.distance_km.toFixed(1)} km</span>}
          </div>
        </div>
      </div>
    </button>
  )
}

// ─── Dual-Panel Location Card ─────────────────────────────────────────────────
// Shows a map tile on the left + driver photo/details on the right.

function LocationCard({ item, onClose, onRequest }) {
  if (!item) return null
  const lat = item.lat
  const lng = item.lng

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Two-panel layout */}
        <div className="flex flex-col sm:flex-row" style={{ minHeight: 180 }}>
          {/* Left — map tile */}
          {lat != null && lng != null ? (
            <div className="sm:w-48 shrink-0 bg-gray-800" style={{ height: 180 }}>
              <iframe
                title="driver location"
                width="100%"
                height="180"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.015},${lat - 0.015},${lng + 0.015},${lat + 0.015}&layer=mapnik&marker=${lat},${lng}`}
                style={{ border: 'none', display: 'block' }}
              />
            </div>
          ) : (
            <div className="sm:w-48 shrink-0 bg-gray-800 flex items-center justify-center" style={{ height: 180 }}>
              <span className="text-4xl">🗺</span>
            </div>
          )}

          {/* Right — driver details */}
          <div className="flex-1 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                {item.avatar_url ? (
                  <img src={item.avatar_url} alt="" className="w-14 h-14 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-gray-700 flex items-center justify-center text-3xl shrink-0">🚗</div>
                )}
                <div>
                  <h3 className="font-bold text-white text-base leading-tight">{item.name || 'Driver'}</h3>
                  {item.rating != null && (
                    <div className="text-yellow-400 text-sm">{_stars(item.rating)} <span className="text-gray-400 text-xs">{item.rating.toFixed(1)}</span></div>
                  )}
                </div>
              </div>
              <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl leading-none shrink-0">✕</button>
            </div>

            <div className="space-y-1 text-sm text-gray-300">
              {item.vehicle     && <p className="flex gap-2"><span>🚘</span><span>{item.vehicle}</span></p>}
              {item.seats != null && <p className="flex gap-2"><span>💺</span><span>{item.seats} seat{item.seats !== 1 ? 's' : ''} available</span></p>}
              <p className="flex gap-2">
                <span>🟢</span>
                <span style={{ color: item.empty !== false ? '#86efac' : 'var(--text-secondary)' }}>
                  {item.empty !== false ? 'Available for rides' : 'Currently occupied'}
                </span>
              </p>
              {item.distance_km != null && (
                <p className="flex gap-2"><span>🗺</span><span>{item.distance_km.toFixed(1)} km away</span></p>
              )}
            </div>

            <button
              onClick={() => onRequest?.(item)}
              className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
            >
              🚗 Request Ride
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function UnifiedMapPage() {
  const navigate = useNavigate()
  const [appUser,       setAppUser]       = useState(null)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [allDrivers,    setAllDrivers]    = useState([])
  const [page,          setPage]          = useState(1)
  const [loading,       setLoading]       = useState(false)
  const [locError,      setLocError]      = useState(false)
  const [userLocation,  setUserLocation]  = useState(null)
  const [selectedId,    setSelectedId]    = useState(null)
  const [selectedItem,  setSelectedItem]  = useState(null)
  const listRef = useRef(null)

  // Load platform user
  useEffect(() => {
    getUserProfile().then(u => setAppUser(u)).catch(() => setAppUser(false))
  }, [])

  // Obtain user geolocation
  useEffect(() => {
    if (!navigator.geolocation) { setUserLocation(DEFAULT_LOC); setLocError(true); return }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => setUserLocation({ lat: coords.latitude, lng: coords.longitude }),
      () => { setUserLocation(DEFAULT_LOC); setLocError(true) },
      { enableHighAccuracy: false, timeout: 8000 }
    )
  }, [])

  // Fetch drivers within radius
  const fetchDrivers = useCallback(async () => {
    const loc = userLocation || DEFAULT_LOC
    setLoading(true)
    try {
      const data = await getAllDriverLocations()
      const drivers = (data.drivers || [])
        .map(d => ({
          ...d,
          id:          d.user_id || d.name,
          distance_km: _haversineKm(loc.lat, loc.lng, d.lat, d.lng),
        }))
        .filter(d => d.distance_km <= RADIUS_KM)
        .sort((a, b) => a.distance_km - b.distance_km)
      setAllDrivers(drivers)
    } catch {
      setAllDrivers([])
    } finally {
      setLoading(false)
    }
  }, [userLocation])

  useEffect(() => { setPage(1); fetchDrivers() }, [fetchDrivers])

  // Auto-refresh every 15 s
  useEffect(() => {
    const id = setInterval(fetchDrivers, 15_000)
    return () => clearInterval(id)
  }, [fetchDrivers])

  // Socket event
  useEffect(() => {
    const h = () => fetchDrivers()
    socket.on('driver_nearby', h)
    return () => socket.off('driver_nearby', h)
  }, [fetchDrivers])

  const visibleItems = allDrivers.slice(0, page * PAGE_SIZE)
  const hasMore      = allDrivers.length > page * PAGE_SIZE

  const handleSelectItem = useCallback((item) => {
    if (!appUser) { setShowAuthModal(true); return }
    const id = item.id ?? item.user_id
    setSelectedId(id)
    setSelectedItem(item)
    setTimeout(() => {
      const el = listRef.current?.querySelector(`[data-item-id="${id}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 100)
  }, [appUser])

  const handleListClick = (item) => {
    if (!appUser) { setShowAuthModal(true); return }
    const id = item.id ?? item.user_id
    setSelectedId(id)
    setSelectedItem(item)
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {showAuthModal && !appUser && (
        <UserAuth onSuccess={u => { setAppUser(u); setShowAuthModal(false) }} onClose={() => setShowAuthModal(false)} />
      )}

      <NavBar user={appUser} onLogin={() => setShowAuthModal(true)} title="Map" />

      {/* Page header */}
      <div className="bg-gradient-to-b from-gray-900 to-gray-950 py-4 px-4">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            🗺 Rideshare Map
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Live drivers within {RADIUS_KM} km of your location.
          </p>
        </div>
      </div>

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-4 space-y-4">
        {/* Geolocation error banner */}
        {locError && (
          <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-xl px-4 py-2.5 text-sm text-yellow-300 flex items-center gap-2">
            <span>⚠️</span>
            <span>Location access denied — showing default location (London). Enable location for accurate results.</span>
          </div>
        )}

        {/* Map — using RideShareMap component */}
        <div className="rounded-xl overflow-hidden border border-gray-700" style={{ height: 360 }}>
          <RideShareMap
            rides={[]}
            driverLocations={allDrivers}
            selectedRideId={selectedId}
            onSelectRide={() => {}}
            userLocation={userLocation}
            radiusKm={RADIUS_KM}
          />
        </div>

        {/* Driver list */}
        <section aria-label="Drivers within radius">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-300">
              🚗 Drivers within {RADIUS_KM} km
              {!loading && allDrivers.length > 0 && (
                <span className="text-gray-500 font-normal ml-2">({allDrivers.length} found)</span>
              )}
            </h2>
            {!loading && (
              <button onClick={fetchDrivers} className="text-xs text-gray-500 hover:text-gray-300 transition-colors" title="Refresh">
                ⟳ Refresh
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex justify-center py-8"><div className="spinner w-8 h-8" /></div>
          ) : allDrivers.length === 0 ? (
            <div className="text-center py-10 text-gray-500 text-sm">
              No active drivers within {RADIUS_KM} km.
            </div>
          ) : (
            <div ref={listRef} className="space-y-2">
              {visibleItems.map(item => {
                const id = item.id ?? item.user_id
                return (
                  <div key={id} data-item-id={id}>
                    <DriverCard
                      item={item}
                      isSelected={selectedId === id}
                      onClick={() => handleListClick(item)}
                    />
                  </div>
                )
              })}
              {hasMore && (
                <button
                  onClick={() => setPage(p => p + 1)}
                  className="w-full py-2.5 rounded-xl border border-gray-700 bg-gray-900/40 hover:bg-gray-800/60 text-gray-400 hover:text-white text-sm font-medium transition-all"
                >
                  Show More ({allDrivers.length - visibleItems.length} remaining)
                </button>
              )}
            </div>
          )}
        </section>
      </main>

      {/* Dual-panel Location Card */}
      {selectedItem && (
        <LocationCard
          item={selectedItem}
          onClose={() => { setSelectedItem(null); setSelectedId(null) }}
          onRequest={() => { setSelectedItem(null); navigate('/rides') }}
        />
      )}

      <footer className="border-t border-gray-800 py-4 px-4 text-center text-xs text-gray-600">
        <p>yotweek © {new Date().getFullYear()} — <Link to="/" className="hover:text-gray-400">Back to Home</Link></p>
      </footer>
    </div>
  )
}

