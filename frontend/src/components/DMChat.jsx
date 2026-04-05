import { useState, useEffect, useRef, useCallback } from 'react'
import socket from '../socket'
import { dmMarkRead, getUserPublicKey } from '../api'
import { getSharedSecret, encryptMessage, decryptMessage, isEncryptedPayload } from '../crypto'

/**
 * DMChat — Direct-message chat panel between two users.
 *
 * Features:
 *  - End-to-end encrypted messages (ECDH + AES-GCM via Web Crypto)
 *  - Left (incoming) / Right (outgoing) message alignment per sender
 *  - Reply-to-message support with inline preview
 *  - Typing indicators
 *  - Read / Delivered / Sent receipts (✓ ✓✓ ✓✓blue)
 *  - Message grouping (consecutive from same sender)
 *  - Date separators between days
 *  - WhatsApp-standard media toolbar: image, location, audio
 *  - Real-time image rendering on upload
 *  - Real-time via Socket.IO dm_* events
 *  - Chat history loaded on join
 *
 * Props:
 *  conv        - conversation object { conv_id, other_user }
 *  currentUser - logged-in user { user_id, name }
 *  onClose     - callback to close this panel
 */

// E2E-encrypted payloads are base64-encoded and larger than plaintext; 4000 chars accommodates them
const MAX_LEN = 4000

// Message type prefixes for media
const IMG_PREFIX  = '[IMAGE]'
const LOC_PREFIX  = '[LOCATION:'
const AUDIO_PREFIX = '[AUDIO]'

function isImageMsg(content)    { return typeof content === 'string' && content.startsWith(IMG_PREFIX) }
function isLocationMsg(content) { return typeof content === 'string' && content.startsWith(LOC_PREFIX) }
function isAudioMsg(content)    { return typeof content === 'string' && content.startsWith(AUDIO_PREFIX) }

function parseLocation(content) {
  // Format: [LOCATION:lat,lng:label]
  try {
    const inner = content.slice(LOC_PREFIX.length, content.lastIndexOf(']'))
    const colonIdx = inner.indexOf(':')
    const coords = colonIdx === -1 ? inner : inner.slice(0, colonIdx)
    const label  = colonIdx === -1 ? '' : inner.slice(colonIdx + 1)
    const [lat, lng] = coords.split(',').map(Number)
    return { lat, lng, label }
  } catch { return null }
}

// ── Date separator helpers ───────────────────────────────────────────────────

function msgDate(ts) {
  if (!ts) return null
  const d = ts > 1e10 ? new Date(ts) : new Date(ts * 1000)
  return d.toDateString()
}

