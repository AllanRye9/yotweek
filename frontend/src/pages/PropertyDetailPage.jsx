/**
 * PropertyDetailPage — Full property detail with image gallery, description,
 * location map preview, and agent list (max 4) with contact buttons.
 *
 * Non-authenticated visitors see a focused, non-interactive map preview with
 * a sign-in prompt overlay instead of the full property details.  After
 * successful authentication they are automatically redirected back to this
 * page so the full view is instantly revealed.
 */

import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../App'
import UserAuth from '../components/UserAuth'
import UserProfile from '../components/UserProfile'
import AgentRegistration from '../components/AgentRegistration'
import { getProperty, startPropertyConversation, getUserProfile, getNearbyAgents } from '../api'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon   from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({ iconRetinaUrl: markerIcon2x, iconUrl: markerIcon, shadowUrl: markerShadow })

const STATUS_COLOR = { active: '#22c55e', sold: '#ef4444', rented: '#f59e0b', empty: '#60a5fa', occupied: '#f87171', soon_empty: '#a78bfa' }
const STATUS_LABEL = { active: 'Active', sold: 'Sold', rented: 'Rented', empty: 'Empty', occupied: 'Occupied', soon_empty: 'Soon Empty' }
const AVAIL_COLOR  = { available: '#22c55e', busy: '#f59e0b', offline: 'var(--text-secondary)' }
const AVAIL_LABEL  = { available: 'Available', busy: 'Busy', offline: 'Offline' }

const OCCUPANCY_COLOR = { empty: '#60a5fa', occupied: '#f87171', soon_empty: '#a78bfa' }
const OCCUPANCY_LABEL = { empty: 'Empty', occupied: 'Occupied', soon_empty: 'Soon Empty' }

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
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 19,
    }).addTo(map)
    map.setView([lat, lng], 14)
    L.marker([lat, lng]).addTo(map).bindTooltip(title ?? 'Property', { permanent: false })
    instRef.current = map
    return () => { map.remove(); instRef.current = null }
  }, [lat, lng, title]) // eslint-disable-line react-hooks/exhaustive-deps

  if (lat == null || lng == null) return null
  return (
    <div
      ref={mapRef}
      style={{ width: '100%', height: 200, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border-color)', marginTop: 12 }}
    />
  )
}

// ─── Sign-in map preview shown to unauthenticated visitors ───────────────────
//
// Renders a non-interactive map centred on the property's location with a
// semi-transparent overlay prompting the user to sign in.  Panning and
// zooming are intentionally disabled to preserve the teaser experience.

