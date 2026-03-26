/**
 * PropertiesPage — Map-based property discovery with listing grid.
 *
 * Features:
 *   - Map (Leaflet) with price-preview markers, synced with list
 *   - Grid/list view of properties with filtering by status
 *   - Click property → navigate to PropertyDetailPage
 *   - Click "Contact Agent" → open PropertyInboxPage conversation
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../App'
import UserAuth from '../components/UserAuth'
import UserProfile from '../components/UserProfile'
import { listProperties, getUserProfile } from '../api'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix leaflet default icon paths
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon   from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({ iconRetinaUrl: markerIcon2x, iconUrl: markerIcon, shadowUrl: markerShadow })

// Status colours
const STATUS_COLOR = { active: '#22c55e', sold: '#ef4444', rented: '#f59e0b' }
const STATUS_LABEL = { active: 'Active', sold: 'Sold', rented: 'Rented' }
const STATUS_BG    = { active: '#22c55e22', sold: '#ef444422', rented: '#f59e0b22' }

function formatPrice(price) {
  if (!price) return 'POA'
  return '£' + Number(price).toLocaleString('en-GB') + '/mo'
}

function _buildMarkerIcon(property, isSelected) {
  const color  = STATUS_COLOR[property.status] ?? '#6b7280'
  const border = isSelected ? `stroke="#facc15" stroke-width="2.5"` : `stroke="#fff" stroke-width="1.5"`
  const price  = formatPrice(property.price)
  // Pill-shaped price tag
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="90" height="36" viewBox="0 0 90 36">
      <rect x="1" y="1" width="88" height="28" rx="14" ry="14" fill="${color}" ${border}/>
      <polygon points="40,28 45,36 50,28" fill="${color}"/>
      <text x="45" y="19" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" font-weight="700" fill="#fff">${price}</text>
    </svg>`
  return L.divIcon({
    html: svg,
    className: '',
    iconSize:  [90, 36],
    iconAnchor:[45, 36],
    popupAnchor:[0, -36],
  })
}

// ─── Tile layer helper ────────────────────────────────────────────────────────

function _makeTileLayer(lang) {
  if (lang === 'en') {
    return L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      {
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions" target="_blank">CARTO</a>',
        maxZoom: 19,
        subdomains: 'abcd',
      }
    )
  }
  return L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    {
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }
  )
}

// ─── PropertyMap ─────────────────────────────────────────────────────────────

function PropertyMap({ properties, selectedId, onSelectProperty, userLocation }) {
  const mapRef        = useRef(null)
  const instanceRef   = useRef(null)
  const tileLayerRef  = useRef(null)
  const markersRef    = useRef({})
  const userMarkerRef = useRef(null)
  // Map language: 'en' = English (CartoDB Voyager, default), 'local' = OSM locale
  const [mapLang, setMapLang] = useState('en')

  // Init map once with English tiles
  useEffect(() => {
    if (instanceRef.current || !mapRef.current) return
    const center = userLocation ? [userLocation.lat, userLocation.lng] : [51.505, -0.09]
    const map = L.map(mapRef.current, { zoomControl: true, scrollWheelZoom: true })
    tileLayerRef.current = _makeTileLayer('en').addTo(map)
    map.setView(center, 11)
    instanceRef.current = map
    return () => { map.remove(); instanceRef.current = null; tileLayerRef.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Swap tile layer when language changes
  useEffect(() => {
    const map = instanceRef.current
    if (!map) return
    if (tileLayerRef.current) map.removeLayer(tileLayerRef.current)
    tileLayerRef.current = _makeTileLayer(mapLang).addTo(map)
  }, [mapLang])

  // Update markers when properties or selectedId changes
  useEffect(() => {
    const map = instanceRef.current
    if (!map) return
    Object.values(markersRef.current).forEach(m => m.remove())
    markersRef.current = {}
    properties.forEach(prop => {
      if (prop.lat == null || prop.lng == null) return
      const icon   = _buildMarkerIcon(prop, prop.property_id === selectedId)
      const marker = L.marker([prop.lat, prop.lng], { icon })
      marker.on('click', () => onSelectProperty?.(prop))
      marker.addTo(map)
      markersRef.current[prop.property_id] = marker
    })
  }, [properties, selectedId, onSelectProperty])

  // Pan to selected marker
  useEffect(() => {
    const map = instanceRef.current
    if (!map || !selectedId) return
    const marker = markersRef.current[selectedId]
    if (marker) {
      map.panTo(marker.getLatLng(), { animate: true })
      marker.setIcon(_buildMarkerIcon(properties.find(p => p.property_id === selectedId) ?? {}, true))
    }
  }, [selectedId, properties])

  // User location marker
  useEffect(() => {
    const map = instanceRef.current
    if (!map || !userLocation) return
    if (userMarkerRef.current) userMarkerRef.current.remove()
    userMarkerRef.current = L.circleMarker([userLocation.lat, userLocation.lng], {
      radius: 9, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.7, weight: 2,
    }).addTo(map)
  }, [userLocation])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 320 }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%', minHeight: 320 }} />
      {/* Map language selector */}
      <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 1000 }}>
        <select
          value={mapLang}
          onChange={e => setMapLang(e.target.value)}
          style={{
            padding: '4px 10px', borderRadius: 9999, fontSize: '0.75rem', fontWeight: 600,
            background: 'rgba(17,24,39,0.9)', color: '#d1d5db',
            border: '1px solid #4b5563', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          }}
          title="Map language"
        >
          <option value="en">🌐 English</option>
          <option value="local">🗺 Local</option>
        </select>
      </div>
    </div>
  )
}

