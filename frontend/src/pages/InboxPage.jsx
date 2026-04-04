import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import DMChat from '../components/DMChat'
import RideChat from '../components/RideChat'
import {
  getUserProfile,
  getDmConversations,
  getDmMessages,
  getRideChatInbox,
  getNotifications,
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
  const navigate   = useNavigate()
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
    { id: 'realestate', label: '🏠 Real Estate' },
  ]

  return (
    <div style={{ background: 'var(--bg-page)', minHeight: '100vh' }} className="flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}>
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/rides')}
                  className="text-sm hover:opacity-70 transition-opacity"
                  style={{ color: 'var(--text-secondary)' }}>
            ← Back
          </button>
          <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Inbox</h1>
        </div>
      </header>

      <div className="flex-1 flex max-w-4xl mx-auto w-full p-4 gap-4">
        {/* Sidebar */}
        <div className="w-56 flex-shrink-0 flex flex-col gap-3">
          {/* Tab buttons */}
          <div className="space-y-1">
            {TABS.map(t => (
              <button key={t.id} onClick={() => { setTab(t.id); setSelectedConv(null); setSelectedRideChat(null) }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.id ? 'bg-amber-500 text-black' : 'hover:opacity-80'}`}
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
                          onClick={() => setSelectedConv(conv)}
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
                          onClick={() => setSelectedRideChat(item)}
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

        {/* Chat panel */}
        <div className="flex-1 min-w-0 rounded-xl border overflow-hidden"
             style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>

          {tab === 'dm' && (
            selectedConv ? (
              <DMChat
                conv={selectedConv}
                currentUser={appUser}
                onClose={() => setSelectedConv(null)}
                onBack={() => setSelectedConv(null)}
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
              <div className="h-full">
                <RideChat
                  ride={selectedRideChat}
                  user={appUser}
                  onClose={() => setSelectedRideChat(null)}
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

          {tab === 'realestate' && (
            <div className="flex items-center justify-center h-full p-8">
              <div className="text-center space-y-2">
                <p className="text-4xl">🏗️</p>
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Coming soon</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Real estate messaging will be available here.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
