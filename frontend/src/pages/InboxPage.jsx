/**
 * InboxPage — Ride Chat Inbox (sole communication method per Feature Area 4).
 *
 * Sidebar (≈35% width):
 *  - Search bar with real-time filtering by origin/destination
 *  - All / Unread filter toggle
 *  - Smart 6-chat limit: pinned chats always show + up to 6 non-pinned, with "Show more"
 *  - Sort: unread first, then most-recent activity
 *  - Pin / Archive / Mute per-chat (stored in localStorage)
 *  - Avatar with initial, unread badge (99+ cap), relative timestamp
 *  - Long-press / right-click for context menu (delete, pin, archive, mute)
 *
 * Chat panel (≈65% width):
 *  - RideChat for ride conversations
 *  - Empty state placeholder when no conversation is selected
 *
 * Global:
 *  - Offline connectivity banner
 *  - First-time user coach-mark overlay
 *  - Full ARIA label support
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import NavBar from '../components/NavBar'
import RideChat from '../components/RideChat'
import {
  getUserProfile,
  getRideChatInbox,
} from '../api'
import socket from '../socket'

const FIRST_TIME_KEY  = 'yot_inbox_first_visit'
const PINNED_KEY      = 'yot_pinned_rides'
const ARCHIVED_KEY    = 'yot_archived_rides'
const MUTED_KEY       = 'yot_muted_rides'
const CHAT_LIMIT      = 6  // max non-pinned chats shown before "Show more"

// ── Persist helpers ───────────────────────────────────────────────────────────
function loadSet(key) {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')) } catch { return new Set() }
}
function saveSet(key, set) {
  try { localStorage.setItem(key, JSON.stringify([...set])) } catch {}
}

function fmtTs(ts) {
  if (!ts) return ''
  try {
    const d = typeof ts === 'number' && ts < 1e10 ? new Date(ts * 1000) : new Date(ts)
    const now  = new Date()
    const diff = now - d
    if (diff < 60000)    return 'Just now'
    if (diff < 3600000)  return Math.floor(diff / 60000) + 'm ago'
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago'
    if (diff < 172800000) return 'Yesterday'
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  } catch { return '' }
}

function unreadLabel(count) {
  if (!count || count <= 0) return null
  return count > 99 ? '99+' : String(count)
}

/** Circular avatar showing the first letter of a name */
function Avatar({ name = '?', size = 'w-10 h-10', textSize = 'text-sm' }) {
  const initial = (name || '?')[0].toUpperCase()
  const hue = [...(name || '?')].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360
  return (
    <div
      className={`${size} rounded-full flex items-center justify-center font-bold ${textSize} shrink-0`}
      style={{ background: `hsl(${hue},55%,40%)`, color: '#fff' }}
      aria-hidden="true"
    >
      {initial}
    </div>
  )
}

