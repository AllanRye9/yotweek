import { useState, useEffect, useRef, useCallback } from 'react'
import socket from '../socket'
import { getRideChatMessages, confirmJourney, getConfirmedUsers, proximityNotify, deleteRideChatMessage, getDriverReviews, submitDriverReview } from '../api'

// ── StarRating ────────────────────────────────────────────────────────────────
function StarRating({ value, onChange, size = 'text-xl' }) {
  const [hover, setHover] = useState(0)
  return (
    <div className="flex gap-0.5">
      {[1,2,3,4,5].map(s => (
        <button key={s} type="button"
          className={`${size} transition-colors ${(hover || value) >= s ? 'text-amber-400' : ''}`}
          style={(hover || value) < s ? { color: 'var(--text-muted)' } : {}}
          onMouseEnter={() => setHover(s)} onMouseLeave={() => setHover(0)}
          onClick={() => onChange && onChange(s)}>★</button>
      ))}
    </div>
  )
}

// ── DriverReviewsPanel ────────────────────────────────────────────────────────
function DriverReviewsPanel({ driverUserId, currentUserId }) {
  const [reviews, setReviews] = useState([])
  const [avg, setAvg]         = useState(0)
  const [form, setForm]       = useState({ rating: 0, comment: '' })
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg]         = useState('')
  const [open, setOpen]       = useState(false)

  useEffect(() => {
    if (!driverUserId || !open) return
    getDriverReviews(driverUserId)
      .then(d => { setReviews(d.reviews || []); setAvg(d.average_rating || 0) })
      .catch(() => {})
  }, [driverUserId, open])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.rating) { setMsg('Please select a rating'); return }
    setSubmitting(true); setMsg('')
    try {
      await submitDriverReview(driverUserId, form.rating, form.comment)
      setMsg('✅ Review submitted!')
      setForm({ rating: 0, comment: '' })
      const d = await getDriverReviews(driverUserId)
      setReviews(d.reviews || [])
      setAvg(d.average_rating || 0)
    } catch (e) { setMsg('❌ ' + (e?.message || 'Failed')) }
    finally { setSubmitting(false) }
  }

  return (
    <div className="border-t" style={{ borderColor: 'var(--border-color)' }}>
      <button onClick={() => setOpen(v => !v)}
              className="w-full px-4 py-2 text-xs font-medium flex items-center justify-between"
              style={{ color: 'var(--text-secondary)' }}>
        <span>⭐ Driver Reviews {avg > 0 ? `(${avg.toFixed(1)}/5)` : ''}</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-3">
          {reviews.length === 0 && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No reviews yet.</p>}
          <div className="space-y-2 max-h-36 overflow-y-auto">
            {reviews.map((r, i) => (
              <div key={r.review_id || i} className="rounded-lg p-2 text-xs"
                   style={{ background: 'var(--bg-surface)' }}>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-amber-600 text-white shrink-0">
                    {(r.reviewer_name || 'A')[0].toUpperCase()}
                  </div>
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{r.reviewer_name}</span>
                  <span className="text-amber-400">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                </div>
                {r.comment && <p className="mt-1 ml-8" style={{ color: 'var(--text-secondary)' }}>{r.comment}</p>}
              </div>
            ))}
          </div>
          {currentUserId && (
            <form onSubmit={handleSubmit} className="space-y-2">
              <StarRating value={form.rating} onChange={v => setForm(f => ({ ...f, rating: v }))} />
              <input placeholder="Your comment (optional)" value={form.comment}
                     onChange={e => setForm(f => ({ ...f, comment: e.target.value }))}
                     maxLength={200}
                     className="w-full rounded-lg px-2 py-1.5 text-xs outline-none"
                     style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
              {msg && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{msg}</p>}
              <button type="submit" disabled={submitting}
                      className="w-full px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500 hover:bg-amber-400 text-black disabled:opacity-50">
                {submitting ? 'Submitting…' : 'Submit Review'}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * RideChat — Live group chat for a single ride.
 * Props: { ride, user, onClose }
 */
export default function RideChat({ ride, user, onClose }) {
  const [messages, setMessages]     = useState([])
  const [text, setText]             = useState('')
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')

  // Journey confirmation (passengers)
  const [showConfirm, setShowConfirm] = useState(false)
  const [realName, setRealName]       = useState('')
  const [contact, setContact]         = useState('')
  const [confirmMsg, setConfirmMsg]   = useState('')
  const [locationLabel, setLocationLabel] = useState('')

  // Confirmed passengers (drivers)
  const [showPassengers, setShowPassengers]   = useState(false)
  const [passengers, setPassengers]           = useState([])
  const [passengersLoading, setPassengersLoading] = useState(false)

  // Proximity notify (drivers)
  const [distance, setDistance]   = useState('')
  const [distUnit, setDistUnit]   = useState('km')
  const [notifyMsg, setNotifyMsg] = useState('')

  // Typing indicator
  const [typingUsers, setTypingUsers] = useState(new Set())
  const typingTimers = useRef({})
  const myTypingTimer = useRef(null)
  const isTypingRef = useRef(false)

  // Message being hovered (for delete button)
  const [hoveredMsg, setHoveredMsg] = useState(null)

  // Message status: track last timestamp seen by others in chat
  const [othersLastActive, setOthersLastActive] = useState(0)

  const bottomRef = useRef(null)
  const rideId    = ride?.ride_id
  const isDriver  = user?.user_id === ride?.user_id
  const myId      = user?.user_id
  const myName    = user?.name || user?.display_name || 'Guest'

  // Auto-fill user location when "Confirm Journey" is opened
  const handleOpenConfirm = () => {
    setShowConfirm(true)
    setRealName(user?.name || '')
    setContact(user?.phone || user?.email || '')
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords
          const label = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
          setLocationLabel(label)
          if (!contact) setContact(user?.phone || user?.email || '')
        },
        () => setLocationLabel(''),
        { timeout: 5000 }
      )
    }
  }

  // Load history + join socket room
  useEffect(() => {
    if (!rideId) return
    setLoading(true)
    getRideChatMessages(rideId)
      .then(d => setMessages(d.messages || []))
      .catch(() => setError('Failed to load messages'))
      .finally(() => setLoading(false))

    socket.emit('join_ride_chat', { ride_id: rideId, name: myName })
    return () => {
      socket.emit('leave_ride_chat', { ride_id: rideId })
      Object.values(typingTimers.current).forEach(t => clearTimeout(t))
      clearTimeout(myTypingTimer.current)
    }
  }, [rideId, myName])

  // Listen for incoming messages
  useEffect(() => {
    const handler = (msg) => {
      if (msg.ride_id !== rideId) return
      setMessages(prev => {
        // Replace pending optimistic message if it matches
        if (msg.sender_name === myName) {
          const pendingIdx = prev.findIndex(m => m._pending && m.text === (msg.text || msg.content))
          if (pendingIdx >= 0) {
            const next = [...prev]
            next[pendingIdx] = { ...msg, _pending: false }
            return next
          }
        }
        if (prev.some(m => m.msg_id === msg.msg_id && msg.msg_id != null)) return prev
        if (msg.sender_name !== myName) {
          setOthersLastActive(msg.ts || Date.now() / 1000)
        }
        return [...prev, msg]
      })
    }
    socket.on('ride_chat_message', handler)
    return () => socket.off('ride_chat_message', handler)
  }, [rideId, myName])

  // Typing indicator events
  useEffect(() => {
    const onTyping = ({ ride_id, sender_id, sender_name }) => {
      if (ride_id !== rideId || sender_id === myId) return
      const label = sender_name || sender_id
      setTypingUsers(prev => new Set([...prev, label]))
      clearTimeout(typingTimers.current[sender_id])
      typingTimers.current[sender_id] = setTimeout(() => {
        setTypingUsers(prev => { const s = new Set(prev); s.delete(label); return s })
      }, 3000)
    }
    const onStopTyping = ({ ride_id, sender_id, sender_name }) => {
      if (ride_id !== rideId || sender_id === myId) return
      const label = sender_name || sender_id
      setTypingUsers(prev => { const s = new Set(prev); s.delete(label); return s })
    }
    socket.on('ride_chat_typing', onTyping)
    socket.on('ride_chat_stop_typing', onStopTyping)
    return () => {
      socket.off('ride_chat_typing', onTyping)
      socket.off('ride_chat_stop_typing', onStopTyping)
    }
  }, [rideId, myId])

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, typingUsers])

  const handleTextChange = (e) => {
    setText(e.target.value)
    if (!rideId) return
    if (!isTypingRef.current) {
      isTypingRef.current = true
      socket.emit('ride_chat_typing', { ride_id: rideId, sender_id: myId, sender_name: myName })
    }
    clearTimeout(myTypingTimer.current)
    myTypingTimer.current = setTimeout(() => {
      isTypingRef.current = false
      socket.emit('ride_chat_stop_typing', { ride_id: rideId, sender_id: myId, sender_name: myName })
    }, 1500)
  }

  const handleSend = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed || !rideId) return
    // Stop typing indicator
    isTypingRef.current = false
    clearTimeout(myTypingTimer.current)
    socket.emit('ride_chat_stop_typing', { ride_id: rideId, sender_id: myId, sender_name: myName })

    // Optimistic add
    setMessages(prev => [...prev, {
      _localId: `pending-${Date.now()}`,
      msg_id: null,
      ride_id: rideId,
      sender_id: myId,
      sender_name: myName,
      text: trimmed,
      ts: Date.now() / 1000,
      _pending: true,
    }])

    socket.emit('ride_chat_message', {
      ride_id:     rideId,
      text:        trimmed,
      sender_name: myName,
      sender_id:   myId,
    })
    setText('')
  }, [text, rideId, myId, myName])

  const handleConfirm = async () => {
    setConfirmMsg('')
    const nameToSend = realName || myName
    const contactToSend = contact || locationLabel
    try {
      await confirmJourney(rideId, nameToSend, contactToSend)
      setConfirmMsg('✅ Journey confirmed!')
      // Send a chat message to notify the driver
      if (locationLabel) {
        socket.emit('ride_chat_message', {
          ride_id:     rideId,
          text:        `📍 I've confirmed my journey. My location: ${locationLabel}`,
          sender_name: myName,
          sender_id:   myId,
        })
      }
      setShowConfirm(false)
      setRealName('')
      setContact('')
    } catch (e) {
      setConfirmMsg('❌ ' + (e?.message || 'Failed'))
    }
  }

  const handleDeleteMessage = async (msg) => {
    const msgId = msg.msg_id || msg.id
    if (!msgId) { setMessages(prev => prev.filter(m => m !== msg)); return }
    try {
      await deleteRideChatMessage(rideId, msgId)
      setMessages(prev => prev.filter(m => (m.msg_id || m.id) !== msgId))
    } catch {}
  }

  const handleLoadPassengers = async () => {
    setShowPassengers(p => !p)
    if (!showPassengers) {
      setPassengersLoading(true)
      try {
        const d = await getConfirmedUsers(rideId)
        setPassengers(d.confirmed_users || [])
      } catch {
        setPassengers([])
      } finally {
        setPassengersLoading(false)
      }
    }
  }

  const handleProximityNotify = async () => {
    setNotifyMsg('')
    const km = parseFloat(distance)
    if (!km || km <= 0) { setNotifyMsg('Enter a valid distance'); return }
    try {
      await proximityNotify(rideId, km, distUnit)
      setNotifyMsg('✅ Passengers notified!')
    } catch (e) {
      setNotifyMsg('❌ ' + (e?.message || 'Failed'))
    }
  }

  const fmtTime = (ts) => {
    if (!ts) return ''
    const d = typeof ts === 'number' && ts < 1e10 ? new Date(ts * 1000) : new Date(ts)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  // Message status ticks
  const MessageTicks = ({ msg }) => {
    if (msg._pending) {
      return <span className="text-xs ml-1 opacity-50" title="Sending">✓</span>
    }
    const ts = msg.ts || 0
    if (ts <= othersLastActive && othersLastActive > 0) {
      return <span className="text-blue-400 text-xs ml-1" title="Seen">✓✓</span>
    }
    return <span className="text-xs ml-1 opacity-50" title="Delivered">✓✓</span>
  }

  return (
    <div className="flex flex-col h-full rounded-xl overflow-hidden border"
         style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>

      {/* Header — display real place names */}
      <div className="flex items-center justify-between px-4 py-3 border-b"
           style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
            🚗 {ride?.origin} → {ride?.destination}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {ride?.fare ? `$${ride.fare}` : 'Ask driver'} · {ride?.seats} seat(s) ·{' '}
            {ride?.departure ? new Date(ride.departure).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
            {ride?.vehicle_color || ride?.vehicle_type ? ` · ${[ride.vehicle_color, ride.vehicle_type].filter(Boolean).join(' ')}` : ''}
            {ride?.driver_name ? ` · Driver: ${ride.driver_name}` : ''}
          </p>
        </div>
        <button onClick={onClose} className="ml-3 text-lg leading-none hover:opacity-70 transition-opacity"
                style={{ color: 'var(--text-muted)' }}>✕</button>
      </div>

      {/* Driver tools */}
      {isDriver && (
        <div className="px-4 py-2 border-b flex flex-wrap gap-2"
             style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}>
          <button onClick={handleLoadPassengers}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}>
            👥 Passengers
          </button>

          <div className="flex items-center gap-1 flex-wrap">
            <input
              type="number" min="0.1" step="0.1" placeholder="Distance"
              value={distance} onChange={e => setDistance(e.target.value)}
              className="w-24 rounded px-2 py-1 text-xs outline-none"
              style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            />
            <select value={distUnit} onChange={e => setDistUnit(e.target.value)}
                    className="rounded px-2 py-1 text-xs outline-none"
                    style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>
              <option value="km">km</option>
              <option value="miles">miles</option>
            </select>
            <button onClick={handleProximityNotify}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-blue-600 hover:bg-blue-500 text-white">
              📍 Notify
            </button>
          </div>
          {notifyMsg && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{notifyMsg}</span>}
        </div>
      )}

      {/* Passengers panel */}
      {isDriver && showPassengers && (
        <div className="px-4 py-2 border-b text-xs"
             style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
          {passengersLoading ? 'Loading…' : passengers.length === 0 ? 'No confirmed passengers yet.' : (
            <ul className="space-y-1">
              {passengers.map((p, i) => (
                <li key={i} className="flex gap-3">
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{p.real_name}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{p.contact}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Passenger — Journey confirmation */}
      {!isDriver && (
        <div className="px-4 py-3 border-b"
             style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}>
          {!showConfirm ? (
            <button
              onClick={handleOpenConfirm}
              className="w-full relative inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white overflow-hidden shadow-lg transition-all duration-300 hover:scale-[1.02] hover:shadow-amber-500/40 active:scale-[0.98]"
              style={{
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 50%, #b45309 100%)',
                boxShadow: '0 4px 15px rgba(245,158,11,0.35)',
              }}
            >
              <span className="text-base">✅</span>
              <span>Confirm Journey</span>
              <span className="absolute inset-0 rounded-xl border border-amber-300/30 pointer-events-none" />
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <input placeholder="Your name" value={realName} onChange={e => setRealName(e.target.value)}
                       className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
                       style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
                <input placeholder="Contact (phone/email)" value={contact} onChange={e => setContact(e.target.value)}
                       className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
                       style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
              </div>
              {locationLabel && (
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>📍 Location: {locationLabel}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleConfirm}
                  className="flex-1 relative inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white shadow-lg transition-all duration-300 hover:scale-[1.02] hover:shadow-amber-500/40 active:scale-[0.98]"
                  style={{
                    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 50%, #b45309 100%)',
                    boxShadow: '0 4px 12px rgba(245,158,11,0.35)',
                  }}
                >
                  <span>✅</span> Submit
                </button>
                <button onClick={() => setShowConfirm(false)}
                        className="px-4 py-2 rounded-lg text-sm hover:opacity-80 transition-opacity"
                        style={{ color: 'var(--text-muted)' }}>
                  Cancel
                </button>
              </div>
              {confirmMsg && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{confirmMsg}</p>}
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {loading && <p className="text-center text-xs py-8" style={{ color: 'var(--text-muted)' }}>Loading…</p>}
        {error && <p className="text-center text-xs py-4 text-red-400">{error}</p>}
        {!loading && messages.length === 0 && (
          <p className="text-center text-xs py-8" style={{ color: 'var(--text-muted)' }}>No messages yet. Say hello!</p>
        )}
        {messages.map((msg, i) => {
          const senderName = msg.sender_name || msg.name || 'User'
          const mine = senderName === myName
          const prevMsg = messages[i - 1]
          const prevSender = prevMsg?.sender_name || prevMsg?.name
          const showSender = !mine && (i === 0 || prevSender !== senderName)
          const msgId = msg.msg_id || msg.id
          const canDelete = mine || isDriver
          return (
            <div key={msgId || msg._localId || i}
                 className={`flex ${mine ? 'justify-end' : 'justify-start'} ${
                   i > 0 && prevSender === senderName ? 'mt-0.5' : 'mt-2'
                 }`}
                 onMouseEnter={() => setHoveredMsg(msgId || msg._localId || i)}
                 onMouseLeave={() => setHoveredMsg(null)}>
              {/* Avatar for incoming messages */}
              {!mine && (
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mr-1.5 mt-auto mb-0.5 ${
                  showSender ? 'bg-amber-600 text-white' : 'opacity-0 pointer-events-none'
                }`}>
                  {senderName.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="max-w-[72%] space-y-0.5">
                {!mine && showSender && (
                  <p className="text-xs font-semibold ml-0.5" style={{ color: 'var(--accent)' }}>
                    {senderName}
                  </p>
                )}
                <div className="flex items-end gap-1">
                  {mine && canDelete && hoveredMsg === (msgId || msg._localId || i) && (
                    <button onClick={() => handleDeleteMessage(msg)}
                            className="text-xs opacity-60 hover:opacity-100 hover:text-red-400 shrink-0 mb-1"
                            title="Delete message"
                            style={{ color: 'var(--text-muted)' }}>🗑</button>
                  )}
                  <div className={`relative px-3 py-2 rounded-2xl text-sm break-words ${
                    mine
                      ? 'bg-amber-500 text-black rounded-tr-sm'
                      : 'rounded-tl-sm'
                  }`}
                       style={mine ? {} : { background: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
                    <p className="break-words leading-snug">{msg.text || msg.content}</p>
                    <div className={`flex items-center justify-end gap-0.5 mt-0.5 ${mine ? 'opacity-70' : 'opacity-50'}`}>
                      <span className="text-xs">{fmtTime(msg.ts || msg.timestamp)}</span>
                      {mine && <MessageTicks msg={msg} />}
                    </div>
                  </div>
                  {!mine && canDelete && isDriver && hoveredMsg === (msgId || msg._localId || i) && (
                    <button onClick={() => handleDeleteMessage(msg)}
                            className="text-xs opacity-60 hover:opacity-100 hover:text-red-400 shrink-0 mb-1"
                            title="Delete message"
                            style={{ color: 'var(--text-muted)' }}>🗑</button>
                  )}
                </div>
              </div>
              {/* Own avatar */}
              {mine && (
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ml-1.5 mt-auto mb-0.5 bg-amber-500 text-black">
                  {myName.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
          )
        })}

        {/* Typing indicator */}
        {typingUsers.size > 0 && (
          <div className="flex items-center gap-2 mt-2 ml-9">
            <div className="px-3 py-2 rounded-2xl rounded-tl-sm"
                 style={{ background: 'var(--bg-surface)', color: 'var(--text-muted)' }}>
              <div className="flex gap-1 items-center">
                <span className="flex gap-0.5">
                  {[0, 1, 2].map(j => (
                    <span key={j} className="w-1.5 h-1.5 rounded-full bg-current animate-bounce"
                          style={{ animationDelay: `${j * 0.15}s` }} />
                  ))}
                </span>
                <span className="text-xs ml-1 italic">
                  {[...typingUsers].join(', ')} {typingUsers.size === 1 ? 'is' : 'are'} typing…
                </span>
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2 px-3 py-2 border-t"
           style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}>
        <input
          value={text}
          onChange={handleTextChange}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          placeholder="Type a message…"
          maxLength={500}
          className="flex-1 rounded-full px-4 py-2 text-sm outline-none"
          style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
        />
        <button onClick={handleSend} disabled={!text.trim()}
                className="w-9 h-9 rounded-full flex items-center justify-center bg-amber-500 hover:bg-amber-400 text-black disabled:opacity-40 transition-all shrink-0">
          ➤
        </button>
      </div>

      {/* Driver reviews */}
      {ride?.user_id && (
        <DriverReviewsPanel driverUserId={ride.user_id} currentUserId={myId} />
      )}
    </div>
  )
}
