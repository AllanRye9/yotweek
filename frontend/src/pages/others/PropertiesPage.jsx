/**
 * PropertiesPage — Property discovery with card grid and inline chat.
 *
 * Features:
 *   - Grid of property cards with image, details, and status
 *   - Filter by status and property type
 *   - "Chat with Agent" button on each card opens an inline chat box
 *   - Click "View Details" → navigate to PropertyDetailPage
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../App'
import UserAuth from '../components/UserAuth'
import ThemeSelector from '../components/ThemeSelector'
import {
  listProperties, getUserProfile,
  startPropertyConversation, getPropertyMessages, sendPropertyMessage,
} from '../api'
import socket from '../socket'

// Status colours
const STATUS_COLOR = { active: '#22c55e', sold: '#ef4444', rented: '#f59e0b', empty: '#60a5fa', occupied: '#f87171', soon_empty: '#a78bfa' }
const STATUS_LABEL = { active: 'Active', sold: 'Sold', rented: 'Rented', empty: 'Empty', occupied: 'Occupied', soon_empty: 'Soon Empty' }
const STATUS_BG    = { active: '#22c55e22', sold: '#ef444422', rented: '#f59e0b22', empty: '#60a5fa22', occupied: '#f8717122', soon_empty: '#a78bfa22' }
const OCCUPANCY_COLOR = { empty: '#60a5fa', occupied: '#f87171', soon_empty: '#a78bfa' }
const OCCUPANCY_LABEL = { empty: '🟢 Empty', occupied: '🔴 Occupied', soon_empty: '🟣 Soon Empty' }

function formatPrice(price) {
  if (!price) return 'POA'
  return '£' + Number(price).toLocaleString('en-GB') + '/mo'
}

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// ─── Inline Property Chat ──────────────────────────────────────────────────────

function InlinePropertyChat({ property, currentUser, onClose }) {
  const [conv, setConv]       = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput]     = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const bottomRef             = useRef(null)

  // Start or find conversation
  useEffect(() => {
    let active = true
    startPropertyConversation(property.property_id, property.agent_id)
      .then(res => {
        if (!active) return
        const c = res.conversation ?? res
        setConv(c)
        return getPropertyMessages(c.conv_id)
      })
      .then(res => {
        if (!active) return
        setMessages(res?.messages ?? [])
      })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [property.property_id, property.agent_id])

  // Socket.IO real-time messages
  useEffect(() => {
    if (!conv?.conv_id) return
    socket.emit('prop_conv_join', { conv_id: conv.conv_id })
    const handler = (msg) => {
      if (msg.conv_id === conv.conv_id) setMessages(prev => [...prev, msg])
    }
    socket.on('prop_conv_message', handler)
    return () => {
      socket.off('prop_conv_message', handler)
    }
  }, [conv?.conv_id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async (e) => {
    e.preventDefault()
    if (!input.trim() || !conv?.conv_id || sending) return
    setSending(true)
    try {
      const msg = await sendPropertyMessage(conv.conv_id, input.trim())
      setMessages(prev => [...prev, msg.message ?? msg])
      setInput('')
    } catch {}
    finally { setSending(false) }
  }

  return (
    <div style={{
      borderTop: '1px solid var(--border-color)',
      background: 'var(--bg-input)',
      borderRadius: '0 0 12px 12px',
    }}>
      {/* Chat header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', borderBottom: '1px solid var(--border-color)',
      }}>
        <span style={{ color: 'var(--text-primary)', fontSize: '0.8rem', fontWeight: 700 }}>
          💬 Chat with Agent
        </span>
        <button
          type="button"
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.9rem' }}
        >✕</button>
      </div>

      {/* Messages */}
      <div style={{ height: 200, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 16 }}>
            <div className="spinner w-6 h-6" />
          </div>
        ) : messages.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', textAlign: 'center', marginTop: 16 }}>
            No messages yet. Send a message to start!
          </p>
        ) : messages.map((msg, i) => {
          const isMine = msg.sender_id === currentUser?.user_id
          return (
            <div key={msg.msg_id ?? i} style={{
              alignSelf: isMine ? 'flex-end' : 'flex-start',
              maxWidth: '80%',
            }}>
              <div style={{
                background: isMine ? '#3b82f6' : 'var(--bg-surface)',
                color: isMine ? '#fff' : 'var(--text-primary)',
                borderRadius: isMine ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                padding: '6px 10px',
                fontSize: '0.78rem',
                border: isMine ? 'none' : '1px solid var(--border-color)',
              }}>
                {msg.content}
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', marginTop: 2, textAlign: isMine ? 'right' : 'left' }}>
                {formatTime(msg.ts ?? msg.created_at)}
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} style={{ display: 'flex', gap: 6, padding: '8px 12px', borderTop: '1px solid var(--border-color)' }}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Type a message…"
          style={{
            flex: 1, background: 'var(--bg-surface)', border: '1px solid var(--border-color)',
            borderRadius: 8, padding: '6px 10px', fontSize: '0.8rem', color: 'var(--text-primary)',
          }}
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          style={{
            background: '#3b82f6', color: '#fff', border: 'none',
            borderRadius: 8, padding: '6px 12px', fontSize: '0.8rem',
            fontWeight: 600, cursor: input.trim() ? 'pointer' : 'not-allowed',
            opacity: input.trim() ? 1 : 0.5,
          }}
        >
          {sending ? '…' : 'Send'}
        </button>
      </form>
    </div>
  )
}

