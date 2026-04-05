import { useState, useEffect, useRef, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getUserProfile, userLogout, uploadAvatar } from '../api'
import NavBar from '../components/NavBar'
import UserProfile from '../components/UserProfile'
import UserAuth from '../components/UserAuth'
import { useAuth } from '../App'

// ─── Local storage cache helpers ─────────────────────────────────────────────

const CACHE_KEY = 'yotweek_profile_cache'

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeCache(user) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(user))
  } catch {}
}

// ─── Toast notification ───────────────────────────────────────────────────────

function Toast({ message, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000)
    return () => clearTimeout(t)
  }, [onDismiss])

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 9999,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-color)',
        borderRadius: 8,
        padding: '10px 16px',
        fontSize: '0.8rem',
        color: 'var(--text-secondary)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        maxWidth: 280,
        lineHeight: 1.4,
      }}
    >
      ⚠️ {message}
    </div>
  )
}

// ─── Default avatar SVG ───────────────────────────────────────────────────────

function DefaultAvatarSVG() {
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
      <circle cx="20" cy="20" r="20" fill="#1e3a5f"/>
      <circle cx="20" cy="15" r="7" fill="#60a5fa"/>
      <ellipse cx="20" cy="34" rx="12" ry="8" fill="#60a5fa"/>
    </svg>
  )
}

// ─── Profile Header Row ───────────────────────────────────────────────────────

function ProfileHeaderRow({ user, onEditClick, onAvatarChange }) {
  const avatarInputRef = useRef(null)
  const [uploading, setUploading] = useState(false)

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const res = await uploadAvatar(file)
      onAvatarChange?.(res.avatar_url)
    } catch {}
    setUploading(false)
    e.target.value = ''
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      {/* Avatar — 40×40, rounded full */}
      <div style={{ position: 'relative', width: 40, height: 40, flexShrink: 0 }}>
        <div
          onClick={() => avatarInputRef.current?.click()}
          title="Click to change avatar"
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            overflow: 'hidden',
            border: '2px solid var(--accent)',
            background: '#1e3a5f',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: uploading ? 0.6 : 1,
          }}
        >
          {user.avatar_url
            ? <img src={user.avatar_url} alt={user.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <DefaultAvatarSVG />
          }
        </div>
        {uploading && (
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{ width: 16, height: 16, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          </div>
        )}
        <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarChange} />
      </div>

      {/* Name & username */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: '1.2rem', color: 'var(--text-primary)', lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {user.name}
          </span>
          {user.role === 'driver' && (
            <span style={{ fontSize: '0.72rem', padding: '2px 7px', borderRadius: 9999, background: 'rgba(16,185,129,0.18)', color: '#6ee7b7', border: '1px solid rgba(16,185,129,0.35)', flexShrink: 0 }}>
              ✅ Verified Driver
            </span>
          )}
        </div>
        {user.username && (
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>@{user.username}</span>
        )}
      </div>

      {/* Edit Profile button */}
      <button
        onClick={onEditClick}
        style={{
          padding: '6px 12px',
          borderRadius: 6,
          border: '1px solid var(--border-color)',
          background: 'transparent',
          color: 'var(--text-secondary)',
          fontSize: '0.82rem',
          cursor: 'pointer',
          flexShrink: 0,
          lineHeight: 1.4,
          transition: 'color 0.15s, border-color 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--text-secondary)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border-color)' }}
      >
        Edit Profile
      </button>
    </div>
  )
}

// ─── Profile Details Grid ─────────────────────────────────────────────────────