function friendlyDate(dateStr) {
  if (!dateStr) return ''
  const d  = new Date(dateStr)
  const now = new Date()
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === now.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

export default function DMChat({ conv, currentUser, onClose, onBack }) {
  const [messages,      setMessages]      = useState([])
  const [text,          setText]          = useState('')
  const [joined,        setJoined]        = useState(false)
  const [isTypingOther, setIsTypingOther] = useState(false)
  const [replyTo,       setReplyTo]       = useState(null)
  const [mediaOpen,     setMediaOpen]     = useState(false)
  const [locSharing,    setLocSharing]    = useState(false)
  const bottomRef   = useRef(null)
  const inputRef    = useRef(null)
  const imageRef    = useRef(null)
  const typingTimer = useRef(null)
  const isTyping    = useRef(false)
  const sharedKeyRef = useRef(null)

  const convId    = conv?.conv_id
  const myId      = currentUser?.user_id
  const otherUser = conv?.other_user

  // ── Derive E2E shared secret ─────────────────────────────────────────────

  useEffect(() => {
    if (!otherUser?.user_id) return
    getUserPublicKey(otherUser.user_id)
      .then(async (res) => {
        if (res?.public_key) {
          sharedKeyRef.current = await getSharedSecret(res.public_key)
        }
      })
      .catch(() => {})
  }, [otherUser?.user_id])

  // ── Helper: decrypt a message ────────────────────────────────────────────

  const decryptMsg = useCallback(async (msg) => {
    if (!sharedKeyRef.current || !isEncryptedPayload(msg.content)) return msg
    try {
      const plain = await decryptMessage(sharedKeyRef.current, msg.content)
      return { ...msg, content: plain, _encrypted: true }
    } catch (_) {
      return { ...msg, content: '🔒 (encrypted)', _encrypted: true }
    }
  }, [])

  // ── Socket setup ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!convId || !myId) return
    socket.emit('dm_join', { conv_id: convId })

    const onJoined = async (payload) => {
      setJoined(true)
      if (payload?.history?.length) {
        const decrypted = await Promise.all(
          payload.history.map(async (m) => {
            const base = {
              ...m,
              status: m.sender_id !== myId && m.status === 'sent' ? 'delivered' : m.status,
            }
            return decryptMsg(base)
          })
        )
        setMessages(decrypted)
      }
      dmMarkRead(convId).catch(() => {})
    }

    const onMessage = async (msg) => {
      if (msg.conv_id !== convId) return
      const incoming = msg.sender_id !== myId
      const base = { ...msg, status: incoming ? 'delivered' : msg.status || 'sent' }
      const decrypted = await decryptMsg(base)
      setMessages(prev => {
        if (prev.some(m => m.msg_id === decrypted.msg_id)) return prev
        return [...prev, decrypted]
      })
      if (incoming) {
        socket.emit('dm_read', { conv_id: convId, reader_id: myId })
        dmMarkRead(convId).catch(() => {})
      }
    }

    const onTyping = ({ conv_id, sender_id }) => {
      if (conv_id !== convId || sender_id === myId) return
      setIsTypingOther(true)
    }

    const onStopTyping = ({ conv_id, sender_id }) => {
      if (conv_id !== convId || sender_id === myId) return
      setIsTypingOther(false)
    }

    const onRead = ({ conv_id, reader_id }) => {
      if (conv_id !== convId || reader_id === myId) return
      setMessages(prev => prev.map(m =>
        m.sender_id === myId ? { ...m, status: 'read' } : m
      ))
    }

    socket.on('dm_joined',      onJoined)
    socket.on('dm_message',     onMessage)
    socket.on('dm_typing',      onTyping)
    socket.on('dm_stop_typing', onStopTyping)
    socket.on('dm_read',        onRead)

    return () => {
      socket.emit('dm_leave', { conv_id: convId })
      socket.off('dm_joined',      onJoined)
      socket.off('dm_message',     onMessage)
      socket.off('dm_typing',      onTyping)
      socket.off('dm_stop_typing', onStopTyping)
      socket.off('dm_read',        onRead)
    }
  }, [convId, myId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTypingOther])

  // ── Typing detection ─────────────────────────────────────────────────────

  const handleTextChange = (e) => {
    setText(e.target.value)
    if (!convId) return
    if (!isTyping.current) {
      isTyping.current = true
      socket.emit('dm_typing', { conv_id: convId, sender_id: myId })
    }
    clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => {
      isTyping.current = false
      socket.emit('dm_stop_typing', { conv_id: convId, sender_id: myId })
    }, 1500)
  }

  // ── Core send (raw payload) ──────────────────────────────────────────────

  const sendPayload = useCallback(async (rawContent, displayContent) => {
    if (!convId || !myId) return

    isTyping.current = false
    clearTimeout(typingTimer.current)
    socket.emit('dm_stop_typing', { conv_id: convId, sender_id: myId })

    let payload = rawContent
    let isE2E   = false
    // Only encrypt text messages, not media payloads
    if (sharedKeyRef.current && !isImageMsg(rawContent) && !isLocationMsg(rawContent) && !isAudioMsg(rawContent)) {
      try {
        payload = await encryptMessage(sharedKeyRef.current, rawContent)
        isE2E   = true
      } catch (_) {}
    }

    const msgId = `${Date.now()}-${Math.random()}`
    const localMsg = {
      msg_id:      msgId,
      conv_id:     convId,
      sender_id:   myId,
      content:     displayContent ?? rawContent,
      status:      'sent',
      reply_to_id: replyTo?.msg_id || null,
      ts:          Date.now() / 1000,
      _reply_preview: replyTo,
      _encrypted:  isE2E,
    }
    setMessages(prev => [...prev, localMsg])

    socket.emit('dm_message', {
      id:          msgId,
      conv_id:     convId,
      sender_id:   myId,
      content:     payload,
      reply_to_id: replyTo?.msg_id || null,
    })

    setReplyTo(null)
  }, [convId, myId, replyTo])

  // ── Send text ────────────────────────────────────────────────────────────

  const handleSend = useCallback(async (e) => {
    e?.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) return
    await sendPayload(trimmed)
    setText('')
    inputRef.current?.focus()
  }, [text, sendPayload])

  // ── Send image ───────────────────────────────────────────────────────────

  const handleImageSelect = useCallback(async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setMediaOpen(false)

    const reader = new FileReader()
    reader.onload = async (ev) => {
      const dataUrl = ev.target.result
      const payload = IMG_PREFIX + dataUrl
      await sendPayload(payload, payload)
    }
    reader.readAsDataURL(file)
  }, [sendPayload])

  // ── Send location ────────────────────────────────────────────────────────

  const handleSendLocation = useCallback(() => {
    if (!navigator.geolocation) return
    setLocSharing(true)
    setMediaOpen(false)
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const { latitude: lat, longitude: lng } = coords
        const label = `${lat.toFixed(5)}, ${lng.toFixed(5)}`
        const payload = `${LOC_PREFIX}${lat},${lng}:${label}]`
        await sendPayload(payload, payload)
        setLocSharing(false)
      },
      () => setLocSharing(false),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [sendPayload])

  // ── Render helpers ────────────────────────────────────────────────────────

  const formatTime = (ts) => {
    if (!ts) return ''
    const d = ts > 1e10 ? new Date(ts) : new Date(ts * 1000)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const StatusIcon = ({ status }) => {
    if (status === 'read')      return <span className="text-blue-300 text-xs ml-1" title="Read">✓✓</span>
    if (status === 'delivered') return <span className="text-gray-400 text-xs ml-1" title="Delivered">✓✓</span>
    return <span className="text-gray-500 text-xs ml-1" title="Sent">✓</span>
  }

  const findMessage = (msgId) => msgId ? messages.find(m => m.msg_id === msgId) : null

  // ── Render message content ────────────────────────────────────────────────

  function MsgContent({ content }) {
    if (isImageMsg(content)) {
      const src = content.slice(IMG_PREFIX.length)
      return (
        <img
          src={src}
          alt="shared image"
          className="rounded-xl max-w-full"
          style={{ maxHeight: 240, objectFit: 'contain', display: 'block' }}
        />
      )
    }
    if (isLocationMsg(content)) {
      const loc = parseLocation(content)
      if (!loc) return <span className="text-xs italic text-gray-400">📍 Location</span>
      const mapUrl = `https://www.openstreetmap.org/?mlat=${loc.lat}&mlon=${loc.lng}#map=15/${loc.lat}/${loc.lng}`
      return (
        <div className="space-y-1">
          <div className="rounded-lg overflow-hidden" style={{ width: 200, height: 120 }}>
            <iframe
              title="location"
              width="200"
              height="120"
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${loc.lng - 0.005},${loc.lat - 0.005},${loc.lng + 0.005},${loc.lat + 0.005}&layer=mapnik&marker=${loc.lat},${loc.lng}`}
              style={{ border: 'none', borderRadius: 8 }}
            />
          </div>
          <a
            href={mapUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-300 underline flex items-center gap-1"
          >
            📍 {loc.label || 'View on map'}
          </a>
        </div>
      )
    }
    if (isAudioMsg(content)) {
      const src = content.slice(AUDIO_PREFIX.length)
      return src
        ? <audio controls src={src} className="max-w-full" style={{ height: 36 }} />
        : <span className="text-xs italic text-gray-400">🎤 Audio message</span>
    }
    return <span>{content}</span>
  }

  // ── Main render ──────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-xl overflow-hidden border border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              onClick={onBack}
              className="text-gray-400 hover:text-white transition-colors text-lg leading-none mr-1 md:hidden"
              aria-label="Back to inbox"
            >
              ←
            </button>
          )}
          <div className="w-9 h-9 rounded-full bg-blue-700 flex items-center justify-center text-sm font-bold text-white shrink-0">
            {otherUser?.name?.charAt(0)?.toUpperCase() || '?'}
          </div>
          <div>
            <p className="text-sm font-semibold text-white">{otherUser?.name || 'User'}</p>
            <p className="text-xs text-gray-500 flex items-center gap-1">
              {sharedKeyRef.current && <span title="End-to-end encrypted">🔒</span>}
              {joined ? (isTypingOther ? 'typing…' : (sharedKeyRef.current ? 'Encrypted' : 'Active')) : 'Connecting…'}
            </p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors text-lg leading-none hidden md:block"
            aria-label="Close chat"
          >
            ✕
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {!joined && (
          <div className="flex justify-center py-8">
            <span className="text-xs text-gray-500">Connecting to chat…</span>
          </div>
        )}
        {joined && messages.length === 0 && (
          <div className="text-center text-xs text-gray-500 pt-10">
            <p className="text-3xl mb-1">💬</p>
            <p>No messages yet. Say hi!</p>
          </div>
        )}
        {messages.map((msg, i) => {
          const isMine  = msg.sender_id === myId
          const prevMsg = messages[i - 1]
          const showSender = !isMine && (i === 0 || prevMsg?.sender_id !== msg.sender_id)

          // ── Date separator ──
          const thisDate = msgDate(msg.ts)
          const prevDate = prevMsg ? msgDate(prevMsg.ts) : null
          const showDate = thisDate && thisDate !== prevDate

          const origMsg     = findMessage(msg.reply_to_id) || msg._reply_preview
          const origContent = origMsg?.content || ''

          return (
            <div key={msg.msg_id || i}>
              {/* Date separator */}
              {showDate && (
                <div className="flex items-center gap-2 my-3">
                  <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
                  <span className="text-xs text-gray-500 px-2 shrink-0">{friendlyDate(thisDate)}</span>
                  <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
                </div>
              )}

              <div className={`flex ${isMine ? 'justify-end' : 'justify-start'} ${
                i > 0 && prevMsg?.sender_id === msg.sender_id && !showDate ? 'mt-0.5' : 'mt-2'
              }`}>
                {/* Avatar for incoming (first in group) */}
                {!isMine && (
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mr-1.5 ${
                    showSender ? 'bg-blue-700 text-white mt-auto mb-0.5' : 'opacity-0'
                  }`}>
                    {otherUser?.name?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                )}

                <div className="max-w-[72%] group">
                  {/* Reply preview bubble */}
                  {msg.reply_to_id && origContent && (
                    <div className={`text-xs rounded-t-lg px-2 py-1 border-l-2 mb-0.5 truncate max-w-full ${
                      isMine
                        ? 'bg-blue-900/60 border-blue-400 text-blue-200 ml-auto rounded-r-none'
                        : 'bg-gray-700/60 border-gray-400 text-gray-300'
                    }`}>
                      <span className="font-semibold">
                        {origMsg?.sender_id === myId ? 'You' : otherUser?.name || 'User'}:
                      </span>{' '}
                      {isImageMsg(origContent) ? '📷 Photo' : isLocationMsg(origContent) ? '📍 Location' : origContent.slice(0, 80)}
                      {!isImageMsg(origContent) && !isLocationMsg(origContent) && origContent.length > 80 ? '…' : ''}
                    </div>
                  )}

                  {/* Message bubble */}
                  <div className={`relative px-3 py-2 rounded-2xl text-sm break-words ${
                    isMine
                      ? 'bg-blue-600 text-white rounded-tr-sm'
                      : 'bg-gray-700 text-gray-100 rounded-tl-sm'
                  }`}>
                    <MsgContent content={msg.content} />
                    <div className={`flex items-center justify-end gap-0.5 mt-0.5 ${isMine ? 'text-blue-200/70' : 'text-gray-400'}`}>
                      {msg._encrypted && <span className="text-xs" title="End-to-end encrypted">🔒</span>}
                      <span className="text-xs">{formatTime(msg.ts)}</span>
                      {isMine && <StatusIcon status={msg.status} />}
                    </div>

                    {/* Reply action (hover) */}
                    <button
                      onClick={() => setReplyTo(msg)}
                      className="absolute -top-2 right-1 hidden group-hover:flex items-center justify-center w-6 h-6 rounded-full bg-gray-600 hover:bg-gray-500 text-gray-300 text-xs transition-colors"
                      title="Reply"
                    >
                      ↩
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )
        })}

        {/* Typing indicator */}
        {isTypingOther && (
          <div className="flex justify-start mt-2">
            <div className="w-7 h-7 rounded-full bg-blue-700 flex items-center justify-center text-xs font-bold shrink-0 mr-1.5">
              {otherUser?.name?.charAt(0)?.toUpperCase() || '?'}
            </div>
            <div className="bg-gray-700/70 rounded-2xl rounded-tl-sm px-3 py-2 text-xs text-gray-400 italic flex items-center gap-1.5">
              <span className="flex gap-0.5">
                {[0, 1, 2].map(k => (
                  <span
                    key={k}
                    className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
                    style={{ animationDelay: `${k * 0.15}s` }}
                  />
                ))}
              </span>
              {otherUser?.name || 'User'} is typing…
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Reply bar */}
      {replyTo && (
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-800/80 border-t border-gray-700 text-xs">
          <div className="flex-1 truncate">
            <span className="text-blue-300 font-semibold">
              Replying to {replyTo.sender_id === myId ? 'yourself' : (otherUser?.name || 'User')}:
            </span>{' '}
            <span className="text-gray-400">
              {isImageMsg(replyTo.content) ? '📷 Photo' : isLocationMsg(replyTo.content) ? '📍 Location' : (replyTo.content || '').slice(0, 80)}
            </span>
          </div>
          <button
            onClick={() => setReplyTo(null)}
            className="text-gray-500 hover:text-gray-300 transition-colors shrink-0"
            aria-label="Cancel reply"
          >
            ✕
          </button>
        </div>
      )}

      {/* Media toolbar */}
      {mediaOpen && (
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-800/90 border-t border-gray-700">
          {/* Image */}
          <button
            type="button"
            onClick={() => imageRef.current?.click()}
            className="flex flex-col items-center gap-0.5 text-xs text-gray-300 hover:text-white transition-colors px-3 py-2 rounded-xl bg-gray-700/60 hover:bg-gray-700"
            title="Send image"
          >
            <span className="text-xl">🖼</span>
            <span>Image</span>
          </button>
          <input ref={imageRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageSelect} />

          {/* Location */}
          <button
            type="button"
            onClick={handleSendLocation}
            disabled={locSharing}
            className="flex flex-col items-center gap-0.5 text-xs text-gray-300 hover:text-white transition-colors px-3 py-2 rounded-xl bg-gray-700/60 hover:bg-gray-700 disabled:opacity-50"
            title="Share location"
          >
            <span className="text-xl">{locSharing ? '…' : '📍'}</span>
            <span>Location</span>
          </button>

          {/* Audio (placeholder) */}
          <button
            type="button"
            className="flex flex-col items-center gap-0.5 text-xs text-gray-500 px-3 py-2 rounded-xl bg-gray-700/60 cursor-not-allowed"
            title="Audio — coming soon"
            disabled
          >
            <span className="text-xl">🎤</span>
            <span>Audio</span>
          </button>
        </div>
      )}

      {/* Input bar */}
      <form
        onSubmit={handleSend}
        className="flex items-center gap-2 px-3 py-2 border-t border-gray-700 bg-gray-800"
      >
        {/* Media toggle */}
        <button
          type="button"
          onClick={() => setMediaOpen(v => !v)}
          className={`rounded-full w-9 h-9 flex items-center justify-center transition-all text-xl shrink-0 ${
            mediaOpen ? 'bg-blue-700 text-white' : 'bg-gray-700/60 text-gray-400 hover:bg-gray-700 hover:text-white'
          }`}
          aria-label="Media"
          title="Attach media"
        >
          +
        </button>

        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={handleTextChange}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) handleSend(e) }}
          placeholder={joined ? 'Type a message…' : 'Connecting…'}
          disabled={!joined}
          maxLength={MAX_LEN}
          className="flex-1 rounded-full bg-gray-900 border border-gray-600 text-gray-100 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 min-w-0"
        />
        <button
          type="submit"
          disabled={!joined || !text.trim()}
          className="rounded-full w-9 h-9 flex items-center justify-center bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-white shrink-0"
          aria-label="Send"
        >
          ➤
        </button>
      </form>
    </div>
  )
}

