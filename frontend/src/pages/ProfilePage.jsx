/**
 * ProfilePage — Full-featured profile page.
 *
 * Zone 1 — Identity Banner  : large circular avatar with real-time preview on selection,
 *                              name, username, member-since, bio tagline.
 * Zone 2 — Editable Fields  : name, username, phone, email, bio, home city, preferred language.
 * Zone 3 — Profile Stats    : total rides taken, rides offered, companion trips, rating, reviews.
 * Zone 4 — Account Actions  : Edit Profile, Change Password, Notification Preferences,
 *                              Privacy Settings, Sign Out.
 *
 * Avatar upload: local object URL previewed instantly; server upload happens in parallel;
 * progress overlay shown during upload; on failure the previous URL is restored.
 */

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getUserProfile,
  userLogout,
  uploadAvatar,
  updateProfileDetails,
  updateUserLocation,
  getRideHistory,
  getExtraProfile,
  updateExtraProfile,
  updatePrivacy,
} from '../api'
import NavBar from '../components/NavBar'
import UserAuth from '../components/UserAuth'

const CACHE_KEY = 'yotweek_profile_cache'
const readCache  = () => { try { const r = localStorage.getItem(CACHE_KEY); return r ? JSON.parse(r) : null } catch { return null } }
const writeCache = (u) => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(u)) } catch {} }

function DefaultAvatarSVG() {
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
      <circle cx="20" cy="20" r="20" fill="#1e3a5f"/>
      <circle cx="20" cy="15" r="7" fill="#60a5fa"/>
      <ellipse cx="20" cy="34" rx="12" ry="8" fill="#60a5fa"/>
    </svg>
  )
}

// ─── Identity Banner ──────────────────────────────────────────────────────────
function IdentityBanner({ user, onAvatarChange }) {
  const inputRef       = useRef(null)
  const [uploading,    setUploading]    = useState(false)
  const [uploadPct,    setUploadPct]    = useState(0)
  const [previewUrl,   setPreviewUrl]   = useState(null)
  const [errorToast,   setErrorToast]   = useState('')

  const displayUrl = previewUrl || user.avatar_url

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    // Immediately show local preview
    const localUrl = URL.createObjectURL(file)
    setPreviewUrl(localUrl)
    const prevUrl = user.avatar_url

    setUploading(true)
    setUploadPct(0)
    // Simulate progress increments while uploading
    const prog = setInterval(() => setUploadPct(p => Math.min(p + 12, 90)), 200)
    try {
      const res = await uploadAvatar(file)
      clearInterval(prog)
      setUploadPct(100)
      setPreviewUrl(null)
      URL.revokeObjectURL(localUrl)
      onAvatarChange?.(res.avatar_url)
      setTimeout(() => setUploadPct(0), 600)
    } catch {
      clearInterval(prog)
      setPreviewUrl(null)
      URL.revokeObjectURL(localUrl)
      onAvatarChange?.(prevUrl)
      setErrorToast('Avatar upload failed. Please try again.')
      setTimeout(() => setErrorToast(''), 3500)
    } finally {
      setUploading(false)
    }
  }

  const memberSince = user.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })
    : null

  return (
    <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 16, padding: '14px 20px', marginBottom: 16, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      {/* Avatar */}
      <div
        onClick={() => inputRef.current?.click()}
        title="Click to change avatar"
        style={{ position: 'relative', width: 72, height: 72, borderRadius: '50%', overflow: 'hidden', border: '3px solid var(--accent)', cursor: 'pointer', flexShrink: 0, boxShadow: '0 2px 10px rgba(0,0,0,0.2)' }}
      >
        {displayUrl
          ? <img src={displayUrl} alt={user.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <DefaultAvatarSVG />}

        {/* Circular progress overlay */}
        {uploading && (
          <svg
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', transform: 'rotate(-90deg)' }}
            viewBox="0 0 120 120"
          >
            <circle cx="60" cy="60" r="56" fill="rgba(0,0,0,0.45)" stroke="none" />
            <circle
              cx="60" cy="60" r="56"
              fill="none"
              stroke="#f59e0b"
              strokeWidth="4"
              strokeDasharray={`${2 * Math.PI * 56}`}
              strokeDashoffset={`${2 * Math.PI * 56 * (1 - uploadPct / 100)}`}
              style={{ transition: 'stroke-dashoffset 0.2s' }}
            />
          </svg>
        )}

        {/* Camera icon overlay */}
        <div style={{ position: 'absolute', bottom: 2, right: 2, width: 26, height: 26, borderRadius: '50%', background: 'var(--accent)', border: '2px solid var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>
          📷
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />

      {/* Name + role + bio */}
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: '1.35rem', color: 'var(--text-primary)' }}>{user.name}</span>
          {user.role === 'driver' && (
            <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: 9999, background: 'rgba(16,185,129,0.15)', color: '#6ee7b7', border: '1px solid rgba(16,185,129,0.35)' }}>✅ Verified Driver</span>
          )}
          {user.role && user.role !== 'driver' && (
            <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: 9999, background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.35)' }}>
              {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
            </span>
          )}
        </div>
        {user.email && (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 1 }}>{user.email}</p>
        )}
        {memberSince && (
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 1 }}>Member since {memberSince}</p>
        )}
        {user.bio && (
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.5 }}>{user.bio}</p>
        )}
      </div>

      {errorToast && (
        <div style={{ width: '100%', background: '#7f1d1d', border: '1px solid #f87171', borderRadius: 8, padding: '6px 14px', fontSize: '0.8rem', color: '#fca5a5' }}>
          ⚠️ {errorToast}
        </div>
      )}
    </section>
  )
}

