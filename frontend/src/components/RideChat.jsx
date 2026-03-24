import { useState, useEffect, useRef } from 'react'
import socket from '../socket'

/**
 * RideChat — Live chat panel for a single ride.
 *
 * Props:
 *  ride    - The ride object ({ ride_id, driver_name, origin, destination })
 *  user    - The logged-in app user (or null for anonymous)
 *  onClose - Callback to close the chat panel
 *
 * Note: Messages are capped at 500 characters (enforced by both this component
 * and the backend's on_ride_chat_message handler).
 */
export default function RideChat({ ride, user, onClose }) {
  const [messages, setMessages] = useState([])
  const [text, setText]         = useState('')
  const [joined, setJoined]     = useState(false)
  const bottomRef               = useRef(null)
  const inputRef                = useRef(null)
  const senderName              = user?.name || 'Passenger'

  /* Join the ride's chat room on mount */
  useEffect(() => {
    if (!ride?.ride_id) return
    socket.emit('join_ride_chat', { ride_id: ride.ride_id, name: senderName })

    const onJoined = () => setJoined(true)
    const onMessage = (msg) => {
      if (msg.ride_id === ride.ride_id) {
        setMessages(prev => [...prev, msg])
      }
    }

    socket.on('ride_chat_joined',  onJoined)
    socket.on('ride_chat_message', onMessage)

    return () => {
      socket.emit('leave_ride_chat', { ride_id: ride.ride_id })
      socket.off('ride_chat_joined',  onJoined)
      socket.off('ride_chat_message', onMessage)
    }
  }, [ride?.ride_id, senderName])

  /* Scroll to latest message */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = (e) => {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || !ride?.ride_id) return
    socket.emit('ride_chat_message', {
      ride_id: ride.ride_id,
      name:    senderName,
      text:    trimmed,
    })
    setText('')
    inputRef.current?.focus()
  }

  const formatTime = (ts) => {
    if (!ts) return ''
    return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

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
          const isMine = msg.name === senderName
          return (
            <div
              key={i}
              className={`flex ${isMine ? 'justify-end' : 'justify-start'} ride-chat-msg-anim`}
            >
              <div
                className={`ride-chat-bubble max-w-[80%] px-3 py-2 rounded-2xl text-sm ${
                  isMine
                    ? 'bg-blue-600 text-white rounded-tr-sm'
                    : 'bg-gray-700 text-gray-100 rounded-tl-sm'
                }`}
              >
                {!isMine && (
                  <p className="text-xs font-semibold text-blue-300 mb-0.5">{msg.name}</p>
                )}
                <p className="leading-snug break-words">{msg.text}</p>
                <p className={`text-xs mt-0.5 ${isMine ? 'text-blue-200/70' : 'text-gray-400'} text-right`}>
                  {formatTime(msg.ts)}
                </p>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="ride-chat-input-bar flex gap-2 px-3 py-2.5 border-t border-gray-700">
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={joined ? 'Type a message…' : 'Connecting…'}
          disabled={!joined}
          maxLength={500}
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
