/**
 * InboxPage — Ride Chat Inbox (sole communication method per Feature Area 4).
 *
 * Sidebar:
 *  - Ride chat conversation list, sorted newest-first (descending chronological order)
 *  - Long-press / right-click to delete a thread
 *
 * Chat panel:
 *  - RideChat for ride conversations
 *  - Empty state placeholder
 *
 * Direct Messages have been removed per Feature Area 4 spec.
 */
import { useState, useEffect, useRef } from 'react'
import NavBar from '../components/NavBar'
import RideChat from '../components/RideChat'
import {
  getUserProfile,
  getRideChatInbox,
} from '../api'
import socket from '../socket'

function fmtTs(ts) {
  if (!ts) return ''
  try {
    const d = typeof ts === 'number' && ts < 1e10 ? new Date(ts * 1000) : new Date(ts)
    const now  = new Date()
    const diff = now - d
    if (diff < 60000)    return 'now'
    if (diff < 3600000)  return Math.floor(diff / 60000)   + 'm'
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h'
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  } catch { return '' }
}

export default function InboxPage() {
  const [appUser, setAppUser]   = useState(null)
  const [rideInbox, setRideInbox] = useState([])
  const [rideLoading, setRideLoad] = useState(false)
  const [selectedRide, setSelectedRide] = useState(null)
  const [showSidebar, setShowSidebar] = useState(true)
  const [contextMenu, setContextMenu] = useState(null) // { ride_id, x, y }
  const longPressTimer = useRef(null)

  useEffect(() => {
    getUserProfile().then(u => setAppUser(u)).catch(() => setAppUser(null))
  }, [])

  const loadRideInbox = () => {
    setRideLoad(true)
    getRideChatInbox()
      .then(d => {
        const convs = d.conversations || d.inbox || []
        // Sort in descending chronological order (newest first)
        const sorted = [...convs].sort((a, b) => {
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
  }

  useEffect(() => { loadRideInbox() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Real-time ride chat updates
  useEffect(() => {
    const onRideNotif = () => loadRideInbox()
    socket.on('ride_chat_notification', onRideNotif)
    return () => { socket.off('ride_chat_notification', onRideNotif) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectRide = (item) => { setSelectedRide(item); setShowSidebar(false); setContextMenu(null) }
  const handleBack = () => { setSelectedRide(null); setShowSidebar(true) }

  // Delete a thread from the local inbox view
  const handleDeleteThread = (rideId) => {
    setRideInbox(prev => prev.filter(item => item.ride_id !== rideId))
    if (selectedRide?.ride_id === rideId) { setSelectedRide(null); setShowSidebar(true) }
    setContextMenu(null)
  }

  // Long-press handler for touch devices
  const handleLongPressStart = (rideId) => {
    longPressTimer.current = setTimeout(() => {
      setContextMenu({ ride_id: rideId })
    }, 500)
  }
  const handleLongPressEnd = () => { clearTimeout(longPressTimer.current) }

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [contextMenu])

  return (
    <div style={{ background: 'var(--bg-page)', minHeight: '100vh' }} className="flex flex-col">
      <NavBar user={appUser || (appUser === null ? null : false)} title="Inbox" />

      {/* Context menu for delete */}
      {contextMenu && (
        <div
          className="fixed z-50 rounded-lg shadow-xl border overflow-hidden"
          style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'var(--bg-card)', borderColor: 'var(--border-color)', minWidth: '160px' }}
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={() => handleDeleteThread(contextMenu.ride_id)}
            className="w-full text-left px-4 py-3 text-sm hover:opacity-80 text-red-400"
          >
            🗑️ Delete conversation
          </button>
          <button
            onClick={() => setContextMenu(null)}
            className="w-full text-left px-4 py-3 text-sm hover:opacity-80"
            style={{ color: 'var(--text-secondary)', borderTop: '1px solid var(--border-color)' }}
          >
            Cancel
          </button>
        </div>
      )}

      <div className="flex-1 flex max-w-4xl mx-auto w-full px-4 py-4 gap-4 min-h-0" style={{ maxHeight: 'calc(100vh - 56px)' }}>

        {/* ── Sidebar ── */}
        <div className={`flex-shrink-0 flex flex-col gap-3 ${!showSidebar ? 'hidden md:flex' : 'flex'} w-full md:w-60`}>

          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>🚗 Ride Chats</h2>
            <button onClick={loadRideInbox} className="text-xs hover:opacity-70" style={{ color: 'var(--text-muted)' }}>↻</button>
          </div>

          {/* Ride list — descending chronological order */}
          <div className="flex-1 overflow-y-auto space-y-1">
            {rideLoading ? (
              <p className="text-xs px-2 py-4 text-center" style={{ color: 'var(--text-muted)' }}>Loading…</p>
            ) : rideInbox.length === 0 ? (
              <p className="text-xs px-2 py-4 text-center" style={{ color: 'var(--text-muted)' }}>No ride chats yet.</p>
            ) : rideInbox.map((item, i) => {
              const isSelected = selectedRide?.ride_id === item.ride_id
              const showCtxMenu = contextMenu?.ride_id === item.ride_id
              return (
                <div key={item.ride_id || i} className="relative">
                  <button
                    onClick={() => handleSelectRide(item)}
                    onContextMenu={e => { e.preventDefault(); setContextMenu({ ride_id: item.ride_id }) }}
                    onTouchStart={() => handleLongPressStart(item.ride_id)}
                    onTouchEnd={handleLongPressEnd}
                    onTouchCancel={handleLongPressEnd}
                    className="w-full text-left flex flex-col px-2 py-2 rounded-lg transition-colors hover:opacity-80"
                    style={{ background: isSelected ? 'var(--bg-surface)' : 'transparent' }}>
                    <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                      {item.ride_info?.origin || item.origin || '?'} → {item.ride_info?.destination || item.destination || '?'}
                    </p>
                    <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{item.text || item.last_message || ''}</p>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{fmtTs(item.ts || item.timestamp)}</span>
                      {item.unread_count > 0 && (
                        <span className="w-4 h-4 rounded-full bg-amber-500 text-black text-xs flex items-center justify-center font-bold">
                          {item.unread_count}
                        </span>
                      )}
                    </div>
                  </button>
                  {/* Inline delete button appears on hover for desktop */}
                  {showCtxMenu && (
                    <button
                      onClick={() => handleDeleteThread(item.ride_id)}
                      className="absolute right-1 top-1 w-6 h-6 rounded-full text-xs flex items-center justify-center bg-red-900/70 text-red-300 hover:bg-red-700 transition-colors"
                      title="Delete conversation"
                    >✕</button>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Chat Panel ── */}
        <div className={`min-w-0 rounded-xl border overflow-hidden ${showSidebar ? 'hidden md:flex md:flex-1' : 'flex flex-1 flex-col'}`}
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>

          {/* Mobile back */}
          {!showSidebar && (
            <div className="flex md:hidden items-center gap-2 px-3 py-2 border-b" style={{ borderColor: 'var(--border-color)' }}>
              <button onClick={handleBack} className="text-sm hover:opacity-70" style={{ color: 'var(--text-secondary)' }}>
                ← Back
              </button>
            </div>
          )}

          {selectedRide ? (
            <div className="flex-1">
              <RideChat ride={selectedRide} user={appUser} onClose={handleBack} />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full p-8">
              <div className="text-center space-y-2">
                <p className="text-4xl">🚗</p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Select a ride conversation</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