// ─── Editable Profile Fields ─────────────────────────────────────────────────
function DetailsPanel({ user, onUpdate }) {
  const [fields, setFields] = useState({
    name:               user.name               || '',
    bio:                user.bio                || '',
    phone:              user.phone              || '',
    email:              user.email              || '',
    home_city:          user.location_name      || '',
    preferred_language: user.preferred_language || '',
  })
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState('')

  const original = {
    name:               user.name               || '',
    bio:                user.bio                || '',
    phone:              user.phone              || '',
    email:              user.email              || '',
    home_city:          user.location_name      || '',
    preferred_language: user.preferred_language || '',
  }
  const dirty = Object.keys(fields).some(k => k !== 'email' && fields[k].trim() !== (original[k] || ''))

  const setF = (k, v) => setFields(f => ({ ...f, [k]: v }))

  const handleSave = async (e) => {
    e.preventDefault()
    if (!dirty) return
    setSaving(true); setError(''); setSaved(false)
    try {
      const res = await updateProfileDetails(
        fields.name.trim(),
        fields.bio.trim(),
        fields.phone.trim(),
        fields.home_city.trim(),
        fields.preferred_language.trim(),
      )
      const patch = {
        name:               fields.name.trim(),
        bio:                fields.bio.trim(),
        phone:              fields.phone.trim(),
        location_name:      fields.home_city.trim(),
        preferred_language: fields.preferred_language.trim(),
        ...(res?.user || {}),
      }
      onUpdate?.(patch)
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch (err) { setError(err.message || 'Save failed.') }
    finally { setSaving(false) }
  }

  const fieldStyle = { width: '100%', background: 'var(--bg-input, var(--bg-surface))', border: '1px solid var(--border-color)', borderRadius: 8, padding: '9px 12px', color: 'var(--text-primary)', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }

  const FIELD_DEFS = [
    { key: 'name',               label: 'Full Name',          type: 'text',     placeholder: 'Your full name',         readOnly: false, maxLength: 80  },
    { key: 'email',              label: 'Email Address',      type: 'email',    placeholder: '',                       readOnly: true,  maxLength: 120 },
    { key: 'phone',              label: 'Phone Number',       type: 'tel',      placeholder: '+1 555 000 0000',        readOnly: false, maxLength: 50  },
    { key: 'bio',                label: 'Bio / Tagline',      type: 'textarea', placeholder: 'A short bio…',           readOnly: false, maxLength: 200 },
    { key: 'home_city',          label: 'Home City / Base Location', type: 'text', placeholder: 'e.g. London',        readOnly: false, maxLength: 100 },
    { key: 'preferred_language', label: 'Preferred Language', type: 'text',     placeholder: 'e.g. English, French',  readOnly: false, maxLength: 50  },
  ]

  return (
    <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 16, padding: '20px 24px', height: '100%', boxSizing: 'border-box' }}>
      <h2 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Profile Details</h2>
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {FIELD_DEFS.map(({ key, label, type, placeholder, readOnly, maxLength }) => (
          <div key={key}>
            <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>{label}</label>
            {type === 'textarea' ? (
              <textarea
                value={fields[key]}
                onChange={e => setF(key, e.target.value)}
                rows={3}
                style={{ ...fieldStyle, resize: 'vertical', minHeight: 72 }}
                placeholder={placeholder}
                maxLength={maxLength}
              />
            ) : (
              <input
                type={type}
                value={fields[key]}
                onChange={readOnly ? undefined : e => setF(key, e.target.value)}
                readOnly={readOnly}
                style={{ ...fieldStyle, opacity: readOnly ? 0.6 : 1, cursor: readOnly ? 'default' : 'text' }}
                placeholder={placeholder}
                maxLength={maxLength}
              />
            )}
          </div>
        ))}
        {error && <p style={{ fontSize: '0.8rem', color: '#f87171' }}>{error}</p>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
          <button type="submit" disabled={saving || !dirty} style={{ padding: '8px 22px', borderRadius: 8, border: 'none', background: dirty ? 'var(--accent, #f59e0b)' : 'var(--border-color)', color: dirty ? 'var(--accent-text, #000)' : 'var(--text-muted)', fontSize: '0.88rem', fontWeight: 600, cursor: dirty ? 'pointer' : 'default' }}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          {saved && <span style={{ fontSize: '0.82rem', color: '#34d399' }}>✓ Saved</span>}
        </div>
      </form>
    </section>
  )
}

