/**
 * PropertyDetailPage — Full property detail with image gallery, description,
 * location map preview, and agent list (max 4) with contact buttons.
 */

import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../App'
import UserAuth from '../components/UserAuth'
import UserProfile from '../components/UserProfile'
import { getProperty, startPropertyConversation, getUserProfile } from '../api'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon   from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({ iconRetinaUrl: markerIcon2x, iconUrl: markerIcon, shadowUrl: markerShadow })

const STATUS_COLOR = { active: '#22c55e', sold: '#ef4444', rented: '#f59e0b' }
const STATUS_LABEL = { active: 'Active', sold: 'Sold', rented: 'Rented' }
const AVAIL_COLOR  = { available: '#22c55e', busy: '#f59e0b', offline: '#6b7280' }
const AVAIL_LABEL  = { available: 'Available', busy: 'Busy', offline: 'Offline' }

function formatPrice(price) {
  if (!price) return 'Price on Application'
  return '£' + Number(price).toLocaleString('en-GB') + ' /mo'
}

function _stars(rating) {
  const full  = Math.floor(rating ?? 0)
  const half  = (rating ?? 0) - full >= 0.5 ? 1 : 0
  const empty = 5 - full - half
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty)
}

// ─── Mini map showing property location ──────────────────────────────────────

function PropertyMiniMap({ lat, lng, title }) {
  const mapRef = useRef(null)
  const instRef = useRef(null)

  useEffect(() => {
    if (instRef.current || !mapRef.current || lat == null || lng == null) return
    const map = L.map(mapRef.current, { zoomControl: false, scrollWheelZoom: false, dragging: false, touchZoom: false })
    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      {
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions" target="_blank">CARTO</a>',
        maxZoom: 19,
        subdomains: 'abcd',
      }
    ).addTo(map)
    map.setView([lat, lng], 14)
    L.marker([lat, lng]).addTo(map).bindTooltip(title ?? 'Property', { permanent: false })
    instRef.current = map
    return () => { map.remove(); instRef.current = null }
  }, [lat, lng, title]) // eslint-disable-line react-hooks/exhaustive-deps

  if (lat == null || lng == null) return null
  return (
    <div
      ref={mapRef}
      style={{ width: '100%', height: 200, borderRadius: 10, overflow: 'hidden', border: '1px solid #374151', marginTop: 12 }}
    />
  )
}

// ─── Image Gallery ────────────────────────────────────────────────────────────

function ImageGallery({ images, title }) {
  const [current, setCurrent] = useState(0)
  if (!images || images.length === 0) {
    return (
      <div style={{
        background: '#374151', borderRadius: 12, height: 280,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '4rem',
      }}>🏠</div>
    )
  }
  return (
    <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden' }}>
      <img
        src={images[current]}
        alt={`${title} ${current + 1}`}
        style={{ width: '100%', height: 320, objectFit: 'cover', display: 'block' }}
      />
      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => setCurrent(c => (c - 1 + images.length) % images.length)}
            style={{
              position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
              background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none',
              borderRadius: '50%', width: 36, height: 36, fontSize: '1.1rem',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >‹</button>
          <button
            type="button"
            onClick={() => setCurrent(c => (c + 1) % images.length)}
            style={{
              position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
              background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none',
              borderRadius: '50%', width: 36, height: 36, fontSize: '1.1rem',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >›</button>
          {/* Thumbnails */}
          <div style={{
            position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)',
            display: 'flex', gap: 6,
          }}>
            {images.map((img, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setCurrent(i)}
                style={{
                  width: 8, height: 8, borderRadius: '50%', border: 'none',
                  background: i === current ? '#fff' : 'rgba(255,255,255,0.4)',
                  cursor: 'pointer', padding: 0,
                }}
              />
            ))}
          </div>
        </>
      )}
      <div style={{
        position: 'absolute', bottom: 10, right: 12,
        background: 'rgba(0,0,0,0.6)', color: '#fff', borderRadius: 6,
        padding: '2px 8px', fontSize: '0.75rem',
      }}>
        {current + 1} / {images.length}
      </div>
    </div>
  )
}

// ─── Agent Card ───────────────────────────────────────────────────────────────

