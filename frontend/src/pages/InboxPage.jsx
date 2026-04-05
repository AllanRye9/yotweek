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
    const now = new Date()
    const diff = now - d
    if (diff < 60000) return 'now'
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm'
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h'
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  } catch { return '' }
}

export default function InboxPage() {
  const [appUser, setAppUser]         = useState(null)
  const [tab, setTab]                 = useState('dm')

  // DM state
  const [dmConvs, setDmConvs]         = useState([])
  const [dmLoading, setDmLoading]     = useState(false)
  const [selectedConv, setSelectedConv] = useState(null)

  // Ride chat state
  const [rideInbox, setRideInbox]     = useState([])
  const [rideLoading, setRideLoading] = useState(false)
  const [selectedRideChat, setSelectedRideChat] = useState(null)

  // Load user
  useEffect(() => {
    getUserProfile().then(u => setAppUser(u)).catch(() => setAppUser(null))
  }, [])

  // Load DM conversations when tab = dm
  useEffect(() => {
    if (tab !== 'dm') return
    setDmLoading(true)
    getDmConversations()
      .then(d => setDmConvs(d.conversations || d || []))
      .catch(() => setDmConvs([]))
      .finally(() => setDmLoading(false))
  }, [tab])

  // Load ride chat inbox when tab = rides
  useEffect(() => {
    if (tab !== 'rides') return
    setRideLoading(true)
    getRideChatInbox()
      .then(d => setRideInbox(d.inbox || []))
      .catch(() => setRideInbox([]))
      .finally(() => setRideLoading(false))
  }, [tab])

  // Real-time DM
  useEffect(() => {
    const onMsg = (msg) => {
      setDmConvs(prev => {
        const idx = prev.findIndex(c => c.conv_id === msg.conv_id)
        if (idx === -1) return prev
        const updated = [...prev]
        updated[idx] = { ...updated[idx], last_message: msg.content, timestamp: msg.ts }
        return updated
      })
    }
    socket.on('dm_message', onMsg)
    return () => socket.off('dm_message', onMsg)
  }, [])

  const inputCls = 'w-full rounded-lg px-3 py-2 text-sm outline-none'
  const inputSty = { background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }

  const TABS = [
    { id: 'dm',    label: '💬 Direct Messages' },
    { id: 'rides', label: '🚗 Ride Messages' },
  ]

  // Mobile: show sidebar or chat panel
  const [showSidebar, setShowSidebar] = useState(true)

  const handleSelectConv = (conv) => {
    setSelectedConv(conv)
    setShowSidebar(false)
  }

  const handleSelectRide = (item) => {
    setSelectedRideChat(item)
    setShowSidebar(false)
  }

  const handleBackToList = () => {
    setSelectedConv(null)
    setSelectedRideChat(null)
    setShowSidebar(true)
  }

  return (
    <div style={{ background: 'var(--bg-page)', minHeight: '100vh' }} className="flex flex-col">
      {/* Shared NavBar */}
      <NavBar user={appUser || (appUser === null ? null : false)} title="Inbox" />

      <div className="flex-1 flex max-w-4xl mx-auto w-full p-4 gap-4 min-h-0" style={{ maxHeight: 'calc(100vh - 56px)' }}>
        {/* Sidebar — full-width on mobile when no chat selected */}
        <div className={`flex-shrink-0 flex flex-col gap-3 ${!showSidebar ? 'hidden md:flex' : 'flex'} w-full md:w-56`}>
          {/* Tab buttons */}
          <div className="flex md:block gap-2 md:space-y-1">
            {TABS.map(t => (
              <button key={t.id} onClick={() => { setTab(t.id); setSelectedConv(null); setSelectedRideChat(null); setShowSidebar(true) }}
                      className={`flex-1 md:flex-none w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.id ? 'bg-amber-500 text-black' : 'hover:opacity-80'}`}
                      style={tab !== t.id ? { color: 'var(--text-secondary)' } : {}}>
                {t.label}
              </button>
            ))}
          </div>

          {/* DM conversation list */}
          {tab === 'dm' && (
            <div className="flex-1 overflow-y-auto space-y-1">
              {dmLoading ? (
                <p className="text-xs px-2 py-4 text-center" style={{ color: 'var(--text-muted)' }}>Loading…</p>
              ) : dmConvs.length === 0 ? (
                <p className="text-xs px-2 py-4 text-center" style={{ color: 'var(--text-muted)' }}>No conversations yet.</p>
              ) : dmConvs.map((conv, i) => {
                const other = conv.other_user || {}
                const isSelected = selectedConv?.conv_id === conv.conv_id
                return (
                  <button key={conv.conv_id || i}
                          onClick={() => handleSelectConv(conv)}
                          className={`w-full text-left flex items-center gap-2 px-2 py-2 rounded-lg transition-colors ${isSelected ? 'bg-amber-500/20' : 'hover:opacity-80'}`}
                          style={{ background: isSelected ? undefined : 'transparent' }}>
                    <div className="w-8 h-8 rounded-full bg-blue-700 flex items-center justify-center text-xs font-bold text-white shrink-0">
                      {(other.name || conv.name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {other.name || conv.name || 'User'}
                      </p>
                      <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
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
                )
              })}
            </div>
          )}

          {/* Ride chat inbox list */}
          {tab === 'rides' && (
            <div className="flex-1 overflow-y-auto space-y-1">
              {rideLoading ? (
                <p className="text-xs px-2 py-4 text-center" style={{ color: 'var(--text-muted)' }}>Loading…</p>
              ) : rideInbox.length === 0 ? (
                <p className="text-xs px-2 py-4 text-center" style={{ color: 'var(--text-muted)' }}>No ride chats yet.</p>
              ) : rideInbox.map((item, i) => {
                const isSelected = selectedRideChat?.ride_id === item.ride_id
                return (
                  <button key={item.ride_id || i}
                          onClick={() => handleSelectRide(item)}
                          className="w-full text-left flex flex-col px-2 py-2 rounded-lg transition-colors hover:opacity-80"
                          style={{ background: isSelected ? 'var(--bg-surface)' : 'transparent' }}>
                    <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                      {item.origin} → {item.destination}
                    </p>
                    <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                      {item.last_message || ''}
                    </p>
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

        {/* Chat panel — full width on mobile when a chat is selected */}
        <div className={`min-w-0 rounded-xl border overflow-hidden ${showSidebar ? 'hidden md:flex md:flex-1' : 'flex flex-1 flex-col'}`}
             style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>

          {/* Mobile back button */}
          {!showSidebar && (
            <div className="flex md:hidden items-center gap-2 px-3 py-2 border-b"
                 style={{ borderColor: 'var(--border-color)' }}>
              <button onClick={handleBackToList}
                      className="text-sm hover:opacity-70 transition-opacity"
                      style={{ color: 'var(--text-secondary)' }}>
                ← Back
              </button>
            </div>
          )}

          {tab === 'dm' && (
            selectedConv ? (
              <DMChat
                conv={selectedConv}
                currentUser={appUser}
                onClose={handleBackToList}
                onBack={handleBackToList}
              />
            ) : (
              <div className="flex items-center justify-center h-full p-8">
                <div className="text-center space-y-2">
                  <p className="text-4xl">💬</p>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    Select a conversation to start chatting
                  </p>
                </div>
              </div>
            )
          )}

          {tab === 'rides' && (
            selectedRideChat ? (
              <div className="flex-1">
                <RideChat
                  ride={selectedRideChat}
                  user={appUser}
                  onClose={handleBackToList}
                />
              </div>
            ) : (
              <div className="flex items-center justify-center h-full p-8">
                <div className="text-center space-y-2">
                  <p className="text-4xl">🚗</p>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    Select a ride conversation
                  </p>
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}