// ─── Profile Stats ────────────────────────────────────────────────────────────
function ProfileStats({ user }) {
  const [stats,   setStats]   = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/user/dashboard', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setStats(d.stats || null))
      .catch(() => setStats(null))
      .finally(() => setLoading(false))
  }, [])

  const memberSince = user.created_at ? new Date(user.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long' }) : null

  // XP: 10 pts per ride taken, 5 per ride offered, 8 per companion trip (capped at 1000 for max level)
  const xp  = loading ? 0 : Math.min(
    (stats?.total_rides      || 0) * 10 +
    (stats?.open_rides       || 0) * 5  +
    (stats?.total_passengers || 0) * 8,
    1000
  )
  const xpPct = Math.round((xp / 1000) * 100)
  const level = Math.floor(xp / 100) + 1

  const tiles = [
    { label: 'Rides Taken',      value: loading ? '…' : stats?.total_rides      ?? '—', icon: '🚗' },
    { label: 'Rides Offered',    value: loading ? '…' : stats?.open_rides        ?? '—', icon: '📋' },
    { label: 'Companion Trips',  value: loading ? '…' : stats?.total_passengers  ?? '—', icon: '🌍' },
    { label: 'Rating',           value: user.rating != null ? user.rating.toFixed(1) : '—', icon: '⭐' },
    { label: 'Reviews',          value: user.review_count ?? '—',                         icon: '💬' },
  ]

  return (
    <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 16, padding: '16px 20px', marginBottom: 16 }}>
      <h2 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Stats</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
        {tiles.map(t => (
          <div key={t.label} style={{ background: 'var(--bg-surface)', borderRadius: 12, padding: '14px 16px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
            <p style={{ fontSize: '1.5rem', marginBottom: 4 }}>{t.icon}</p>
            <p style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>{t.value}</p>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 3 }}>{t.label}</p>
          </div>
        ))}
      </div>

      {/* XP progress bar */}
      {!loading && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>⚡ Level {level} · {xp} XP</span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{xpPct}% to next</span>
          </div>
          <div style={{ height: 8, background: 'var(--bg-input)', borderRadius: 999, overflow: 'hidden', border: '1px solid var(--border-color)' }}>
            <div style={{
              height: '100%',
              width: `${xpPct}%`,
              background: 'linear-gradient(90deg, #f59e0b, #d97706)',
              borderRadius: 999,
              transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)',
            }} />
          </div>
        </div>
      )}
    </section>
  )
}