function AgentCard({ agent, onContact, contacting }) {
  const avColor = AVAIL_COLOR[agent.availability_status] ?? '#6b7280'
  return (
    <div style={{
      background: '#1f2937', border: '1px solid #374151', borderRadius: 12,
      padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {/* Avatar */}
        <div style={{
          width: 48, height: 48, borderRadius: '50%', background: '#374151',
          fontSize: '1.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          {agent.avatar ?? '👤'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ color: '#f3f4f6', fontWeight: 700, fontSize: '0.9rem' }}>{agent.name}</span>
            <span title={AVAIL_LABEL[agent.availability_status]} style={{
              display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
              background: avColor, flexShrink: 0,
            }} />
            <span style={{ color: avColor, fontSize: '0.72rem', fontWeight: 600 }}>
              {AVAIL_LABEL[agent.availability_status] ?? agent.availability_status}
            </span>
          </div>
          {agent.avg_rating != null && (
            <div style={{ color: '#f59e0b', fontSize: '0.78rem', marginTop: 2 }}>
              {_stars(agent.avg_rating)}
              <span style={{ color: '#9ca3af', marginLeft: 4 }}>
                ({agent.review_count ?? 0} review{(agent.review_count ?? 0) !== 1 ? 's' : ''})
              </span>
            </div>
          )}
          {agent.bio && (
            <p style={{ color: '#9ca3af', fontSize: '0.77rem', margin: '4px 0 0', lineHeight: 1.5,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {agent.bio}
            </p>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onContact(agent)}
        disabled={contacting === agent.agent_id}
        style={{
          background: contacting === agent.agent_id ? '#374151' : '#10b981',
          color: '#fff', border: 'none', borderRadius: 8,
          padding: '8px 0', fontSize: '0.82rem', fontWeight: 600,
          cursor: contacting === agent.agent_id ? 'wait' : 'pointer',
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}
      >
        {contacting === agent.agent_id ? '…' : '💬 Contact Agent'}
      </button>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PropertyDetailPage() {
  const { propertyId } = useParams()
  const navigate       = useNavigate()
  const { admin }      = useAuth()

  const [appUser, setAppUser]             = useState(null)
  const [userLoading, setUserLoading]     = useState(true)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [profileOpen, setProfileOpen]     = useState(false)
  const profileRef = useRef(null)

  const [property, setProperty]       = useState(null)
  const [propLoading, setPropLoading] = useState(true)
  const [propError, setPropError]     = useState(null)
  const [contacting, setContacting]   = useState(null)

  // Load user
  useEffect(() => {
    getUserProfile()
      .then(u => setAppUser(u))
      .catch(() => setAppUser(false))
      .finally(() => setUserLoading(false))
  }, [])

  // Close profile on outside click
  useEffect(() => {
    const h = (e) => { if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // Load property
  useEffect(() => {
    if (!propertyId) return
    setPropLoading(true)
    getProperty(propertyId)
      .then(data => {
        if (data?.property) setProperty(data.property)
        else setPropError('Property not found.')
      })
      .catch(() => setPropError('Failed to load property.'))
      .finally(() => setPropLoading(false))
  }, [propertyId])

  const handleContactAgent = async (agent) => {
    if (!appUser) { setShowAuthModal(true); return }
    setContacting(agent.agent_id)
    try {
      const data = await startPropertyConversation(propertyId, agent.agent_id)
      if (data?.conv?.conv_id) {
        navigate(`/property-inbox?conv=${data.conv.conv_id}`)
      }
    } catch {
      // silent
    } finally {
      setContacting(null)
    }
  }

  const statusColor = STATUS_COLOR[property?.status] ?? '#6b7280'

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
        background: '#111827', borderBottom: '1px solid #1f2937',
        padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link to="/" style={{ color: '#3b82f6', fontWeight: 800, fontSize: '1.15rem', textDecoration: 'none' }}>
            🏠 YOT
          </Link>
          <nav style={{ display: 'flex', gap: 12 }}>
            <Link to="/" style={{ color: '#9ca3af', fontSize: '0.85rem', textDecoration: 'none' }}>Home</Link>
            <Link to="/properties" style={{ color: '#9ca3af', fontSize: '0.85rem', textDecoration: 'none' }}>Properties</Link>
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
                ) : <span>👤</span>}
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
                borderRadius: 8, padding: '7px 16px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer',
              }}
            >Sign In</button>
          )}
        </div>
      </header>

      {/* ── Breadcrumb ── */}
      <div style={{ padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: '#6b7280' }}>
        <Link to="/properties" style={{ color: '#3b82f6', textDecoration: 'none' }}>Properties</Link>
        <span>›</span>
        <span style={{ color: '#9ca3af' }}>{property?.title ?? '…'}</span>
      </div>

      {propLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <div className="spinner w-10 h-10" />
        </div>
      ) : propError ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#ef4444' }}>
          {propError}
          <br />
          <Link to="/properties" style={{ color: '#3b82f6', marginTop: 12, display: 'inline-block' }}>← Back to Listings</Link>
        </div>
      ) : property && (
        <div style={{ padding: '0 24px 40px', maxWidth: 1100, margin: '0 auto', width: '100%' }}>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>

            {/* ── LEFT: property details ── */}
            <div style={{ flex: '1 1 0', minWidth: 280 }}>
              <ImageGallery images={property.images} title={property.title} />

              <div style={{ marginTop: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                  <h1 style={{ color: '#f3f4f6', fontSize: '1.4rem', fontWeight: 800, margin: 0, flex: 1 }}>
                    {property.title}
                  </h1>
                  <span style={{
                    background: `${statusColor}22`, color: statusColor,
                    border: `1px solid ${statusColor}44`,
                    borderRadius: 9999, padding: '3px 12px', fontSize: '0.78rem', fontWeight: 700,
                  }}>
                    {STATUS_LABEL[property.status] ?? property.status}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
                  <span style={{ color: '#22c55e', fontSize: '1.4rem', fontWeight: 800 }}>
                    {formatPrice(property.price)}
                  </span>
                  {property.address && (
                    <span style={{ color: '#9ca3af', fontSize: '0.85rem' }}>
                      📍 {property.address}
                    </span>
                  )}
                </div>

                {property.description && (
                  <div style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
                    <h2 style={{ color: '#f3f4f6', fontSize: '0.95rem', fontWeight: 700, margin: '0 0 8px' }}>Description</h2>
                    <p style={{ color: '#d1d5db', fontSize: '0.88rem', lineHeight: 1.7, margin: 0, whiteSpace: 'pre-line' }}>
                      {property.description}
                    </p>
                  </div>
                )}

                <PropertyMiniMap lat={property.lat} lng={property.lng} title={property.title} />
              </div>
            </div>

            {/* ── RIGHT: agent list ── */}
            <div style={{ flex: '0 0 300px', minWidth: 260 }}>
              <div style={{
                background: '#111827', border: '1px solid #374151', borderRadius: 14,
                padding: '18px 16px', position: 'sticky', top: 80,
              }}>
                <h2 style={{ color: '#f3f4f6', fontSize: '1rem', fontWeight: 700, margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>👨‍💼</span> Listed Agents
                  {property.agents && property.agents.length > 0 && (
                    <span style={{ color: '#6b7280', fontSize: '0.8rem', fontWeight: 400 }}>
                      ({property.agents.length})
                    </span>
                  )}
                </h2>

                {property.agents && property.agents.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {property.agents.map(agent => (
                      <AgentCard
                        key={agent.agent_id}
                        agent={agent}
                        onContact={handleContactAgent}
                        contacting={contacting}
                      />
                    ))}
                  </div>
                ) : (
                  <div style={{ color: '#6b7280', fontSize: '0.85rem', textAlign: 'center', padding: '20px 0' }}>
                    No agents assigned to this property.
                  </div>
                )}

                {!appUser && (
                  <p style={{ color: '#6b7280', fontSize: '0.75rem', textAlign: 'center', marginTop: 12 }}>
                    <button
                      type="button"
                      onClick={() => setShowAuthModal(true)}
                      style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: '0.75rem' }}
                    >
                      Sign in
                    </button>
                    {' '}to contact agents
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
