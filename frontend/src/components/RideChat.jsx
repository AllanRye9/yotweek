import { useState, useEffect, useRef, useCallback } from 'react'
import socket from '../socket'

/**
 * RideChat — Live chat panel for a single ride.
 *
 * Features:
 *  - Driver messages (right, charcoal bubble) vs. Passenger messages (left, gray bubble)
 *  - Typing indicators: "Driver is typing…" / "Rider is typing…"
 *  - Read receipts: ✓ Sent → ✓✓ Delivered → ✓✓ Read (blue)
 *  - Messages capped at 500 characters
 *
 * Props:
 *  ride    - The ride object ({ ride_id, driver_name, origin, destination })
 *  user    - The logged-in app user (or null for anonymous)
 *  onClose - Callback to close the chat panel
 */

const MAX_LEN = 500

export default function RideChat({ ride, user, onClose }) {
  const [messages,   setMessages]   = useState([])
  const [text,       setText]       = useState('')
  const [joined,     setJoined]     = useState(false)
  const [typers,     setTypers]     = useState([])  // names currently typing
  const [readBy,     setReadBy]     = useState({})  // msgId → Set<name>
  const bottomRef                   = useRef(null)
  const inputRef                    = useRef(null)
  const typingTimer                 = useRef(null)
  const isTyping                    = useRef(false)

  const senderName  = user?.name   || 'Passenger'
  const isDriver    = user?.role   === 'driver'

  // ── Socket setup ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!ride?.ride_id) return
    socket.emit('join_ride_chat', { ride_id: ride.ride_id, name: senderName })

    const onJoined  = () => setJoined(true)

    const onMessage = (msg) => {
      if (msg.ride_id !== ride.ride_id) return
      setMessages(prev => [...prev, { ...msg, status: 'delivered' }])
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
      // Upgrade status to 'read' for our own messages
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

  // ── Send ───────────────────────────────────────────────────────────────────

  const handleSend = (e) => {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || !ride?.ride_id) return

    // Stop-typing housekeeping
    isTyping.current = false
    clearTimeout(typingTimer.current)
    socket.emit('ride_chat_stop_typing', { ride_id: ride.ride_id, name: senderName })

    const msgId = `${Date.now()}-${Math.random()}`
    // Optimistic local message
    const localMsg = {
      id:      msgId,
      ride_id: ride.ride_id,
      name:    senderName,
      text:    trimmed,
      ts:      Date.now() / 1000,
      role:    user?.role || 'passenger',
      status:  'sent',
    }
    setMessages(prev => [...prev, localMsg])

    socket.emit('ride_chat_message', {
      ride_id: ride.ride_id,
      name:    senderName,
      text:    trimmed,
      role:    user?.role || 'passenger',
      id:      msgId,
    })
    setText('')
    inputRef.current?.focus()
  }

  const formatTime = (ts) => {
    if (!ts) return ''
    const d = ts > 1e10 ? new Date(ts) : new Date(ts * 1000)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  // ── Receipt icon ───────────────────────────────────────────────────────────

  const ReceiptIcon = ({ status }) => {
    if (status === 'read')      return <span className="text-blue-300 text-xs ml-1" title="Read">✓✓</span>
    if (status === 'delivered') return <span className="text-gray-300 text-xs ml-1" title="Delivered">✓✓</span>
    return <span className="text-gray-500 text-xs ml-1" title="Sent">✓</span>
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
          const isDriver = msgRole === 'driver'

          // Bubble style: driver = charcoal right; passenger = light gray left
          const bubbleClass = isMine
            ? (isDriver
                ? 'bg-gray-700 text-gray-100 rounded-tr-sm'   // driver sends: right charcoal
                : 'bg-blue-600 text-white rounded-tr-sm')      // passenger sends: right blue
            : (isDriver
                ? 'bg-gray-700 text-gray-100 rounded-tl-sm'   // driver receives on left: charcoal
                : 'bg-gray-600/80 text-gray-100 rounded-tl-sm') // passenger on left: lighter gray

          return (
            <div
              key={i}
              className={`flex ${isMine ? 'justify-end' : 'justify-start'} ride-chat-msg-anim`}
            >
              {/* Role icon for non-mine driver messages */}
              {!isMine && isDriver && (
                <span className="text-xs mr-1 mt-2 text-gray-500" title="Driver">🚗</span>
              )}

              <div className={`ride-chat-bubble max-w-[80%] px-3 py-2 rounded-2xl text-sm ${bubbleClass}`}>
                {!isMine && (
                  <p className="text-xs font-semibold text-blue-300 mb-0.5 flex items-center gap-1">
                    {msg.name}
                    {isDriver && <span className="text-yellow-400 text-xs">Driver</span>}
                  </p>
                )}
                <p className="leading-snug break-words">{msg.text}</p>
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

      {/* Input */}
      <form onSubmit={handleSend} className="ride-chat-input-bar flex gap-2 px-3 py-2.5 border-t border-gray-700">
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={handleTextChange}
          placeholder={joined ? 'Type a message…' : 'Connecting…'}
          disabled={!joined}
          maxLength={MAX_LEN}
          className="flex-1 rounded-full bg-gray-800 border border-gray-600 text-gray-100 text-sm px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 ride-chat-text-input"
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
