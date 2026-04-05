/**
 * NotificationsPage — Full-page notification view.
 *
 * Features:
 *  - Per-category accordion sections (ride, message, system, etc.)
 *  - Expandable detail for each notification
 *  - Deep-link action routing back into the relevant module
 *  - Mark individual / all as read
 *  - Clear all
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import NavBar from '../components/NavBar'
import UserAuth from '../components/UserAuth'
import {
  getUserProfile,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  clearAllNotifications,
} from '../api'

// ─── Category metadata ────────────────────────────────────────────────────────
const CAT_META = {
  ride:      { icon: '🚗', label: 'Rides',    color: '#f59e0b' },
  message:   { icon: '💬', label: 'Messages', color: '#3b82f6' },
  dm:        { icon: '💬', label: 'Messages', color: '#3b82f6' },
  system:    { icon: '🔧', label: 'System',   color: '#6b7280' },
  companion: { icon: '🌍', label: 'Companions', color: '#8b5cf6' },
  property:  { icon: '🏠', label: 'Property', color: '#10b981' },
  default:   { icon: '🔔', label: 'Other',    color: '#9ca3af' },
}

function catMeta(type) {
  return CAT_META[type?.toLowerCase()] || CAT_META.default
}

// ─── Deep-link resolver ───────────────────────────────────────────────────────
function resolveLink(notif) {
  if (notif.link) return notif.link
  const t = (notif.type || '').toLowerCase()
  if (t === 'ride')      return '/rides'
  if (t === 'message' || t === 'dm') return '/inbox'
  if (t === 'companion') return '/companions'
  return null
}

// ─── Time formatter ───────────────────────────────────────────────────────────
function fmtTs(ts) {
  if (!ts) return ''
  const d    = new Date(ts)
  const now  = new Date()
  const diff = now - d
  if (diff < 60000)    return 'just now'
  if (diff < 3600000)  return Math.floor(diff / 60000) + 'm ago'
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ─── Single notification row ──────────────────────────────────────────────────
function NotifRow({ notif, onRead, onAction }) {
  const [expanded, setExpanded] = useState(false)
  const meta = catMeta(notif.type)
  const link = resolveLink(notif)

  const handleClick = () => {
    if (!notif.read) onRead(notif.notif_id)
    setExpanded(v => !v)
  }

  return (
    <div
      className={`rounded-xl border transition-all ${notif.read ? 'opacity-70' : ''}`}
      style={{ background: 'var(--bg-card)', borderColor: expanded ? meta.color + '80' : 'var(--border-color)' }}
    >
      <button
        onClick={handleClick}
        className="w-full text-left flex items-start gap-3 px-4 py-3"
      >
        {/* Unread dot */}
        <div className="shrink-0 mt-1">
          {notif.read
            ? <span className="text-lg">{meta.icon}</span>
            : (
              <span className="relative">
                <span className="text-lg">{meta.icon}</span>
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full" style={{ background: meta.color }} />
              </span>
            )
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className={`text-sm leading-tight ${notif.read ? '' : 'font-semibold'}`} style={{ color: 'var(--text-primary)' }}>
              {notif.title}
            </p>
            <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>{fmtTs(notif.created_at)}</span>
          </div>
          {!expanded && notif.body && (
            <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>{notif.body}</p>
          )}
        </div>
        <span className="shrink-0 text-xs" style={{ color: 'var(--text-muted)' }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-3 space-y-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
          {notif.body && (
            <p className="text-sm pt-3" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>{notif.body}</p>
          )}
          {link && (
            <button
              onClick={() => onAction(link)}
              className="text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors"
              style={{ background: meta.color + '22', color: meta.color, border: `1px solid ${meta.color}55` }}
            >
              {notif.link_label || 'View →'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Category section ─────────────────────────────────────────────────────────
function CategorySection({ type, notifications, onRead, onAction }) {
  const [open, setOpen] = useState(true)
  const meta  = catMeta(type)
  const unread = notifications.filter(n => !n.read).length

  return (
    <section>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 py-2 mb-2"
      >
        <span className="text-base">{meta.icon}</span>
        <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{meta.label}</span>
        {unread > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: meta.color + '22', color: meta.color }}>
            {unread} new
          </span>
        )}
        <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="space-y-2">
          {notifications.map(n => (
            <NotifRow key={n.notif_id} notif={n} onRead={onRead} onAction={onAction} />
          ))}
        </div>
      )}
    </section>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function NotificationsPage() {
  const navigate = useNavigate()
  const [appUser,  setAppUser]  = useState(null)
  const [showAuth, setShowAuth] = useState(false)
  const [notifs,   setNotifs]   = useState([])
  const [unread,   setUnread]   = useState(0)
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    getUserProfile().then(u => setAppUser(u)).catch(() => setAppUser(false))
    loadNotifs()
  }, [])

  const loadNotifs = () => {
    getNotifications()
      .then(d => { setNotifs(d.notifications || []); setUnread(d.unread || 0) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  const handleRead = async (id) => {
    try { await markNotificationRead(id) } catch {}
    setNotifs(prev => prev.map(n => n.notif_id === id ? { ...n, read: true } : n))
    setUnread(prev => Math.max(0, prev - 1))
  }

  const handleReadAll = async () => {
    try { await markAllNotificationsRead() } catch {}
    setNotifs(prev => prev.map(n => ({ ...n, read: true })))
    setUnread(0)
  }

  const handleClear = async () => {
    if (!window.confirm('Clear all notifications?')) return
    try { await clearAllNotifications() } catch {}
    setNotifs([])
    setUnread(0)
  }

  const handleAction = (link) => {
    if (link.startsWith('http')) window.open(link, '_blank', 'noopener')
    else navigate(link)
  }

  // Group by category type
  const grouped = {}
  notifs.forEach(n => {
    const t = (n.type || 'default').toLowerCase()
    const key = CAT_META[t] ? t : 'default'
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(n)
  })

  // Sort categories: unread first
  const sortedKeys = Object.keys(grouped).sort((a, b) => {
    const ua = grouped[a].filter(n => !n.read).length
    const ub = grouped[b].filter(n => !n.read).length
    return ub - ua
  })

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-page)', display: 'flex', flexDirection: 'column' }}>
      {showAuth && !appUser && (
        <UserAuth onSuccess={u => { setAppUser(u); setShowAuth(false); loadNotifs() }} onClose={() => setShowAuth(false)} />
      )}

      <NavBar user={appUser} onLogin={() => setShowAuth(true)} title="Notifications" />

      <main style={{ flex: 1, maxWidth: 680, width: '100%', margin: '0 auto', padding: '20px 16px 40px', boxSizing: 'border-box' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
              🔔 Notifications
              {unread > 0 && (
                <span style={{ marginLeft: 8, fontSize: '0.75rem', padding: '2px 8px', borderRadius: 9999, background: '#f59e0b22', color: '#f59e0b', border: '1px solid #f59e0b55' }}>
                  {unread} unread
                </span>
              )}
            </h1>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {unread > 0 && (
              <button onClick={handleReadAll} style={{ fontSize: '0.8rem', padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                Mark all read
              </button>
            )}
            {notifs.length > 0 && (
              <button onClick={handleClear} style={{ fontSize: '0.8rem', padding: '5px 12px', borderRadius: 8, border: '1px solid rgba(248,113,113,0.4)', background: 'transparent', color: '#f87171', cursor: 'pointer' }}>
                Clear all
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
            <div className="spinner w-8 h-8" />
          </div>
        ) : !appUser ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
            <p style={{ fontSize: '2.5rem', marginBottom: 8 }}>🔔</p>
            <p style={{ fontSize: '0.9rem' }}>Sign in to view your notifications.</p>
            <button onClick={() => setShowAuth(true)} style={{ marginTop: 16, padding: '8px 20px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: 'var(--accent-text)', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer' }}>
              Sign In
            </button>
          </div>
        ) : notifs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
            <p style={{ fontSize: '2.5rem', marginBottom: 8 }}>✅</p>
            <p style={{ fontSize: '0.9rem' }}>You're all caught up!</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {sortedKeys.map(key => (
              <CategorySection
                key={key}
                type={key}
                notifications={grouped[key]}
                onRead={handleRead}
                onAction={handleAction}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
