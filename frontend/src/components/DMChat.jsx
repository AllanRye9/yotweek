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
 *  - Inline media toolbar: image, audio recording, file/document, location
 *  - Image staging area with preview thumbnail, caption, remove button
 *  - Audio hold-to-record with waveform animation, duration timer, preview before send
 *  - Location preview card (map tile + address label + Send/Cancel)
 *  - Real-time via Socket.IO dm_* events
 *  - Chat history loaded on join
 *
 * Props:
 *  conv        - conversation object { conv_id, other_user }
 *  currentUser - logged-in user { user_id, name }
 *  onClose     - callback to close this panel
 */

const MAX_LEN = 4000

const IMG_PREFIX   = '[IMAGE]'
const LOC_PREFIX   = '[LOCATION:'
const AUDIO_PREFIX = '[AUDIO]'
const FILE_PREFIX  = '[FILE:'

function isImageMsg(content)    { return typeof content === 'string' && content.startsWith(IMG_PREFIX) }
function isLocationMsg(content) { return typeof content === 'string' && content.startsWith(LOC_PREFIX) }
function isAudioMsg(content)    { return typeof content === 'string' && content.startsWith(AUDIO_PREFIX) }
function isFileMsg(content)     { return typeof content === 'string' && content.startsWith(FILE_PREFIX) }

function parseLocation(content) {
  try {
    const inner   = content.slice(LOC_PREFIX.length, content.lastIndexOf(']'))
    const colonIdx = inner.indexOf(':')
    const coords  = colonIdx === -1 ? inner : inner.slice(0, colonIdx)
    const label   = colonIdx === -1 ? '' : inner.slice(colonIdx + 1)
    const [lat, lng] = coords.split(',').map(Number)
    return { lat, lng, label }
  } catch { return null }
}

function parseFile(content) {
  try {
    const inner = content.slice(FILE_PREFIX.length, content.lastIndexOf(']'))
    const sep   = inner.indexOf(':')
    const name  = sep === -1 ? 'file' : inner.slice(0, sep)
    const data  = sep === -1 ? inner : inner.slice(sep + 1)
    return { name, data }
  } catch { return null }
}

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