// ─── Property Card ────────────────────────────────────────────────────────────

function PropertyCard({ property, isSelected, onClick }) {
  const navigate = useNavigate()
  const color = STATUS_COLOR[property.status] ?? '#6b7280'
  return (
    <div
      onClick={onClick}
      style={{
        background: isSelected ? '#1e3a5f' : '#1f2937',
        border: `1.5px solid ${isSelected ? '#3b82f6' : '#374151'}`,
        borderRadius: 12,
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'all 0.18s',
        boxShadow: isSelected ? '0 0 0 2px #3b82f644' : '0 2px 8px rgba(0,0,0,0.3)',
      }}
    >
      {/* Cover image */}
      <div style={{ position: 'relative', height: 160, background: '#374151', overflow: 'hidden' }}>
        {property.cover_image ? (
          <img
            src={property.cover_image}
            alt={property.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            loading="lazy"
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: '2.5rem' }}>🏠</div>
        )}
        {/* Status badge */}
        <span style={{
          position: 'absolute', top: 8, right: 8,
          background: STATUS_BG[property.status] ?? '#6b728033',
          color,
          border: `1px solid ${color}44`,
          borderRadius: 9999,
          padding: '2px 10px',
          fontSize: '0.72rem',
          fontWeight: 700,
          backdropFilter: 'blur(4px)',
        }}>
          {STATUS_LABEL[property.status] ?? property.status}
        </span>
        {/* Price badge */}
        <span style={{
          position: 'absolute', bottom: 8, left: 8,
          background: 'rgba(0,0,0,0.7)',
          color: '#f3f4f6',
          borderRadius: 8,
          padding: '3px 10px',
          fontSize: '0.85rem',
          fontWeight: 700,
        }}>
          {formatPrice(property.price)}
        </span>
      </div>

      <div style={{ padding: '12px 14px 14px' }}>
        <h3 style={{ color: '#f3f4f6', fontSize: '0.95rem', fontWeight: 700, margin: '0 0 4px', lineHeight: 1.3 }}>
          {property.title}
        </h3>
        {property.address && (
          <p style={{ color: '#9ca3af', fontSize: '0.78rem', margin: '0 0 8px' }}>
            📍 {property.address}
          </p>
        )}
        {property.description && (
          <p style={{ color: '#d1d5db', fontSize: '0.8rem', margin: '0 0 10px', lineHeight: 1.5,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {property.description}
          </p>
        )}
        <button
          type="button"
          onClick={e => { e.stopPropagation(); navigate(`/properties/${property.property_id}`) }}
          style={{
            background: '#3b82f6', color: '#fff', border: 'none',
            borderRadius: 8, padding: '7px 14px', fontSize: '0.8rem',
            fontWeight: 600, cursor: 'pointer', width: '100%',
          }}
        >
          View Details →
        </button>
      </div>
    </div>
  )
}

// ─── Preview Card (shown on map click) ───────────────────────────────────────

function PropertyPreviewCard({ property, onClose, onViewDetail }) {
  if (!property) return null
  const color = STATUS_COLOR[property.status] ?? '#6b7280'
  return (
    <div style={{
      position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
      background: '#1f2937', border: '1.5px solid #374151', borderRadius: 12,
      boxShadow: '0 8px 30px rgba(0,0,0,0.6)', zIndex: 900,
      width: 'min(360px, calc(100% - 32px))',
      padding: '14px 16px',
    }}>
      <button
        type="button"
        onClick={onClose}
        style={{
          position: 'absolute', top: 10, right: 12,
          background: '#374151', border: 'none', borderRadius: '50%',
          width: 26, height: 26, color: '#9ca3af', cursor: 'pointer',
          fontSize: '0.85rem', fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >✕</button>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {property.cover_image && (
          <img
            src={property.cover_image}
            alt={property.title}
            style={{ width: 80, height: 64, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <span style={{ color: '#f3f4f6', fontWeight: 700, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {property.title}
            </span>
          </div>
          <div style={{ color, fontWeight: 700, fontSize: '0.85rem', marginBottom: 2 }}>
            {formatPrice(property.price)}
          </div>
          {property.address && (
            <div style={{ color: '#9ca3af', fontSize: '0.75rem', marginBottom: 8 }}>📍 {property.address}</div>
          )}
          <button
            type="button"
            onClick={onViewDetail}
            style={{
              background: '#3b82f6', color: '#fff', border: 'none',
              borderRadius: 7, padding: '5px 12px', fontSize: '0.78rem',
              fontWeight: 600, cursor: 'pointer',
            }}
          >
            View Details →
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PropertiesPage() {
  const { admin } = useAuth()
  const navigate  = useNavigate()

  const [appUser, setAppUser]           = useState(null)
  const [userLoading, setUserLoading]   = useState(true)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [profileOpen, setProfileOpen]   = useState(false)
  const profileRef = useRef(null)

  const [properties, setProperties]     = useState([])
  const [loading, setLoading]           = useState(true)
  const [statusFilter, setStatusFilter] = useState('')  // '' = all
  const [selectedId, setSelectedId]     = useState(null)
  const [previewProp, setPreviewProp]   = useState(null)
  const [viewMode, setViewMode]         = useState('map')  // 'map' | 'grid'
  const [userLocation, setUserLocation] = useState(null)

  // Load user
  useEffect(() => {
    getUserProfile()
      .then(u => setAppUser(u))
      .catch(() => setAppUser(false))
      .finally(() => setUserLoading(false))
  }, [])

  // Close profile dropdown on outside click
  useEffect(() => {
    const h = (e) => { if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // Request geolocation
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {},
        { timeout: 5000 },
      )
    }
  }, [])

  // Fetch properties
  const fetchProperties = useCallback(async () => {
    setLoading(true)
    try {
      const params = {}
      if (statusFilter) params.status = statusFilter
      const data = await listProperties(params)
      setProperties(data.properties ?? [])
    } catch {
      setProperties([])
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { fetchProperties() }, [fetchProperties])

  const handleMarkerClick = useCallback((prop) => {
    setSelectedId(prop.property_id)
    setPreviewProp(prop)
  }, [])

  const handleCardClick = useCallback((prop) => {
    setSelectedId(prop.property_id)
    setPreviewProp(prop)
  }, [])

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {showAuthModal && !appUser && (
        <UserAuth
          onSuccess={u => { setAppUser(u); setShowAuthModal(false) }}
          onClose={() => setShowAuthModal(false)}
        />
      )}

      {/* ── Navbar ── */}
      <header style={{
        background: '#111827',
        borderBottom: '1px solid #1f2937',
        padding: '12px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link to="/" style={{ color: '#3b82f6', fontWeight: 800, fontSize: '1.15rem', textDecoration: 'none' }}>
            🏠 YOT
          </Link>
          <nav style={{ display: 'flex', gap: 12 }}>
            <Link to="/" style={{ color: '#9ca3af', fontSize: '0.85rem', textDecoration: 'none' }}>Home</Link>
            <Link to="/properties" style={{ color: '#3b82f6', fontSize: '0.85rem', fontWeight: 600, textDecoration: 'none' }}>Properties</Link>
            <Link to="/property-inbox" style={{ color: '#9ca3af', fontSize: '0.85rem', textDecoration: 'none' }}>Inbox</Link>
          </nav>
        </div>
        <div ref={profileRef} style={{ position: 'relative' }}>
          {userLoading ? null : appUser ? (
            <div>
              <button
                type="button"
                onClick={() => setProfileOpen(o => !o)}
                style={{
                  background: '#1f2937', border: '1px solid #374151', borderRadius: 8,
                  padding: '6px 12px', color: '#d1d5db', fontSize: '0.82rem', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                {appUser.avatar_url ? (
                  <img src={appUser.avatar_url} alt="" style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ fontSize: '1rem' }}>👤</span>
                )}
                {appUser.name}
              </button>
              {profileOpen && (
                <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 200 }}>
                  <UserProfile user={appUser} onUpdate={u => { setAppUser(u); setProfileOpen(false) }} />
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowAuthModal(true)}
              style={{
                background: '#3b82f6', color: '#fff', border: 'none',
                borderRadius: 8, padding: '7px 16px', fontSize: '0.82rem',
                fontWeight: 600, cursor: 'pointer',
              }}
            >
              Sign In
            </button>
          )}
        </div>
      </header>

      {/* ── Page header ── */}
      <div style={{ padding: '20px 24px 0', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ color: '#f3f4f6', fontSize: '1.5rem', fontWeight: 800, margin: 0 }}>Property Discovery</h1>
          <p style={{ color: '#6b7280', fontSize: '0.85rem', margin: '4px 0 0' }}>
            {properties.length} propert{properties.length !== 1 ? 'ies' : 'y'} found
          </p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            style={{
              background: '#1f2937', color: '#d1d5db', border: '1px solid #374151',
              borderRadius: 8, padding: '7px 12px', fontSize: '0.82rem', cursor: 'pointer',
            }}
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="sold">Sold</option>
            <option value="rented">Rented</option>
          </select>
          {/* View toggle */}
          <div style={{ display: 'flex', gap: 2, background: '#1f2937', border: '1px solid #374151', borderRadius: 8, overflow: 'hidden' }}>
            {[['map','🗺 Map'], ['grid','⊞ Grid']].map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                style={{
                  background: viewMode === mode ? '#3b82f6' : 'transparent',
                  color: viewMode === mode ? '#fff' : '#9ca3af',
                  border: 'none', padding: '7px 14px', fontSize: '0.82rem',
                  fontWeight: 600, cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: 'flex', gap: 0, padding: '16px 24px 24px', minHeight: 0 }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
            <div className="spinner w-10 h-10" />
          </div>
        ) : viewMode === 'map' ? (
          /* ── Map + list layout ── */
          <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0, alignItems: 'flex-start' }}>
            {/* Map */}
            <div style={{ flex: '1 1 55%', position: 'relative', borderRadius: 14, overflow: 'hidden', minHeight: 480, border: '1px solid #374151' }}>
              <PropertyMap
                properties={properties}
                selectedId={selectedId}
                onSelectProperty={handleMarkerClick}
                userLocation={userLocation}
              />
              <PropertyPreviewCard
                property={previewProp}
                onClose={() => setPreviewProp(null)}
                onViewDetail={() => navigate(`/properties/${previewProp.property_id}`)}
              />
            </div>

            {/* Sidebar list */}
            <div style={{ flex: '0 0 320px', display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 600, overflowY: 'auto' }}>
              {properties.length === 0 ? (
                <div style={{ color: '#6b7280', textAlign: 'center', padding: '40px 16px' }}>
                  No properties found.
                </div>
              ) : properties.map(prop => (
                <PropertyCard
                  key={prop.property_id}
                  property={prop}
                  isSelected={prop.property_id === selectedId}
                  onClick={() => handleCardClick(prop)}
                />
              ))}
            </div>
          </div>
        ) : (
          /* ── Grid layout ── */
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 16,
            flex: 1,
            alignContent: 'start',
          }}>
            {properties.length === 0 ? (
              <div style={{ color: '#6b7280', textAlign: 'center', padding: '40px 16px', gridColumn: '1/-1' }}>
                No properties found.
              </div>
            ) : properties.map(prop => (
              <PropertyCard
                key={prop.property_id}
                property={prop}
                isSelected={prop.property_id === selectedId}
                onClick={() => handleCardClick(prop)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
