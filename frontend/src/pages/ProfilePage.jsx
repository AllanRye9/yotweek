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
    <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 12, padding: '24px 20px', marginBottom: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
      {/* Avatar */}
      <div
        onClick={() => inputRef.current?.click()}
        title="Click to change avatar"
        style={{ position: 'relative', width: 96, height: 96, borderRadius: '50%', overflow: 'hidden', border: '3px solid var(--accent)', cursor: 'pointer', flexShrink: 0 }}
      >
        {displayUrl
          ? <img src={displayUrl} alt={user.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <DefaultAvatarSVG />}

        {/* Circular progress overlay */}
        {uploading && (
          <svg
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', transform: 'rotate(-90deg)' }}
            viewBox="0 0 96 96"
          >
            <circle cx="48" cy="48" r="44" fill="rgba(0,0,0,0.45)" stroke="none" />
            <circle
              cx="48" cy="48" r="44"
              fill="none"
              stroke="#f59e0b"
              strokeWidth="4"
              strokeDasharray={`${2 * Math.PI * 44}`}
              strokeDashoffset={`${2 * Math.PI * 44 * (1 - uploadPct / 100)}`}
              style={{ transition: 'stroke-dashoffset 0.2s' }}
            />
          </svg>
        )}

        {/* Camera icon overlay */}
        <div style={{ position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderRadius: '50%', background: 'var(--accent)', border: '2px solid var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>
          📷
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />

      {/* Name + role */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 800, fontSize: '1.4rem', color: 'var(--text-primary)' }}>{user.name}</span>
          {user.role === 'driver' && (
            <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 9999, background: 'rgba(16,185,129,0.15)', color: '#6ee7b7', border: '1px solid rgba(16,185,129,0.35)' }}>✅ Verified Driver</span>
          )}
          {user.role && user.role !== 'driver' && (
            <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 9999, background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.35)' }}>
              {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
            </span>
          )}
        </div>
        {memberSince && (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>Member since {memberSince}</p>
        )}
        {user.bio && (
          <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: 6, maxWidth: 400, lineHeight: 1.5 }}>{user.bio}</p>
        )}
      </div>

      {errorToast && (
        <div style={{ background: '#7f1d1d', border: '1px solid #f87171', borderRadius: 8, padding: '6px 14px', fontSize: '0.8rem', color: '#fca5a5' }}>
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

  const fieldStyle = { width: '100%', background: 'var(--bg-input, var(--bg-surface))', border: '1px solid var(--border-color)', borderRadius: 8, padding: '8px 10px', color: 'var(--text-primary)', fontSize: '0.88rem', outline: 'none', boxSizing: 'border-box' }

  const FIELD_DEFS = [
    { key: 'name',               label: 'Full Name',          type: 'text',     placeholder: 'Your full name',         readOnly: false, maxLength: 80  },
    { key: 'email',              label: 'Email Address',      type: 'email',    placeholder: '',                       readOnly: true,  maxLength: 120 },
    { key: 'phone',              label: 'Phone Number',       type: 'tel',      placeholder: '+1 555 000 0000',        readOnly: false, maxLength: 50  },
    { key: 'bio',                label: 'Bio / Tagline',      type: 'textarea', placeholder: 'A short bio…',           readOnly: false, maxLength: 200 },
    { key: 'home_city',          label: 'Home City / Base Location', type: 'text', placeholder: 'e.g. London',        readOnly: false, maxLength: 100 },
    { key: 'preferred_language', label: 'Preferred Language', type: 'text',     placeholder: 'e.g. English, French',  readOnly: false, maxLength: 50  },
  ]

  return (
    <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 12, padding: 16, marginBottom: 12 }}>
      <h2 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Profile Details</h2>
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {FIELD_DEFS.map(({ key, label, type, placeholder, readOnly, maxLength }) => (
          <div key={key}>
            <label style={{ fontSize: '0.76rem', color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>{label}</label>
            {type === 'textarea' ? (
              <textarea
                value={fields[key]}
                onChange={e => setF(key, e.target.value)}
                rows={3}
                style={{ ...fieldStyle, resize: 'vertical', minHeight: 64 }}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="submit" disabled={saving || !dirty} style={{ padding: '7px 18px', borderRadius: 8, border: 'none', background: dirty ? 'var(--accent, #f59e0b)' : 'var(--border-color)', color: dirty ? 'var(--accent-text, #000)' : 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 600, cursor: dirty ? 'pointer' : 'default' }}>
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
  const tiles = [
    { label: 'Rides Taken',      value: loading ? '…' : stats?.total_rides      ?? '—', icon: '🚗' },
    { label: 'Rides Offered',    value: loading ? '…' : stats?.open_rides        ?? '—', icon: '📋' },
    { label: 'Companion Trips',  value: loading ? '…' : stats?.total_passengers  ?? '—', icon: '🌍' },
    { label: 'Rating',           value: user.rating != null ? user.rating.toFixed(1) : '—', icon: '⭐' },
    { label: 'Reviews',          value: user.review_count ?? '—',                         icon: '💬' },
  ]

  return (
    <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 12, padding: 16, marginBottom: 12 }}>
      <h2 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Stats</h2>
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
        {tiles.map(t => (
          <div key={t.label} style={{ background: 'var(--bg-surface)', borderRadius: 10, padding: '10px 14px', border: '1px solid var(--border-color)', flexShrink: 0, minWidth: 90, textAlign: 'center' }}>
            <p style={{ fontSize: '1.25rem', marginBottom: 2 }}>{t.icon}</p>
            <p style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{t.value}</p>
            <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>{t.label}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

// ─── Account Actions ──────────────────────────────────────────────────────────
function AccountActions({ onLogout, navigate }) {
  const actions = [
    { label: '✏️ Edit Profile',             fn: () => document.querySelector('#profile-details-form')?.scrollIntoView({ behavior: 'smooth' }), color: 'var(--text-secondary)' },
    { label: '🔑 Change Password',          fn: () => navigate('/reset-password'),  color: 'var(--text-secondary)' },
    { label: '🔔 Notification Preferences', fn: () => navigate('/notifications'),   color: 'var(--text-secondary)' },
    { label: '🔒 Privacy Settings',         fn: () => {},                            color: 'var(--text-secondary)' },
    { label: '💬 Inbox',                    fn: () => navigate('/inbox'),            color: 'var(--text-secondary)' },
    { label: '📊 Dashboard',                fn: () => navigate('/dashboard'),        color: 'var(--text-secondary)' },
  ]

  return (
    <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 12, padding: 16, marginBottom: 12 }}>
      <h2 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Account</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {actions.map(({ label, fn, color }) => (
          <button
            key={label}
            onClick={fn}
            style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: 'none', background: 'transparent', color, fontSize: '0.88rem', cursor: 'pointer', transition: 'background 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-surface)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            {label}
          </button>
        ))}
        <div style={{ borderTop: '1px solid var(--border-color)', marginTop: 6, paddingTop: 8 }}>
          <button
            onClick={onLogout}
            style={{ textAlign: 'left', width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(248,113,113,0.4)', background: 'transparent', color: '#f87171', fontSize: '0.88rem', cursor: 'pointer', transition: 'background 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(248,113,113,0.08)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            🚪 Sign Out
          </button>
        </div>
      </div>
    </section>
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
        <main style={{ flex: 1, maxWidth: 680, width: '100%', margin: '0 auto', padding: '20px 16px 40px', boxSizing: 'border-box' }}>
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
              <div id="profile-details-form">
                <DetailsPanel user={appUser} onUpdate={handleUpdate} />
              </div>
              <ProfileStats user={appUser} />
              <AccountActions onLogout={handleLogout} navigate={navigate} />
            </>
          )}
        </main>
      </div>
    </>
  )
}
