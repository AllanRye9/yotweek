/**
 * InboxPage — Two-panel advanced inbox.
 *
 * Sidebar:
 *  - Tab selector (DM / Ride Messages)
 *  - Conversation list with delivery state indicators, unread badge, timestamp
 *  - Date separators grouping conversations by day
 *
 * Chat panel:
 *  - DMChat (with media toolbar, date separators, typing indicator, delivery states)
 *  - RideChat for ride conversations
 *  - Empty state placeholder
 */
import { useState, useEffect } from 'react'
import NavBar from '../components/NavBar'
import DMChat from '../components/DMChat'
import RideChat from '../components/RideChat'
import {
  getUserProfile,
  getDmConversations,
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

function convDateGroup(ts) {
  if (!ts) return null
  const d = typeof ts === 'number' && ts < 1e10 ? new Date(ts * 1000) : new Date(ts)
  return d.toDateString()
}

function friendlyGroup(dateStr) {
  if (!dateStr) return ''
  const d   = new Date(dateStr)
  const now  = new Date()
  const y    = new Date(now); y.setDate(now.getDate() - 1)
  if (d.toDateString() === now.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString())   return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function DeliveryDot({ state }) {
  if (state === 'read')      return <span className="text-blue-400 text-xs" title="Read">✓✓</span>
  if (state === 'delivered') return <span className="text-gray-400 text-xs" title="Delivered">✓✓</span>
  if (state === 'sent')      return <span className="text-gray-500 text-xs" title="Sent">✓</span>
  return null
}

export default function InboxPage() {
  const [appUser, setAppUser]   = useState(null)
  const [tab,     setTab]       = useState('dm')
  const [dmConvs, setDmConvs]   = useState([])
  const [dmLoading, setDmLoad]  = useState(false)
  const [selectedConv, setSelectedConv] = useState(null)
  const [rideInbox, setRideInbox] = useState([])
  const [rideLoading, setRideLoad] = useState(false)
  const [selectedRide, setSelectedRide] = useState(null)
  const [showSidebar, setShowSidebar] = useState(true)

  useEffect(() => {
    getUserProfile().then(u => setAppUser(u)).catch(() => setAppUser(null))
  }, [])

  useEffect(() => {
    if (tab !== 'dm') return
    setDmLoad(true)
    getDmConversations()
      .then(d => setDmConvs(d.conversations || d || []))
      .catch(() => setDmConvs([]))
      .finally(() => setDmLoad(false))
  }, [tab])

  useEffect(() => {
    if (tab !== 'rides') return
    setRideLoad(true)
    getRideChatInbox()
      .then(d => setRideInbox(d.inbox || []))
      .catch(() => setRideInbox([]))
      .finally(() => setRideLoad(false))
  }, [tab])

  // Real-time DM update
  useEffect(() => {
    const onMsg = (msg) => {
      setDmConvs(prev => {
        const idx = prev.findIndex(c => c.conv_id === msg.conv_id)
        if (idx === -1) return prev
        const updated = [...prev]
        updated[idx] = { ...updated[idx], last_message: msg.content, timestamp: msg.ts, last_delivery: msg.status || 'sent' }
        return updated
      })
    }
    socket.on('dm_message', onMsg)
    return () => socket.off('dm_message', onMsg)
  }, [])

  const handleSelectConv = (conv) => { setSelectedConv(conv); setShowSidebar(false) }
  const handleSelectRide = (item) => { setSelectedRide(item);  setShowSidebar(false) }
  const handleBack = () => { setSelectedConv(null); setSelectedRide(null); setShowSidebar(true) }

  const TABS = [
    { id: 'dm',    label: '💬 Direct' },
    { id: 'rides', label: '🚗 Rides'  },
  ]

  // Build date-grouped DM list
  let prevGroup = null
  const dmWithGroups = dmConvs.map(c => {
    const g    = convDateGroup(c.timestamp)
    const show = g !== prevGroup
    prevGroup  = g
    return { ...c, _showGroup: show, _group: g }
  })

  return (
    <div style={{ background: 'var(--bg-page)', minHeight: '100vh' }} className="flex flex-col">
      <NavBar user={appUser || (appUser === null ? null : false)} title="Inbox" />

      <div className="flex-1 flex max-w-4xl mx-auto w-full p-4 gap-4 min-h-0" style={{ maxHeight: 'calc(100vh - 56px)' }}>

        {/* ── Sidebar ── */}
        <div className={`flex-shrink-0 flex flex-col gap-3 ${!showSidebar ? 'hidden md:flex' : 'flex'} w-full md:w-60`}>

          {/* Tabs */}
          <div className="flex md:block gap-2 md:space-y-1">
            {TABS.map(t => (
              <button key={t.id}
                onClick={() => { setTab(t.id); setSelectedConv(null); setSelectedRide(null); setShowSidebar(true) }}
                className={`flex-1 md:flex-none w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${tab === t.id ? 'bg-amber-500 text-black' : 'hover:opacity-80'}`}
                style={tab !== t.id ? { color: 'var(--text-secondary)' } : {}}>
                {t.label}
              </button>
            ))}
          </div>

          {/* DM list */}
          {tab === 'dm' && (
            <div className="flex-1 overflow-y-auto space-y-0.5">
              {dmLoading ? (
                <p className="text-xs px-2 py-4 text-center" style={{ color: 'var(--text-muted)' }}>Loading…</p>
              ) : dmConvs.length === 0 ? (
                <p className="text-xs px-2 py-4 text-center" style={{ color: 'var(--text-muted)' }}>No conversations yet.</p>
              ) : dmWithGroups.map((conv, i) => {
                const other      = conv.other_user || {}
                const isSelected = selectedConv?.conv_id === conv.conv_id
                return (
                  <div key={conv.conv_id || i}>
                    {/* Date group separator */}
                    {conv._showGroup && conv._group && (
                      <p className="text-xs px-2 py-1 mt-2" style={{ color: 'var(--text-muted)' }}>
                        {friendlyGroup(conv._group)}
                      </p>
                    )}
                    <button
                      onClick={() => handleSelectConv(conv)}
                      className={`w-full text-left flex items-center gap-2 px-2 py-2 rounded-lg transition-colors ${isSelected ? 'bg-amber-500/20' : 'hover:opacity-80'}`}
                      style={{ background: isSelected ? undefined : 'transparent' }}>
                      <div className="w-8 h-8 rounded-full bg-blue-700 flex items-center justify-center text-xs font-bold text-white shrink-0">
                        {(other.name || conv.name || '?').charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                          {other.name || conv.name || 'User'}
                        </p>
                        <p className="text-xs truncate flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                          {conv.last_delivery && <DeliveryDot state={conv.last_delivery} />}
                          {conv.last_message || ''}
                        </p>
                      </div>
                      <div className="flex flex-col items-end shrink-0 gap-0.5">
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{fmtTs(conv.timestamp)}</span>
                        {conv.unread_count > 0 && (
                          <span className="w-4 h-4 rounded-full bg-amber-500 text-black text-xs flex items-center justify-center font-bold leading-none">
                            {conv.unread_count}
                          </span>
                        )}
                      </div>
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Ride list */}
          {tab === 'rides' && (
            <div className="flex-1 overflow-y-auto space-y-1">
              {rideLoading ? (
                <p className="text-xs px-2 py-4 text-center" style={{ color: 'var(--text-muted)' }}>Loading…</p>
              ) : rideInbox.length === 0 ? (
                <p className="text-xs px-2 py-4 text-center" style={{ color: 'var(--text-muted)' }}>No ride chats yet.</p>
              ) : rideInbox.map((item, i) => {
                const isSelected = selectedRide?.ride_id === item.ride_id
                return (
                  <button key={item.ride_id || i}
                    onClick={() => handleSelectRide(item)}
                    className="w-full text-left flex flex-col px-2 py-2 rounded-lg transition-colors hover:opacity-80"
                    style={{ background: isSelected ? 'var(--bg-surface)' : 'transparent' }}>
                    <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                      {item.origin} → {item.destination}
                    </p>
                    <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{item.last_message || ''}</p>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{fmtTs(item.timestamp)}</span>
                      {item.unread_count > 0 && (
                        <span className="w-4 h-4 rounded-full bg-amber-500 text-black text-xs flex items-center justify-center font-bold">
                          {item.unread_count}
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
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

          {tab === 'dm' && (
            selectedConv ? (
              <DMChat conv={selectedConv} currentUser={appUser} onClose={handleBack} onBack={handleBack} />
            ) : (
              <div className="flex items-center justify-center h-full p-8">
                <div className="text-center space-y-2">
                  <p className="text-4xl">💬</p>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Select a conversation to start chatting</p>
                </div>
              </div>
            )
          )}

          {tab === 'rides' && (
            selectedRide ? (
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
            )
          )}
        </div>
      </div>
    </div>
  )
}