function PropertySignInMapPreview({ lat, lng, title, onSignIn, onSignUp }) {
  const mapRef = useRef(null)
  const instRef = useRef(null)

  useEffect(() => {
    if (instRef.current || !mapRef.current || lat == null || lng == null) return
    // Fully locked-down map: no interaction at all
    const map = L.map(mapRef.current, {
      zoomControl: false,
      scrollWheelZoom: false,
      dragging: false,
      touchZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
    })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 19,
    }).addTo(map)
    map.setView([lat, lng], 15)
    // Clean location pin — no interactive popup, just a static tooltip
    const marker = L.marker([lat, lng])
    marker.addTo(map)
    if (title) marker.bindTooltip(title, { permanent: true, direction: 'top', offset: [0, -10] })
    instRef.current = map
    return () => { map.remove(); instRef.current = null }
  }, [lat, lng, title]) // eslint-disable-line react-hooks/exhaustive-deps

  if (lat == null || lng == null) return null

  return (
    <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', marginTop: 16 }}>
      {/* Non-interactive map */}
      <div
        ref={mapRef}
        style={{ width: '100%', height: 380, background: 'var(--bg-surface)' }}
      />
      {/* Semi-transparent overlay with sign-in CTA */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.72) 100%)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'flex-end',
        padding: '0 24px 32px',
        pointerEvents: 'none', // let map handle any stray pointer events
      }}>
        <div style={{
          background: 'rgba(17,24,39,0.92)',
          border: '1px solid rgba(55,65,81,0.8)',
          borderRadius: 14,
          padding: '20px 24px',
          maxWidth: 380,
          width: '100%',
          textAlign: 'center',
          pointerEvents: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          <p style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1rem', margin: '0 0 6px' }}>
            📍 {title ?? 'Property Location'}
          </p>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.84rem', margin: '0 0 16px', lineHeight: 1.5 }}>
            Sign in to view property details, contact the agent, and see availability.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button
              type="button"
              onClick={onSignIn}
              style={{
                background: '#3b82f6', color: '#fff', border: 'none',
                borderRadius: 8, padding: '9px 22px',
                fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
                minWidth: 100,
              }}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={onSignUp}
              style={{
                background: 'transparent', color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 8, padding: '9px 22px',
                fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
                minWidth: 100,
              }}
            >
              Sign Up
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Image Gallery ────────────────────────────────────────────────────────────

function ImageGallery({ images, title }) {
  const [current, setCurrent] = useState(0)
  if (!images || images.length === 0) {
    return (
      <div style={{
        background: 'var(--bg-input)', borderRadius: 12, height: 280,
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
  const [expanded, setExpanded] = useState(false)
  const avColor = AVAIL_COLOR[agent.availability_status] ?? 'var(--text-secondary)'
  return (
    <div style={{
      background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 12,
      padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10,
      transition: 'box-shadow 0.2s',
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {/* Avatar */}
        <div style={{
          width: 48, height: 48, borderRadius: '50%', background: 'var(--bg-input)',
          fontSize: '1.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          {agent.avatar ?? '👤'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.9rem' }}>{agent.name}</span>
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
              <span style={{ color: 'var(--text-secondary)', marginLeft: 4 }}>
                ({agent.review_count ?? 0} review{(agent.review_count ?? 0) !== 1 ? 's' : ''})
              </span>
            </div>
          )}
          {agent.bio && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.77rem', margin: '4px 0 0', lineHeight: 1.5,
              display: '-webkit-box', WebkitLineClamp: expanded ? 'none' : 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {agent.bio}
            </p>
          )}
        </div>
      </div>

      {/* Expanded profile details */}
      {expanded && (
        <div style={{
          background: 'var(--bg-surface)', borderRadius: 8, padding: '10px 12px',
          display: 'flex', flexDirection: 'column', gap: 6,
          animation: 'agent-profile-expand 0.2s ease-out',
        }}>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
            Agent Profile
          </p>
          {agent.like_count != null && agent.like_count > 0 && (
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
              ❤️ <span style={{ color: 'var(--text-primary)' }}>{agent.like_count}</span> recommendation{agent.like_count !== 1 ? 's' : ''}
            </div>
          )}
          {agent.created_at && (
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
              📅 Member since{' '}
              <span style={{ color: 'var(--text-primary)' }}>
                {new Date(agent.created_at).toLocaleDateString('en-GB', { year: 'numeric', month: 'short' })}
              </span>
            </div>
          )}
          {agent.review_count > 0 && (
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
              ⭐ Avg rating{' '}
              <span style={{ color: '#f59e0b', fontWeight: 700 }}>{(agent.avg_rating ?? 0).toFixed(1)}</span>
              {' '}/ 5
            </div>
          )}
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.72rem', marginTop: 4, margin: 0 }}>
            To get in touch, use the message button below.
          </p>
        </div>
      )}

      {/* Action row */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          style={{
            background: 'var(--bg-input)', color: 'var(--text-primary)', border: 'none', borderRadius: 8,
            padding: '8px 12px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, flexShrink: 0,
            transition: 'background 0.15s',
          }}
          aria-expanded={expanded}
          aria-label={expanded ? 'Hide profile' : 'View profile'}
        >
          {expanded ? '▲ Less' : '👤 Profile'}
        </button>
        <button
          type="button"
          onClick={() => onContact(agent)}
          disabled={contacting === agent.agent_id}
          style={{
            background: contacting === agent.agent_id ? 'var(--bg-input)' : '#10b981',
            color: '#fff', border: 'none', borderRadius: 8,
            padding: '8px 0', fontSize: '0.82rem', fontWeight: 600,
            cursor: contacting === agent.agent_id ? 'wait' : 'pointer',
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            transition: 'background 0.15s',
          }}
        >
          {contacting === agent.agent_id ? '…' : '💬 Message Agent'}
        </button>
      </div>
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
  const [showAgentModal, setShowAgentModal] = useState(false)
  const [profileOpen, setProfileOpen]     = useState(false)
  const profileRef = useRef(null)

  const [property, setProperty]       = useState(null)
  const [propLoading, setPropLoading] = useState(true)
  const [propError, setPropError]     = useState(null)
  const [contacting, setContacting]   = useState(null)

  // Listed agents "show more" state
  const LISTED_AGENTS_PAGE = 4
  const [listedAgentsShown, setListedAgentsShown] = useState(LISTED_AGENTS_PAGE)

  // Nearby agents state
  const [nearbyAgents, setNearbyAgents]       = useState([])
  const [nearbyTotal, setNearbyTotal]         = useState(0)
  const [nearbyLoading, setNearbyLoading]     = useState(false)
  const [nearbyOffset, setNearbyOffset]       = useState(0)
  const [nearbyRadius, setNearbyRadius]       = useState(8)
  const NEARBY_PAGE = 4

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

  // Load nearby agents (first page) — re-fetch when radius changes
  useEffect(() => {
    if (!propertyId) return
    setNearbyLoading(true)
    setNearbyOffset(0)
    getNearbyAgents(propertyId, NEARBY_PAGE, 0, nearbyRadius)
      .then(data => {
        setNearbyAgents(data.agents ?? [])
        setNearbyTotal(data.total ?? 0)
      })
      .catch(() => {})
      .finally(() => setNearbyLoading(false))
  }, [propertyId, nearbyRadius])

  const handleLoadMoreNearby = () => {
    const newOffset = nearbyOffset + NEARBY_PAGE
    getNearbyAgents(propertyId, NEARBY_PAGE, newOffset, nearbyRadius)
      .then(data => {
        setNearbyAgents(prev => [...prev, ...(data.agents ?? [])])
        setNearbyOffset(newOffset)
      })
      .catch(() => {})
  }

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

  const statusColor = STATUS_COLOR[property?.status] ?? 'var(--text-secondary)'

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {showAuthModal && !appUser && (
        <UserAuth
          onSuccess={u => { setAppUser(u); setShowAuthModal(false) }}
          onClose={() => setShowAuthModal(false)}
        />
      )}

      {/* ── Agent Registration Modal ── */}
      {showAgentModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 500,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '20px',
          }}
          onClick={e => { if (e.target === e.currentTarget) setShowAgentModal(false) }}
        >
          <AgentRegistration onClose={() => setShowAgentModal(false)} />
        </div>
      )}

      {/* ── Navbar ── */}
      <header style={{
        background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-color)',
        padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link to="/" style={{ color: '#3b82f6', fontWeight: 800, fontSize: '1.15rem', textDecoration: 'none' }}>
            🏠 YOT
          </Link>
          <nav style={{ display: 'flex', gap: 12 }}>
            <Link to="/" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textDecoration: 'none' }}>Home</Link>
            <Link to="/properties" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textDecoration: 'none' }}>Properties</Link>
            <Link to="/property-inbox" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textDecoration: 'none' }}>Inbox</Link>
          </nav>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Register as Agent button — always visible in top-right */}
          <button
            type="button"
            onClick={() => appUser ? setShowAgentModal(true) : setShowAuthModal(true)}
            style={{
              background: 'transparent', color: 'var(--text-secondary)',
              border: '1px solid var(--border-color)', borderRadius: 8,
              padding: '6px 12px', fontSize: '0.78rem', fontWeight: 600,
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}
            title="Register as a property agent"
          >
            🏢 Become an Agent
          </button>

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
        </div>
      </header>

      {/* ── Breadcrumb ── */}
      <div style={{ padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
        <Link to="/properties" style={{ color: '#3b82f6', textDecoration: 'none' }}>Properties</Link>
        <span>›</span>
        <span style={{ color: 'var(--text-secondary)' }}>{property?.title ?? '…'}</span>
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
        /* ── Unauthenticated: focused map preview + sign-in prompt ── */
        !appUser && !userLoading ? (
          <div style={{ padding: '0 24px 40px', maxWidth: 700, margin: '0 auto', width: '100%' }}>
            <div style={{ marginBottom: 12 }}>
              <h1 style={{ color: 'var(--text-primary)', fontSize: '1.3rem', fontWeight: 800, margin: '0 0 6px' }}>
                {property.title}
              </h1>
              {property.address && (
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0 }}>📍 {property.address}</p>
              )}
            </div>
            <PropertySignInMapPreview
              lat={property.lat}
              lng={property.lng}
              title={property.title}
              onSignIn={() => setShowAuthModal(true)}
              onSignUp={() => setShowAuthModal(true)}
            />
          </div>
        ) : (
        /* ── Authenticated: full property details ── */
        <div style={{ padding: '0 24px 40px', maxWidth: 1100, margin: '0 auto', width: '100%' }}>
          <div className="property-layout" style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>

            {/* ── LEFT: property details ── */}
            <div style={{ flex: '1 1 0', minWidth: 280 }}>
              <ImageGallery images={property.images} title={property.title} />

              <div style={{ marginTop: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                  <h1 style={{ color: 'var(--text-primary)', fontSize: '1.4rem', fontWeight: 800, margin: 0, flex: 1 }}>
                    {property.title}
                  </h1>
                  <span style={{
                    background: `${statusColor}22`, color: statusColor,
                    border: `1px solid ${statusColor}44`,
                    borderRadius: 9999, padding: '3px 12px', fontSize: '0.78rem', fontWeight: 700,
                  }}>
                    {STATUS_LABEL[property.status] ?? property.status}
                  </span>
                  {property.occupancy_status && OCCUPANCY_LABEL[property.occupancy_status] && (
                    <span style={{
                      background: `${OCCUPANCY_COLOR[property.occupancy_status]}22`,
                      color: OCCUPANCY_COLOR[property.occupancy_status],
                      border: `1px solid ${OCCUPANCY_COLOR[property.occupancy_status]}44`,
                      borderRadius: 9999, padding: '3px 12px', fontSize: '0.78rem', fontWeight: 700,
                    }}>
                      {OCCUPANCY_LABEL[property.occupancy_status]}
                      {property.occupancy_status === 'soon_empty' && property.available_date
                        ? ` · ${property.available_date}`
                        : ''}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
                  <span style={{ color: '#22c55e', fontSize: '1.4rem', fontWeight: 800 }}>
                    {formatPrice(property.price)}
                  </span>
                  {property.address && (
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                      📍 {property.address}
                    </span>
                  )}
                </div>

                {property.description && (
                  <div style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
                    <h2 style={{ color: 'var(--text-primary)', fontSize: '0.95rem', fontWeight: 700, margin: '0 0 8px' }}>Description</h2>
                    <p style={{ color: 'var(--text-primary)', fontSize: '0.88rem', lineHeight: 1.7, margin: 0, whiteSpace: 'pre-line' }}>
                      {property.description}
                    </p>
                  </div>
                )}

                <PropertyMiniMap lat={property.lat} lng={property.lng} title={property.title} />
              </div>
            </div>

            {/* ── RIGHT: agent list ── */}
            <div className="property-agents-panel" style={{ flex: '0 0 300px', minWidth: 260 }}>
              <div style={{
                background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 14,
                padding: '18px 16px', position: 'sticky', top: 80,
              }}>
                <h2 style={{ color: 'var(--text-primary)', fontSize: '1rem', fontWeight: 700, margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>👨‍💼</span> Listed Agents
                  {property.agents && property.agents.length > 0 && (
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 400 }}>
                      ({property.agents.length})
                    </span>
                  )}
                </h2>

                {property.agents && property.agents.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {property.agents.slice(0, listedAgentsShown).map(agent => (
                      <AgentCard
                        key={agent.agent_id}
                        agent={agent}
                        onContact={handleContactAgent}
                        contacting={contacting}
                      />
                    ))}
                    {listedAgentsShown < property.agents.length && (
                      <button
                        type="button"
                        onClick={() => setListedAgentsShown(n => n + LISTED_AGENTS_PAGE)}
                        style={{
                          width: '100%', padding: '8px 0', fontSize: '0.8rem',
                          fontWeight: 600, borderRadius: 8, cursor: 'pointer',
                          background: 'var(--bg-input)', color: 'var(--text-primary)',
                          border: '1px solid var(--border-color)', transition: 'background 0.15s',
                        }}
                      >
                        Show More ({property.agents.length - listedAgentsShown} remaining)
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textAlign: 'center', padding: '20px 0' }}>
                    No agents assigned to this property.
                  </div>
                )}

                {/* ── Nearby Agents ── */}
                <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                    <h2 style={{ color: 'var(--text-primary)', fontSize: '1rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                      <span>📍</span> Nearby Agents
                      {nearbyTotal > 0 && (
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 400 }}>
                          ({nearbyTotal})
                        </span>
                      )}
                    </h2>
                    {/* Distance filter */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <label style={{ color: 'var(--text-secondary)', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                        Within
                      </label>
                      <select
                        value={nearbyRadius}
                        onChange={e => setNearbyRadius(Number(e.target.value))}
                        style={{
                          background: 'var(--bg-input)', color: 'var(--text-primary)',
                          border: '1px solid var(--border-color)', borderRadius: 6,
                          padding: '3px 6px', fontSize: '0.75rem', cursor: 'pointer',
                        }}
                      >
                        {[2, 5, 8, 15, 25, 50].map(km => (
                          <option key={km} value={km}>{km} km</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {nearbyLoading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}>
                      <div className="spinner w-6 h-6" />
                    </div>
                  ) : nearbyAgents.length === 0 ? (
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', textAlign: 'center', padding: '12px 0' }}>
                      No agents found within {nearbyRadius} km.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {nearbyAgents.map(agent => (
                        <div key={agent.agent_id} style={{
                          background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 10,
                          padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10,
                        }}>
                          <div style={{
                            width: 40, height: 40, borderRadius: '50%', background: 'var(--bg-surface)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '1.4rem', flexShrink: 0, position: 'relative',
                          }}>
                            {agent.avatar ?? '👤'}
                            <span style={{
                              position: 'absolute', bottom: 0, right: 0,
                              width: 10, height: 10, borderRadius: '50%',
                              background: AVAIL_COLOR[agent.availability_status] ?? 'var(--text-secondary)',
                              border: '2px solid var(--border-color)',
                            }} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {agent.name}
                            </div>
                            <div style={{ color: AVAIL_COLOR[agent.availability_status] ?? 'var(--text-secondary)', fontSize: '0.72rem', fontWeight: 600 }}>
                              {AVAIL_LABEL[agent.availability_status] ?? agent.availability_status}
                            </div>
                            {agent.distance_km !== null && agent.distance_km !== undefined && (
                              <div style={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}>
                                📍 {agent.distance_km.toFixed(1)} km away
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleContactAgent(agent)}
                            disabled={contacting === agent.agent_id}
                            style={{
                              background: contacting === agent.agent_id ? 'var(--bg-input)' : '#10b981',
                              color: '#fff', border: 'none', borderRadius: 7,
                              padding: '6px 10px', fontSize: '0.75rem', fontWeight: 600,
                              cursor: contacting === agent.agent_id ? 'wait' : 'pointer',
                              flexShrink: 0, transition: 'background 0.15s',
                            }}
                          >
                            {contacting === agent.agent_id ? '…' : '💬'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {!nearbyLoading && nearbyAgents.length < nearbyTotal && (
                    <button
                      type="button"
                      onClick={handleLoadMoreNearby}
                      style={{
                        width: '100%', marginTop: 10, padding: '8px 0', fontSize: '0.8rem',
                        fontWeight: 600, borderRadius: 8, cursor: 'pointer',
                        background: 'var(--bg-input)', color: 'var(--text-primary)',
                        border: '1px solid var(--border-color)', transition: 'background 0.15s',
                      }}
                    >
                      Show More ({nearbyTotal - nearbyAgents.length} remaining)
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
        )
      )}
    </div>
  )
}
