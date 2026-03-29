import { useState, useEffect, useCallback, useRef } from 'react'
import socket from '../socket'
import {
  dmListConversations, dmStartConversation, dmSendMessage, listUsers,
} from '../api'
import DMChat from './DMChat'
import { playMessageChime } from '../sounds'

/**
 * DMInbox — Direct-message inbox.
 *
 * Features:
 *  - Lists all conversations, sorted by most-recent message
 *  - Unread count badges
 *  - Last message preview (sender + snippet)
 *  - Quick-reply inline (without opening full chat)
 *  - Open full chat for any conversation
 *  - Start new conversation by picking a user
 *  - Real-time updates via dm_notification socket event
 *
 * Props:
 *  currentUser - logged-in user object { user_id, name }
 */

export default function DMInbox({ currentUser }) {
  const [conversations,  setConversations]  = useState([])
  const [loading,        setLoading]        = useState(true)
  const [activeConv,     setActiveConv]     = useState(null)   // open full chat
  const [quickReply,     setQuickReply]     = useState(null)   // conv open for quick-reply
  const [quickText,      setQuickText]      = useState('')
  const [sendingQR,      setSendingQR]      = useState(false)
  const [showNewChat,    setShowNewChat]     = useState(false)
  const [allUsers,       setAllUsers]        = useState([])
  const [userSearch,     setUserSearch]      = useState('')
  const [totalUnread,    setTotalUnread]     = useState(0)
  const prevUnreadRef    = useRef(0)

  const myId = currentUser?.user_id

  // ── Load conversations ────────────────────────────────────────────────────

  const loadConversations = useCallback(async () => {
    try {
      const data = await dmListConversations()
      const convs = data.conversations || []
      setConversations(convs)
      const newTotal = convs.reduce((s, c) => s + (c.unread_count || 0), 0)
      // Play chime when unread count increases (new message arrived)
      if (newTotal > prevUnreadRef.current) {
        playMessageChime()
      }
      prevUnreadRef.current = newTotal
      setTotalUnread(newTotal)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!myId) return
    loadConversations()
  }, [myId, loadConversations])

  // ── Real-time: new DM notification ───────────────────────────────────────

  useEffect(() => {
    if (!myId) return

    const onNotif = (data) => {
      // Reload conversations to get updated preview + unread count
      loadConversations()
    }

    socket.on('dm_notification', onNotif)
    return () => socket.off('dm_notification', onNotif)
  }, [myId, loadConversations])

  // ── Start new conversation ────────────────────────────────────────────────

  const handleOpenNewChat = async () => {
    setShowNewChat(true)
    if (allUsers.length === 0) {
      try {
        const data = await listUsers()
        setAllUsers(data.users || [])
      } catch { /* ignore */ }
    }
  }

  const handleStartConversation = async (otherUserId) => {
    try {
      const data = await dmStartConversation(otherUserId)
      const conv = data.conv
      // Enrich with other user info
      const otherUser = allUsers.find(u => u.user_id === otherUserId)
      setActiveConv({
        conv_id:    conv.conv_id,
        other_user: { user_id: otherUserId, name: otherUser?.name || otherUserId },
        unread_count: 0,
        last_message: null,
      })
      setShowNewChat(false)
      loadConversations()
    } catch { /* ignore */ }
  }

  // ── Quick reply ───────────────────────────────────────────────────────────

  const handleQuickReply = async (conv) => {
    const trimmed = quickText.trim()
    if (!trimmed || sendingQR) return
    setSendingQR(true)
    try {
      await dmSendMessage(conv.conv_id, trimmed)
      setQuickText('')
      setQuickReply(null)
      loadConversations()
    } catch { /* ignore */ } finally {
      setSendingQR(false)
    }
  }

  // ── Format time ───────────────────────────────────────────────────────────

  const fmtTime = (ts) => {
    if (!ts) return ''
    const d = ts > 1e10 ? new Date(ts) : new Date(ts * 1000)
    const now = new Date()
    const diff = now - d
    if (diff < 60 * 1000) return 'just now'
    if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 24 * 60 * 60 * 1000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  // ── If full chat is open, show it ─────────────────────────────────────────

  if (activeConv) {
    return (
      <div className="h-[600px]">
        <DMChat
          conv={activeConv}
          currentUser={currentUser}
          onClose={() => { setActiveConv(null); loadConversations() }}
        />
      </div>
    )
  }

  // ── Filtered user list for new chat ───────────────────────────────────────

  const filteredUsers = allUsers.filter(u =>
    u.name.toLowerCase().includes(userSearch.toLowerCase())
  )

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          💬 Messages
          {totalUnread > 0 && (
            <span className="bg-blue-600 text-white text-xs px-1.5 py-0.5 rounded-full">
              {totalUnread > 99 ? '99+' : totalUnread}
            </span>
          )}
        </h2>
        <div className="flex gap-2">
          <button
            onClick={loadConversations}
            className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
            title="Refresh"
          >
            ↺ Refresh
          </button>
          <button
            onClick={handleOpenNewChat}
            className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            + New Message
          </button>
        </div>
      </div>

      {/* New chat picker */}
      {showNewChat && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">Start a conversation</p>
            <button
              onClick={() => { setShowNewChat(false); setUserSearch('') }}
              className="text-gray-500 hover:text-gray-300 text-lg leading-none"
            >
              ✕
            </button>
          </div>
          <input
            type="text"
            placeholder="Search by name…"
            value={userSearch}
            onChange={e => setUserSearch(e.target.value)}
            className="w-full rounded-lg bg-gray-900 border border-gray-600 text-gray-100 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {filteredUsers.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-2">
              {allUsers.length === 0 ? 'Loading users…' : 'No users found.'}
            </p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {filteredUsers.map(u => (
                <button
                  key={u.user_id}
                  onClick={() => handleStartConversation(u.user_id)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-700 transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded-full bg-blue-700 flex items-center justify-center text-sm font-bold text-white shrink-0">
                    {u.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-sm text-white">{u.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Conversations list */}
      {loading ? (
        <div className="text-center py-8">
          <div className="spinner w-6 h-6 mx-auto" />
        </div>
      ) : conversations.length === 0 ? (
        <div className="text-center text-sm text-gray-500 py-10">
          <p className="text-3xl mb-2">💬</p>
          <p>No conversations yet.</p>
          <button
            onClick={handleOpenNewChat}
            className="mt-3 text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            Start a new conversation →
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {conversations.map((conv) => {
            const isQR = quickReply?.conv_id === conv.conv_id
            const lastMsg = conv.last_message
            const preview = lastMsg
              ? (lastMsg.sender_id === myId ? 'You: ' : '') + (lastMsg.content || '…')
              : 'No messages yet'
            const lastTs = lastMsg?.ts

            return (
              <div
                key={conv.conv_id}
                className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden hover:bg-gray-800/80 transition-colors"
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full bg-blue-700 flex items-center justify-center text-sm font-bold text-white shrink-0">
                    {conv.other_user?.name?.charAt(0)?.toUpperCase() || '?'}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-semibold text-white truncate">
                        {conv.other_user?.name || 'User'}
                      </p>
                      {conv.unread_count > 0 && (
                        <span className="bg-blue-600 text-white text-xs px-1.5 py-0.5 rounded-full shrink-0">
                          {conv.unread_count}
                        </span>
                      )}
                    </div>
                    <p className={`text-xs truncate ${conv.unread_count > 0 ? 'text-white font-medium' : 'text-gray-400'}`}>
                      {preview.slice(0, 60)}{preview.length > 60 ? '…' : ''}
                    </p>
                  </div>

                  {/* Timestamp */}
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-xs text-gray-500">{fmtTime(lastTs)}</span>
                    <div className="flex gap-1">
                      {/* Quick reply button */}
                      <button
                        onClick={() => {
                          if (isQR) {
                            setQuickReply(null)
                            setQuickText('')
                          } else {
                            setQuickReply(conv)
                            setQuickText('')
                          }
                        }}
                        className="text-xs text-gray-400 hover:text-blue-300 transition-colors px-1.5 py-0.5 rounded border border-gray-700 hover:border-blue-500"
                        title="Quick reply"
                      >
                        ↩
                      </button>
                      {/* Open chat button */}
                      <button
                        onClick={() => setActiveConv(conv)}
                        className="text-xs text-gray-400 hover:text-blue-300 transition-colors px-1.5 py-0.5 rounded border border-gray-700 hover:border-blue-500"
                        title="Open chat"
                      >
                        💬
                      </button>
                    </div>
                  </div>
                </div>

                {/* Quick reply input (inline) */}
                {isQR && (
                  <div className="px-4 pb-3 pt-0 flex gap-2 border-t border-gray-700/50">
                    <input
                      type="text"
                      autoFocus
                      value={quickText}
                      onChange={e => setQuickText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleQuickReply(conv) }}
                      placeholder={`Reply to ${conv.other_user?.name || 'User'}…`}
                      maxLength={1000}
                      className="flex-1 rounded-lg bg-gray-900 border border-gray-600 text-gray-100 text-sm px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0"
                    />
                    <button
                      onClick={() => handleQuickReply(conv)}
                      disabled={!quickText.trim() || sendingQR}
                      className="rounded-lg px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm transition-colors shrink-0"
                    >
                      Send
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