// ─── Property Card ────────────────────────────────────────────────────────────

function PropertyCard({ property, currentUser, onRequireAuth }) {
  const navigate = useNavigate()
  const [chatOpen, setChatOpen] = useState(false)
  const color = STATUS_COLOR[property.status] ?? 'var(--text-secondary)'

  const handleChatClick = (e) => {
    e.stopPropagation()
    if (!currentUser) { onRequireAuth?.(); return }
    setChatOpen(o => !o)
  }

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1.5px solid var(--border-color)',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Cover image */}
      <div style={{ position: 'relative', height: 200, background: 'var(--bg-input)', overflow: 'hidden', flexShrink: 0 }}>
        {property.cover_image ? (
          <img
            src={property.cover_image}
            alt={property.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            loading="lazy"
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: '3rem' }}>🏠</div>
        )}
        {/* Status badge */}
        <span style={{
          position: 'absolute', top: 10, right: 10,
          background: STATUS_BG[property.status] ?? '#6b728033',
          color,
          border: `1px solid ${color}44`,
          borderRadius: 9999,
          padding: '3px 10px',
          fontSize: '0.72rem',
          fontWeight: 700,
          backdropFilter: 'blur(4px)',
        }}>
          {STATUS_LABEL[property.status] ?? property.status}
        </span>
        {/* Price badge */}
        <span style={{
          position: 'absolute', bottom: 10, left: 10,
          background: 'rgba(0,0,0,0.75)',
          color: '#fff',
          borderRadius: 8,
          padding: '4px 10px',
          fontSize: '0.9rem',
          fontWeight: 700,
        }}>
          {formatPrice(property.price)}
        </span>
      </div>

      {/* Details */}
      <div style={{ padding: '12px 14px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h3 style={{ color: 'var(--text-primary)', fontSize: '1rem', fontWeight: 700, margin: 0, lineHeight: 1.3 }}>
          {property.title}
        </h3>
        {property.address && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: 0 }}>
            📍 {property.address}
          </p>
        )}
        {property.occupancy_status && OCCUPANCY_LABEL[property.occupancy_status] && (
          <p style={{ fontSize: '0.78rem', margin: 0, color: OCCUPANCY_COLOR[property.occupancy_status] ?? 'var(--text-secondary)' }}>
            {OCCUPANCY_LABEL[property.occupancy_status]}
            {property.occupancy_status === 'soon_empty' && property.available_date
              ? ` · Available ${property.available_date}`
              : ''}
          </p>
        )}
        {property.description && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', margin: 0, lineHeight: 1.5,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {property.description}
          </p>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 6 }}>
          <button
            type="button"
            onClick={() => navigate(`/properties/${property.property_id}`)}
            style={{
              flex: 1, background: '#3b82f6', color: '#fff', border: 'none',
              borderRadius: 8, padding: '8px 12px', fontSize: '0.8rem',
              fontWeight: 600, cursor: 'pointer',
            }}
          >
            View Details →
          </button>
          <button
            type="button"
            onClick={handleChatClick}
            style={{
              flex: 1,
              background: chatOpen ? 'rgba(59,130,246,0.2)' : 'var(--bg-input)',
              color: chatOpen ? '#60a5fa' : 'var(--text-secondary)',
              border: `1px solid ${chatOpen ? '#3b82f6' : 'var(--border-color)'}`,
              borderRadius: 8, padding: '8px 12px', fontSize: '0.8rem',
              fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {chatOpen ? '💬 Close Chat' : '💬 Chat with Agent'}
          </button>
        </div>
      </div>

      {/* Inline chat */}
      {chatOpen && (
        <InlinePropertyChat
          property={property}
          currentUser={currentUser}
          onClose={() => setChatOpen(false)}
        />
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PropertiesPage() {
  const { admin } = useAuth()
  const navigate  = useNavigate()

  const [appUser, setAppUser]             = useState(null)
  const [userLoading, setUserLoading]     = useState(true)
  const [showAuthModal, setShowAuthModal] = useState(false)

  const [properties, setProperties]       = useState([])
  const [loading, setLoading]             = useState(true)
  const [statusFilter, setStatusFilter]   = useState('')
  const [typeFilter, setTypeFilter]       = useState('')

  // Load user
  useEffect(() => {
    getUserProfile()
      .then(u => setAppUser(u))
      .catch(() => setAppUser(false))
      .finally(() => setUserLoading(false))
  }, [])

  // Fetch properties
  const fetchProperties = useCallback(async () => {
    setLoading(true)
    try {
      const params = {}
      if (statusFilter) params.status = statusFilter
      if (typeFilter) params.property_type = typeFilter
      const data = await listProperties(params)
      setProperties(data.properties ?? [])
    } catch {
      setProperties([])
    } finally {
      setLoading(false)
    }
  }, [statusFilter, typeFilter])

  useEffect(() => { fetchProperties() }, [fetchProperties])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-page)', display: 'flex', flexDirection: 'column' }}>
      {showAuthModal && !appUser && (
        <UserAuth
          onSuccess={u => { setAppUser(u); setShowAuthModal(false) }}
          onClose={() => setShowAuthModal(false)}
        />
      )}

      {/* ── Navbar ── */}
      <nav className="sticky top-0 z-50 bg-gray-950/95 backdrop-blur border-b border-gray-800">
        <div className="max-w-full px-4 flex items-center h-14 gap-4">
          <Link to="/" className="flex items-center gap-2 text-xl font-bold text-white shrink-0">
            <img src="/yotweek.png" alt="" width={22} height={22} style={{ borderRadius: 4 }} aria-hidden="true" />
            <span className="gradient-text hidden sm:inline">yotweek</span>
          </Link>
          <Link to="/" className="text-xs text-gray-400 hover:text-white transition-colors">← Home</Link>
          <div className="flex-1" />
          <ThemeSelector />
          {!userLoading && (appUser ? (
            <button
              onClick={() => navigate('/profile')}
              className="w-8 h-8 rounded-full bg-blue-700 hover:bg-blue-600 flex items-center justify-center text-base transition-colors overflow-hidden"
              aria-label="Profile"
            >
              {appUser.avatar_url
                ? <img src={appUser.avatar_url} alt="" className="w-full h-full object-cover" />
                : <span>{appUser.role === 'driver' ? '🚗' : '🧍'}</span>
              }
            </button>
          ) : (
            <button
              onClick={() => setShowAuthModal(true)}
              className="text-xs px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-white transition-colors"
            >
              Login / Register
            </button>
          ))}
          {admin && (
            <Link to="/const" className="btn-secondary btn-sm hidden sm:inline-flex">Dashboard</Link>
          )}
        </div>
      </nav>

      {/* ── Page header ── */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
          <div>
            <h1 style={{ color: 'var(--text-primary)', fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>🏠 Property Discovery</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', margin: '2px 0 0' }}>
              {properties.length} propert{properties.length !== 1 ? 'ies' : 'y'} found
            </p>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              style={{
                background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)',
                borderRadius: 8, padding: '6px 10px', fontSize: '0.8rem', cursor: 'pointer',
              }}
            >
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="sold">Sold</option>
              <option value="rented">Rented</option>
              <option value="empty">Empty</option>
              <option value="occupied">Occupied</option>
              <option value="soon_empty">Soon Empty</option>
            </select>
          </div>
        </div>

        {/* Property type tabs */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { id: '',           label: 'All' },
            { id: 'short_stay', label: '🛏 Short Stay' },
            { id: 'rentals',    label: '🔑 Rentals' },
            { id: 'sale',       label: '🏷 Sale' },
            { id: 'purchase',   label: '🏡 Purchase' },
            { id: 'hotels',     label: '🏨 Hotels' },
            { id: 'listings',   label: '�� Listings' },
          ].map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTypeFilter(t.id)}
              style={{
                borderRadius: 9999, padding: '5px 14px', fontSize: '0.78rem',
                fontWeight: 600, cursor: 'pointer',
                border: typeFilter === t.id ? '2px solid #3b82f6' : '1px solid var(--border-color)',
                background: typeFilter === t.id ? 'rgba(59,130,246,0.18)' : 'var(--bg-input)',
                color: typeFilter === t.id ? '#60a5fa' : 'var(--text-secondary)',
                transition: 'all 0.15s',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Property Grid ── */}
      <main style={{ flex: 1, padding: '20px', overflowY: 'auto' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
            <div className="spinner w-10 h-10" />
          </div>
        ) : properties.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-secondary)' }}>
            <div style={{ fontSize: '3rem', marginBottom: 12 }}>🏠</div>
            <p>No properties found. Try adjusting your filters.</p>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: '20px',
          }}>
            {properties.map(prop => (
              <PropertyCard
                key={prop.property_id}
                property={prop}
                currentUser={appUser}
                onRequireAuth={() => setShowAuthModal(true)}
              />
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-gray-800 py-3 px-4 text-center text-xs text-gray-600">
        <p>yotweek © {new Date().getFullYear()} — <Link to="/" className="hover:text-gray-400">Back to Home</Link></p>
      </footer>
    </div>
  )
}