// ─── Account Actions ──────────────────────────────────────────────────────────
function AccountActions({ onLogout, navigate }) {
  const actions = [
    { label: 'Edit Profile',             icon: '✏️', fn: () => document.querySelector('#profile-details-form')?.scrollIntoView({ behavior: 'smooth' }), accent: '#6366f1' },
    { label: 'Change Password',          icon: '🔑', fn: () => navigate('/reset-password'),  accent: '#f59e0b' },
    { label: 'Notification Preferences', icon: '🔔', fn: () => navigate('/notifications'),   accent: '#10b981' },
    { label: 'Privacy Settings',         icon: '🔒', fn: () => {},                            accent: '#8b5cf6' },
    { label: 'Inbox',                    icon: '💬', fn: () => navigate('/inbox'),            accent: '#0ea5e9' },
    { label: 'Dashboard',                icon: '📊', fn: () => navigate('/dashboard'),        accent: '#f97316' },
  ]

  return (
    <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 16, padding: '20px 24px', height: '100%', boxSizing: 'border-box' }}>
      <h2 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Account</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
        {actions.map(({ label, icon, fn, accent }) => (
          <button
            key={label}
            onClick={fn}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 8, padding: '16px 10px', borderRadius: 12, border: `1px solid var(--border-color)`,
              background: 'var(--bg-surface)', cursor: 'pointer', transition: 'all 0.18s',
              color: 'var(--text-primary)', fontSize: '0.82rem', fontWeight: 600,
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.background = `${accent}18` }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.background = 'var(--bg-surface)' }}
          >
            <span style={{ fontSize: '1.4rem' }}>{icon}</span>
            <span style={{ textAlign: 'center', lineHeight: 1.3 }}>{label}</span>
          </button>
        ))}
      </div>
      <div style={{ borderTop: '1px solid var(--border-color)', marginTop: 14, paddingTop: 14 }}>
        <button
          onClick={onLogout}
          style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '11px 16px', borderRadius: 10, border: '1px solid rgba(248,113,113,0.35)', background: 'transparent', color: '#f87171', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer', transition: 'background 0.15s' }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(248,113,113,0.08)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <span style={{ fontSize: '1.1rem' }}>🚪</span> Sign Out
        </button>
      </div>
    </section>
  )
}