function ProfileDetailsGrid({ user }) {
  const rows = [
    { label: 'Email',        value: user.email },
    { label: 'Phone',        value: user.phone || null },
    { label: 'Member since', value: user.created_at ? new Date(user.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : null },
    { label: 'Location',     value: user.location_name || null },
    { label: 'Role',         value: user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : null },
  ].filter(r => r.value)

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: 8,
        marginTop: 16,
      }}
      className="profile-details-grid"
    >
      {rows.map(row => (
        <div key={row.label} style={{ display: 'contents' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4, alignSelf: 'center' }}>{row.label}</span>
          <span style={{ fontSize: '0.88rem', color: 'var(--text-primary)', lineHeight: 1.4, alignSelf: 'center', wordBreak: 'break-word' }}>{row.value}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Action Buttons Row ───────────────────────────────────────────────────────

const BTN_BASE = {
  height: 32,
  padding: '0 12px',
  borderRadius: 6,
  fontSize: '0.85rem',
  cursor: 'pointer',
  lineHeight: '30px',
  border: '1px solid transparent',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  whiteSpace: 'nowrap',
  transition: 'opacity 0.15s',
  minWidth: 32,
  touchAction: 'manipulation',
}

function ActionButtonsRow({ onLogout, navigate }) {
  return (
    <div
      style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}
      className="profile-actions-row"
    >
      <button
        onClick={() => navigate('/rides')}
        style={{ ...BTN_BASE, background: 'var(--accent)', color: 'var(--accent-text)', border: '1px solid var(--accent)' }}
        onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
        onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
      >
        ✈️ Airport Rides
      </button>

      <button
        onClick={() => navigate('/dashboard')}
        style={{ ...BTN_BASE, background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
        onMouseEnter={e => (e.currentTarget.style.opacity = '0.75')}
        onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
      >
        📊 Dashboard
      </button>

      <button
        onClick={onLogout}
        style={{ ...BTN_BASE, background: 'transparent', color: '#f87171', border: '1px solid #f87171' }}
        onMouseEnter={e => (e.currentTarget.style.opacity = '0.75')}
        onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
      >
        Logout
      </button>
    </div>
  )
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────

function ProfileSkeleton() {
  const bar = (w, h = 12) => (
    <div style={{ width: w, height: h, borderRadius: 6, background: 'var(--border-color)', opacity: 0.6 }} />
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'pp-pulse 1.5s ease-in-out infinite' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--border-color)', opacity: 0.6 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {bar(120, 14)}
          {bar(80)}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
        {[80, 160, 60, 120, 70, 100].map((w, i) => <div key={i}>{bar(w)}</div>)}
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * ProfilePage — Compact, spec-compliant profile page.
 * Renders cached data immediately, then silently fetches fresh data in the background.
 */
export default function ProfilePage() {
  const { admin } = useAuth()
  const navigate = useNavigate()
  const [appUser, setAppUser] = useState(() => readCache())
  const [loading, setLoading] = useState(!readCache())
  const [showAuth, setShowAuth] = useState(false)
  const [toast, setToast] = useState(null)
  const [editOpen, setEditOpen] = useState(false)
  const toastDismiss = useCallback(() => setToast(null), [])

  // Background fetch — always runs on mount; uses cached data for instant render
  useEffect(() => {
    let cancelled = false
    getUserProfile()
      .then(fresh => {
        if (cancelled) return
        writeCache(fresh)
        setAppUser(fresh)
      })
      .catch(() => {
        if (cancelled) return
        // If no cached data at all, mark as not logged in
        setAppUser(prev => prev ?? false)
        if (readCache()) {
          setToast('Could not refresh profile. Showing cached data.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const handleLogout = async () => {
    try { await userLogout() } catch (_) {}
    localStorage.removeItem(CACHE_KEY)
    setAppUser(false)
    navigate('/')
  }

  const handleUserUpdate = (updated) => {
    if (!updated) return
    setAppUser(prev => {
      const merged = { ...prev, ...updated }
      writeCache(merged)
      return merged
    })
  }

  const handleAvatarChange = (url) => {
    setAppUser(prev => {
      const updated = { ...prev, avatar_url: url }
      writeCache(updated)
      return updated
    })
  }

  const mainContainerStyle = {
    flex: 1,
    width: '100%',
    maxWidth: 1200,
    margin: '0 auto',
    paddingLeft: '4vw',
    paddingRight: '4vw',
    paddingTop: 24,
    paddingBottom: 32,
    boxSizing: 'border-box',
  }

  const profileCardStyle = {
    background: 'var(--bg-card)',
    border: '1px solid var(--border-color)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    lineHeight: 1.4,
  }

  return (
    <>
      <style>{`
        @keyframes pp-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.5; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        /* Responsive: collapse grid to 1 col & stack buttons on narrow screens */
        @media (max-width: 767px) {
          .pp-main { padding-left: 12px !important; padding-right: 12px !important; }
          .profile-details-grid { grid-template-columns: 1fr 1fr !important; }
          .profile-actions-row { flex-direction: column !important; }
          .profile-actions-row button { width: 100% !important; justify-content: center !important; }
        }
        @media (max-width: 479px) {
          .profile-details-grid { grid-template-columns: max-content 1fr !important; }
        }
        button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        a:focus-visible      { outline: 2px solid var(--accent); outline-offset: 2px; }
      `}</style>

      <div style={{ minHeight: '100vh', background: 'var(--bg-page)', display: 'flex', flexDirection: 'column' }}>

        {/* Auth modal */}
        {showAuth && !appUser && (
          <UserAuth
            onSuccess={(u) => { writeCache(u); setAppUser(u); setShowAuth(false) }}
            onClose={() => setShowAuth(false)}
          />
        )}

        {/* Shared NavBar */}
        <NavBar
          user={appUser}
          onLogin={() => setShowAuth(true)}
          title="Profile"
        />

        {/* ── Main container (4% left/right margin, max 1200px) ── */}
        <main style={mainContainerStyle} className="pp-main">

          {loading && !appUser ? (
            /* Initial skeleton while no cached data */
            <div style={profileCardStyle}><ProfileSkeleton /></div>

          ) : !appUser ? (
            /* Not logged in */
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 16, textAlign: 'center' }}>
              <div style={{ fontSize: '3rem' }}>👤</div>
              <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Your Profile</h1>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', maxWidth: 300, lineHeight: 1.5, margin: 0 }}>
                Log in to view and edit your profile, track your ride history, and manage settings.
              </p>
              <button
                onClick={() => setShowAuth(true)}
                style={{ ...BTN_BASE, height: 36, padding: '0 20px', background: 'var(--accent)', color: 'var(--accent-text)', border: 'none', borderRadius: 8, fontSize: '0.9rem', fontWeight: 600 }}
              >
                Login / Register
              </button>
            </div>

          ) : (
            /* Logged in */
            <>
              {/* ── Profile Header Row + Details + Actions ── */}
              <section aria-label="Profile summary" style={profileCardStyle}>
                <ProfileHeaderRow
                  user={appUser}
                  onEditClick={() => setEditOpen(o => !o)}
                  onAvatarChange={handleAvatarChange}
                />
                <ProfileDetailsGrid user={appUser} />
                <ActionButtonsRow onLogout={handleLogout} navigate={navigate} />
              </section>

              {/* ── Full profile tabs (overview / rides / stats / driver / inbox) ── */}
              <UserProfile
                user={appUser}
                onLogout={handleLogout}
                onLocationUpdate={(loc) => handleUserUpdate(loc)}
                onUserUpdate={(u) => u && handleUserUpdate(u)}
                defaultTab={editOpen ? 'overview' : undefined}
              />
            </>
          )}
        </main>

        <footer style={{ borderTop: '1px solid var(--border-color)', padding: '12px 16px', textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          yotweek © {new Date().getFullYear()} —{' '}
          <Link to="/" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Back to Home</Link>
        </footer>
      </div>

      {/* Non-blocking bottom-right toast */}
      {toast && <Toast message={toast} onDismiss={toastDismiss} />}
    </>
  )
}
