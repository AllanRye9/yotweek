/**
 * PropertyInboxPage — Inbox for property-linked conversations between users and agents.
 *
 * Features:
 *   - Conversation list (left panel)
 *   - Chat view (right panel) with real-time Socket.IO
 *   - User messages on RIGHT, agent messages on LEFT
 *   - Property context shown per conversation
 *   - Typing indicators
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../App'
import UserAuth from '../components/UserAuth'
import UserProfile from '../components/UserProfile'
import {
  listPropertyConversations,
  getPropertyMessages,
  sendPropertyMessage,
  markPropertyConversationRead,
  getUserProfile,
} from '../api'
import socket from '../socket'

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const now = new Date()
  const diffDays = Math.floor((now - d) / 86400000)
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7)  return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// ─── Conversation List Item ────────────────────────────────────────────────────

function ConvListItem({ conv, isSelected, onClick }) {
  const unread = conv.unread_count ?? 0
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%', background: isSelected ? '#1e3a5f' : 'transparent',
        border: 'none', borderBottom: '1px solid #1f2937',
        padding: '12px 14px', cursor: 'pointer',
        textAlign: 'left', display: 'flex', gap: 10, alignItems: 'flex-start',
        transition: 'background 0.15s',
      }}
    >
      {/* Property icon */}
      <div style={{
        width: 44, height: 44, borderRadius: 10, background: '#374151',
        flexShrink: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem',
      }}>
        {conv.property?.cover_image ? (
          <img src={conv.property.cover_image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : '🏠'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 4 }}>
          <span style={{
            color: '#f3f4f6', fontSize: '0.85rem', fontWeight: isSelected ? 700 : 600,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {conv.property?.title ?? 'Property'}
          </span>
          {conv.last_message && (
            <span style={{ color: '#6b7280', fontSize: '0.7rem', flexShrink: 0 }}>
              {formatTime(conv.last_message.ts)}
            </span>
          )}
        </div>
        <div style={{ color: '#9ca3af', fontSize: '0.75rem', marginTop: 1 }}>
          {conv.role === 'user' ? `Agent: ${conv.agent?.name}` : `Buyer: ${conv.other_user?.name}`}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
          <span style={{
            color: '#6b7280', fontSize: '0.75rem',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '85%',
          }}>
            {conv.last_message?.content ?? 'Start a conversation'}
          </span>
          {unread > 0 && (
            <span style={{
              background: '#3b82f6', color: '#fff', borderRadius: 9999,
              padding: '1px 7px', fontSize: '0.68rem', fontWeight: 700, flexShrink: 0,
            }}>
              {unread}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

// ─── Chat View ────────────────────────────────────────────────────────────────

function ChatView({ conv, appUser, onConvUpdated }) {
  const [messages, setMessages]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [input, setInput]         = useState('')
  const [sending, setSending]     = useState(false)
  const [typing, setTyping]       = useState(false)  // other person typing
  const bottomRef   = useRef(null)
  const convIdRef   = useRef(null)
  const typingTimer = useRef(null)

  const convId = conv?.conv_id

  // Load messages and join socket room
  useEffect(() => {
    if (!convId) return
    convIdRef.current = convId
    setLoading(true)
    setMessages([])

    getPropertyMessages(convId)
      .then(data => {
        if (convIdRef.current === convId) {
          setMessages(data.messages ?? [])
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))

    // Mark read
    markPropertyConversationRead(convId).catch(() => {})

    // Join socket room
    socket.emit('prop_conv_join', { conv_id: convId })

    const handleMsg = (msg) => {
      if (msg.conv_id !== convId) return
      setMessages(prev => {
        if (prev.some(m => m.msg_id === msg.msg_id)) return prev
        return [...prev, msg]
      })
      // Mark read immediately since we're viewing
      markPropertyConversationRead(convId).catch(() => {})
      onConvUpdated?.()
    }

    const handleHistory = (data) => {
      if (data.conv_id === convId) {
        setMessages(data.history ?? [])
      }
    }

    const handleConvError = (data) => {
      if (data.conv_id === convId) {
        // Access denied or conversation not found via socket — REST layer
        // already enforces the same check, so this is informational only.
        console.warn('prop_conv_error', data.error)
      }
    }

    const handleTyping = (data) => {
      if (data.conv_id === convId && data.sender_id !== appUser?.user_id) {
        setTyping(true)
        clearTimeout(typingTimer.current)
        typingTimer.current = setTimeout(() => setTyping(false), 3000)
      }
    }

    const handleStopTyping = (data) => {
      if (data.conv_id === convId) setTyping(false)
    }

    socket.on('property_message',        handleMsg)
    socket.on('prop_conv_joined',        handleHistory)
    socket.on('prop_conv_error',         handleConvError)
    socket.on('prop_conv_typing',        handleTyping)
    socket.on('prop_conv_stop_typing',   handleStopTyping)

    return () => {
      socket.emit('prop_conv_leave', { conv_id: convId })
      socket.off('property_message',       handleMsg)
      socket.off('prop_conv_joined',       handleHistory)
      socket.off('prop_conv_error',        handleConvError)
      socket.off('prop_conv_typing',       handleTyping)
      socket.off('prop_conv_stop_typing',  handleStopTyping)
      clearTimeout(typingTimer.current)
    }
  }, [convId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, typing])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    setInput('')
    socket.emit('prop_conv_stop_typing', { conv_id: convId, sender_id: appUser?.user_id })
    try {
      await sendPropertyMessage(convId, text)
      onConvUpdated?.()
    } catch {
      setInput(text)  // restore on failure
    } finally {
      setSending(false)
    }
  }

  const handleInputChange = (e) => {
    setInput(e.target.value)
    if (convId && appUser?.user_id) {
      socket.emit('prop_conv_typing', { conv_id: convId, sender_id: appUser.user_id })
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const myUserId = appUser?.user_id
  const isUser   = conv?.user_id === myUserId

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Chat header */}
      <div style={{
        padding: '14px 18px', borderBottom: '1px solid #374151',
        background: '#111827', display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 10, background: '#374151',
          flexShrink: 0, overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem',
        }}>
          {conv?.property?.cover_image ? (
            <img src={conv.property.cover_image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : '🏠'}
        </div>
        <div>
          <div style={{ color: '#f3f4f6', fontWeight: 700, fontSize: '0.9rem' }}>
            {conv?.property?.title ?? 'Property'}
          </div>
          <div style={{ color: '#6b7280', fontSize: '0.75rem' }}>
            {isUser
              ? `Talking to: ${conv?.agent?.name ?? 'Agent'}`
              : `Talking to: ${conv?.other_user?.name ?? 'Buyer'}`}
          </div>
        </div>
        <Link
          to={`/properties/${conv?.property?.property_id}`}
          style={{ marginLeft: 'auto', color: '#3b82f6', fontSize: '0.78rem', textDecoration: 'none' }}
        >
          View Property →
        </Link>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '16px 18px',
        display: 'flex', flexDirection: 'column', gap: 10,
        background: '#0d1117',
      }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <div className="spinner w-8 h-8" />
          </div>
        ) : messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#4b5563', padding: 40 }}>
            <div style={{ fontSize: '2rem', marginBottom: 8 }}>💬</div>
            Send a message to start the conversation
          </div>
        ) : messages.map(msg => {
          const isMe = msg.sender_id === myUserId || msg.sender_role === (isUser ? 'user' : 'agent')
          return (
            <div
              key={msg.msg_id}
              style={{
                display: 'flex',
                justifyContent: isMe ? 'flex-end' : 'flex-start',
              }}
            >
              <div style={{
                maxWidth: '72%',
                background: isMe ? '#1d4ed8' : '#1f2937',
                color: '#f3f4f6',
                borderRadius: isMe ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                padding: '9px 13px',
                fontSize: '0.87rem',
                lineHeight: 1.5,
              }}>
                {msg.content}
                <div style={{ color: isMe ? '#93c5fd' : '#6b7280', fontSize: '0.68rem', marginTop: 4, textAlign: 'right' }}>
                  {formatTime(msg.ts)}
                </div>
              </div>
            </div>
          )
        })}

        {typing && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{
              background: '#1f2937', borderRadius: '14px 14px 14px 4px',
              padding: '10px 14px', display: 'flex', gap: 4, alignItems: 'center',
            }}>
              {[0, 1, 2].map(i => (
                <span
                  key={i}
                  style={{
                    width: 7, height: 7, borderRadius: '50%', background: '#6b7280',
                    animation: 'typing-dot 1.2s infinite',
                    animationDelay: `${i * 0.2}s`,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '12px 16px', borderTop: '1px solid #374151',
        background: '#111827', display: 'flex', gap: 8, alignItems: 'flex-end',
      }}>
        <textarea
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Type a message…"
          rows={1}
          style={{
            flex: 1, background: '#1f2937', color: '#f3f4f6',
            border: '1px solid #374151', borderRadius: 10,
            padding: '9px 12px', fontSize: '0.88rem', resize: 'none',
            outline: 'none', lineHeight: 1.5,
          }}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!input.trim() || sending}
          style={{
            background: input.trim() ? '#3b82f6' : '#374151',
            color: '#fff', border: 'none', borderRadius: 10,
            width: 40, height: 40, fontSize: '1.1rem', cursor: input.trim() ? 'pointer' : 'not-allowed',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}
        >
          ➤
        </button>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PropertyInboxPage() {
  const { admin }   = useAuth()
  const location    = useLocation()
  const navigate    = useNavigate()

  const [appUser, setAppUser]             = useState(null)
  const [userLoading, setUserLoading]     = useState(true)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [profileOpen, setProfileOpen]     = useState(false)
  const profileRef = useRef(null)

  const [conversations, setConversations] = useState([])
  const [convsLoading, setConvsLoading]   = useState(true)
  const [selectedConvId, setSelectedConvId] = useState(null)

  // Load user
  useEffect(() => {
    getUserProfile()
      .then(u => { setAppUser(u); return u })
      .catch(() => { setAppUser(false); return false })
      .finally(() => setUserLoading(false))
  }, [])

  // Close profile on outside click
  useEffect(() => {
    const h = (e) => { if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // Pre-select conv_id from query param
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const conv = params.get('conv')
    if (conv) setSelectedConvId(conv)
  }, [location.search])

  const loadConversations = useCallback(async () => {
    try {
      const data = await listPropertyConversations()
      setConversations(data.conversations ?? [])
    } catch {
      setConversations([])
    } finally {
      setConvsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (appUser) loadConversations()
    else if (appUser === false) setConvsLoading(false)
  }, [appUser, loadConversations])

  // Listen for incoming property message notifications to refresh conv list
  useEffect(() => {
    const handler = () => loadConversations()
    socket.on('property_message_notification', handler)
    return () => socket.off('property_message_notification', handler)
  }, [loadConversations])

  const selectedConv = conversations.find(c => c.conv_id === selectedConvId) ?? null

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <style>{`
        @keyframes typing-dot {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>

      {showAuthModal && !appUser && (
        <UserAuth
          onSuccess={u => { setAppUser(u); setShowAuthModal(false) }}
          onClose={() => setShowAuthModal(false)}
        />
      )}

      {/* ── Navbar ── */}
      <header style={{
        background: '#111827', borderBottom: '1px solid #1f2937',
        padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link to="/" style={{ color: '#3b82f6', fontWeight: 800, fontSize: '1.15rem', textDecoration: 'none' }}>
            🏠 YOT
          </Link>
          <nav style={{ display: 'flex', gap: 12 }}>
            <Link to="/" style={{ color: '#9ca3af', fontSize: '0.85rem', textDecoration: 'none' }}>Home</Link>
            <Link to="/properties" style={{ color: '#9ca3af', fontSize: '0.85rem', textDecoration: 'none' }}>Properties</Link>
            <Link to="/property-inbox" style={{ color: '#3b82f6', fontSize: '0.85rem', fontWeight: 600, textDecoration: 'none' }}>Inbox</Link>
          </nav>
        </div>
        <div ref={profileRef} style={{ position: 'relative' }}>
          {userLoading ? null : appUser ? (
            <div>
              <button
                type="button"
                onClick={() => setProfileOpen(o => !o)}
                style={{
                  background: '#1f2937', border: '1px solid #374151', borderRadius: 8,
                  padding: '6px 12px', color: '#d1d5db', fontSize: '0.82rem', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                {appUser.avatar_url ? (
                  <img src={appUser.avatar_url} alt="" style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover' }} />
                ) : <span>👤</span>}
                {appUser.name}
              </button>
              {profileOpen && (
                <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 200 }}>
                  <UserProfile user={appUser} onUpdate={u => { setAppUser(u); setProfileOpen(false) }} />
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowAuthModal(true)}
              style={{
                background: '#3b82f6', color: '#fff', border: 'none',
                borderRadius: 8, padding: '7px 16px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer',
              }}
            >Sign In</button>
          )}
        </div>
      </header>

      {/* ── Main layout ── */}
      {!appUser && !userLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: 40 }}>
          <div style={{ fontSize: '3rem', marginBottom: 16 }}>💬</div>
          <h2 style={{ color: '#f3f4f6', fontSize: '1.2rem', marginBottom: 8 }}>Property Inbox</h2>
          <p style={{ color: '#6b7280', marginBottom: 20 }}>Sign in to view your conversations with agents</p>
          <button
            type="button"
            onClick={() => setShowAuthModal(true)}
            style={{
              background: '#3b82f6', color: '#fff', border: 'none',
              borderRadius: 10, padding: '10px 24px', fontSize: '0.9rem',
              fontWeight: 600, cursor: 'pointer',
            }}
          >Sign In</button>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', minHeight: 0, height: 'calc(100vh - 57px)' }}>
          {/* Left: conversation list */}
          <div style={{
            width: 300, flexShrink: 0,
            borderRight: '1px solid #1f2937',
            background: '#111827',
            display: 'flex', flexDirection: 'column',
            overflowY: 'auto',
          }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #1f2937' }}>
              <h2 style={{ color: '#f3f4f6', fontSize: '0.95rem', fontWeight: 700, margin: 0 }}>
                Property Inbox
                {conversations.length > 0 && (
                  <span style={{ color: '#6b7280', fontWeight: 400, marginLeft: 6, fontSize: '0.82rem' }}>
                    {conversations.length}
                  </span>
                )}
              </h2>
            </div>

            {convsLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                <div className="spinner w-7 h-7" />
              </div>
            ) : conversations.length === 0 ? (
              <div style={{ padding: '40px 16px', textAlign: 'center', color: '#4b5563' }}>
                <div style={{ fontSize: '2rem', marginBottom: 8 }}>📭</div>
                <p style={{ fontSize: '0.85rem' }}>No conversations yet.</p>
                <Link to="/properties" style={{ color: '#3b82f6', fontSize: '0.82rem' }}>Browse Properties →</Link>
              </div>
            ) : conversations.map(conv => (
              <ConvListItem
                key={conv.conv_id}
                conv={conv}
                isSelected={conv.conv_id === selectedConvId}
                onClick={() => {
                  setSelectedConvId(conv.conv_id)
                  navigate(`/property-inbox?conv=${conv.conv_id}`, { replace: true })
                }}
              />
            ))}
          </div>

          {/* Right: chat */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {selectedConv ? (
              <ChatView
                key={selectedConvId}
                conv={selectedConv}
                appUser={appUser}
                onConvUpdated={loadConversations}
              />
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#4b5563' }}>
                <div style={{ fontSize: '3rem', marginBottom: 12 }}>💬</div>
                <p style={{ fontSize: '0.9rem' }}>Select a conversation to start chatting</p>
                <Link to="/properties" style={{ color: '#3b82f6', fontSize: '0.85rem', marginTop: 8 }}>
                  Browse Properties →
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