function fmtDuration(secs) {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Waveform visualiser — animates 20 bars
function Waveform({ active }) {
  return (
    <span className="flex items-end gap-px h-5">
      {Array.from({ length: 20 }, (_, i) => (
        <span
          key={i}
          className="w-0.5 rounded-full"
          style={{
            background: active ? '#34d399' : '#6b7280',
            height: active ? `${40 + Math.sin(i * 0.7 + Date.now() / 200) * 40}%` : '30%',
            animation: active ? `wave ${0.4 + (i % 5) * 0.1}s ease-in-out infinite alternate` : 'none',
            animationDelay: `${i * 0.05}s`,
          }}
        />
      ))}
    </span>
  )
}

export default function DMChat({ conv, currentUser, onClose, onBack }) {
  const [messages,      setMessages]      = useState([])
  const [text,          setText]          = useState('')
  const [joined,        setJoined]        = useState(false)
  const [isTypingOther, setIsTypingOther] = useState(false)
  const [replyTo,       setReplyTo]       = useState(null)

  // Staged media states
  const [stagedImage,    setStagedImage]    = useState(null)   // { dataUrl, caption }
  const [stagedAudio,    setStagedAudio]    = useState(null)   // { blob, url, duration }
  const [stagedLocation, setStagedLocation] = useState(null)   // { lat, lng, label }
  const [locLoading,     setLocLoading]     = useState(false)

  // Audio recording state
  const [isRecording,      setIsRecording]      = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)

  const bottomRef      = useRef(null)
  const inputRef       = useRef(null)
  const imageRef       = useRef(null)
  const fileRef        = useRef(null)
  const typingTimer    = useRef(null)
  const isTyping       = useRef(false)
  const sharedKeyRef   = useRef(null)
  const mediaRecRef    = useRef(null)
  const audioChunksRef = useRef([])
  const recTimerRef    = useRef(null)
  const waveTimerRef   = useRef(null)
  const [waveTick,     setWaveTick]     = useState(0)

  const convId    = conv?.conv_id
  const myId      = currentUser?.user_id
  const otherUser = conv?.other_user

  // ── Derive E2E shared secret ─────────────────────────────────────────────
  useEffect(() => {
    if (!otherUser?.user_id) return
    getUserPublicKey(otherUser.user_id)
      .then(async (res) => {
        if (res?.public_key) sharedKeyRef.current = await getSharedSecret(res.public_key)
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
            const base = { ...m, status: m.sender_id !== myId && m.status === 'sent' ? 'delivered' : m.status }
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
      setMessages(prev => prev.map(m => m.sender_id === myId ? { ...m, status: 'read' } : m))
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
  }, [convId, myId, decryptMsg])

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
    if (sharedKeyRef.current && !isImageMsg(rawContent) && !isLocationMsg(rawContent) && !isAudioMsg(rawContent) && !isFileMsg(rawContent)) {
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
    // Send staged image
    if (stagedImage) {
      const caption = stagedImage.caption?.trim()
      const payload = IMG_PREFIX + stagedImage.dataUrl + (caption ? '\n' + caption : '')
      await sendPayload(payload, payload)
      setStagedImage(null)
      return
    }
    // Send staged audio
    if (stagedAudio) {
      const reader = new FileReader()
      reader.onload = async (ev) => {
        const payload = AUDIO_PREFIX + ev.target.result
        await sendPayload(payload, payload)
      }
      reader.readAsDataURL(stagedAudio.blob)
      URL.revokeObjectURL(stagedAudio.url)
      setStagedAudio(null)
      return
    }
    // Send staged location
    if (stagedLocation) {
      const payload = `${LOC_PREFIX}${stagedLocation.lat},${stagedLocation.lng}:${stagedLocation.label}]`
      await sendPayload(payload, payload)
      setStagedLocation(null)
      return
    }
    // Send text
    const trimmed = text.trim()
    if (!trimmed) return
    await sendPayload(trimmed)
    setText('')
    inputRef.current?.focus()
  }, [text, sendPayload, stagedImage, stagedAudio, stagedLocation])

  // Send button enabled when text or staged media
  const canSend = joined && (text.trim().length > 0 || stagedImage || stagedAudio || stagedLocation)

  // ── Image staging ────────────────────────────────────────────────────────
  const handleImageSelect = useCallback((e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = (ev) => setStagedImage({ dataUrl: ev.target.result, caption: '' })
    reader.readAsDataURL(file)
  }, [])

  // ── File/document staging ─────────────────────────────────────────────────
  const handleFileSelect = useCallback((e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const payload = `${FILE_PREFIX}${file.name}:${ev.target.result}]`
      await sendPayload(payload, payload)
    }
    reader.readAsDataURL(file)
  }, [sendPayload])

  // ── Audio recording ───────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    if (isRecording) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      mediaRecRef.current    = mr
      audioChunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        const url  = URL.createObjectURL(blob)
        setStagedAudio({ blob, url, duration: recordingDuration })
        setIsRecording(false)
        clearInterval(recTimerRef.current)
        clearInterval(waveTimerRef.current)
      }
      mr.start(100)
      setIsRecording(true)
      setRecordingDuration(0)
      recTimerRef.current  = setInterval(() => setRecordingDuration(d => d + 1), 1000)
      waveTimerRef.current = setInterval(() => setWaveTick(t => t + 1), 80)
    } catch (_) {}
  }, [isRecording, recordingDuration])

  const stopRecording = useCallback(() => {
    if (mediaRecRef.current && mediaRecRef.current.state === 'recording') {
      mediaRecRef.current.stop()
    }
    clearInterval(recTimerRef.current)
    clearInterval(waveTimerRef.current)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearInterval(recTimerRef.current)
      clearInterval(waveTimerRef.current)
      if (mediaRecRef.current?.state === 'recording') mediaRecRef.current.stop()
    }
  }, [])

  // ── Location staging ──────────────────────────────────────────────────────
  const handleRequestLocation = useCallback(() => {
    if (!navigator.geolocation) return
    setLocLoading(true)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const { latitude: lat, longitude: lng } = coords
        const label = `${lat.toFixed(5)}, ${lng.toFixed(5)}`
        setStagedLocation({ lat, lng, label })
        setLocLoading(false)
      },
      () => setLocLoading(false),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [])

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

  function MsgContent({ content }) {
    if (isImageMsg(content)) {
      const rest    = content.slice(IMG_PREFIX.length)
      const newline = rest.indexOf('\n')
      const src     = newline === -1 ? rest : rest.slice(0, newline)
      const caption = newline === -1 ? '' : rest.slice(newline + 1)
      return (
        <div className="space-y-1">
          <img src={src} alt="shared image" className="rounded-xl max-w-full" style={{ maxHeight: 240, objectFit: 'contain', display: 'block' }} />
          {caption && <p className="text-xs text-gray-300">{caption}</p>}
        </div>
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
          <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-300 underline flex items-center gap-1">
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
    if (isFileMsg(content)) {
      const f = parseFile(content)
      if (!f) return <span className="text-xs italic text-gray-400">📎 File</span>
      return (
        <a href={f.data} download={f.name} className="flex items-center gap-2 text-xs text-blue-300 underline">
          📎 {f.name}
        </a>
      )
    }
    return <span>{content}</span>
  }

  // ── Main render ──────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-xl overflow-hidden border border-gray-700">
      <style>{`@keyframes wave{from{transform:scaleY(0.4)}to{transform:scaleY(1.0)}}`}</style>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2">
          {onBack && (
            <button onClick={onBack} className="text-gray-400 hover:text-white transition-colors text-lg leading-none mr-1 md:hidden" aria-label="Back to inbox">
              ←
            </button>
          )}
          {otherUser?.avatar_url ? (
            <img src={otherUser.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
          ) : (
            <div className="w-9 h-9 rounded-full bg-blue-700 flex items-center justify-center text-sm font-bold text-white shrink-0">
              {otherUser?.name?.charAt(0)?.toUpperCase() || '?'}
            </div>
          )}
          <div>
            <p className="text-sm font-semibold text-white">{otherUser?.name || 'User'}</p>
            <p className="text-xs text-gray-500 flex items-center gap-1">
              {sharedKeyRef.current && <span title="End-to-end encrypted">🔒</span>}
              {joined ? (isTypingOther ? 'typing…' : (sharedKeyRef.current ? 'Encrypted' : 'Active')) : 'Connecting…'}
            </p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors text-lg leading-none hidden md:block" aria-label="Close chat">
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
          const isMine   = msg.sender_id === myId
          const prevMsg  = messages[i - 1]
          const showSender = !isMine && (i === 0 || prevMsg?.sender_id !== msg.sender_id)

          const thisDate = msgDate(msg.ts)
          const prevDate = prevMsg ? msgDate(prevMsg.ts) : null
          const showDate = thisDate && thisDate !== prevDate

          const origMsg     = findMessage(msg.reply_to_id) || msg._reply_preview
          const origContent = origMsg?.content || ''

          return (
            <div key={msg.msg_id || i}>
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
                {!isMine && (
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mr-1.5 ${
                    showSender ? 'bg-blue-700 text-white mt-auto mb-0.5' : 'opacity-0'
                  }`}>
                    {otherUser?.avatar_url
                      ? <img src={otherUser.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                      : otherUser?.name?.charAt(0)?.toUpperCase() || '?'
                    }
                  </div>
                )}

                <div className="max-w-[72%] group">
                  {msg.reply_to_id && origContent && (
                    <div className={`text-xs rounded-t-lg px-2 py-1 border-l-2 mb-0.5 truncate max-w-full ${
                      isMine ? 'bg-blue-900/60 border-blue-400 text-blue-200 ml-auto rounded-r-none' : 'bg-gray-700/60 border-gray-400 text-gray-300'
                    }`}>
                      <span className="font-semibold">
                        {origMsg?.sender_id === myId ? 'You' : otherUser?.name || 'User'}:
                      </span>{' '}
                      {isImageMsg(origContent) ? '📷 Photo' : isLocationMsg(origContent) ? '📍 Location' : isAudioMsg(origContent) ? '🎤 Audio' : origContent.slice(0, 80)}
                      {!isImageMsg(origContent) && !isLocationMsg(origContent) && !isAudioMsg(origContent) && origContent.length > 80 ? '…' : ''}
                    </div>
                  )}

                  <div className={`relative px-3 py-2 rounded-2xl text-sm break-words ${
                    isMine ? 'bg-blue-600 text-white rounded-tr-sm' : 'bg-gray-700 text-gray-100 rounded-tl-sm'
                  }`}>
                    <MsgContent content={msg.content} />
                    <div className={`flex items-center justify-end gap-0.5 mt-0.5 ${isMine ? 'text-blue-200/70' : 'text-gray-400'}`}>
                      {msg._encrypted && <span className="text-xs" title="End-to-end encrypted">🔒</span>}
                      <span className="text-xs">{formatTime(msg.ts)}</span>
                      {isMine && <StatusIcon status={msg.status} />}
                    </div>

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

        {isTypingOther && (
          <div className="flex justify-start mt-2">
            <div className="w-7 h-7 rounded-full bg-blue-700 flex items-center justify-center text-xs font-bold shrink-0 mr-1.5">
              {otherUser?.name?.charAt(0)?.toUpperCase() || '?'}
            </div>
            <div className="bg-gray-700/70 rounded-2xl rounded-tl-sm px-3 py-2 text-xs text-gray-400 italic flex items-center gap-1.5">
              <span className="flex gap-0.5">
                {[0, 1, 2].map(k => (
                  <span key={k} className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: `${k * 0.15}s` }} />
                ))}
              </span>
              {otherUser?.name || 'User'} is typing…
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Staging areas ── */}

      {/* Reply bar */}
      {replyTo && (
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-800/80 border-t border-gray-700 text-xs">
          <div className="flex-1 truncate">
            <span className="text-blue-300 font-semibold">
              Replying to {replyTo.sender_id === myId ? 'yourself' : (otherUser?.name || 'User')}:
            </span>{' '}
            <span className="text-gray-400">
              {isImageMsg(replyTo.content) ? '📷 Photo' : isLocationMsg(replyTo.content) ? '📍 Location' : isAudioMsg(replyTo.content) ? '🎤 Audio' : (replyTo.content || '').slice(0, 80)}
            </span>
          </div>
          <button onClick={() => setReplyTo(null)} className="text-gray-500 hover:text-gray-300 transition-colors shrink-0" aria-label="Cancel reply">✕</button>
        </div>
      )}

      {/* Image staging area */}
      {stagedImage && (
        <div className="flex items-start gap-3 px-3 py-2 bg-gray-800/90 border-t border-gray-700">
          <div className="relative shrink-0">
            <img src={stagedImage.dataUrl} alt="staged" className="rounded-lg object-cover" style={{ width: 72, height: 72 }} />
            <button
              onClick={() => setStagedImage(null)}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 text-white text-xs flex items-center justify-center leading-none"
              aria-label="Remove image"
            >✕</button>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-400 mb-1">📷 Image ready to send</p>
            <input
              type="text"
              placeholder="Add a caption…"
              value={stagedImage.caption}
              onChange={e => setStagedImage(s => ({ ...s, caption: e.target.value }))}
              className="w-full text-xs rounded-lg bg-gray-900 border border-gray-600 text-gray-200 px-2 py-1 outline-none focus:ring-1 focus:ring-blue-500"
              maxLength={200}
            />
          </div>
        </div>
      )}

      {/* Audio recording / staged audio area */}
      {(isRecording || stagedAudio) && (
        <div className="flex items-center gap-3 px-3 py-2 bg-gray-800/90 border-t border-gray-700">
          {isRecording ? (
            <>
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
              <div className="flex-1 flex items-center gap-2 overflow-hidden">
                <Waveform active={true} key={waveTick} />
                <span className="text-xs text-green-400 font-mono shrink-0">{fmtDuration(recordingDuration)}</span>
              </div>
              <button
                onMouseUp={stopRecording}
                onTouchEnd={stopRecording}
                className="text-xs px-3 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold"
              >
                ■ Stop
              </button>
            </>
          ) : stagedAudio ? (
            <>
              <Waveform active={false} />
              <audio controls src={stagedAudio.url} className="h-8 flex-1 min-w-0" style={{ minWidth: 0 }} />
              <span className="text-xs text-gray-400 shrink-0">{fmtDuration(stagedAudio.duration)}</span>
              <button
                onClick={() => { URL.revokeObjectURL(stagedAudio.url); setStagedAudio(null) }}
                className="text-xs text-red-400 hover:text-red-300 transition-colors shrink-0 px-2"
                aria-label="Discard audio"
              >
                🗑
              </button>
            </>
          ) : null}
        </div>
      )}

      {/* Location staging area */}
      {(locLoading || stagedLocation) && (
        <div className="flex items-start gap-3 px-3 py-2 bg-gray-800/90 border-t border-gray-700">
          {locLoading ? (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              Getting your location…
            </div>
          ) : stagedLocation ? (
            <>
              <div className="rounded-lg overflow-hidden shrink-0" style={{ width: 100, height: 72 }}>
                <iframe
                  title="staged location"
                  width="100"
                  height="72"
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${stagedLocation.lng - 0.003},${stagedLocation.lat - 0.003},${stagedLocation.lng + 0.003},${stagedLocation.lat + 0.003}&layer=mapnik&marker=${stagedLocation.lat},${stagedLocation.lng}`}
                  style={{ border: 'none' }}
                />
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-xs text-gray-300">📍 {stagedLocation.label}</p>
                <div className="flex gap-2">
                  <button
                    onClick={handleSend}
                    className="text-xs px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold"
                  >
                    Send Location
                  </button>
                  <button
                    onClick={() => setStagedLocation(null)}
                    className="text-xs px-3 py-1 rounded-lg text-gray-400 hover:text-gray-300 transition-colors"
                    style={{ border: '1px solid rgba(255,255,255,0.1)' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* ── Input bar with inline media icons ── */}
      <form
        onSubmit={handleSend}
        className="flex items-center gap-1.5 px-2 py-2 border-t border-gray-700 bg-gray-800"
      >
        {/* Hidden file inputs */}
        <input ref={imageRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageSelect} />
        <input ref={fileRef}  type="file"                  style={{ display: 'none' }} onChange={handleFileSelect} />

        {/* Image icon */}
        <button
          type="button"
          onClick={() => imageRef.current?.click()}
          disabled={!joined || isRecording || !!stagedAudio}
          className="w-8 h-8 rounded-full flex items-center justify-center text-base transition-colors hover:bg-gray-700 text-gray-400 hover:text-white disabled:opacity-40 shrink-0"
          title="Send image"
        >
          🖼
        </button>

        {/* Audio record — hold to record */}
        <button
          type="button"
          onMouseDown={startRecording}
          onMouseUp={stopRecording}
          onTouchStart={(e) => { e.preventDefault(); startRecording() }}
          onTouchEnd={stopRecording}
          disabled={!joined || !!stagedImage || !!stagedAudio || !!stagedLocation}
          className={`w-8 h-8 rounded-full flex items-center justify-center text-base transition-colors shrink-0 ${
            isRecording ? 'bg-red-600 text-white' : 'hover:bg-gray-700 text-gray-400 hover:text-white'
          } disabled:opacity-40`}
          title="Hold to record audio"
        >
          🎤
        </button>

        {/* File/document icon */}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={!joined || isRecording || !!stagedAudio}
          className="w-8 h-8 rounded-full flex items-center justify-center text-base transition-colors hover:bg-gray-700 text-gray-400 hover:text-white disabled:opacity-40 shrink-0"
          title="Send file"
        >
          📎
        </button>

        {/* Location icon */}
        <button
          type="button"
          onClick={handleRequestLocation}
          disabled={!joined || isRecording || !!stagedLocation || locLoading}
          className="w-8 h-8 rounded-full flex items-center justify-center text-base transition-colors hover:bg-gray-700 text-gray-400 hover:text-white disabled:opacity-40 shrink-0"
          title="Share location"
        >
          📍
        </button>

        {/* Text input */}
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={handleTextChange}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) handleSend(e) }}
          placeholder={
            stagedImage ? 'Add a caption or send…' :
            stagedAudio ? 'Press ➤ to send audio…' :
            stagedLocation ? 'Location staged — press ➤ to send' :
            joined ? 'Type a message…' : 'Connecting…'
          }
          disabled={!joined || isRecording}
          maxLength={MAX_LEN}
          className="flex-1 rounded-full bg-gray-900 border border-gray-600 text-gray-100 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 min-w-0"
        />

        {/* Send button */}
        <button
          type="submit"
          disabled={!canSend || isRecording}
          className="rounded-full w-9 h-9 flex items-center justify-center bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-white shrink-0"
          aria-label="Send"
        >
          ➤
        </button>
      </form>
    </div>
  )
}