export default function InboxPage() {
  const [appUser, setAppUser]   = useState(null)
  const [rideInbox, setRideInbox] = useState([])
  const [rideLoading, setRideLoad] = useState(false)
  const [selectedRide, setSelectedRide] = useState(null)
  const [showSidebar, setShowSidebar] = useState(true)
  const [contextMenu, setContextMenu] = useState(null) // { ride_id }
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all') // 'all' | 'unread'
  const [showArchived, setShowArchived] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [showCoachMark, setShowCoachMark] = useState(false)
  const longPressTimer = useRef(null)

  // Persistent sets (localStorage)
  const [pinned,   setPinned]   = useState(() => loadSet(PINNED_KEY))
  const [archived, setArchived] = useState(() => loadSet(ARCHIVED_KEY))
  const [muted,    setMuted]    = useState(() => loadSet(MUTED_KEY))

  const togglePin = useCallback((rideId) => {
    setPinned(prev => {
      const next = new Set(prev)
      next.has(rideId) ? next.delete(rideId) : next.add(rideId)
      saveSet(PINNED_KEY, next)
      return next
    })
  }, [])

  const toggleArchive = useCallback((rideId) => {
    setArchived(prev => {
      const next = new Set(prev)
      next.has(rideId) ? next.delete(rideId) : next.add(rideId)
      saveSet(ARCHIVED_KEY, next)
      return next
    })
    setContextMenu(null)
  }, [])

  const toggleMute = useCallback((rideId) => {
    setMuted(prev => {
      const next = new Set(prev)
      next.has(rideId) ? next.delete(rideId) : next.add(rideId)
      saveSet(MUTED_KEY, next)
      return next
    })
    setContextMenu(null)
  }, [])

  useEffect(() => {
    getUserProfile().then(u => setAppUser(u)).catch(() => setAppUser(null))
  }, [])

  useEffect(() => {
    if (!localStorage.getItem(FIRST_TIME_KEY)) setShowCoachMark(true)
  }, [])

  const dismissCoachMark = () => {
    localStorage.setItem(FIRST_TIME_KEY, '1')
    setShowCoachMark(false)
  }

  useEffect(() => {
    const goOnline  = () => setIsOnline(true)
    const goOffline = () => setIsOnline(false)
    window.addEventListener('online',  goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online',  goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  const loadRideInbox = useCallback(() => {
    setRideLoad(true)
    getRideChatInbox()
      .then(d => {
        const convs = d.conversations || d.inbox || []
        // Sort: unread first (by unread_count desc), then by most-recent activity (ts desc)
        const sorted = [...convs].sort((a, b) => {
          const au = a.unread_count || 0
          const bu = b.unread_count || 0
          if (au !== bu) return bu - au  // unread first
          const ta = a.ts || a.timestamp || 0
          const tb = b.ts || b.timestamp || 0
          const na = typeof ta === 'number' ? ta : new Date(ta).getTime() / 1000
          const nb = typeof tb === 'number' ? tb : new Date(tb).getTime() / 1000
          return nb - na
        })
        setRideInbox(sorted)
      })
      .catch(() => setRideInbox([]))
      .finally(() => setRideLoad(false))
  }, [])

  useEffect(() => { loadRideInbox() }, [loadRideInbox])

  // Real-time ride chat updates — move updated thread to top and increment unread
  useEffect(() => {
    const onRideNotif = (data) => {
      if (data?.ride_id) {
        setRideInbox(prev => {
          const idx = prev.findIndex(item => item.ride_id === data.ride_id)
          // Increment unread only if chat is not currently selected and not muted
          const shouldBumpUnread = selectedRide?.ride_id !== data.ride_id && !muted.has(data.ride_id)
          if (idx < 0) { loadRideInbox(); return prev }
          const updated = {
            ...prev[idx],
            ts: Date.now() / 1000,
            unread_count: shouldBumpUnread ? (prev[idx].unread_count || 0) + 1 : prev[idx].unread_count,
          }
          const rest = prev.filter((_, i) => i !== idx)
          // Re-sort: unread first, then most-recent
          const next = [updated, ...rest].sort((a, b) => {
            const au = a.unread_count || 0
            const bu = b.unread_count || 0
            if (au !== bu) return bu - au
            return (b.ts || 0) - (a.ts || 0)
          })
          return next
        })
      } else {
        loadRideInbox()
      }
    }
    socket.on('ride_chat_notification', onRideNotif)
    return () => { socket.off('ride_chat_notification', onRideNotif) }
  }, [loadRideInbox, selectedRide, muted])

  // Base filtered + search
  const baseFiltered = rideInbox.filter(item => {
    if (archived.has(item.ride_id)) return false  // archived chats excluded from main list
    if (filter === 'unread' && !(item.unread_count > 0)) return false
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    const origin      = (item.ride_info?.origin      || item.origin      || '').toLowerCase()
    const destination = (item.ride_info?.destination || item.destination || '').toLowerCase()
    const companion   = (item.companion_name || item.driver_name || '').toLowerCase()
    return origin.includes(q) || destination.includes(q) || companion.includes(q)
  })

  // Pinned always shown, non-pinned limited to CHAT_LIMIT unless showMore
  const pinnedItems    = baseFiltered.filter(item => pinned.has(item.ride_id))
  const nonPinnedItems = baseFiltered.filter(item => !pinned.has(item.ride_id))
  const visibleNonPinned = showMore ? nonPinnedItems : nonPinnedItems.slice(0, CHAT_LIMIT)
  const filteredInbox  = [...pinnedItems, ...visibleNonPinned]

  // Archived chat list
  const archivedItems = rideInbox.filter(item => archived.has(item.ride_id))

  const handleSelectRide = (item) => {
    setRideInbox(prev => prev.map(r => r.ride_id === item.ride_id ? { ...r, unread_count: 0 } : r))
    setSelectedRide(item)
    setShowSidebar(false)
    setContextMenu(null)
  }
  const handleBack = () => { setSelectedRide(null); setShowSidebar(true) }

  const handleDeleteThread = (rideId) => {
    setRideInbox(prev => prev.filter(item => item.ride_id !== rideId))
    if (selectedRide?.ride_id === rideId) { setSelectedRide(null); setShowSidebar(true) }
    setContextMenu(null)
  }

  const handleLongPressStart = (rideId) => {
    longPressTimer.current = setTimeout(() => setContextMenu({ ride_id: rideId }), 500)
  }
  const handleLongPressEnd = () => clearTimeout(longPressTimer.current)

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [contextMenu])

  const totalUnread = rideInbox.filter(item => !muted.has(item.ride_id)).reduce((s, item) => s + (item.unread_count || 0), 0)

  return (
    <div style={{ background: 'var(--bg-page)', minHeight: '100vh' }} className="flex flex-col">
      <NavBar user={appUser || (appUser === null ? null : false)} title="Messages" />

      {/* ── Offline banner ── */}
      {!isOnline && (
        <div
          role="status"
          aria-live="polite"
          className="text-center text-xs py-2 px-4 font-medium"
          style={{ background: '#92400e', color: '#fef3c7' }}
        >
          You are offline. Messages will send when connection is restored.
        </div>
      )}

      {/* ── First-time coach mark ── */}
      {showCoachMark && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center pb-12 px-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          role="dialog"
          aria-label="Inbox tips"
          aria-modal="true"
        >
          <div
            className="rounded-2xl p-6 max-w-sm w-full space-y-3 shadow-2xl"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
          >
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>💬 Ride Chat Tips</h3>
            <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <li>🚗 Chat with your driver or passenger here.</li>
              <li>📌 Long-press or right-click to pin, archive, or mute a chat.</li>
              <li>🔔 Pinned chats always stay visible at the top.</li>
              <li>👆 Swipe left (or long-press) on a conversation to see options.</li>
            </ul>
            <button
              onClick={dismissCoachMark}
              className="w-full py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
            >
              Got it!
            </button>
          </div>
        </div>
      )}

      {/* ── Context menu (pin / archive / mute / delete) ── */}
      {contextMenu && (
        <div
          className="fixed z-50 rounded-xl shadow-2xl border overflow-hidden"
          style={{
            top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            background: 'var(--bg-card)', borderColor: 'var(--border-color)', minWidth: '200px',
          }}
          role="menu"
          aria-label="Conversation options"
          onClick={e => e.stopPropagation()}
        >
          <button
            role="menuitem"
            onClick={() => { togglePin(contextMenu.ride_id); setContextMenu(null) }}
            className="w-full text-left px-4 py-3 text-sm hover:opacity-80 flex items-center gap-2"
            style={{ color: 'var(--text-secondary)' }}
          >
            {pinned.has(contextMenu.ride_id) ? '📌 Unpin chat' : '📌 Pin chat'}
          </button>
          <button
            role="menuitem"
            onClick={() => toggleArchive(contextMenu.ride_id)}
            className="w-full text-left px-4 py-3 text-sm hover:opacity-80 flex items-center gap-2"
            style={{ color: 'var(--text-secondary)', borderTop: '1px solid var(--border-color)' }}
          >
            {archived.has(contextMenu.ride_id) ? '📂 Unarchive chat' : '🗂️ Archive chat'}
          </button>
          <button
            role="menuitem"
            onClick={() => toggleMute(contextMenu.ride_id)}
            className="w-full text-left px-4 py-3 text-sm hover:opacity-80 flex items-center gap-2"
            style={{ color: 'var(--text-secondary)', borderTop: '1px solid var(--border-color)' }}
          >
            {muted.has(contextMenu.ride_id) ? '🔔 Unmute notifications' : '🔕 Mute notifications'}
          </button>
          <button
            role="menuitem"
            onClick={() => handleDeleteThread(contextMenu.ride_id)}
            className="w-full text-left px-4 py-3 text-sm hover:opacity-80 text-red-400 flex items-center gap-2"
            style={{ borderTop: '1px solid var(--border-color)' }}
          >
            🗑️ Delete conversation
          </button>
          <button
            role="menuitem"
            onClick={() => setContextMenu(null)}
            className="w-full text-left px-4 py-3 text-sm hover:opacity-80 flex items-center gap-2"
            style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)' }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* ── Main layout ── */}
      <div
        className="flex-1 flex max-w-6xl mx-auto w-full px-2 md:px-4 py-3 gap-0 md:gap-3 min-h-0"
        style={{ maxHeight: 'calc(100vh - 56px)' }}
      >

        {/* ── Left panel (conversation list ≈ 35%) ── */}
        <aside
          aria-label="Ride conversations"
          className={`flex flex-col gap-2 ${!showSidebar ? 'hidden md:flex' : 'flex'} w-full md:w-[35%] shrink-0 rounded-xl border overflow-hidden`}
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
        >
          {/* Panel header */}
          <div
            className="px-4 pt-3 pb-2 border-b"
            style={{ borderColor: 'var(--border-color)' }}
          >
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                🚗 Ride Chats
                {totalUnread > 0 && (
                  <span
                    className="inbox-unread-badge min-w-[1.2rem] h-5 rounded-full px-1.5 text-xs flex items-center justify-center font-bold"
                    style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
                    aria-label={`${totalUnread} unread`}
                  >
                    {unreadLabel(totalUnread)}
                  </span>
                )}
              </h2>
              <button
                onClick={loadRideInbox}
                aria-label="Refresh conversations"
                className="text-base hover:opacity-70 transition-opacity"
                style={{ color: 'var(--text-muted)' }}
              >
                ↻
              </button>
            </div>

            {/* Search bar */}
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none" style={{ color: 'var(--text-muted)' }}>🔍</span>
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by destination or name…"
                aria-label="Search conversations"
                className="w-full rounded-lg pl-8 pr-3 py-1.5 text-xs outline-none"
                style={{
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                }}
              />
            </div>

            {/* Filter toggle */}
            <div
              className="flex gap-1 mt-2"
              role="group"
              aria-label="Message filter"
            >
              {[['all', 'All Messages'], ['unread', 'Unread Only']].map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setFilter(val)}
                  aria-pressed={filter === val}
                  className="flex-1 py-1 text-xs rounded-lg font-medium transition-colors"
                  style={
                    filter === val
                      ? { background: 'var(--accent)', color: 'var(--accent-text)' }
                      : { background: 'var(--bg-input)', color: 'var(--text-secondary)' }
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto" role="list" aria-label="Conversation list">
            {rideLoading ? (
              <p className="text-xs px-4 py-6 text-center" style={{ color: 'var(--text-muted)' }}>Loading…</p>
            ) : rideInbox.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 px-4 py-10 text-center">
                <span className="text-4xl">🚗</span>
                <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>No ride conversations yet.</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Book a ride to start chatting.</p>
              </div>
            ) : filteredInbox.length === 0 ? (
              <p className="text-xs px-4 py-6 text-center" style={{ color: 'var(--text-muted)' }}>No conversations match your search.</p>
            ) : filteredInbox.map((item, i) => {
              const isSelected   = selectedRide?.ride_id === item.ride_id
              const showCtxMenu  = contextMenu?.ride_id === item.ride_id
              const isPinned     = pinned.has(item.ride_id)
              const isMuted      = muted.has(item.ride_id)
              const origin       = item.ride_info?.origin      || item.origin      || '?'
              const destination  = item.ride_info?.destination || item.destination || '?'
              const companion    = item.companion_name || item.driver_name || ''
              const preview      = item.text || item.last_message || ''
              const badge        = isMuted ? null : unreadLabel(item.unread_count)
              const ariaLabel    = `Conversation: ${origin} to ${destination}${companion ? `, with ${companion}` : ''}${badge ? `, ${badge} unread` : ''}${isPinned ? ', pinned' : ''}`
              return (
                <div
                  key={item.ride_id || i}
                  role="listitem"
                  className="relative border-b last:border-b-0"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <button
                    onClick={() => handleSelectRide(item)}
                    onContextMenu={e => { e.preventDefault(); setContextMenu({ ride_id: item.ride_id }) }}
                    onTouchStart={() => handleLongPressStart(item.ride_id)}
                    onTouchEnd={handleLongPressEnd}
                    onTouchCancel={handleLongPressEnd}
                    aria-label={ariaLabel}
                    aria-selected={isSelected}
                    className="w-full text-left flex items-center gap-3 px-3 py-3 transition-colors hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
                    style={{
                      background: isSelected ? 'var(--bg-surface)' : 'transparent',
                      outlineColor: 'var(--accent)',
                    }}
                  >
                    {/* Avatar */}
                    <div className="relative">
                      <Avatar name={companion || destination} />
                      {isPinned && (
                        <span className="absolute -top-1 -right-1 text-xs" title="Pinned">📌</span>
                      )}
                      {isMuted && (
                        <span className="absolute -bottom-1 -right-1 text-xs" title="Muted">🔕</span>
                      )}
                    </div>

                    {/* Text block */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-1">
                        <p
                          className="text-sm font-semibold truncate"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {origin} → {destination}
                        </p>
                        <span
                          className="text-xs shrink-0"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {fmtTs(item.ts || item.timestamp)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-1 mt-0.5">
                        <p
                          className="text-xs truncate"
                          style={{ color: badge ? 'var(--text-secondary)' : 'var(--text-muted)', fontWeight: badge ? '500' : '400' }}
                        >
                          {preview || (companion ? `Chat with ${companion}` : 'Start conversation')}
                        </p>
                        {badge && (
                          <span
                            className="inbox-unread-badge min-w-[1.2rem] h-5 rounded-full px-1.5 text-xs flex items-center justify-center font-bold shrink-0"
                            style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
                            aria-label={`${item.unread_count} unread messages`}
                          >
                            {badge}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>

                  {/* Inline delete button appears when context menu is active */}
                  {showCtxMenu && (
                    <button
                      onClick={() => handleDeleteThread(item.ride_id)}
                      aria-label="Delete this conversation"
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full text-xs flex items-center justify-center bg-red-900/70 text-red-300 hover:bg-red-700 transition-colors"
                    >
                      ✕
                    </button>
                  )}
                </div>
              )
            })}

            {/* Show more / less toggle for non-pinned overflow */}
            {nonPinnedItems.length > CHAT_LIMIT && !search.trim() && filter === 'all' && (
              <button
                onClick={() => setShowMore(v => !v)}
                className="w-full text-center py-2.5 text-xs font-medium hover:opacity-80 transition-opacity"
                style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)' }}
              >
                {showMore
                  ? `▲ Show fewer chats`
                  : `▼ Show ${nonPinnedItems.length - CHAT_LIMIT} more chat${nonPinnedItems.length - CHAT_LIMIT !== 1 ? 's' : ''}`}
              </button>
            )}

            {/* Archived section */}
            {archivedItems.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border-color)' }}>
                <button
                  onClick={() => setShowArchived(v => !v)}
                  className="w-full text-left px-4 py-2 text-xs flex items-center gap-1.5 hover:opacity-80"
                  style={{ color: 'var(--text-muted)' }}
                >
                  🗂️ Archived ({archivedItems.length}) {showArchived ? '▲' : '▼'}
                </button>
                {showArchived && archivedItems.map((item, i) => {
                  const origin      = item.ride_info?.origin      || item.origin      || '?'
                  const destination = item.ride_info?.destination || item.destination || '?'
                  const companion   = item.companion_name || item.driver_name || ''
                  return (
                    <div key={item.ride_id || i} className="flex items-center gap-2 px-3 py-2 border-b"
                         style={{ borderColor: 'var(--border-color)' }}>
                      <button
                        onClick={() => handleSelectRide(item)}
                        className="flex items-center gap-2 flex-1 text-left text-xs hover:opacity-80"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        <Avatar name={companion || destination} size="w-7 h-7" textSize="text-xs" />
                        <span className="truncate">{origin} → {destination}</span>
                      </button>
                      <button
                        onClick={() => toggleArchive(item.ride_id)}
                        className="text-xs text-amber-500 hover:text-amber-400 shrink-0"
                        title="Unarchive"
                      >Unarchive</button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </aside>

        {/* ── Right panel (active conversation ≈ 65%) ── */}
        <section
          aria-label="Active conversation"
          className={`min-w-0 rounded-xl border overflow-hidden flex-col ${showSidebar ? 'hidden md:flex md:flex-1' : 'flex flex-1'}`}
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
        >
          {/* Mobile back navigation */}
          {!showSidebar && (
            <div
              className="flex md:hidden items-center gap-2 px-3 py-2 border-b"
              style={{ borderColor: 'var(--border-color)' }}
            >
              <button
                onClick={handleBack}
                aria-label="Back to conversation list"
                className="text-sm flex items-center gap-1 hover:opacity-70 transition-opacity"
                style={{ color: 'var(--text-secondary)' }}
              >
                ← Back
              </button>
            </div>
          )}

          {selectedRide ? (
            <div className="flex-1 min-h-0 flex flex-col">
              <RideChat ride={selectedRide} user={appUser} onClose={handleBack} />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
              <span className="text-5xl" aria-hidden="true">💬</span>
              <p className="text-base font-medium" style={{ color: 'var(--text-secondary)' }}>
                Select a ride conversation to begin messaging.
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Only ride-related conversations appear here.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

