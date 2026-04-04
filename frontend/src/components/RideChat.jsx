import { useState, useEffect, useRef, useCallback } from 'react'
import socket from '../socket'
import { confirmJourney, getConfirmedUsers, proximityNotify } from '../api'

/**
 * RideChat — Live chat panel for a single ride.
 *
 * Features:
 *  - Driver messages (right, charcoal bubble) vs. Passenger messages (left, gray bubble)
 *  - Typing indicators: "Driver is typing…" / "Rider is typing…"
 *  - Read receipts: ✓ Sent → ✓✓ Delivered → ✓✓ Read (blue)
 *  - Messages capped at 500 characters
 *  - Image, audio (voice), and location sharing
 *  - Chat history loaded on join
 *  - Bi-directional: ride poster can reply to any user
 *
 * Props:
 *  ride    - The ride object ({ ride_id, driver_name, origin, destination, user_id })
 *  user    - The logged-in app user (or null for anonymous)
 *  onClose - Callback to close the chat panel
 */

const MAX_LEN = 500
const MAX_IMAGE_SIZE = 1_000_000  // ~1 MB base64

export default function RideChat({ ride, user, onClose, defaultMessage = '' }) {
  const [messages,   setMessages]   = useState([])
  const [text,       setText]       = useState(defaultMessage)
  const [joined,     setJoined]     = useState(false)
  const [typers,     setTypers]     = useState([])
  const [readBy,     setReadBy]     = useState({})
  const bottomRef                   = useRef(null)
  const inputRef                    = useRef(null)
  const typingTimer                 = useRef(null)
  const isTyping                    = useRef(false)
  const fileInputRef                = useRef(null)
  const mediaRecorderRef            = useRef(null)
  const audioChunksRef              = useRef([])
  const [recording,  setRecording]  = useState(false)
  const [mediaError, setMediaError] = useState('')

  // ── Journey Confirmation state ────────────────────────────────────────────
  const [showConfirmForm,   setShowConfirmForm]   = useState(false)
  const [confirmName,       setConfirmName]       = useState(user?.name || '')
  const [confirmContact,    setConfirmContact]    = useState('')
  const [confirmLoading,    setConfirmLoading]    = useState(false)
  const [confirmError,      setConfirmError]      = useState('')
  const [confirmOk,         setConfirmOk]         = useState(false)

  // ── Confirmed Users (driver view) ─────────────────────────────────────────
  const [showConfirmedUsers, setShowConfirmedUsers] = useState(false)
  const [confirmedUsers,     setConfirmedUsers]     = useState([])
  const [confirmedLoading,   setConfirmedLoading]   = useState(false)

  // ── Proximity Notify state (driver) ──────────────────────────────────────
  const [showProximity,    setShowProximity]    = useState(false)
  const [proximityDist,    setProximityDist]    = useState(1)
  const [proximityUnit,    setProximityUnit]    = useState('km')
  const [proximityLoading, setProximityLoading] = useState(false)
  const [proximityMsg,     setProximityMsg]     = useState('')

  const senderName  = user?.name   || 'Passenger'
  const isDriver    = user?.role   === 'driver'
  const isPoster    = ride?.user_id && user?.user_id === ride.user_id

  // ── Socket setup ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!ride?.ride_id) return
    socket.emit('join_ride_chat', { ride_id: ride.ride_id, name: senderName })

    const onJoined  = (payload) => {
      setJoined(true)
      // Load chat history sent by server on join
      if (payload?.history?.length) {
        setMessages(payload.history.map(m => ({ ...m, status: 'delivered' })))
      }
    }

    const onMessage = (msg) => {
      if (msg.ride_id !== ride.ride_id) return
      setMessages(prev => {
        // Deduplicate by id
        if (prev.some(m => m.id === msg.id)) return prev
        return [...prev, { ...msg, status: 'delivered' }]
      })
      // Emit read receipt for messages from others
      if (msg.name !== senderName) {
        socket.emit('ride_chat_read', { ride_id: ride.ride_id, msg_id: msg.id, reader: senderName })
      }
    }

    const onTyping = ({ ride_id, name }) => {
      if (ride_id !== ride.ride_id || name === senderName) return
      setTypers(prev => prev.includes(name) ? prev : [...prev, name])
    }

    const onStopTyping = ({ ride_id, name }) => {
      if (ride_id !== ride.ride_id) return
      setTypers(prev => prev.filter(n => n !== name))
    }

    const onRead = ({ ride_id, msg_id, reader }) => {
      if (ride_id !== ride.ride_id) return
      setReadBy(prev => {
        const set = new Set(prev[msg_id] || [])
        set.add(reader)
        return { ...prev, [msg_id]: set }
      })
      setMessages(prev => prev.map(m => m.id === msg_id && m.name === senderName
        ? { ...m, status: 'read' }
        : m
      ))
    }

    socket.on('ride_chat_joined',       onJoined)
    socket.on('ride_chat_message',      onMessage)
    socket.on('ride_chat_typing',       onTyping)
    socket.on('ride_chat_stop_typing',  onStopTyping)
    socket.on('ride_chat_read',         onRead)

    return () => {
      socket.emit('leave_ride_chat', { ride_id: ride.ride_id })
      socket.off('ride_chat_joined',       onJoined)
      socket.off('ride_chat_message',      onMessage)
      socket.off('ride_chat_typing',       onTyping)
      socket.off('ride_chat_stop_typing',  onStopTyping)
      socket.off('ride_chat_read',         onRead)
    }
  }, [ride?.ride_id, senderName])

  /* Scroll to latest message */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, typers])

  // ── Typing detection ───────────────────────────────────────────────────────

  const handleTextChange = (e) => {
    setText(e.target.value)
    if (!ride?.ride_id) return
    if (!isTyping.current) {
      isTyping.current = true
      socket.emit('ride_chat_typing', { ride_id: ride.ride_id, name: senderName })
    }
    clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => {
      isTyping.current = false
      socket.emit('ride_chat_stop_typing', { ride_id: ride.ride_id, name: senderName })
    }, 1500)
  }

  // ── Send text ──────────────────────────────────────────────────────────────

  const emitMessage = useCallback((extra = {}) => {
    const msgId = `${Date.now()}-${Math.random()}`
    const trimmed = text.trim()
    if (!trimmed && !extra.media_type) return

    isTyping.current = false
    clearTimeout(typingTimer.current)
    socket.emit('ride_chat_stop_typing', { ride_id: ride.ride_id, name: senderName })

    const localMsg = {
      id:         msgId,
      ride_id:    ride.ride_id,
      name:       senderName,
      text:       trimmed,
      ts:         Date.now() / 1000,
      role:       user?.role || 'passenger',
      status:     'sent',
      media_type: extra.media_type || null,
      media_data: extra.media_data || null,
      lat:        extra.lat || null,
      lng:        extra.lng || null,
    }
    setMessages(prev => [...prev, localMsg])

    socket.emit('ride_chat_message', {
      ride_id:    ride.ride_id,
      name:       senderName,
      text:       trimmed,
      role:       user?.role || 'passenger',
      id:         msgId,
      media_type: extra.media_type || null,
      media_data: extra.media_data || null,
      lat:        extra.lat || null,
      lng:        extra.lng || null,
    })
    setText('')
    inputRef.current?.focus()
  }, [text, ride, senderName, user])

  const handleSend = (e) => {
    e.preventDefault()
    if (!text.trim() || !ride?.ride_id) return
    emitMessage()
  }

  // ── Image attachment ───────────────────────────────────────────────────────

  const handleImagePick = () => fileInputRef.current?.click()

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { setMediaError('Only image files are supported.'); return }
    const reader = new FileReader()
    reader.onload = (ev) => {
      const b64 = ev.target.result
      if (b64.length > MAX_IMAGE_SIZE) { setMediaError('Image too large (max ~750 KB).'); return }
      setMediaError('')
      emitMessage({ media_type: 'image', media_data: b64 })
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  // ── Voice recording ────────────────────────────────────────────────────────

  const startRecording = async () => {
    setMediaError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      audioChunksRef.current = []
      recorder.ondataavailable = (e) => audioChunksRef.current.push(e.data)
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        const reader = new FileReader()
        reader.onload = (ev) => {
          const b64 = ev.target.result
          if (b64.length > MAX_IMAGE_SIZE) { setMediaError('Audio too large.'); return }
          emitMessage({ media_type: 'audio', media_data: b64 })
        }
        reader.readAsDataURL(blob)
      }
      recorder.start()
      mediaRecorderRef.current = recorder
      setRecording(true)
    } catch {
      setMediaError('Microphone access denied.')
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    setRecording(false)
  }

  // ── Location sharing ───────────────────────────────────────────────────────

  const handleShareLocation = () => {
    setMediaError('')
    if (!navigator.geolocation) { setMediaError('Geolocation not supported.'); return }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => emitMessage({ media_type: 'location', lat: coords.latitude, lng: coords.longitude }),
      () => setMediaError('Location permission denied.'),
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }

  const formatTime = (ts) => {
    if (!ts) return ''
    const d = ts > 1e10 ? new Date(ts) : new Date(ts * 1000)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  // ── Journey confirmation handlers ─────────────────────────────────────────

  const handleConfirmJourney = async (e) => {
    e.preventDefault()
    setConfirmError('')
    if (!confirmName.trim() || !confirmContact.trim()) {
      setConfirmError('Both real name and contact are required.')
      return
    }
    setConfirmLoading(true)
    try {
      await confirmJourney(ride.ride_id, confirmName.trim(), confirmContact.trim())
      setConfirmOk(true)
      setShowConfirmForm(false)
    } catch (err) {
      setConfirmError(err.message || 'Failed to confirm journey.')
    } finally {
      setConfirmLoading(false)
    }
  }

  const handleLoadConfirmedUsers = async () => {
    setConfirmedLoading(true)
    try {
      const data = await getConfirmedUsers(ride.ride_id)
      setConfirmedUsers(data.confirmed_users || [])
      setShowConfirmedUsers(true)
    } catch (err) {
      setConfirmedUsers([])
    } finally {
      setConfirmedLoading(false)
    }
  }

  const handleProximityNotify = async (e) => {
    e.preventDefault()
    setProximityLoading(true)
    setProximityMsg('')
    try {
      const data = await proximityNotify(ride.ride_id, Number(proximityDist), proximityUnit)
      setProximityMsg(`✅ Notified ${data.notified} passenger${data.notified !== 1 ? 's' : ''}.`)
    } catch (err) {
      setProximityMsg(`❌ ${err.message || 'Failed to send.'}`)
    } finally {
      setProximityLoading(false)
    }
  }



  const ReceiptIcon = ({ status }) => {
    const received = status === 'read' || status === 'delivered'
    return (
      <span className="inline-flex items-center gap-0.5 ml-1">
        {/* Filled "o" indicator: green = received, red = not yet received */}
        <span
          className={`ride-chat-read-dot ${received ? 'ride-chat-read-dot-green' : 'ride-chat-read-dot-red'}`}
          title={received ? (status === 'read' ? 'Read' : 'Delivered') : 'Sent'}
        >
          o
        </span>
        {status === 'read'      && <span className="text-blue-300 text-xs" title="Read">✓✓</span>}
        {status === 'delivered' && <span className="text-gray-300 text-xs" title="Delivered">✓✓</span>}
        {status === 'sent'      && <span className="text-gray-500 text-xs" title="Sent">✓</span>}
      </span>
    )
  }

  // ── Media bubble contents ──────────────────────────────────────────────────

  const MediaContent = ({ msg }) => {
    if (msg.media_type === 'image' && msg.media_data) {
      return (
        <img
          src={msg.media_data}
          alt="shared image"
          className="max-w-full rounded-lg mt-1 max-h-48 object-cover"
          loading="lazy"
        />
      )
    }
    if (msg.media_type === 'audio' && msg.media_data) {
      return (
        <audio controls src={msg.media_data} className="mt-1 h-8 w-full" />
      )
    }
    if (msg.media_type === 'location' && msg.lat != null) {
      const mapUrl = `https://www.openstreetmap.org/?mlat=${msg.lat}&mlon=${msg.lng}#map=15/${msg.lat}/${msg.lng}`
      return (
        <a href={mapUrl} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 mt-1 text-blue-300 text-xs hover:text-blue-200 underline">
          📍 View location ({msg.lat.toFixed(4)}, {msg.lng.toFixed(4)})
        </a>
      )
    }
    return null
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="ride-chat-panel flex flex-col h-full">
      {/* Header */}
      <div className="ride-chat-header flex items-center justify-between px-4 py-2.5 border-b border-gray-700">
        <div>
          <p className="text-sm font-semibold text-white flex items-center gap-1.5">
            <span>💬</span>
            <span>Live Chat</span>
            {isPoster && (
              <span className="text-xs px-1.5 py-0.5 bg-blue-900/60 border border-blue-700 text-blue-300 rounded-full">
                Your Ride
              </span>
            )}
          </p>
          <p className="text-xs text-gray-400 truncate max-w-[220px]">
            {ride.origin} → {ride.destination} · {ride.driver_name}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-300 transition-colors text-lg leading-none"
          aria-label="Close chat"
        >
          ✕
        </button>
      </div>

      {/* Messages */}
      <div className="ride-chat-messages flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {!joined && (
          <div className="flex justify-center py-4">
            <span className="ride-chat-connecting text-xs text-gray-500">Connecting to chat…</span>
          </div>
        )}
        {joined && messages.length === 0 && (
          <div className="text-center text-xs text-gray-500 pt-6">
            <p className="text-2xl mb-1">💬</p>
            <p>No messages yet. Say hello!</p>
          </div>
        )}
        {messages.map((msg, i) => {
          const isMine   = msg.name === senderName
          const msgRole  = msg.role || (msg.name === ride?.driver_name ? 'driver' : 'passenger')
          const msgIsDriver = msgRole === 'driver'

          const bubbleClass = isMine
            ? (isDriver
                ? 'bg-gray-700 text-gray-100 rounded-tr-sm'
                : 'bg-blue-600 text-white rounded-tr-sm')
            : (msgIsDriver
                ? 'bg-gray-700 text-gray-100 rounded-tl-sm'
                : 'bg-gray-600/80 text-gray-100 rounded-tl-sm')

          return (
            <div
              key={msg.id || i}
              className={`flex ${isMine ? 'justify-end' : 'justify-start'} ride-chat-msg-anim`}
            >
              {!isMine && msgIsDriver && (
                <span className="text-xs mr-1 mt-2 text-gray-500" title="Driver">🚗</span>
              )}

              <div className={`ride-chat-bubble max-w-[80%] px-3 py-2 rounded-2xl text-sm ${bubbleClass}`}>
                {!isMine && (
                  <p className="text-xs font-semibold text-blue-300 mb-0.5 flex items-center gap-1">
                    {msg.name}
                    {msgIsDriver && <span className="text-yellow-400 text-xs">Driver</span>}
                    {ride?.user_id && msg.user_id === ride.user_id && (
                      <span className="text-green-400 text-xs">Poster</span>
                    )}
                  </p>
                )}
                {msg.text && <p className="leading-snug break-words">{msg.text}</p>}
                <MediaContent msg={msg} />
                <div className={`flex items-center justify-end gap-0.5 mt-0.5 ${isMine ? 'text-blue-200/70' : 'text-gray-400'}`}>
                  <span className="text-xs">{formatTime(msg.ts)}</span>
                  {isMine && <ReceiptIcon status={msg.status} />}
                </div>
              </div>
            </div>
          )
        })}

        {/* Typing indicator */}
        {typers.length > 0 && (
          <div className="flex justify-start">
            <div className="bg-gray-700/60 rounded-2xl rounded-tl-sm px-3 py-2 text-xs text-gray-400 italic flex items-center gap-1.5">
              <span className="flex gap-0.5">
                {[0,1,2].map(i => (
                  <span
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </span>
              {typers.join(', ')} {typers.length === 1 ? 'is' : 'are'} typing…
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Media error */}
      {mediaError && (
        <div className="px-3 py-1 text-xs text-red-400 bg-red-900/20 border-t border-red-800/40">
          {mediaError}
        </div>
      )}

      {/* ── Journey Confirmation (passenger) ── */}
      {!isPoster && !isDriver && joined && (
        <div className="px-3 py-2 border-t border-gray-700/60 bg-gray-800/30">
          {confirmOk ? (
            <p className="text-xs text-green-400 flex items-center gap-1">✅ Journey confirmed! Driver has your details.</p>
          ) : showConfirmForm ? (
            <form onSubmit={handleConfirmJourney} className="space-y-1.5">
              <p className="text-xs font-semibold text-green-400">✅ Confirm Your Journey</p>
              <div className="flex gap-1.5">
                <input type="text" placeholder="Your real name" value={confirmName}
                  onChange={e => setConfirmName(e.target.value)}
                  className="flex-1 rounded-lg bg-gray-700 border border-gray-600 text-gray-100 text-xs px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-500" />
                <input type="text" placeholder="Phone/email" value={confirmContact}
                  onChange={e => setConfirmContact(e.target.value)}
                  className="flex-1 rounded-lg bg-gray-700 border border-gray-600 text-gray-100 text-xs px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-500" />
              </div>
              {confirmError && <p className="text-red-400 text-xs">{confirmError}</p>}
              <div className="flex gap-1.5">
                <button type="submit" disabled={confirmLoading}
                  className="text-xs px-3 py-1.5 rounded-lg bg-green-700 hover:bg-green-600 text-white font-semibold disabled:opacity-50 transition-colors">
                  {confirmLoading ? 'Confirming…' : '✅ Confirm'}
                </button>
                <button type="button" onClick={() => setShowConfirmForm(false)}
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors">
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button onClick={() => setShowConfirmForm(true)}
              className="text-xs px-3 py-1.5 rounded-lg bg-green-800/60 hover:bg-green-700/60 border border-green-700/50 text-green-300 font-semibold transition-colors">
              ✅ Confirm My Journey
            </button>
          )}
        </div>
      )}

      {/* ── Confirmed Users + Proximity Notify (driver/poster) ── */}
      {isPoster && joined && (
        <div className="px-3 py-2 border-t border-gray-700/60 bg-gray-800/30 space-y-2">
          {/* Confirmed users toggle */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={showConfirmedUsers ? () => setShowConfirmedUsers(false) : handleLoadConfirmedUsers}
              disabled={confirmedLoading}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-indigo-800/60 hover:bg-indigo-700/60 border border-indigo-700/50 text-indigo-300 font-semibold transition-colors disabled:opacity-50">
              {confirmedLoading ? '…' : `👥 Confirmed Users${confirmedUsers.length > 0 ? ` (${confirmedUsers.length})` : ''}`}
            </button>
            <button onClick={() => setShowProximity(v => !v)}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-orange-800/60 hover:bg-orange-700/60 border border-orange-700/50 text-orange-300 font-semibold transition-colors">
              📍 Notify Distance
            </button>
          </div>

          {/* Confirmed users list */}
          {showConfirmedUsers && (
            <div className="space-y-1">
              {confirmedUsers.length === 0 ? (
                <p className="text-xs text-gray-500 italic">No confirmed passengers yet.</p>
              ) : confirmedUsers.map(cu => (
                <div key={cu.confirmation_id} className="flex items-center justify-between bg-gray-700/40 rounded-lg px-2.5 py-1.5">
                  <div>
                    <p className="text-xs text-white font-medium">{cu.real_name}</p>
                    <p className="text-xs text-blue-400">{cu.contact}</p>
                  </div>
                  <span className="text-xs text-green-400">✅ Confirmed</span>
                </div>
              ))}
            </div>
          )}

          {/* Proximity notification form */}
          {showProximity && (
            <form onSubmit={handleProximityNotify} className="space-y-1.5">
              <p className="text-xs font-semibold text-orange-400">📍 Send Proximity Alert to Confirmed Passengers</p>
              <div className="flex gap-1.5 items-center">
                <input type="number" min={0.1} step={0.1} value={proximityDist}
                  onChange={e => setProximityDist(e.target.value)}
                  className="w-20 rounded-lg bg-gray-700 border border-gray-600 text-gray-100 text-xs px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-orange-500" />
                <select value={proximityUnit} onChange={e => setProximityUnit(e.target.value)}
                  className="rounded-lg bg-gray-700 border border-gray-600 text-gray-100 text-xs px-2 py-1.5 focus:outline-none">
                  <option value="km">km</option>
                  <option value="miles">miles</option>
                </select>
                <button type="submit" disabled={proximityLoading}
                  className="text-xs px-3 py-1.5 rounded-lg bg-orange-700 hover:bg-orange-600 text-white font-semibold disabled:opacity-50 transition-colors">
                  {proximityLoading ? 'Sending…' : '📤 Send'}
                </button>
              </div>
              {proximityMsg && <p className="text-xs text-gray-300">{proximityMsg}</p>}
            </form>
          )}
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSend} className="ride-chat-input-bar flex gap-1.5 px-2 py-2 border-t border-gray-700">
        {/* Image pick */}
        <input ref={fileInputRef} type="file" accept="image/*" className="sr-only" onChange={handleFileChange} />
        <button
          type="button"
          onClick={handleImagePick}
          disabled={!joined}
          title="Send image"
          className="ride-chat-media-btn rounded-full w-8 h-8 flex items-center justify-center bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-300 text-sm transition-colors shrink-0"
        >
          🖼
        </button>

        {/* Voice record */}
        <button
          type="button"
          onClick={recording ? stopRecording : startRecording}
          disabled={!joined}
          title={recording ? 'Stop recording' : 'Send voice message'}
          className={`ride-chat-media-btn rounded-full w-8 h-8 flex items-center justify-center disabled:opacity-40 text-sm transition-colors shrink-0 ${
            recording ? 'bg-red-600 hover:bg-red-500 text-white ride-chat-recording-pulse' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
          }`}
        >
          🎙
        </button>

        {/* Location share */}
        <button
          type="button"
          onClick={handleShareLocation}
          disabled={!joined}
          title="Share location"
          className="ride-chat-media-btn rounded-full w-8 h-8 flex items-center justify-center bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-300 text-sm transition-colors shrink-0"
        >
          📍
        </button>

        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={handleTextChange}
          placeholder={joined ? 'Type a message…' : 'Connecting…'}
          disabled={!joined}
          maxLength={MAX_LEN}
          className="flex-1 rounded-full bg-gray-800 border border-gray-600 text-gray-100 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 ride-chat-text-input min-w-0"
        />
        <button
          type="submit"
          disabled={!joined || !text.trim()}
          className="ride-chat-send-btn rounded-full w-9 h-9 flex items-center justify-center bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-white shrink-0"
          aria-label="Send"
        >
          ➤
        </button>
      </form>
    </div>
  )
}