// ─── Location Sharing ─────────────────────────────────────────────────────────
function LocationSharing() {
  const [status, setStatus]       = useState('')
  const [tracking, setTracking]   = useState(false)
  const [msg, setMsg]             = useState('')
  const watchIdRef                = useRef(null)

  const shareOnce = () => {
    if (!navigator.geolocation) { setMsg('Geolocation not supported.'); return }
    setStatus('locating')
    setMsg('')
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await updateUserLocation(pos.coords.latitude, pos.coords.longitude)
          setMsg('📍 Location shared successfully.')
        } catch {
          setMsg('Failed to share location.')
        }
        setStatus('')
      },
      () => { setMsg('Could not get location.'); setStatus('') },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const toggleLive = () => {
    if (tracking) {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
      setTracking(false)
      setMsg('Live tracking stopped.')
      return
    }
    if (!navigator.geolocation) { setMsg('Geolocation not supported.'); return }
    setMsg('📡 Live tracking started…')
    setTracking(true)
    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        try { await updateUserLocation(pos.coords.latitude, pos.coords.longitude) } catch {}
      },
      () => { setMsg('Live tracking error.'); setTracking(false) },
      { enableHighAccuracy: true }
    )
  }

  useEffect(() => () => {
    if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current)
  }, [])

  const btn = { padding: '9px 18px', borderRadius: 9, border: 'none', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer', transition: 'opacity 0.15s' }

  return (
    <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 16, padding: '20px 24px', marginBottom: 20 }}>
      <h2 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Location Sharing</h2>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={shareOnce}
          disabled={status === 'locating'}
          style={{ ...btn, background: '#3b82f6', color: '#fff', opacity: status === 'locating' ? 0.6 : 1 }}
        >
          📍 {status === 'locating' ? 'Locating…' : 'Share Once'}
        </button>
        <button
          onClick={toggleLive}
          style={{ ...btn, background: tracking ? '#ef4444' : '#10b981', color: '#fff' }}
        >
          {tracking ? '⏹ Stop Live Tracking' : '📡 Start Live Tracking'}
        </button>
      </div>
      {msg && <p style={{ marginTop: 10, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{msg}</p>}
    </section>
  )
}

