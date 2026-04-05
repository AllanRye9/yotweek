/**
 * ProfilePage — Three-zone profile page.
 *
 * Zone 1 — Identity Banner  : avatar (click-to-upload), name, username, role badge.
 * Zone 2 — Inline-Edit Panel: editable name, bio, phone with save.
 * Zone 3 — Activity Metrics : read-only stats (rides, member since, etc.).
 *
 * Top-right NavBar icon always links directly here.
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

function IdentityBanner({ user, onAvatarChange }) {
  const inputRef    = useRef(null)
  const [uploading, setUploading] = useState(false)

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try { const res = await uploadAvatar(file); onAvatarChange?.(res.avatar_url) } catch {}
    setUploading(false)
    e.target.value = ''
  }

  return (
    <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 12, padding: '20px 16px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
      <div onClick={() => inputRef.current?.click()} title="Click to change avatar"
        style={{ position: 'relative', width: 72, height: 72, borderRadius: '50%', overflow: 'hidden', border: '3px solid var(--accent)', cursor: 'pointer', flexShrink: 0, opacity: uploading ? 0.6 : 1 }}>
        {user.avatar_url
          ? <img src={user.avatar_url} alt={user.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <DefaultAvatarSVG />}
        {uploading && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 20, height: 20, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          </div>
        )}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.45)', textAlign: 'center', fontSize: 11, color: '#fff', padding: '2px 0' }}>📷</div>
      </div>
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 800, fontSize: '1.3rem', color: 'var(--text-primary)', lineHeight: 1.3 }}>{user.name}</span>
          {user.role === 'driver' && (
            <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 9999, background: 'rgba(16,185,129,0.15)', color: '#6ee7b7', border: '1px solid rgba(16,185,129,0.35)' }}>✅ Verified Driver</span>
          )}
          {user.role && user.role !== 'driver' && (
            <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 9999, background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.35)' }}>
              {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
            </span>
          )}
        </div>
        {user.username && <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: 2 }}>@{user.username}</p>}
        {user.email    && <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)',    marginTop: 2 }}>{user.email}</p>}
      </div>
    </section>
  )
}

function DetailsPanel({ user, onUpdate }) {
  const [name,   setName]   = useState(user.name || '')
  const [bio,    setBio]    = useState(user.bio  || '')
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState('')
  const dirty = name.trim() !== (user.name || '') || bio.trim() !== (user.bio || '')

  const handleSave = async (e) => {
    e.preventDefault()
    if (!dirty) return
    setSaving(true); setError(''); setSaved(false)
    try {
      await updateProfileDetails(name.trim(), bio.trim())
      onUpdate?.({ name: name.trim(), bio: bio.trim() })
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch (err) { setError(err.message || 'Save failed.') }
    finally { setSaving(false) }
  }

  const field = { width: '100%', background: 'var(--bg-input, var(--bg-surface))', border: '1px solid var(--border-color)', borderRadius: 8, padding: '8px 10px', color: 'var(--text-primary)', fontSize: '0.88rem', outline: 'none', boxSizing: 'border-box' }

  return (
    <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 12, padding: 16, marginBottom: 12 }}>
      <h2 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Profile Details</h2>
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <label style={{ fontSize: '0.76rem', color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Display Name</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} style={field} placeholder="Your name" maxLength={80} />
        </div>
        <div>
          <label style={{ fontSize: '0.76rem', color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Bio</label>
          <textarea value={bio} onChange={e => setBio(e.target.value)} rows={3} style={{ ...field, resize: 'vertical', minHeight: 64 }} placeholder="A short bio…" maxLength={200} />
        </div>
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

function ActivityMetrics({ user }) {
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
  const metrics = [
    { label: 'Total Rides',  value: loading ? '…' : stats?.total_rides ?? '—', icon: '🚗' },
    { label: 'Active Rides', value: loading ? '…' : stats?.open_rides  ?? '—', icon: '✅' },
    { label: 'Member Since', value: memberSince || '—',                         icon: '📅' },
    { label: 'Location',     value: user.location_name || '—',                  icon: '📍' },
  ]

  return (
    <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 12, padding: 16, marginBottom: 12 }}>
      <h2 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Activity</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        {metrics.map(m => (
          <div key={m.label} style={{ background: 'var(--bg-surface)', borderRadius: 10, padding: 12, border: '1px solid var(--border-color)' }}>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4 }}>{m.icon} {m.label}</p>
            <p style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>{m.value}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

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
              <DetailsPanel user={appUser} onUpdate={handleUpdate} />
              <ActivityMetrics user={appUser} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {[
                  { label: '✈️ Airport Rides', path: '/rides',     accent: true  },
                  { label: '📊 Dashboard',     path: '/dashboard', accent: false },
                  { label: '💬 Inbox',         path: '/inbox',     accent: false },
                ].map(({ label, path, accent }) => (
                  <button key={path} onClick={() => navigate(path)} style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${accent ? 'var(--accent)' : 'var(--border-color)'}`, background: accent ? 'var(--accent)' : 'transparent', color: accent ? 'var(--accent-text)' : 'var(--text-secondary)', fontSize: '0.85rem', cursor: 'pointer' }}>
                    {label}
                  </button>
                ))}
                <button onClick={handleLogout} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #f87171', background: 'transparent', color: '#f87171', fontSize: '0.85rem', cursor: 'pointer' }}>
                  Sign Out
                </button>
              </div>
            </>
          )}
        </main>
      </div>
    </>
  )
}
