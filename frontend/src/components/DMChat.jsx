import { useState, useEffect, useRef, useCallback } from 'react'
import socket from '../socket'
import { dmMarkRead } from '../api'

/**
 * DMChat — Direct-message chat panel between two users.
 *
 * Features:
 *  - Left (incoming) / Right (outgoing) message alignment
 *  - Reply-to-message support with inline preview
 *  - Typing indicators
 *  - Read / Delivered / Sent receipts (✓ ✓✓ ✓✓blue)
 *  - Message grouping (consecutive from same sender)
 *  - Real-time via Socket.IO dm_* events
 *  - Chat history loaded on join
 *
 * Props:
 *  conv        - conversation object { conv_id, other_user }
 *  currentUser - logged-in user { user_id, name }
 *  onClose     - callback to close this panel
 */

const MAX_LEN = 1000

export default function DMChat({ conv, currentUser, onClose }) {
  const [messages,    setMessages]    = useState([])
  const [text,        setText]        = useState('')
  const [joined,      setJoined]      = useState(false)
  const [isTypingOther, setIsTypingOther] = useState(false)
  const [replyTo,     setReplyTo]     = useState(null)   // message being replied to
  const bottomRef                     = useRef(null)
  const inputRef                      = useRef(null)
  const typingTimer                   = useRef(null)
  const isTyping                      = useRef(false)

  const convId     = conv?.conv_id
  const myId       = currentUser?.user_id
  const otherUser  = conv?.other_user

  // ── Socket setup ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!convId || !myId) return
    socket.emit('dm_join', { conv_id: convId })

    const onJoined = (payload) => {
      setJoined(true)
      if (payload?.history?.length) {
        setMessages(payload.history.map(m => ({
          ...m,
          // Upgrade status for messages sent by others to 'delivered'
          status: m.sender_id !== myId && m.status === 'sent' ? 'delivered' : m.status,
        })))
      }
      // Mark as read
      dmMarkRead(convId).catch(() => {})
    }

    const onMessage = (msg) => {
      if (msg.conv_id !== convId) return
      setMessages(prev => {
        if (prev.some(m => m.msg_id === msg.msg_id)) return prev
        const incoming = msg.sender_id !== myId
        return [...prev, { ...msg, status: incoming ? 'delivered' : msg.status || 'sent' }]
      })
      if (msg.sender_id !== myId) {
        // Notify sender that message was delivered → emit dm_read
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
      // Mark all my sent messages as read
      setMessages(prev => prev.map(m =>
        m.sender_id === myId ? { ...m, status: 'read' } : m
      ))
    }

    socket.on('dm_joined',       onJoined)
    socket.on('dm_message',      onMessage)
    socket.on('dm_typing',       onTyping)
    socket.on('dm_stop_typing',  onStopTyping)
    socket.on('dm_read',         onRead)

    return () => {
      socket.emit('dm_leave', { conv_id: convId })
      socket.off('dm_joined',       onJoined)
      socket.off('dm_message',      onMessage)
      socket.off('dm_typing',       onTyping)
      socket.off('dm_stop_typing',  onStopTyping)
      socket.off('dm_read',         onRead)
    }
  }, [convId, myId])

  /* Auto-scroll */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTypingOther])

  // ── Typing detection ────────────────────────────────────────────────────────

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

  // ── Send ─────────────────────────────────────────────────────────────────────

  const handleSend = useCallback((e) => {
    e?.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || !convId || !myId) return

    isTyping.current = false
    clearTimeout(typingTimer.current)
    socket.emit('dm_stop_typing', { conv_id: convId, sender_id: myId })

    const msgId = `${Date.now()}-${Math.random()}`
    const localMsg = {
      msg_id:      msgId,
      conv_id:     convId,
      sender_id:   myId,
      content:     trimmed,
      status:      'sent',
      reply_to_id: replyTo?.msg_id || null,
      ts:          Date.now() / 1000,
      _reply_preview: replyTo,
    }
    setMessages(prev => [...prev, localMsg])

    socket.emit('dm_message', {
      id:          msgId,
      conv_id:     convId,
      sender_id:   myId,
      content:     trimmed,
      reply_to_id: replyTo?.msg_id || null,
    })

    setText('')
    setReplyTo(null)
    inputRef.current?.focus()
  }, [text, convId, myId, replyTo])

  const formatTime = (ts) => {
    if (!ts) return ''
    const d = ts > 1e10 ? new Date(ts) : new Date(ts * 1000)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  // ── Status icon ──────────────────────────────────────────────────────────────

  const StatusIcon = ({ status }) => {
    if (status === 'read')      return <span className="text-blue-300 text-xs ml-1" title="Read">✓✓</span>
    if (status === 'delivered') return <span className="text-gray-400 text-xs ml-1" title="Delivered">✓✓</span>
    return <span className="text-gray-500 text-xs ml-1" title="Sent">✓</span>
  }

  // ── Find original message for reply preview ──────────────────────────────────

  const findMessage = (msgId) => msgId ? messages.find(m => m.msg_id === msgId) : null

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-xl overflow-hidden border border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-blue-700 flex items-center justify-center text-sm font-bold text-white shrink-0">
            {otherUser?.name?.charAt(0)?.toUpperCase() || '?'}
          </div>
          <div>
            <p className="text-sm font-semibold text-white">{otherUser?.name || 'User'}</p>
            <p className="text-xs text-gray-500">
              {joined ? (isTypingOther ? 'typing…' : 'Active') : 'Connecting…'}
            </p>
          </div>
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
          const isMine = msg.sender_id === myId
          const prevMsg = messages[i - 1]
          const showSender = !isMine && (i === 0 || prevMsg?.sender_id !== msg.sender_id)

          // Reply preview
          const origMsg = findMessage(msg.reply_to_id) || msg._reply_preview
          const origContent = origMsg?.content || origMsg?.text || ''

          return (
            <div
              key={msg.msg_id || i}
              className={`flex ${isMine ? 'justify-end' : 'justify-start'} ${
                i > 0 && prevMsg?.sender_id === msg.sender_id ? 'mt-0.5' : 'mt-2'
              }`}
            >
              {/* Avatar for incoming (first in group) */}
              {!isMine && (
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mr-1.5 ${
                  showSender ? 'bg-blue-700 text-white mt-auto mb-0.5' : 'opacity-0'
                }`}>
                  {otherUser?.name?.charAt(0)?.toUpperCase() || '?'}
                </div>
              )}

              <div className={`max-w-[72%] group`}>
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
                    {origContent.slice(0, 80)}{origContent.length > 80 ? '…' : ''}
                  </div>
                )}

                {/* Message bubble */}
                <div
                  className={`relative px-3 py-2 rounded-2xl text-sm break-words ${
                    isMine
                      ? 'bg-blue-600 text-white rounded-tr-sm'
                      : 'bg-gray-700 text-gray-100 rounded-tl-sm'
                  }`}
                >
                  {msg.content || msg.text}
                  <div className={`flex items-center justify-end gap-0.5 mt-0.5 ${isMine ? 'text-blue-200/70' : 'text-gray-400'}`}>
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
                {[0, 1, 2].map(i => (
                  <span
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
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
            <span className="text-gray-400">{(replyTo.content || replyTo.text || '').slice(0, 80)}</span>
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

      {/* Input bar */}
      <form
        onSubmit={handleSend}
        className="flex gap-2 px-3 py-2 border-t border-gray-700 bg-gray-800"
      >
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
