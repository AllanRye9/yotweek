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
import { listProperties, listAgents, getUserProfile } from '../api'
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

const AVAIL_COLOR = { available: '#22c55e', busy: '#f59e0b', offline: 'var(--text-secondary)' }
const AVAIL_LABEL = { available: 'Available', busy: 'Busy', offline: 'Offline' }

function _haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatPrice(price) {
  if (!price) return 'POA'
  return '£' + Number(price).toLocaleString('en-GB') + '/mo'
}

function _buildMarkerIcon(property, isSelected) {
  const color  = STATUS_COLOR[property.status] ?? 'var(--text-secondary)'
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

// ─── PropertyMap ─────────────────────────────────────────────────────────────

function PropertyMap({ properties, selectedId, onSelectProperty, userLocation }) {
  const mapRef      = useRef(null)
  const instanceRef = useRef(null)
  const markersRef  = useRef({})
  const userMarkerRef = useRef(null)

  // Init map once
  useEffect(() => {
    if (instanceRef.current || !mapRef.current) return
    const center = userLocation ? [userLocation.lat, userLocation.lng] : [51.505, -0.09]
    const map = L.map(mapRef.current, { zoomControl: true, scrollWheelZoom: true })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)
    map.setView(center, 11)
    instanceRef.current = map
    return () => { map.remove(); instanceRef.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  return <div ref={mapRef} style={{ width: '100%', height: '100%', minHeight: 320 }} />
}

// ─── Property Card ────────────────────────────────────────────────────────────

function PropertyCard({ property, isSelected, onClick }) {
  const navigate = useNavigate()
  const color = STATUS_COLOR[property.status] ?? 'var(--text-secondary)'
  return (
    <div
      onClick={onClick}
      className="prop-card-enter prop-card-hover"
      style={{
        background: isSelected ? 'rgba(59,130,246,0.13)' : 'var(--bg-card)',
        border: `1.5px solid ${isSelected ? '#3b82f6' : 'var(--border-color)'}`,
        borderRadius: 12,
        overflow: 'hidden',
        cursor: 'pointer',
        boxShadow: isSelected ? '0 0 0 2px rgba(59,130,246,0.25)' : '0 1px 4px rgba(0,0,0,0.08)',
      }}
    >
      {/* Cover image */}
      <div style={{ position: 'relative', height: 160, background: 'var(--bg-input)', overflow: 'hidden' }}>
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
          color: 'var(--text-primary)',
          borderRadius: 8,
          padding: '3px 10px',
          fontSize: '0.85rem',
          fontWeight: 700,
        }}>
          {formatPrice(property.price)}
        </span>
      </div>

      <div style={{ padding: '12px 14px 14px' }}>
        <h3 style={{ color: 'var(--text-primary)', fontSize: '0.95rem', fontWeight: 700, margin: '0 0 4px', lineHeight: 1.3 }}>
          {property.title}
        </h3>
        {property.address && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', margin: '0 0 8px' }}>
            📍 {property.address}
          </p>
        )}
        {property.description && (
          <p style={{ color: 'var(--text-primary)', fontSize: '0.8rem', margin: '0 0 10px', lineHeight: 1.5,
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
  const color = STATUS_COLOR[property.status] ?? 'var(--text-secondary)'
  return (
    <div style={{
      position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
      background: 'var(--bg-input)', border: '1.5px solid var(--border-color)', borderRadius: 12,
      boxShadow: '0 8px 30px rgba(0,0,0,0.6)', zIndex: 900,
      width: 'min(360px, calc(100% - 32px))',
      padding: '14px 16px',
    }}>
      <button
        type="button"
        onClick={onClose}
        style={{
          position: 'absolute', top: 10, right: 12,
          background: 'var(--bg-input)', border: 'none', borderRadius: '50%',
          width: 26, height: 26, color: 'var(--text-secondary)', cursor: 'pointer',
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
            <span style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {property.title}
            </span>
          </div>
          <div style={{ color, fontWeight: 700, fontSize: '0.85rem', marginBottom: 2 }}>
            {formatPrice(property.price)}
          </div>
          {property.address && (
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: 8 }}>📍 {property.address}</div>
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

// ─── Nearest Agents Panel ────────────────────────────────────────────────────

function NearestAgentsPanel({ userLocation }) {
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listAgents()
      .then(d => setAgents(d.agents ?? []))
      .catch(() => setAgents([]))
      .finally(() => setLoading(false))
  }, [])

  const sorted = [...agents]
    .map(a => ({
      ...a,
      _dist: userLocation && a.lat != null
        ? _haversineKm(userLocation.lat, userLocation.lng, a.lat, a.lng)
        : null,
    }))
    .sort((a, b) => {
      const order = { available: 0, busy: 1, offline: 2 }
      const oa = order[a.availability_status] ?? 3
      const ob = order[b.availability_status] ?? 3
      if (oa !== ob) return oa - ob
      return (a._dist ?? 9999) - (b._dist ?? 9999)
    })

  return (
    <div>
      <h3 style={{ color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 700, margin: '0 0 10px' }}>
        🧑‍💼 Nearest Agents
      </h3>
      {loading ? (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div className="spinner w-6 h-6" />
        </div>
      ) : sorted.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center', padding: '16px 0' }}>
          No agents available.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sorted.slice(0, 6).map(a => (
            <div key={a.agent_id ?? a.id} style={{
              background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 10,
              padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: '50%', background: 'var(--bg-input)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.3rem', flexShrink: 0, position: 'relative',
              }}>
                {a.avatar ?? '🧑‍💼'}
                <span style={{
                  position: 'absolute', bottom: 0, right: 0,
                  width: 10, height: 10, borderRadius: '50%',
                  background: AVAIL_COLOR[a.availability_status] ?? 'var(--text-secondary)',
                  border: '2px solid var(--border-color)',
                }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'var(--text-primary)', fontSize: '0.82rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {a.name}
                </div>
                <div style={{ color: AVAIL_COLOR[a.availability_status] ?? 'var(--text-secondary)', fontSize: '0.72rem', fontWeight: 600 }}>
                  {AVAIL_LABEL[a.availability_status] ?? a.availability_status}
                </div>
                {a._dist != null && (
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}>📍 {a._dist.toFixed(1)} km</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
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
  const [userLocation, setUserLocation] = useState(null)
  // Mobile panel tab: 'map' | 'list' | 'agents'
  const [mobileTab, setMobileTab]       = useState('map')

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
    <div style={{ minHeight: '100vh', background: 'var(--bg-page)', display: 'flex', flexDirection: 'column' }}>
      {showAuthModal && !appUser && (
        <UserAuth
          onSuccess={u => { setAppUser(u); setShowAuthModal(false) }}
          onClose={() => setShowAuthModal(false)}
        />
      )}

      {/* ── Navbar ── */}
      <header style={{
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-color)',
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
            <Link to="/" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textDecoration: 'none' }}>Home</Link>
            <Link to="/properties" style={{ color: '#3b82f6', fontSize: '0.85rem', fontWeight: 600, textDecoration: 'none' }}>Properties</Link>
            <Link to="/property-inbox" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textDecoration: 'none' }}>Inbox</Link>
          </nav>
        </div>
        <div ref={profileRef} style={{ position: 'relative' }}>
          {userLoading ? null : appUser ? (
            <div>
              <button
                type="button"
                onClick={() => setProfileOpen(o => !o)}
                style={{
                  background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 8,
                  padding: '6px 12px', color: 'var(--text-primary)', fontSize: '0.82rem', cursor: 'pointer',
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
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ color: 'var(--text-primary)', fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>🏠 Property Discovery</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', margin: '2px 0 0' }}>
            {properties.length} propert{properties.length !== 1 ? 'ies' : 'y'} found
          </p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            style={{
              background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)',
              borderRadius: 8, padding: '6px 10px', fontSize: '0.8rem', cursor: 'pointer',
            }}
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="sold">Sold</option>
            <option value="rented">Rented</option>
          </select>
        </div>
      </div>

      {/* ── 3-column layout ── */}
      <div className="prop-page-layout" style={{ flex: 1, display: 'flex', minHeight: 0, height: 'calc(100vh - 110px)' }}>

        {/* ── Mobile tab bar (visible only on small screens) ── */}
        <div className="prop-mobile-tabs" role="tablist">
          {[
            { id: 'list',   icon: '📋', label: 'Properties' },
            { id: 'map',    icon: '🗺️', label: 'Map' },
            { id: 'agents', icon: '👤', label: 'Agents' },
          ].map(tab => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={mobileTab === tab.id}
              className={`prop-mobile-tab-btn${mobileTab === tab.id ? ' active' : ''}`}
              onClick={() => setMobileTab(tab.id)}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* ── Left: Available Properties ── */}
        <aside
          className={`prop-left-sidebar${mobileTab !== 'list' ? ' prop-panel-hidden-mobile' : ''}`}
          style={{
            width: 280, flexShrink: 0,
            borderRight: '1px solid var(--border-color)',
            overflowY: 'auto',
            background: 'var(--bg-surface)',
            display: 'flex', flexDirection: 'column',
          }}
        >
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 700 }}>📋 Available Properties</div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
                <div className="spinner w-7 h-7" />
              </div>
            ) : properties.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '24px 8px', fontSize: '0.82rem' }}>
                No properties found.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {properties.map(prop => (
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
        </aside>

        {/* ── Center: Map ── */}
        <main
          className={`prop-center-col${mobileTab !== 'map' ? ' prop-panel-hidden-mobile' : ''}`}
          style={{ flex: 1, position: 'relative', minWidth: 0, height: '100%' }}
        >
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
        </main>

        {/* ── Right: Nearest Agents ── */}
        <aside
          className={`prop-right-sidebar${mobileTab !== 'agents' ? ' prop-panel-hidden-mobile' : ''}`}
          style={{
            width: 280, flexShrink: 0,
            borderLeft: '1px solid var(--border-color)',
            overflowY: 'auto',
            background: 'var(--bg-surface)',
            display: 'flex', flexDirection: 'column',
          }}
        >
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 700 }}>📊 Nearest Agents</div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 10px' }}>
            <NearestAgentsPanel userLocation={userLocation} />
          </div>
        </aside>
      </div>
    </div>
  )
}
