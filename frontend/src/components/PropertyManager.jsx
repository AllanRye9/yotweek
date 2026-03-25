/**
 * PropertyManager — Property management dashboard with:
 *   - Tabbed navigation: Dashboard | Properties | Agents | Map View
 *   - Property list with status management (Empty / Occupied / Soon Empty)
 *   - Closest available property identification
 *   - Interactive map with property pins
 *   - Agent list sorted by distance with "Show more" pagination
 *   - Agent availability status, filtering, and real-time updates via socket.io
 *   - Agent profile modal with chat, reviews, and review submission
 *   - Geolocation banner for location-based nearest agent/property lookup
 *
 * Uses demo data since this feature ships as a UI-only prototype.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import PropertyMap from './PropertyMap'
import socket from '../socket'

// ─── Demo data ────────────────────────────────────────────────────────────────

const DEMO_PROPERTIES = [
  { id: 1, address: '12 Oak Street, London', lat: 51.513, lng: -0.078, status: 'empty',      size: '2-bed flat',  available_date: '2026-04-01', agent_id: 1 },
  { id: 2, address: '8 Maple Avenue, London', lat: 51.501, lng: -0.117, status: 'occupied',  size: '3-bed house', available_date: null,         agent_id: 2 },
  { id: 3, address: '34 Pine Road, London',   lat: 51.529, lng: -0.102, status: 'soon_empty',size: '1-bed studio',available_date: '2026-05-15', agent_id: 3 },
  { id: 4, address: '5 Elm Close, London',    lat: 51.491, lng: -0.063, status: 'empty',      size: '2-bed flat',  available_date: '2026-04-10', agent_id: 1 },
  { id: 5, address: '21 Birch Lane, London',  lat: 51.521, lng: -0.134, status: 'occupied',  size: '4-bed house', available_date: null,         agent_id: 4 },
  { id: 6, address: '9 Cedar Court, London',  lat: 51.508, lng: -0.055, status: 'soon_empty',size: '2-bed flat',  available_date: '2026-06-01', agent_id: 2 },
]

const DEMO_AGENTS = [
  { id: 1, name: 'Alice Johnson', rating: 4.8, reviews: 34, lat: 51.515, lng: -0.082, avatar: '👩', availability_status: 'available', bio: 'Specialist in central London residential lettings with 8 years experience.', email: 'alice@agency.example', phone: '+44 7700 900001' },
  { id: 2, name: 'Bob Williams',  rating: 4.5, reviews: 21, lat: 51.499, lng: -0.121, avatar: '👨', availability_status: 'busy',      bio: 'Commercial and residential expert, currently managing 40+ properties.', email: 'bob@agency.example',   phone: '+44 7700 900002' },
  { id: 3, name: 'Carol Davis',   rating: 4.9, reviews: 47, lat: 51.527, lng: -0.108, avatar: '👩', availability_status: 'available', bio: 'Top-rated agent for North London. Fluent in English and French.', email: 'carol@agency.example', phone: '+44 7700 900003' },
  { id: 4, name: 'Dan Brown',     rating: 4.2, reviews: 18, lat: 51.487, lng: -0.059, avatar: '👨', availability_status: 'offline',   bio: 'On leave until next month. Specialises in South London properties.', email: 'dan@agency.example',   phone: '+44 7700 900004' },
  { id: 5, name: 'Eva Martinez',  rating: 4.6, reviews: 29, lat: 51.503, lng: -0.095, avatar: '👩', availability_status: 'available', bio: 'West London lettings and sales. Bilingual English/Spanish.', email: 'eva@agency.example',   phone: '+44 7700 900005' },
  { id: 6, name: 'Frank Lee',     rating: 4.3, reviews: 15, lat: 51.532, lng: -0.072, avatar: '👨', availability_status: 'busy',      bio: 'Handling multiple portfolio clients this quarter.', email: 'frank@agency.example', phone: '+44 7700 900006' },
  { id: 7, name: 'Grace Kim',     rating: 4.7, reviews: 38, lat: 51.497, lng: -0.143, avatar: '👩', availability_status: 'available', bio: 'East London specialist. Former surveyor turned letting agent.', email: 'grace@agency.example', phone: '+44 7700 900007' },
  { id: 8, name: 'Henry Chen',    rating: 4.4, reviews: 22, lat: 51.519, lng: -0.128, avatar: '👨', availability_status: 'available', bio: 'New homes and off-plan specialist with developer contacts across London.', email: 'henry@agency.example', phone: '+44 7700 900008' },
]

const DEMO_REVIEWS = {
  1: [
    { id: 1, reviewer: 'James T.', rating: 5, text: 'Alice was incredibly professional and found us a place within a week!', date: '2026-03-10' },
    { id: 2, reviewer: 'Sophie R.', rating: 5, text: 'Brilliant communication throughout the whole process.', date: '2026-02-22' },
  ],
  2: [
    { id: 3, reviewer: 'Mark D.', rating: 4, text: 'Bob is knowledgeable but sometimes slow to respond.', date: '2026-01-15' },
  ],
  3: [
    { id: 4, reviewer: 'Lily W.', rating: 5, text: 'The best agent I have ever worked with. Absolutely amazing.', date: '2026-03-01' },
    { id: 5, reviewer: 'Tom B.', rating: 5, text: 'Carol went above and beyond on our relocation.', date: '2026-02-10' },
  ],
  4: [{ id: 6, reviewer: 'Nadia K.', rating: 4, text: 'Good knowledge of the area, reliable.', date: '2025-12-20' }],
  5: [{ id: 7, reviewer: 'Paulo S.', rating: 5, text: 'Eva made the whole process stress-free.', date: '2026-03-18' }],
  6: [{ id: 8, reviewer: 'Chloe M.', rating: 4, text: 'Frank was busy but still delivered results.', date: '2026-01-28' }],
  7: [
    { id: 9, reviewer: 'Ravi P.', rating: 5, text: 'Grace has exceptional market knowledge.', date: '2026-03-05' },
    { id: 10, reviewer: 'Lena H.', rating: 4, text: 'Very helpful, would recommend.', date: '2026-02-14' },
  ],
  8: [{ id: 11, reviewer: 'Olu A.', rating: 4, text: 'Henry pointed us to off-plan options we hadn\'t considered.', date: '2026-03-22' }],
}

const AGENTS_PAGE_SIZE = 4

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_COLOR = { empty: '#6b7280', occupied: '#ef4444', soon_empty: '#22c55e' }
const STATUS_LABEL = { empty: 'Empty', occupied: 'Occupied', soon_empty: 'Soon Empty' }
const STATUS_BG    = { empty: '#6b728022', occupied: '#ef444422', soon_empty: '#22c55e22' }

const AVAIL_COLOR = { available: '#22c55e', busy: '#f59e0b', offline: '#6b7280' }
const AVAIL_LABEL = { available: 'Available', busy: 'Busy', offline: 'Offline' }
const AVAIL_ORDER = { available: 0, busy: 1, offline: 2 }

function _haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function _stars(rating) {
  const full  = Math.floor(rating)
  const half  = rating - full >= 0.5 ? 1 : 0
  const empty = 5 - full - half
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty)
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 9999,
      background: STATUS_BG[status] ?? '#6b728022',
      color: STATUS_COLOR[status] ?? '#6b7280',
      fontSize: '0.75rem',
      fontWeight: 700,
      border: `1px solid ${STATUS_COLOR[status] ?? '#6b7280'}44`,
    }}>
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

function AvailDot({ status }) {
  const color = AVAIL_COLOR[status] ?? '#6b7280'
  return (
    <span
      title={AVAIL_LABEL[status] ?? status}
      style={{
        display: 'inline-block',
        width: 9,
        height: 9,
        borderRadius: '50%',
        background: color,
        border: `1.5px solid ${color}88`,
        flexShrink: 0,
        verticalAlign: 'middle',
        marginLeft: 5,
      }}
    />
  )
}

// ─── Agent Profile Modal ──────────────────────────────────────────────────────

// Returns or creates a stable anonymous session ID for socket room identification
function _getSessionUserId() {
  const key = '_pm_anon_uid'
  let id = localStorage.getItem(key)
  if (!id) {
    id = 'anon_' + Math.random().toString(36).slice(2, 10)
    localStorage.setItem(key, id)
  }
  return id
}

function AgentProfileModal({ agent, onClose, onStatusChange }) {
  const [reviews, setReviews]         = useState(DEMO_REVIEWS[agent.id] ?? [])
  const [liked, setLiked]             = useState(false)
  const [reviewRating, setReviewRating] = useState(5)
  const [reviewText, setReviewText]   = useState('')
  const [reviewSubmitting, setReviewSubmitting] = useState(false)
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput]     = useState('')
  const [agentTyping, setAgentTyping] = useState(false)
  const [localStatus, setLocalStatus] = useState(agent.availability_status)
  const chatEndRef = useRef(null)
  const autoReplyTimer = useRef(null)
  const userId = useRef(_getSessionUserId())

  // Lock body scroll while modal is open
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // Join socket room and load chat history
  useEffect(() => {
    socket.emit('agent_chat_join', { agent_id: agent.id, user_id: userId.current })

    fetch(`/api/agents/${agent.id}/chat`)
      .then(r => r.ok ? r.json() : [])
      .catch(() => [])
      .then(msgs => setChatMessages(Array.isArray(msgs) ? msgs : []))

    const handleMsg = (data) => {
      if (data.agent_id === agent.id) {
        setChatMessages(prev => [...prev, data])
      }
    }
    socket.on('agent_chat_message', handleMsg)
    return () => {
      socket.off('agent_chat_message', handleMsg)
      clearTimeout(autoReplyTimer.current)
    }
  }, [agent.id])

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, agentTyping])

  const sendChatMessage = () => {
    const text = chatInput.trim()
    if (!text) return
    const msg = { agent_id: agent.id, user_id: userId.current, sender_role: 'user', text, timestamp: new Date().toISOString() }
    setChatMessages(prev => [...prev, msg])
    socket.emit('agent_chat_message', msg)
    setChatInput('')

    // Simulated agent typing + auto-reply
    socket.emit('agent_chat_typing', { agent_id: agent.id, user_id: userId.current })
    setAgentTyping(true)
    autoReplyTimer.current = setTimeout(() => {
      setAgentTyping(false)
      socket.emit('agent_chat_stop_typing', { agent_id: agent.id, user_id: userId.current })
      const reply = {
        agent_id: agent.id,
        sender_role: 'agent',
        text: "Thanks for your message! I'll get back to you shortly.",
        timestamp: new Date().toISOString(),
      }
      setChatMessages(prev => [...prev, reply])
    }, 1500)
  }

  const submitReview = async () => {
    if (!reviewText.trim()) return
    setReviewSubmitting(true)
    try {
      const res = await fetch(`/api/agents/${agent.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: reviewRating, text: reviewText }),
      })
      if (!res.ok && res.status !== 401) throw new Error('fail')
    } catch (_) { /* intentional fall-through to demo */ }
    // Always add inline (demo / unauthenticated behaviour)
    setReviews(prev => [
      { id: Date.now(), reviewer: 'You', rating: reviewRating, text: reviewText, date: new Date().toISOString().slice(0, 10) },
      ...prev,
    ])
    setReviewText('')
    setReviewRating(5)
    setReviewSubmitting(false)
  }

  const handleStatusChange = async (newStatus) => {
    setLocalStatus(newStatus)
    onStatusChange?.(agent.id, newStatus)
    try {
      await fetch(`/api/agents/${agent.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
    } catch (_) { /* silent fail */ }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: '#1f2937', border: '1px solid #374151', borderRadius: 14,
        width: '100%', maxWidth: 560, maxHeight: '90vh',
        overflowY: 'auto', position: 'relative',
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
      }}>
        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          style={{
            position: 'absolute', top: 12, right: 14,
            background: '#374151', border: 'none', borderRadius: '50%',
            width: 30, height: 30, cursor: 'pointer',
            color: '#9ca3af', fontSize: '1rem', fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          ✕
        </button>

        <div style={{ padding: '24px 24px 0' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              background: '#374151', fontSize: '2rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              {agent.avatar}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ color: '#f3f4f6', fontSize: '1.05rem', fontWeight: 700 }}>{agent.name}</span>
                <AvailDot status={localStatus} />
                <span style={{ color: AVAIL_COLOR[localStatus], fontSize: '0.75rem', fontWeight: 600 }}>
                  {AVAIL_LABEL[localStatus]}
                </span>
              </div>
              <div style={{ color: '#facc15', fontSize: '0.82rem', marginTop: 2 }}>
                {_stars(agent.rating)}{' '}
                <span style={{ color: '#9ca3af' }}>{agent.rating.toFixed(1)}/5</span>
                <span style={{ color: '#6b7280', fontSize: '0.72rem' }}> ({agent.reviews} reviews)</span>
              </div>
              <div style={{ color: '#6b7280', fontSize: '0.75rem', marginTop: 3 }}>{agent.email} · {agent.phone}</div>
            </div>
          </div>

          {/* Bio */}
          <p style={{ color: '#9ca3af', fontSize: '0.82rem', marginBottom: 14, lineHeight: 1.5 }}>{agent.bio}</p>

          {/* Status dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <span style={{ color: '#6b7280', fontSize: '0.78rem' }}>Set availability:</span>
            <select
              value={localStatus}
              onChange={e => handleStatusChange(e.target.value)}
              style={{
                background: '#111827', border: '1px solid #374151', borderRadius: 6,
                color: AVAIL_COLOR[localStatus], fontSize: '0.78rem', padding: '4px 8px',
                cursor: 'pointer',
              }}
            >
              {Object.keys(AVAIL_LABEL).map(s => (
                <option key={s} value={s} style={{ color: AVAIL_COLOR[s] }}>{AVAIL_LABEL[s]}</option>
              ))}
            </select>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
            <button
              type="button"
              onClick={() => setLiked(l => !l)}
              style={{
                padding: '7px 18px', borderRadius: 8, fontSize: '0.82rem', fontWeight: 600,
                background: liked ? '#ef444422' : '#374151',
                border: liked ? '1px solid #ef444444' : '1px solid #4b5563',
                color: liked ? '#f87171' : '#d1d5db', cursor: 'pointer',
              }}
            >
              {liked ? '❤️ Liked' : '🤍 Like'}
            </button>
          </div>
        </div>

        {/* Inline Chat */}
        <div style={{ padding: '0 24px', marginBottom: 20 }}>
          <div style={{
            border: '1px solid #374151', borderRadius: 10,
            background: '#111827', overflow: 'hidden',
          }}>
            <div style={{
              padding: '8px 12px', borderBottom: '1px solid #374151',
              color: '#9ca3af', fontSize: '0.78rem', fontWeight: 600,
            }}>
              💬 Chat with {agent.name}
            </div>
            <div style={{ height: 200, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {chatMessages.length === 0 && (
                <div style={{ color: '#4b5563', fontSize: '0.78rem', textAlign: 'center', marginTop: 60 }}>
                  No messages yet. Say hello!
                </div>
              )}
              {chatMessages.map((m, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: m.sender_role === 'user' ? 'flex-end' : 'flex-start',
                  }}
                >
                  <div style={{
                    maxWidth: '75%', padding: '7px 12px', borderRadius: 10,
                    background: m.sender_role === 'user' ? '#1d4ed8' : '#374151',
                    color: '#f3f4f6', fontSize: '0.8rem', lineHeight: 1.4,
                  }}>
                    {m.text}
                  </div>
                </div>
              ))}
              {agentTyping && (
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div style={{
                    padding: '7px 12px', borderRadius: 10,
                    background: '#374151', color: '#9ca3af', fontSize: '0.78rem', fontStyle: 'italic',
                  }}>
                    {agent.name} is typing…
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div style={{
              display: 'flex', gap: 8, padding: '8px 12px',
              borderTop: '1px solid #374151',
            }}>
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendChatMessage()}
                placeholder="Type a message…"
                style={{
                  flex: 1, padding: '7px 10px', borderRadius: 7,
                  background: '#1f2937', border: '1px solid #374151',
                  color: '#e5e7eb', fontSize: '0.8rem', outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={sendChatMessage}
                style={{
                  padding: '7px 14px', borderRadius: 7, fontSize: '0.8rem', fontWeight: 600,
                  background: '#1d4ed8', border: 'none', color: '#fff', cursor: 'pointer',
                }}
              >
                Send
              </button>
            </div>
          </div>
        </div>

        {/* Reviews */}
        <div style={{ padding: '0 24px 24px' }}>
          <div style={{ color: '#d1d5db', fontSize: '0.88rem', fontWeight: 700, marginBottom: 10 }}>
            Reviews ({reviews.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {reviews.map(r => (
              <div key={r.id} style={{
                background: '#111827', border: '1px solid #374151', borderRadius: 8,
                padding: '10px 12px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ color: '#f3f4f6', fontSize: '0.8rem', fontWeight: 600 }}>{r.reviewer}</span>
                  <span style={{ color: '#6b7280', fontSize: '0.72rem' }}>{r.date}</span>
                </div>
                <div style={{ color: '#facc15', fontSize: '0.75rem', marginBottom: 4 }}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</div>
                <div style={{ color: '#9ca3af', fontSize: '0.8rem', lineHeight: 1.4 }}>{r.text}</div>
              </div>
            ))}
            {reviews.length === 0 && (
              <div style={{ color: '#4b5563', fontSize: '0.78rem' }}>No reviews yet.</div>
            )}
          </div>

          {/* Write a review */}
          <div style={{
            border: '1px solid #374151', borderRadius: 10,
            background: '#111827', padding: '14px',
          }}>
            <div style={{ color: '#9ca3af', fontSize: '0.82rem', fontWeight: 600, marginBottom: 10 }}>✍️ Write a Review</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setReviewRating(n)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: '1.3rem', color: n <= reviewRating ? '#facc15' : '#374151',
                    padding: 0,
                  }}
                >
                  ★
                </button>
              ))}
            </div>
            <textarea
              value={reviewText}
              onChange={e => setReviewText(e.target.value)}
              placeholder="Share your experience…"
              rows={3}
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 7,
                background: '#1f2937', border: '1px solid #374151',
                color: '#e5e7eb', fontSize: '0.8rem', outline: 'none',
                resize: 'vertical', boxSizing: 'border-box',
              }}
            />
            <button
              type="button"
              onClick={submitReview}
              disabled={reviewSubmitting || !reviewText.trim()}
              style={{
                marginTop: 8, padding: '7px 18px', borderRadius: 7, fontSize: '0.8rem', fontWeight: 600,
                background: reviewSubmitting || !reviewText.trim() ? '#374151' : '#1d4ed8',
                border: 'none', color: '#fff', cursor: reviewSubmitting || !reviewText.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {reviewSubmitting ? 'Submitting…' : 'Submit Review'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Agent Card ───────────────────────────────────────────────────────────────

function AgentCard({ agent, distKm, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: '#1f2937',
        border: '1px solid #374151',
        borderRadius: 10,
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => onClick && (e.currentTarget.style.borderColor = '#4b5563')}
      onMouseLeave={e => onClick && (e.currentTarget.style.borderColor = '#374151')}
    >
      <div style={{
        width: 44, height: 44, borderRadius: '50%',
        background: '#374151',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.5rem', flexShrink: 0, position: 'relative',
      }}>
        {agent.avatar}
        <span style={{
          position: 'absolute', bottom: 1, right: 1,
          width: 10, height: 10, borderRadius: '50%',
          background: AVAIL_COLOR[agent.availability_status] ?? '#6b7280',
          border: '2px solid #1f2937',
        }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ color: '#f3f4f6', fontSize: '0.88rem', fontWeight: 700 }}>{agent.name}</span>
          <AvailDot status={agent.availability_status} />
        </div>
        <div style={{ color: '#facc15', fontSize: '0.78rem', letterSpacing: '0.04em' }}>
          {_stars(agent.rating)}{' '}
          <span style={{ color: '#9ca3af' }}>{agent.rating.toFixed(1)}/5</span>
          <span style={{ color: '#6b7280', fontSize: '0.72rem' }}> ({agent.reviews} reviews)</span>
        </div>
        {distKm != null && (
          <div style={{ color: '#6b7280', fontSize: '0.72rem', marginTop: 2 }}>
            📍 {distKm.toFixed(1)} km away
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Agent List panel ─────────────────────────────────────────────────────────

function AgentListPanel({ agents, refLat, refLng, onAgentClick }) {
  const [shown, setShown]           = useState(AGENTS_PAGE_SIZE)
  const [availFilter, setAvailFilter] = useState('all')

  const sorted = useMemo(() => {
    let list = [...agents]
    if (availFilter !== 'all') list = list.filter(a => a.availability_status === availFilter)
    if (refLat != null && refLng != null) {
      list = list.map(a => ({ ...a, _dist: _haversineKm(refLat, refLng, a.lat, a.lng) }))
    }
    // Sort: available > busy > offline, then by distance within each group
    list.sort((a, b) => {
      const oa = AVAIL_ORDER[a.availability_status] ?? 3
      const ob = AVAIL_ORDER[b.availability_status] ?? 3
      if (oa !== ob) return oa - ob
      return (a._dist ?? 0) - (b._dist ?? 0)
    })
    return list
  }, [agents, refLat, refLng, availFilter])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ color: '#d1d5db', fontSize: '0.9rem', fontWeight: 700, margin: 0 }}>
          🧑‍💼 Nearest Agents
        </h3>
        <select
          value={availFilter}
          onChange={e => { setAvailFilter(e.target.value); setShown(AGENTS_PAGE_SIZE) }}
          style={{
            background: '#111827', border: '1px solid #374151', borderRadius: 6,
            color: '#9ca3af', fontSize: '0.78rem', padding: '4px 8px', cursor: 'pointer',
          }}
        >
          <option value="all">All</option>
          {Object.entries(AVAIL_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sorted.slice(0, shown).map(a => (
          <AgentCard key={a.id} agent={a} distKm={a._dist} onClick={() => onAgentClick?.(a)} />
        ))}
        {sorted.length === 0 && (
          <div style={{ color: '#4b5563', fontSize: '0.78rem', padding: '16px 0', textAlign: 'center' }}>
            No agents match this filter.
          </div>
        )}
      </div>
      {shown < sorted.length && (
        <button
          type="button"
          onClick={() => setShown(s => s + AGENTS_PAGE_SIZE)}
          style={{
            marginTop: 12, width: '100%',
            padding: '8px 0', borderRadius: 8,
            background: '#1f2937', border: '1px solid #374151',
            color: '#9ca3af', fontSize: '0.82rem', fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Show more ({sorted.length - shown} remaining)
        </button>
      )}
    </div>
  )
}

// ─── Dashboard overview panel ─────────────────────────────────────────────────

function DashboardPanel({ properties, agents, userLocation, onSelectProperty, closestId, onAgentClick }) {
  const counts = useMemo(() => ({
    empty:      properties.filter(p => p.status === 'empty').length,
    occupied:   properties.filter(p => p.status === 'occupied').length,
    soon_empty: properties.filter(p => p.status === 'soon_empty').length,
  }), [properties])

  const closest = properties.find(p => p.id === closestId)
  const [selectedId, setSelectedId] = useState(null)

  const handlePin = useCallback((prop) => {
    setSelectedId(prop.id)
    onSelectProperty?.(prop)
  }, [onSelectProperty])

  const refLat = userLocation?.lat ?? (properties[0]?.lat)
  const refLng = userLocation?.lng ?? (properties[0]?.lng)

  return (
    <div className="space-y-5">
      {/* Metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {[
          { label: 'Empty',      count: counts.empty,      status: 'empty' },
          { label: 'Occupied',   count: counts.occupied,   status: 'occupied' },
          { label: 'Soon Empty', count: counts.soon_empty, status: 'soon_empty' },
        ].map(c => (
          <div key={c.status} style={{
            background: '#1f2937', border: `1px solid ${STATUS_COLOR[c.status]}44`,
            borderRadius: 10, padding: '12px 14px', textAlign: 'center',
          }}>
            <div style={{ color: STATUS_COLOR[c.status], fontSize: '1.6rem', fontWeight: 800 }}>{c.count}</div>
            <div style={{ color: '#9ca3af', fontSize: '0.75rem', marginTop: 2 }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Closest available callout */}
      {closest && (
        <div style={{
          background: '#22c55e11', border: '1px solid #22c55e44',
          borderRadius: 10, padding: '10px 14px',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: '1.3rem' }}>⭐</span>
          <div>
            <div style={{ color: '#22c55e', fontSize: '0.82rem', fontWeight: 700 }}>Closest available property</div>
            <div style={{ color: '#d1d5db', fontSize: '0.85rem' }}>{closest.address}</div>
            <div style={{ color: '#6b7280', fontSize: '0.75rem' }}>{closest.size} · {STATUS_LABEL[closest.status]}</div>
          </div>
        </div>
      )}

      {/* Map */}
      <div style={{ height: 320, borderRadius: 10, overflow: 'hidden', border: '1px solid #374151' }}>
        <PropertyMap
          properties={properties}
          selectedId={selectedId}
          onSelectProperty={handlePin}
          userLocation={userLocation}
          closestId={closestId}
        />
      </div>

      {/* Agent list */}
      <AgentListPanel agents={agents} refLat={refLat} refLng={refLng} onAgentClick={onAgentClick} />
    </div>
  )
}

// ─── Properties list panel ────────────────────────────────────────────────────

function PropertiesPanel({ properties, setProperties, onSelectOnMap }) {
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    let list = properties
    if (filter !== 'all') list = list.filter(p => p.status === filter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(p => p.address.toLowerCase().includes(q))
    }
    return list
  }, [properties, filter, search])

  const cycleStatus = (id) => {
    const cycle = { empty: 'occupied', occupied: 'soon_empty', soon_empty: 'empty' }
    setProperties(prev => prev.map(p => p.id === id ? { ...p, status: cycle[p.status] } : p))
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search by address…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: '1 1 180px', padding: '7px 12px', borderRadius: 8,
            background: '#111827', border: '1px solid #374151',
            color: '#e5e7eb', fontSize: '0.82rem', outline: 'none',
          }}
        />
        {['all', 'empty', 'occupied', 'soon_empty'].map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            style={{
              padding: '6px 14px', borderRadius: 8, fontSize: '0.78rem', fontWeight: 600,
              cursor: 'pointer',
              border: filter === f ? `1.5px solid ${STATUS_COLOR[f] ?? '#6366f1'}` : '1px solid #374151',
              background: filter === f ? `${STATUS_COLOR[f] ?? '#6366f1'}22` : '#1f2937',
              color: filter === f ? (STATUS_COLOR[f] ?? '#a5b4fc') : '#9ca3af',
            }}
          >
            {f === 'all' ? 'All' : STATUS_LABEL[f]}
          </button>
        ))}
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead>
            <tr style={{ color: '#6b7280', borderBottom: '1px solid #374151' }}>
              <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600 }}>Address</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600 }}>Size</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600 }}>Status</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600 }}>Available</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: '#6b7280', padding: '24px 0' }}>
                  No properties match your filter.
                </td>
              </tr>
            )}
            {filtered.map(p => (
              <tr
                key={p.id}
                style={{ borderBottom: '1px solid #1f2937', transition: 'background 0.1s' }}
                onMouseEnter={e => e.currentTarget.style.background = '#1f2937'}
                onMouseLeave={e => e.currentTarget.style.background = ''}
              >
                <td style={{ padding: '9px 10px', color: '#e5e7eb' }}>{p.address}</td>
                <td style={{ padding: '9px 10px', color: '#9ca3af' }}>{p.size}</td>
                <td style={{ padding: '9px 10px' }}><StatusBadge status={p.status} /></td>
                <td style={{ padding: '9px 10px', color: '#9ca3af' }}>{p.available_date ?? '—'}</td>
                <td style={{ padding: '9px 10px' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => cycleStatus(p.id)}
                      title="Cycle status"
                      style={{
                        padding: '4px 10px', borderRadius: 6, fontSize: '0.75rem',
                        background: '#374151', border: '1px solid #4b5563',
                        color: '#d1d5db', cursor: 'pointer',
                      }}
                    >
                      ↻ Status
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelectOnMap?.(p)}
                      title="Show on map"
                      style={{
                        padding: '4px 10px', borderRadius: 6, fontSize: '0.75rem',
                        background: '#1d4ed822', border: '1px solid #1d4ed844',
                        color: '#93c5fd', cursor: 'pointer',
                      }}
                    >
                      🗺 Map
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Agents panel ─────────────────────────────────────────────────────────────

function AgentsPanel({ agents, properties, selectedPropertyId, onAgentClick, onStatusChange }) {
  const selectedProp = properties.find(p => p.id === selectedPropertyId)
  const refLat = selectedProp?.lat
  const refLng = selectedProp?.lng
  const [availFilter, setAvailFilter] = useState('all')
  const [shown, setShown] = useState(AGENTS_PAGE_SIZE)

  const sorted = useMemo(() => {
    let list = [...agents]
    if (availFilter !== 'all') list = list.filter(a => a.availability_status === availFilter)
    if (refLat != null && refLng != null) {
      list = list.map(a => ({ ...a, _dist: _haversineKm(refLat, refLng, a.lat, a.lng) }))
    }
    // Sort: available > busy > offline, then by distance
    list.sort((a, b) => {
      const oa = AVAIL_ORDER[a.availability_status] ?? 3
      const ob = AVAIL_ORDER[b.availability_status] ?? 3
      if (oa !== ob) return oa - ob
      return (a._dist ?? 0) - (b._dist ?? 0)
    })
    return list
  }, [agents, refLat, refLng, availFilter])

  return (
    <div className="space-y-4">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ color: '#9ca3af', fontSize: '0.8rem' }}>
          {selectedProp ? (
            <>Showing agents closest to: <span style={{ color: '#e5e7eb', fontWeight: 600 }}>{selectedProp.address}</span></>
          ) : (
            'Select a property to sort agents by proximity, or view all agents by availability.'
          )}
        </div>
        <select
          value={availFilter}
          onChange={e => { setAvailFilter(e.target.value); setShown(AGENTS_PAGE_SIZE) }}
          style={{
            background: '#111827', border: '1px solid #374151', borderRadius: 6,
            color: '#9ca3af', fontSize: '0.78rem', padding: '4px 8px', cursor: 'pointer',
          }}
        >
          <option value="all">All</option>
          {Object.entries(AVAIL_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sorted.slice(0, shown).map(a => (
          <AgentCard key={a.id} agent={a} distKm={a._dist} onClick={() => onAgentClick?.(a)} />
        ))}
        {sorted.length === 0 && (
          <div style={{ color: '#4b5563', fontSize: '0.78rem', padding: '16px 0', textAlign: 'center' }}>
            No agents match this filter.
          </div>
        )}
      </div>
      {shown < sorted.length && (
        <button
          type="button"
          onClick={() => setShown(s => s + AGENTS_PAGE_SIZE)}
          style={{
            width: '100%', padding: '9px 0', borderRadius: 8,
            background: '#1f2937', border: '1px solid #374151',
            color: '#9ca3af', fontSize: '0.82rem', fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Show more ({sorted.length - shown} remaining)
        </button>
      )}
    </div>
  )
}

// ─── Map View panel ───────────────────────────────────────────────────────────

function MapViewPanel({ properties, userLocation, closestId, initialSelectedId = null }) {
  const [selectedId, setSelectedId] = useState(initialSelectedId)
  const selectedProp = properties.find(p => p.id === selectedId)

  return (
    <div>
      {/* Full-height map */}
      <div style={{ height: 460, borderRadius: 10, overflow: 'hidden', border: '1px solid #374151', marginBottom: 16 }}>
        <PropertyMap
          properties={properties}
          selectedId={selectedId}
          onSelectProperty={p => setSelectedId(p.id)}
          userLocation={userLocation}
          closestId={closestId}
        />
      </div>

      {/* Status legend */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
        {Object.entries(STATUS_LABEL).map(([s, l]) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: '#9ca3af' }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: STATUS_COLOR[s] }} />
            {l}
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: '#9ca3af' }}>
          <span style={{ color: '#facc15' }}>⭐</span> Closest available
        </div>
      </div>

      {/* Property list below map */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {properties.map(p => (
          <div
            key={p.id}
            onClick={() => setSelectedId(p.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '9px 12px', borderRadius: 8, cursor: 'pointer',
              background: selectedId === p.id ? '#1d4ed822' : '#1f2937',
              border: selectedId === p.id ? '1px solid #3b82f644' : '1px solid #374151',
              transition: 'all 0.15s',
            }}
          >
            <span style={{
              width: 10, height: 10, borderRadius: '50%',
              background: STATUS_COLOR[p.status], flexShrink: 0,
            }} />
            <span style={{ flex: 1, color: '#e5e7eb', fontSize: '0.82rem' }}>{p.address}</span>
            <StatusBadge status={p.status} />
            {p.id === closestId && <span style={{ color: '#facc15', fontSize: '0.78rem' }}>⭐</span>}
          </div>
        ))}
      </div>

      {selectedProp && (
        <div style={{
          marginTop: 12, padding: '10px 14px', borderRadius: 8,
          background: '#1f2937', border: '1px solid #374151',
          fontSize: '0.82rem', color: '#d1d5db',
        }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{selectedProp.address}</div>
          <div>Size: {selectedProp.size}</div>
          {selectedProp.available_date && <div>Available: {selectedProp.available_date}</div>}
        </div>
      )}
    </div>
  )
}

// ─── Main PropertyManager ─────────────────────────────────────────────────────

const PM_TABS = [
  { id: 'dashboard',  label: '🏠 Dashboard' },
  { id: 'properties', label: '🏢 Properties' },
  { id: 'agents',     label: '🧑‍💼 Agents' },
  { id: 'map_view',   label: '🗺 Map View' },
]

export default function PropertyManager({ userLocation }) {
  const [tab, setTab]               = useState('dashboard')
  const [properties, setProperties] = useState(DEMO_PROPERTIES)
  const [agents, setAgents]         = useState(DEMO_AGENTS)
  const [selectedPropertyId, setSelectedPropertyId] = useState(null)
  const [mapViewId, setMapViewId]   = useState(null)
  const [activeAgent, setActiveAgent] = useState(null)

  // Geolocation state
  const [geoLocation, setGeoLocation]   = useState(null)
  const [geoRequested, setGeoRequested] = useState(false)
  const [geoError, setGeoError]         = useState(null)

  const requestGeoLocation = useCallback(() => {
    setGeoRequested(true)
    if (!navigator.geolocation) { setGeoError('Geolocation not supported'); return }
    navigator.geolocation.getCurrentPosition(
      (pos) => setGeoLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setGeoError('Location access denied'),
    )
  }, [])

  const effectiveLocation = geoLocation || userLocation

  // Listen for real-time agent status changes
  useEffect(() => {
    const handleStatusChanged = ({ agent_id, status }) => {
      setAgents(prev => prev.map(a => a.id === agent_id ? { ...a, availability_status: status } : a))
    }
    socket.on('agent_status_changed', handleStatusChanged)
    return () => socket.off('agent_status_changed', handleStatusChanged)
  }, [])

  const handleAgentStatusChange = useCallback((agentId, newStatus) => {
    setAgents(prev => prev.map(a => a.id === agentId ? { ...a, availability_status: newStatus } : a))
  }, [])

  // Compute closest available property from the effective location (or map centre)
  const closestId = useMemo(() => {
    const refLat = effectiveLocation?.lat ?? 51.505
    const refLng = effectiveLocation?.lng ?? -0.09
    const available = properties.filter(p => p.status === 'empty' || p.status === 'soon_empty')
    if (!available.length) return null
    return available
      .map(p => ({ id: p.id, dist: _haversineKm(refLat, refLng, p.lat, p.lng) }))
      .sort((a, b) => a.dist - b.dist)[0].id
  }, [properties, effectiveLocation])

  // Enrich properties with distance for tooltips
  const enriched = useMemo(() => {
    const refLat = effectiveLocation?.lat ?? 51.505
    const refLng = effectiveLocation?.lng ?? -0.09
    return properties.map(p => ({
      ...p,
      _dist: _haversineKm(refLat, refLng, p.lat, p.lng).toFixed(1),
      agent_name: agents.find(a => a.id === p.agent_id)?.name,
    }))
  }, [properties, agents, effectiveLocation])

  const handleShowOnMap = useCallback((prop) => {
    setMapViewId(prop.id)
    setTab('map_view')
  }, [])

  // Merge modal agent data with live agents state (so status updates reflect in modal)
  const activeAgentLive = activeAgent
    ? (agents.find(a => a.id === activeAgent.id) ?? activeAgent)
    : null

  return (
    <div>
      {/* Section header */}
      <div style={{ marginBottom: 16 }}>
        <h2 className="text-lg font-bold text-white flex items-center gap-2">🏢 Property Management</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Overview of properties, interactive map, and nearest agents.
        </p>
      </div>

      {/* Geolocation permission banner */}
      {!geoRequested && !userLocation && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
          background: '#1d4ed811', border: '1px solid #1d4ed844',
          borderRadius: 10, padding: '10px 14px', marginBottom: 16,
        }}>
          <div>
            <div style={{ color: '#93c5fd', fontSize: '0.82rem', fontWeight: 700 }}>Use your location for better results</div>
            <div style={{ color: '#6b7280', fontSize: '0.75rem', marginTop: 2 }}>
              Find the nearest properties and agents to you.
            </div>
          </div>
          <button
            type="button"
            onClick={requestGeoLocation}
            style={{
              padding: '7px 16px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600,
              background: '#1d4ed8', border: 'none', color: '#fff', cursor: 'pointer',
            }}
          >
            📍 Use My Location
          </button>
        </div>
      )}

      {/* Geo status feedback */}
      {geoRequested && !geoLocation && !geoError && (
        <div style={{
          background: '#37415111', border: '1px solid #374151',
          borderRadius: 8, padding: '8px 14px', marginBottom: 14,
          color: '#9ca3af', fontSize: '0.78rem',
        }}>
          ⏳ Requesting your location…
        </div>
      )}
      {geoLocation && (
        <div style={{
          background: '#22c55e11', border: '1px solid #22c55e33',
          borderRadius: 8, padding: '8px 14px', marginBottom: 14,
          color: '#4ade80', fontSize: '0.78rem',
        }}>
          📍 Using your GPS location for nearby calculations.
        </div>
      )}
      {geoError && (
        <div style={{
          background: '#ef444411', border: '1px solid #ef444433',
          borderRadius: 8, padding: '8px 14px', marginBottom: 14,
          color: '#f87171', fontSize: '0.78rem',
        }}>
          ⚠️ {geoError}
        </div>
      )}

      {/* Horizontal tab bar */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20, borderBottom: '1px solid #374151', paddingBottom: 10 }}>
        {PM_TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{
              padding: '7px 16px', borderRadius: 8, fontSize: '0.82rem',
              fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
              border: tab === t.id ? '2px solid #3b82f6' : '1px solid #374151',
              background: tab === t.id ? '#3b82f622' : '#1f2937',
              color: tab === t.id ? '#93c5fd' : '#9ca3af',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {tab === 'dashboard' && (
        <DashboardPanel
          properties={enriched}
          agents={agents}
          userLocation={effectiveLocation}
          onSelectProperty={p => setSelectedPropertyId(p.id)}
          closestId={closestId}
          onAgentClick={setActiveAgent}
        />
      )}

      {tab === 'properties' && (
        <PropertiesPanel
          properties={properties}
          setProperties={setProperties}
          onSelectOnMap={handleShowOnMap}
        />
      )}

      {tab === 'agents' && (
        <AgentsPanel
          agents={agents}
          properties={properties}
          selectedPropertyId={selectedPropertyId}
          onAgentClick={setActiveAgent}
          onStatusChange={handleAgentStatusChange}
        />
      )}

      {tab === 'map_view' && (
        <MapViewPanel
          properties={enriched}
          userLocation={effectiveLocation}
          closestId={closestId}
          initialSelectedId={mapViewId}
        />
      )}

      {/* Agent profile modal */}
      {activeAgentLive && (
        <AgentProfileModal
          agent={activeAgentLive}
          onClose={() => setActiveAgent(null)}
          onStatusChange={handleAgentStatusChange}
        />
      )}
    </div>
  )
}
