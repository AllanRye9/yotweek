import { useState, useEffect, useRef, useCallback } from 'react'
import socket from '../socket'
import { getRideChatMessages, confirmJourney, cancelJourneyConfirmation, getConfirmedUsers, proximityNotify, deleteRideChatMessage, driverConfirmBooking, driverCancelPassengerConfirmation, getDriverReviews, submitDriverReview } from '../api'

// Quick-reply templates shown above the message input
const QUICK_REPLIES = [
  'On my way 🚶',
  'Running late ⏳',
  'I\'m here! 📍',
  'Got it ✅',
  'Be there in 5 min 🚗',
  'Please share your location 📌',
]

// Cancel reasons for booking cancellation
const CANCEL_REASONS = [
  'User no-show',
  'Route change',
  'Vehicle issue',
  'Emergency',
  'Other',
]

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

  // Journey confirmation / Share Pickup Location (passengers)
  const [showConfirm, setShowConfirm] = useState(false)
  const [realName, setRealName]       = useState('')
  const [contact, setContact]         = useState('')
  const [confirmMsg, setConfirmMsg]   = useState('')
  const [tripId, setTripId]           = useState(null)  // shown after successful confirm
  const [locationLabel, setLocationLabel] = useState('')
  const [locationLat, setLocationLat] = useState(null)
  const [locationLng, setLocationLng] = useState(null)
  const [manualAddress, setManualAddress] = useState('')
  const [notifyDriver, setNotifyDriver] = useState(true)
  const [mediaFile, setMediaFile]     = useState(null)
  const [confirmSuccess, setConfirmSuccess] = useState(false)
  const [currentSeats, setCurrentSeats] = useState(ride?.seats ?? null)
  const fileInputRef = useRef(null)

  // Cancel confirmation (passenger)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelMsg, setCancelMsg] = useState('')

  // Confirmed passengers (drivers)
  const [showPassengers, setShowPassengers]   = useState(false)
  const [passengers, setPassengers]           = useState([])
  const [passengersLoading, setPassengersLoading] = useState(false)

  // Per-passenger cancel modal (driver)
  const [cancelTarget, setCancelTarget]   = useState(null) // { confirmation_id, real_name }
  const [driverCancelReason, setDriverCancelReason] = useState('')
  const [driverCancelMsg, setDriverCancelMsg] = useState('')

  // Proximity notify (drivers)
  const [distance, setDistance]   = useState('')
  const [distUnit, setDistUnit]   = useState('km')
  const [notifyMsg, setNotifyMsg] = useState('')
  const [notifySummary, setNotifySummary] = useState(null) // { total_reached, users }

  // Driver live-location sharing
  const [locShareMsg, setLocShareMsg] = useState('')

  // Typing indicator
  const [typingUsers, setTypingUsers] = useState(new Set())
  const typingTimers = useRef({})
  const myTypingTimer = useRef(null)
  const isTypingRef = useRef(false)

  // Delete control: undo toast
  const [deletedMsg, setDeletedMsg] = useState(null) // { msg, timeout }
  const deleteUndoTimer = useRef(null)
  const [showDeleteMenu, setShowDeleteMenu] = useState(null) // msg identifier

  // Message being hovered (for delete button)
  const [hoveredMsg, setHoveredMsg] = useState(null)

  // Message status: track last timestamp seen by others in chat
  const [othersLastActive, setOthersLastActive] = useState(0)

  const bottomRef = useRef(null)
  const rideId    = ride?.ride_id
  const isDriver  = user?.user_id === ride?.user_id || user?.user_id === ride?.driver_id
  const myId      = user?.user_id
  const myName    = user?.name || user?.display_name || 'Guest'

  // Open "Share Pickup Location" panel and auto-detect geo location
  const handleOpenConfirm = () => {
    setShowConfirm(true)
    setRealName(user?.name || '')
    setContact(user?.phone || user?.email || '')
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords
          setLocationLat(latitude)
          setLocationLng(longitude)
          const label = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
          setLocationLabel(label)
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

  // Listen for real-time seat updates (emitted after Confirm Journey)
  useEffect(() => {
    const onSeatsUpdated = ({ ride_id, seats }) => {
      if (ride_id === rideId) setCurrentSeats(seats)
    }
    socket.on('ride_seats_updated', onSeatsUpdated)
    return () => socket.off('ride_seats_updated', onSeatsUpdated)
  }, [rideId])

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
      name:        myName,
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
      const result = await confirmJourney(rideId, nameToSend, contactToSend, locationLat, locationLng)
      setConfirmMsg('✅ Booking confirmed!')
      setConfirmSuccess(true)
      // Show trip ID
      if (result?.trip_id) setTripId(result.trip_id)
      // Update seat count if backend returned new seat total
      if (result?.seats != null) setCurrentSeats(result.seats)
      setTimeout(() => setConfirmSuccess(false), 2000)

      // Send Google Maps link if geo available
      if (locationLat != null && locationLng != null) {
        const mapsLink = `https://maps.google.com/?q=${locationLat},${locationLng}`
        socket.emit('ride_chat_message', {
          ride_id:     rideId,
          text:        `📍 My pickup location: ${mapsLink}`,
          name:        myName,
          sender_name: myName,
          sender_id:   myId,
        })
      }

      // Send manual address text if provided
      if (manualAddress.trim()) {
        socket.emit('ride_chat_message', {
          ride_id:     rideId,
          text:        `📍 Pickup address: ${manualAddress.trim()}`,
          name:        myName,
          sender_name: myName,
          sender_id:   myId,
        })
      }

      // Send media attachment if selected
      if (mediaFile) {
        const reader = new FileReader()
        reader.onload = (ev) => {
          socket.emit('ride_chat_message', {
            ride_id:     rideId,
            name:        myName,
            sender_name: myName,
            sender_id:   myId,
            media_type:  'image',
            media_data:  ev.target.result,
            text:        '',
          })
        }
        reader.readAsDataURL(mediaFile)
      }

      // Notify driver via socket if toggle is on (no geo / no manual = send text note)
      if (notifyDriver && !locationLat && !manualAddress.trim()) {
        socket.emit('ride_chat_message', {
          ride_id:     rideId,
          text:        `📍 I've confirmed my pickup. Please let me know when you're on your way!`,
          name:        myName,
          sender_name: myName,
          sender_id:   myId,
        })
      }

      setShowConfirm(false)
      setRealName('')
      setContact('')
      setManualAddress('')
      setMediaFile(null)
      setLocationLat(null)
      setLocationLng(null)
      setLocationLabel('')
    } catch (e) {
      setConfirmMsg('❌ ' + (e?.message || 'Failed'))
    }
  }

  const handleCancelConfirmation = async () => {
    setCancelMsg('')
    try {
      const result = await cancelJourneyConfirmation(rideId, cancelReason)
      setCancelMsg('✅ Booking cancelled.')
      if (result?.seats != null) setCurrentSeats(result.seats)
      setTripId(null)
      setTimeout(() => { setShowCancelConfirm(false); setCancelMsg('') }, 1500)
    } catch (e) {
      setCancelMsg('❌ ' + (e?.message || 'Failed'))
    }
  }

  const handleDriverCancelPassenger = async () => {
    if (!cancelTarget) return
    setDriverCancelMsg('')
    try {
      const result = await driverCancelPassengerConfirmation(rideId, cancelTarget.confirmation_id, driverCancelReason)
      setDriverCancelMsg('✅ Cancelled.')
      if (result?.seats != null) setCurrentSeats(result.seats)
      setPassengers(prev => prev.filter(p => p.confirmation_id !== cancelTarget.confirmation_id))
      setTimeout(() => { setCancelTarget(null); setDriverCancelMsg(''); setDriverCancelReason('') }, 1200)
    } catch (e) {
      setDriverCancelMsg('❌ ' + (e?.message || 'Failed'))
    }
  }

  const handleDriverConfirmPassenger = async (confirmationId) => {
    try {
      await driverConfirmBooking(rideId, confirmationId)
      setPassengers(prev => prev.map(p =>
        p.confirmation_id === confirmationId ? { ...p, driver_confirmed: 1 } : p
      ))
    } catch {}
  }

  const handleDeleteMessage = useCallback((msg, deleteForEveryone = false) => {
    const msgId = msg.msg_id || msg.id
    const identifier = msgId || msg._localId

    if (!deleteForEveryone || !msgId) {
      // Delete for me: remove from local state with undo
      clearTimeout(deleteUndoTimer.current)
      setDeletedMsg({ msg, identifier })
      setMessages(prev => prev.filter(m => (m.msg_id || m.id || m._localId) !== identifier))
      deleteUndoTimer.current = setTimeout(() => setDeletedMsg(null), 5000)
      return
    }

    // Delete for everyone: backend delete
    deleteRideChatMessage(rideId, msgId)
      .then(() => {
        setMessages(prev => prev.filter(m => (m.msg_id || m.id) !== msgId))
      })
      .catch(() => {})
  }, [rideId])

  const handleUndoDelete = useCallback(() => {
    if (!deletedMsg) return
    clearTimeout(deleteUndoTimer.current)
    setMessages(prev => {
      // Re-insert at approximate position by timestamp
      const ts = deletedMsg.msg.ts || 0
      const insertIdx = prev.findLastIndex(m => (m.ts || 0) <= ts) + 1
      const next = [...prev]
      next.splice(insertIdx, 0, deletedMsg.msg)
      return next
    })
    setDeletedMsg(null)
  }, [deletedMsg])

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

  // Listen for real-time journey confirmation events when driver is viewing passengers
  useEffect(() => {
    const onJourneyConfirmed = (data) => {
      if (data?.ride_id !== rideId) return
      // Refresh passengers list if currently shown
      if (showPassengers) {
        getConfirmedUsers(rideId)
          .then(d => setPassengers(d.confirmed_users || []))
          .catch(() => {})
      }
    }
    const onJourneyCancelled = (data) => {
      if (data?.ride_id !== rideId) return
      if (data?.user_id) {
        setPassengers(prev => prev.filter(p => p.user_id !== data.user_id))
      }
    }
    socket.on('journey_confirmed', onJourneyConfirmed)
    socket.on('journey_cancelled', onJourneyCancelled)
    return () => {
      socket.off('journey_confirmed', onJourneyConfirmed)
      socket.off('journey_cancelled', onJourneyCancelled)
    }
  }, [rideId, showPassengers])

  const handleProximityNotify = async () => {
    setNotifyMsg('')
    setNotifySummary(null)
    const km = parseFloat(distance)
    if (!km || km <= 0) { setNotifyMsg('Enter a valid distance'); return }
    try {
      const result = await proximityNotify(rideId, km, distUnit)
      setNotifyMsg(`✅ Notified ${result.notified ?? 0} passenger(s)!`)
      if (result.users_reached && result.users_reached.length > 0) {
        setNotifySummary({ total: result.notified, users: result.users_reached })
      }
    } catch (e) {
      setNotifyMsg('❌ ' + (e?.message || 'Failed'))
    }
  }

  const handleShareLiveLocation = () => {
    setLocShareMsg('')
    if (!navigator.geolocation) {
      setLocShareMsg('❌ Geolocation not supported by your browser')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        const mapsLink = `https://maps.google.com/?q=${latitude},${longitude}`
        const locationText = `📍 Driver live location: ${mapsLink}`
        socket.emit('ride_chat_message', {
          ride_id:     rideId,
          text:        locationText,
          name:        myName,
          sender_name: myName,
          sender_id:   myId,
          role:        'driver',
        })
        setLocShareMsg('✅ Location shared!')
        setTimeout(() => setLocShareMsg(''), 3000)
      },
      () => setLocShareMsg('❌ Could not get your location'),
      { timeout: 8000 }
    )
  }

  const handleConfirmPickup = () => {
    const pickupText = `✅ Driver confirmed pick-up. I'm on my way to collect you!`
    socket.emit('ride_chat_message', {
      ride_id:     rideId,
      text:        pickupText,
      name:        myName,
      sender_name: myName,
      sender_id:   myId,
      role:        'driver',
    })
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

      {/* ── Undo delete toast ── */}
      {deletedMsg && (
        <div
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl px-4 py-2.5 shadow-2xl text-sm font-medium"
          style={{ background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155' }}
          role="status"
          aria-live="polite"
        >
          <span>🗑️ Message deleted</span>
          <button onClick={handleUndoDelete}
                  className="ml-1 text-amber-400 hover:text-amber-300 font-semibold text-xs">
            Undo
          </button>
        </div>
      )}

      {/* ── Driver: cancel passenger modal ── */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
             style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="rounded-2xl p-5 max-w-xs w-full space-y-3 shadow-2xl"
               style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              ❌ Cancel {cancelTarget.real_name}'s Booking
            </h3>
            <select
              value={driverCancelReason}
              onChange={e => setDriverCancelReason(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            >
              <option value="">Select reason…</option>
              {CANCEL_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            {driverCancelMsg && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{driverCancelMsg}</p>}
            <div className="flex gap-2">
              <button onClick={handleDriverCancelPassenger}
                      className="flex-1 px-3 py-2 rounded-xl text-sm font-semibold text-white bg-red-600 hover:bg-red-500">
                Cancel Booking
              </button>
              <button onClick={() => { setCancelTarget(null); setDriverCancelReason(''); setDriverCancelMsg('') }}
                      className="px-3 py-2 rounded-xl text-sm hover:opacity-80"
                      style={{ color: 'var(--text-muted)' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

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
            👥 Passengers {passengers.length > 0 ? `(${passengers.length})` : ''}
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

          <button onClick={handleShareLiveLocation}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-green-700 hover:bg-green-600 text-white">
            🗺️ Share My Location
          </button>
          {locShareMsg && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{locShareMsg}</span>}

          <button onClick={handleConfirmPickup}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-amber-600 hover:bg-amber-500 text-white">
            ✅ Confirm Pick-Up
          </button>
        </div>
      )}

      {/* Proximity notify summary */}
      {isDriver && notifySummary && (
        <div className="px-4 py-2 border-b text-xs"
             style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}>
          <div className="flex items-center justify-between mb-1">
            <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
              📊 Alert Summary — {notifySummary.total} passenger(s) notified
            </span>
            <button onClick={() => setNotifySummary(null)} className="text-xs opacity-50 hover:opacity-80"
                    style={{ color: 'var(--text-muted)' }}>✕</button>
          </div>
          <ul className="space-y-0.5">
            {notifySummary.users.map((u, i) => (
              <li key={i} className="flex gap-2">
                <span style={{ color: 'var(--text-primary)' }}>{u.name}</span>
                {u.dist_km != null && (
                  <span style={{ color: 'var(--text-muted)' }}>{u.dist_km} km away</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Passengers panel */}
      {isDriver && showPassengers && (
        <div className="px-4 py-2 border-b text-xs"
             style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
          {passengersLoading ? 'Loading…' : passengers.length === 0 ? 'No confirmed passengers yet.' : (
            <ul className="space-y-1.5">
              {passengers.map((p, i) => (
                <li key={p.confirmation_id || i} className="flex items-center gap-2 flex-wrap">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${p.driver_confirmed ? 'bg-green-400' : 'bg-yellow-400'}`}
                        title={p.driver_confirmed ? 'Driver confirmed' : 'Pending driver confirmation'} />
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{p.real_name}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{p.contact}</span>
                  {p.lat != null && (
                    <a href={`https://maps.google.com/?q=${p.lat},${p.lng}`}
                       target="_blank" rel="noopener noreferrer"
                       className="text-blue-400 hover:text-blue-300 text-xs">📍 Map</a>
                  )}
                  <div className="flex gap-1 ml-auto shrink-0">
                    {!p.driver_confirmed && (
                      <button
                        onClick={() => handleDriverConfirmPassenger(p.confirmation_id)}
                        className="px-2 py-0.5 rounded text-xs bg-green-700 hover:bg-green-600 text-white font-medium"
                        title="Confirm this passenger"
                      >
                        ✓ Confirm
                      </button>
                    )}
                    <button
                      onClick={() => { setCancelTarget(p); setDriverCancelReason(''); setDriverCancelMsg('') }}
                      className="px-2 py-0.5 rounded text-xs bg-red-800 hover:bg-red-700 text-white font-medium"
                      title="Cancel this passenger's booking"
                    >
                      ✕ Cancel
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Passenger — Share Pickup Location */}
      {!isDriver && (
        <div className="px-4 py-3 border-b"
             style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}>
          {currentSeats != null && (
            <p className="text-xs mb-2 font-medium" style={{ color: currentSeats === 0 ? '#f87171' : '#6ee7b7' }}>
              💺 {currentSeats === 0 ? 'No seats available' : `${currentSeats} seat${currentSeats !== 1 ? 's' : ''} available`}
            </p>
          )}
          {confirmSuccess && (
            <div className="mb-2 rounded-xl px-4 py-2 text-sm font-semibold text-center text-white animate-bounce"
                 style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}>
              🎉 Booking Confirmed!
            </div>
          )}

          {/* Trip ID receipt */}
          {tripId && !showConfirm && !showCancelConfirm && (
            <div className="mb-2 rounded-xl px-3 py-2 text-xs flex items-center justify-between gap-2"
                 style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>
                🎫 Trip ID: <strong style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{tripId}</strong>
              </span>
              <button
                onClick={() => setShowCancelConfirm(true)}
                className="text-xs text-red-400 hover:text-red-300 font-medium shrink-0"
              >
                Cancel Booking
              </button>
            </div>
          )}

          {/* Cancel confirmation panel */}
          {showCancelConfirm && (
            <div className="mb-2 rounded-xl p-3 space-y-2"
                 style={{ background: 'var(--bg-input)', border: '1px solid rgba(248,113,113,0.3)' }}>
              <p className="text-xs font-medium" style={{ color: '#f87171' }}>Cancel your booking?</p>
              <select
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                className="w-full rounded-lg px-2 py-1.5 text-xs outline-none"
                style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
              >
                <option value="">Select reason (optional)…</option>
                {CANCEL_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              {cancelMsg && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{cancelMsg}</p>}
              <div className="flex gap-2">
                <button onClick={handleCancelConfirmation}
                        className="flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-500 text-white">
                  Confirm Cancel
                </button>
                <button onClick={() => setShowCancelConfirm(false)}
                        className="px-3 py-1.5 rounded-lg text-xs hover:opacity-80"
                        style={{ color: 'var(--text-muted)' }}>
                  Keep Booking
                </button>
              </div>
            </div>
          )}

          {currentSeats === 0 && !showConfirm ? (
            <div className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-red-300"
                 style={{ background: 'rgba(127,29,29,0.4)', border: '1px solid rgba(248,113,113,0.3)' }}>
              🚫 Fully Booked — No seats available
            </div>
          ) : !showConfirm && !showCancelConfirm ? (
            <button
              onClick={handleOpenConfirm}
              className="w-full relative inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white overflow-hidden shadow-lg transition-all duration-300 hover:scale-[1.02] hover:shadow-amber-500/40 active:scale-[0.98]"
              style={{
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 50%, #b45309 100%)',
                boxShadow: '0 4px 15px rgba(245,158,11,0.35)',
              }}
            >
              <span className="text-base">📍</span>
              <span>Share Pickup Location & Confirm</span>
              <span className="absolute inset-0 rounded-xl border border-amber-300/30 pointer-events-none" />
            </button>
          ) : showConfirm ? (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <input placeholder="Your name" value={realName} onChange={e => setRealName(e.target.value)}
                       className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
                       style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
                <input placeholder="Contact (phone/email)" value={contact} onChange={e => setContact(e.target.value)}
                       className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
                       style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
              </div>

              {/* Google Maps link (auto-detected) */}
              {locationLat != null ? (
                <div className="flex items-center gap-2 text-xs rounded-lg px-3 py-1.5"
                     style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
                  <span>🗺️</span>
                  <a href={`https://maps.google.com/?q=${locationLat},${locationLng}`}
                     target="_blank" rel="noopener noreferrer"
                     className="text-blue-400 hover:text-blue-300 underline flex-1 truncate">
                    {`https://maps.google.com/?q=${locationLat.toFixed(5)},${locationLng.toFixed(5)}`}
                  </a>
                  <button
                    onClick={() => navigator.clipboard?.writeText(`https://maps.google.com/?q=${locationLat},${locationLng}`)}
                    className="text-xs text-amber-400 hover:text-amber-300 shrink-0"
                    title="Copy address"
                  >📋</button>
                  <span className="text-green-400 shrink-0">✓</span>
                </div>
              ) : (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>📍 Detecting your location…</p>
              )}

              {/* Manual address override */}
              <input
                placeholder="Or type your pickup address manually (optional)"
                value={manualAddress}
                onChange={e => setManualAddress(e.target.value)}
                className="rounded-lg px-3 py-2 text-sm outline-none w-full"
                style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
              />

              {/* Media attachment */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-700 hover:bg-gray-600 text-white flex items-center gap-1"
                >
                  📎 {mediaFile ? mediaFile.name.slice(0, 18) + (mediaFile.name.length > 18 ? '…' : '') : 'Attach photo'}
                </button>
                {mediaFile && (
                  <button type="button" onClick={() => setMediaFile(null)}
                          className="text-xs text-red-400 hover:text-red-300">✕</button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => setMediaFile(e.target.files?.[0] || null)}
                />
              </div>

              {/* Notify driver toggle */}
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={notifyDriver} onChange={e => setNotifyDriver(e.target.checked)} className="w-3.5 h-3.5 rounded" />
                <span>Send alert notification to driver</span>
              </label>

              <div className="flex gap-2">
                <button
                  onClick={handleConfirm}
                  className="flex-1 relative inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white shadow-lg transition-all duration-300 hover:scale-[1.02] hover:shadow-amber-500/40 active:scale-[0.98]"
                  style={{
                    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 50%, #b45309 100%)',
                    boxShadow: '0 4px 12px rgba(245,158,11,0.35)',
                  }}
                >
                  <span>📍</span> Confirm & Share
                </button>
                <button onClick={() => { setShowConfirm(false); setManualAddress(''); setMediaFile(null) }}
                        className="px-4 py-2 rounded-lg text-sm hover:opacity-80 transition-opacity"
                        style={{ color: 'var(--text-muted)' }}>
                  Cancel
                </button>
              </div>
              {confirmMsg && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{confirmMsg}</p>}
            </div>
          ) : null}
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
          const identifier = msgId || msg._localId || i
          const canDelete = mine || isDriver
          const isRecent = i >= messages.length - 3
          const msgText = msg.text || msg.content || ''
          // Detect location/maps messages for copy button
          const isMapsMsg = msgText.includes('maps.google.com') || msgText.includes('📍')
          const mapsUrl = isMapsMsg ? (msgText.match(/https?:\/\/maps\.google\.com\S+/) || [])[0] : null
          // Extract plain address from "📍 Pickup address: ..." messages
          const addressMatch = msgText.match(/📍 Pickup address:\s*(.+)/)
          const plainAddress = addressMatch ? addressMatch[1].trim() : null

          return (
            <div key={msgId || msg._localId || i}
                 className={`flex ${mine ? 'justify-end' : 'justify-start'} ${
                   i > 0 && prevSender === senderName ? 'mt-0.5' : 'mt-2'
                 } ${isRecent && msg._pending ? 'msg-entry' : ''}`}
                 onMouseEnter={() => setHoveredMsg(identifier)}
                 onMouseLeave={() => { setHoveredMsg(null); setShowDeleteMenu(null) }}>
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
                  {/* Delete button for own messages */}
                  {mine && canDelete && hoveredMsg === identifier && (
                    <div className="relative shrink-0 mb-1">
                      <button
                        onClick={() => setShowDeleteMenu(v => v === identifier ? null : identifier)}
                        className="text-xs opacity-60 hover:opacity-100 hover:text-red-400"
                        title="Delete options"
                        style={{ color: 'var(--text-muted)' }}
                      >🗑</button>
                      {showDeleteMenu === identifier && (
                        <div className="absolute bottom-full mb-1 right-0 rounded-xl shadow-2xl overflow-hidden z-20 min-w-[160px]"
                             style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                          <button
                            onClick={() => { handleDeleteMessage(msg, false); setShowDeleteMenu(null) }}
                            className="w-full text-left px-3 py-2 text-xs hover:opacity-80"
                            style={{ color: 'var(--text-secondary)' }}
                          >Delete for me</button>
                          {msgId && (
                            <button
                              onClick={() => { handleDeleteMessage(msg, true); setShowDeleteMenu(null) }}
                              className="w-full text-left px-3 py-2 text-xs hover:opacity-80 text-red-400 border-t"
                              style={{ borderColor: 'var(--border-color)' }}
                            >Delete for everyone</button>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className={`relative px-3 py-2 rounded-2xl text-sm break-words ${
                    mine
                      ? 'bg-amber-500 text-black rounded-tr-sm'
                      : 'rounded-tl-sm'
                  }`}
                       style={mine ? {} : { background: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
                    {msg.media_type === 'image' && msg.media_data ? (
                      <img src={msg.media_data} alt="Shared photo" className="max-w-[180px] rounded-lg" style={{ maxHeight: 160, objectFit: 'cover' }} />
                    ) : (
                      <p className="break-words leading-snug">{msgText}</p>
                    )}
                    {/* Copy address button for location messages */}
                    {(mapsUrl || plainAddress) && (
                      <button
                        onClick={() => navigator.clipboard?.writeText(mapsUrl || plainAddress || '')}
                        className="mt-1 flex items-center gap-1 text-xs opacity-70 hover:opacity-100 transition-opacity"
                        style={{ color: mine ? 'rgba(0,0,0,0.7)' : 'var(--text-muted)' }}
                        title="Copy address"
                      >
                        📋 Copy address
                      </button>
                    )}
                    <div className={`flex items-center justify-end gap-0.5 mt-0.5 ${mine ? 'opacity-70' : 'opacity-50'}`}>
                      <span className="text-xs">{fmtTime(msg.ts || msg.timestamp)}</span>
                      {mine && <MessageTicks msg={msg} />}
                    </div>
                  </div>

                  {/* Driver can delete others' messages */}
                  {!mine && canDelete && isDriver && hoveredMsg === identifier && (
                    <div className="relative shrink-0 mb-1">
                      <button
                        onClick={() => setShowDeleteMenu(v => v === `d-${identifier}` ? null : `d-${identifier}`)}
                        className="text-xs opacity-60 hover:opacity-100 hover:text-red-400"
                        title="Delete message"
                        style={{ color: 'var(--text-muted)' }}
                      >🗑</button>
                      {showDeleteMenu === `d-${identifier}` && (
                        <div className="absolute bottom-full mb-1 left-0 rounded-xl shadow-2xl overflow-hidden z-20 min-w-[160px]"
                             style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                          {msgId && (
                            <button
                              onClick={() => { handleDeleteMessage(msg, true); setShowDeleteMenu(null) }}
                              className="w-full text-left px-3 py-2 text-xs hover:opacity-80 text-red-400"
                            >Delete for everyone</button>
                          )}
                        </div>
                      )}
                    </div>
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

      {/* Quick reply templates */}
      <div className="px-3 py-1.5 border-t flex gap-1.5 overflow-x-auto scrollbar-hide flex-nowrap"
           style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}>
        {QUICK_REPLIES.map(qr => (
          <button
            key={qr}
            onClick={() => { setText(qr); }}
            className="shrink-0 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap hover:opacity-80 transition-opacity"
            style={{ background: 'var(--bg-input)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
          >
            {qr}
          </button>
        ))}
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