// ─── Rides History ────────────────────────────────────────────────────────────
function RidesHistory() {
  const [rides,   setRides]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    getRideHistory()
      .then(d => setRides(d.rides || []))
      .catch(() => setError('Failed to load rides.'))
      .finally(() => setLoading(false))
  }, [])

  const fmtDate = (s) => { try { return new Date(s).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return s } }

  return (
    <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 16, padding: '20px 24px', marginBottom: 20 }}>
      <h2 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Rides</h2>
      {loading && <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Loading…</p>}
      {error   && <p style={{ fontSize: '0.85rem', color: '#f87171' }}>{error}</p>}
      {!loading && !error && rides.length === 0 && (
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>No rides yet.</p>
      )}
      {!loading && rides.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rides.map(r => (
            <div key={r.ride_id} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 12, padding: '12px 16px' }}>
              <p style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                {r.origin} → {r.destination}
              </p>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 4, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {r.departure && <span>🕐 {fmtDate(r.departure)}</span>}
                {r.seats     && <span>🪑 {r.seats} seat(s)</span>}
                <span style={{
                  padding: '1px 8px', borderRadius: 9999, fontWeight: 600, fontSize: '0.72rem',
                  background: r.status === 'open' ? 'rgba(16,185,129,0.15)' : 'rgba(107,114,128,0.15)',
                  color:      r.status === 'open' ? '#6ee7b7' : 'var(--text-muted)',
                  border: `1px solid ${r.status === 'open' ? 'rgba(16,185,129,0.3)' : 'var(--border-color)'}`,
                }}>
                  {r.status || 'open'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ─── Travel Preferences ───────────────────────────────────────────────────────
function TravelPreferences() {
  const TRAVEL_STYLE_OPTS   = ['budget', 'mid-range', 'luxury', 'backpacker']
  const BUDGET_RANGE_OPTS   = ['<$50/day', '$50-150/day', '$150-500/day', '$500+/day']
  const VISIBILITY_OPTS     = ['public', 'friends', 'private']

  const defaultPrefs = { travel_style: '', budget_range: '', interests: '', languages: '', available_from: '', available_to: '', preferred_destinations: '', bio_travel: '' }
  const defaultPrivacy = { profile_visibility: 'public', show_location: 'public', show_travel_dates: 'public' }

  const [prefs,       setPrefs]       = useState(defaultPrefs)
  const [privacy,     setPrivacy]     = useState(defaultPrivacy)
  const [loading,     setLoading]     = useState(true)
  const [savingPrefs, setSavingPrefs] = useState(false)
  const [savingPriv,  setSavingPriv]  = useState(false)
  const [savedPrefs,  setSavedPrefs]  = useState(false)
  const [savedPriv,   setSavedPriv]   = useState(false)
  const [errorPrefs,  setErrorPrefs]  = useState('')
  const [errorPriv,   setErrorPriv]   = useState('')

  useEffect(() => {
    getExtraProfile()
      .then(d => {
        const p = d.profile || d || {}
        setPrefs({
          travel_style:          p.travel_style          || '',
          budget_range:          p.budget_range          || '',
          interests:             Array.isArray(p.interests) ? p.interests.join(', ') : (p.interests || ''),
          languages:             p.languages             || '',
          available_from:        p.available_from        || '',
          available_to:          p.available_to          || '',
          preferred_destinations: p.preferred_destinations || '',
          bio_travel:            p.bio_travel            || '',
        })
        const priv = d.privacy || p.privacy || {}
        setPrivacy({
          profile_visibility: priv.profile_visibility || 'public',
          show_location:      priv.show_location      || 'public',
          show_travel_dates:  priv.show_travel_dates  || 'public',
        })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const setP  = (k, v) => setPrefs(prev => ({ ...prev, [k]: v }))
  const setPr = (k, v) => setPrivacy(prev => ({ ...prev, [k]: v }))

  const handleSavePrefs = async (e) => {
    e.preventDefault()
    setSavingPrefs(true)
    setErrorPrefs('')
    try {
      await updateExtraProfile({
        ...prefs,
        interests: prefs.interests ? prefs.interests.split(',').map(s => s.trim()).filter(Boolean) : [],
      })
      setSavedPrefs(true)
      setTimeout(() => setSavedPrefs(false), 2500)
    } catch (err) {
      setErrorPrefs(err.message || 'Save failed.')
    } finally {
      setSavingPrefs(false)
    }
  }

  const handleSavePrivacy = async (e) => {
    e.preventDefault()
    setSavingPriv(true)
    setErrorPriv('')
    try {
      await updatePrivacy(privacy)
      setSavedPriv(true)
      setTimeout(() => setSavedPriv(false), 2500)
    } catch (err) {
      setErrorPriv(err.message || 'Save failed.')
    } finally {
      setSavingPriv(false)
    }
  }

  const fieldStyle = { width: '100%', background: 'var(--bg-input, var(--bg-surface))', border: '1px solid var(--border-color)', borderRadius: 8, padding: '9px 12px', color: 'var(--text-primary)', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }
  const labelStyle = { fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }
  const sectionStyle = { background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 16, padding: '20px 24px', marginBottom: 14 }

  if (loading) return (
    <section style={sectionStyle}>
      <h2 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>🌍 Travel Preferences</h2>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Loading…</p>
    </section>
  )

  return (
    <>
      {/* Travel Preferences form */}
      <section style={sectionStyle}>
        <h2 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.06em' }}>🌍 Travel Preferences</h2>
        <form onSubmit={handleSavePrefs} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
            <div>
              <label style={labelStyle}>Travel Style</label>
              <select value={prefs.travel_style} onChange={e => setP('travel_style', e.target.value)} style={fieldStyle}>
                <option value="">— Select —</option>
                {TRAVEL_STYLE_OPTS.map(o => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Budget Range</label>
              <select value={prefs.budget_range} onChange={e => setP('budget_range', e.target.value)} style={fieldStyle}>
                <option value="">— Select —</option>
                {BUDGET_RANGE_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Interests (comma-separated)</label>
            <input type="text" value={prefs.interests} onChange={e => setP('interests', e.target.value)} placeholder="e.g. hiking, food, photography" style={fieldStyle} maxLength={300} />
          </div>
          <div>
            <label style={labelStyle}>Languages Spoken</label>
            <input type="text" value={prefs.languages} onChange={e => setP('languages', e.target.value)} placeholder="e.g. English, Spanish" style={fieldStyle} maxLength={200} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            <div>
              <label style={labelStyle}>Available From</label>
              <input type="date" value={prefs.available_from} onChange={e => setP('available_from', e.target.value)} style={fieldStyle} />
            </div>
            <div>
              <label style={labelStyle}>Available To</label>
              <input type="date" value={prefs.available_to} onChange={e => setP('available_to', e.target.value)} style={fieldStyle} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Preferred Destinations</label>
            <input type="text" value={prefs.preferred_destinations} onChange={e => setP('preferred_destinations', e.target.value)} placeholder="e.g. Southeast Asia, Europe" style={fieldStyle} maxLength={300} />
          </div>
          <div>
            <label style={labelStyle}>Travel Bio</label>
            <textarea value={prefs.bio_travel} onChange={e => setP('bio_travel', e.target.value)} rows={3} style={{ ...fieldStyle, resize: 'vertical', minHeight: 72 }} placeholder="Tell fellow travellers about your travel style…" maxLength={500} />
          </div>
          {errorPrefs && <p style={{ fontSize: '0.8rem', color: '#f87171' }}>{errorPrefs}</p>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="submit" disabled={savingPrefs} style={{ padding: '8px 22px', borderRadius: 8, border: 'none', background: 'var(--accent, #f59e0b)', color: 'var(--accent-text, #000)', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer', opacity: savingPrefs ? 0.6 : 1 }}>
              {savingPrefs ? 'Saving…' : 'Save Preferences'}
            </button>
            {savedPrefs && <span style={{ fontSize: '0.82rem', color: '#34d399' }}>✓ Saved</span>}
          </div>
        </form>
      </section>

      {/* Privacy Settings */}
      <section style={sectionStyle}>
        <h2 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.06em' }}>🔒 Privacy Settings</h2>
        <form onSubmit={handleSavePrivacy} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            {[
              { key: 'profile_visibility', label: 'Profile Visibility' },
              { key: 'show_location',      label: 'Show Location'      },
              { key: 'show_travel_dates',  label: 'Show Travel Dates'  },
            ].map(({ key, label }) => (
              <div key={key}>
                <label style={labelStyle}>{label}</label>
                <select value={privacy[key]} onChange={e => setPr(key, e.target.value)} style={fieldStyle}>
                  {VISIBILITY_OPTS.map(o => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
                </select>
              </div>
            ))}
          </div>
          {errorPriv && <p style={{ fontSize: '0.8rem', color: '#f87171' }}>{errorPriv}</p>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="submit" disabled={savingPriv} style={{ padding: '8px 22px', borderRadius: 8, border: 'none', background: 'var(--accent, #f59e0b)', color: 'var(--accent-text, #000)', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer', opacity: savingPriv ? 0.6 : 1 }}>
              {savingPriv ? 'Saving…' : 'Save Privacy'}
            </button>
            {savedPriv && <span style={{ fontSize: '0.82rem', color: '#34d399' }}>✓ Saved</span>}
          </div>
        </form>
      </section>
    </>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ProfilePage() {
  const navigate  = useNavigate()
  const [appUser, setAppUser] = useState(() => readCache())
  const [loading, setLoading] = useState(!readCache())
  const [showAuth,setShowAuth]= useState(false)

  useEffect(() => {
    let cancelled = false
    getUserProfile()
      .then(fresh => { if (!cancelled) { writeCache(fresh); setAppUser(fresh) } })
      .catch(() => { if (!cancelled) setAppUser(prev => prev ?? false) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const handleLogout = async () => {
    try { await userLogout() } catch {}
    localStorage.removeItem(CACHE_KEY)
    setAppUser(false)
    navigate('/')
  }

  const handleUpdate = (patch) => {
    setAppUser(prev => { const m = { ...prev, ...patch }; writeCache(m); return m })
  }

  return (
    <>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}@keyframes pp-pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
      <div style={{ minHeight: '100vh', background: 'var(--bg-page)', display: 'flex', flexDirection: 'column' }}>
        {showAuth && !appUser && (
          <UserAuth onSuccess={u => { writeCache(u); setAppUser(u); setShowAuth(false) }} onClose={() => setShowAuth(false)} />
        )}
        <NavBar user={appUser} onLogin={() => setShowAuth(true)} title="Profile" />
        <main style={{ flex: 1, maxWidth: 1100, width: '100%', margin: '0 auto', padding: '16px 16px 40px', boxSizing: 'border-box' }}>
          {/* Back button */}
          <button
            onClick={() => navigate(-1)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 14, padding: '6px 14px', borderRadius: 9, border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', transition: 'opacity 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.75'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          >
            ← Back
          </button>

          {loading && !appUser ? (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 12, padding: 20, animation: 'pp-pulse 1.5s ease-in-out infinite' }}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--border-color)' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ width: 140, height: 14, borderRadius: 6, background: 'var(--border-color)' }} />
                  <div style={{ width: 90,  height: 11, borderRadius: 6, background: 'var(--border-color)' }} />
                </div>
              </div>
            </div>
          ) : !appUser ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 16, textAlign: 'center' }}>
              <div style={{ fontSize: '3rem' }}>👤</div>
              <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Your Profile</h1>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', maxWidth: 300, lineHeight: 1.5, margin: 0 }}>Log in to view and edit your profile.</p>
              <button onClick={() => setShowAuth(true)} style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: 'var(--accent-text)', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer' }}>
                Login / Register
              </button>
            </div>
          ) : (
            <>
              <IdentityBanner user={appUser} onAvatarChange={url => handleUpdate({ avatar_url: url })} />

              <hr style={{ borderColor: 'var(--border-color)', margin: '8px 0' }} />

              {/* Vehicle Details (drivers only) */}
              {appUser.role === 'driver' && (
                <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 16, padding: '16px 20px', marginBottom: 14 }}>
                  <h2 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>🚗 Vehicle Details</h2>
                  {appUser.vehicle ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                      {[
                        { label: 'Make / Model', value: [appUser.vehicle.make, appUser.vehicle.model].filter(Boolean).join(' ') || '—' },
                        { label: 'Year', value: appUser.vehicle.year || '—' },
                        { label: 'License Plate', value: appUser.vehicle.license_plate || '—' },
                      ].map(item => (
                        <div key={item.label} style={{ background: 'var(--bg-surface)', borderRadius: 12, padding: '12px 14px', border: '1px solid var(--border-color)' }}>
                          <p style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{item.label}</p>
                          <p style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>{item.value}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>No vehicle details added yet.</p>
                  )}
                </section>
              )}

              {/* Stats Summary row */}
              <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 16, padding: '14px 20px', marginBottom: 14 }}>
                <h2 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>📊 Stats Summary</h2>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  {[
                    { icon: '🚗', label: 'Total Rides', value: appUser.total_rides ?? '—' },
                    { icon: '⭐', label: 'Rating', value: appUser.rating != null ? appUser.rating.toFixed(1) : '—' },
                    { icon: '📅', label: 'Member Since', value: appUser.created_at ? new Date(appUser.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short' }) : '—' },
                  ].map(s => (
                    <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 10, padding: '8px 14px' }}>
                      <span style={{ fontSize: '1.1rem' }}>{s.icon}</span>
                      <div>
                        <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</p>
                        <p style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>{s.value}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* User ID card */}
              <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 14, padding: '10px 20px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: '1rem' }}>🪪</span>
                <div>
                  <p style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>User ID</p>
                  <p style={{ fontSize: '0.85rem', fontFamily: 'monospace', color: 'var(--text-primary)', wordBreak: 'break-all' }}>{appUser.user_id}</p>
                </div>
              </section>

              <LocationSharing />
              <RidesHistory />
              <ProfileStats user={appUser} />
              <div id="profile-details-form" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16, marginBottom: 16 }}>
                <DetailsPanel user={appUser} onUpdate={handleUpdate} />
                <AccountActions onLogout={handleLogout} navigate={navigate} />
              </div>
              <TravelPreferences />
            </>
          )}
        </main>
      </div>
    </>
  )
}
