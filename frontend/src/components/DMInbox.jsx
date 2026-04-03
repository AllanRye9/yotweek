import { useState, useEffect, useCallback, useRef } from 'react'
import socket from '../socket'
import {
  dmListConversations, dmStartConversation, dmSendMessage, dmGetContacts, dmDeleteConversation,
  searchUsers,
} from '../api'
import DMChat from './DMChat'
import { playMessageChime } from '../sounds'

/**
 * DMInbox — Direct-message inbox.
 *
 * Features:
 *  - Lists all conversations, sorted by most-recent message
 *  - Conversation search filter
 *  - Unread count badges
 *  - Last message preview (sender + snippet)
 *  - Quick-reply inline (without opening full chat)
 *  - Open full chat for any conversation
 *  - Delete individual conversations
 *  - Start new conversation (previously communicated users shown first)
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
  const [contacts,       setContacts]       = useState([])    // previously communicated users
  const [userSearch,     setUserSearch]      = useState('')
  const [searchResults,  setSearchResults]  = useState([])    // live search results
  const [searchLoading,  setSearchLoading]  = useState(false)
  const [convSearch,     setConvSearch]      = useState('')
  const [totalUnread,    setTotalUnread]     = useState(0)
  const prevUnreadRef    = useRef(0)
  const searchTimerRef   = useRef(null)

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
    setUserSearch('')
    setSearchResults([])
    if (contacts.length === 0) {
      try {
        const data = await dmGetContacts()
        setContacts(data.contacts || [])
      } catch { /* ignore */ }
    }
  }

  const handleUserSearchChange = (val) => {
    setUserSearch(val)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (!val.trim()) {
      setSearchResults([])
      return
    }
    setSearchLoading(true)
    searchTimerRef.current = setTimeout(async () => {
      try {
        const data = await searchUsers(val.trim())
        setSearchResults(data.users || [])
      } catch { /* ignore */ } finally {
        setSearchLoading(false)
      }
    }, 300)
  }

  const handleStartConversation = async (otherUserId) => {
    try {
      const data = await dmStartConversation(otherUserId)
      const conv = data.conv
      // Build a lookup map from available sources for O(1) name resolution
      const userMap = new Map([
        ...conversations.map(c => c.other_user ? [c.other_user.user_id, c.other_user] : null).filter(Boolean),
        ...contacts.map(u => [u.user_id, u]),
      ])
      const otherUser = userMap.get(otherUserId)
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

  // ── Delete conversation ───────────────────────────────────────────────────

  const handleDeleteConversation = async (convId) => {
    if (!window.confirm('Delete this conversation? This cannot be undone.')) return
    try {
      await dmDeleteConversation(convId)
      setConversations(prev => prev.filter(c => c.conv_id !== convId))
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

  // ── Build user list for new chat ─────────────────────────────────────────────
  // If user has typed a search query, show live search results; otherwise show previous contacts
  const filteredUsers = userSearch.trim()
    ? searchResults
    : contacts.filter(u => u.name.toLowerCase().includes(userSearch.toLowerCase()))

  // ── Filtered conversation list ────────────────────────────────────────────

  const filteredConversations = convSearch.trim()
    ? conversations.filter(c => c.other_user?.name?.toLowerCase().includes(convSearch.toLowerCase()))
    : conversations

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

      {/* Conversation search */}
      {conversations.length > 0 && (
        <input
          type="text"
          placeholder="Search conversations…"
          value={convSearch}
          onChange={e => setConvSearch(e.target.value)}
          className="w-full rounded-lg bg-gray-900 border border-gray-700 text-gray-100 text-sm px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      )}

      {/* New chat picker */}
      {showNewChat && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">Start a conversation</p>
            <button
              onClick={() => { setShowNewChat(false); setUserSearch(''); setSearchResults([]) }}
              className="text-gray-500 hover:text-gray-300 text-lg leading-none"
            >
              ✕
            </button>
          </div>
          <div className="relative">
            <input
              type="text"
              placeholder="Type a username to search…"
              value={userSearch}
              onChange={e => handleUserSearchChange(e.target.value)}
              autoFocus
              className="w-full rounded-lg bg-gray-900 border border-gray-600 text-gray-100 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {searchLoading && (
              <span className="absolute right-2.5 top-2.5 text-gray-400 text-xs">⏳</span>
            )}
          </div>
          {filteredUsers.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-2">
              {userSearch.trim()
                ? (searchLoading ? 'Searching…' : 'No users found.')
                : (contacts.length === 0
                  ? 'Type a username above to find someone.'
                  : 'No contacts match your search.')}
            </p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {!userSearch.trim() && contacts.length > 0 && (
                <p className="text-xs text-gray-500 px-1 pb-0.5">Previously contacted</p>
              )}
              {userSearch.trim() && searchResults.length > 0 && (
                <p className="text-xs text-gray-500 px-1 pb-0.5">Search results</p>
              )}
              {filteredUsers.map((u) => (
                <button
                  key={u.user_id}
                  onClick={() => handleStartConversation(u.user_id)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-700 transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded-full bg-blue-700 flex items-center justify-center text-sm font-bold text-white shrink-0">
                    {u.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-white block truncate">{u.name}</span>
                    {u.username && u.username !== u.name && (
                      <span className="text-xs text-gray-400 block truncate">@{u.username}</span>
                    )}
                  </div>
                  <span className="text-xs text-gray-500">💬</span>
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
      ) : filteredConversations.length === 0 ? (
        <div className="text-center text-sm text-gray-500 py-10">
          <p className="text-3xl mb-2">💬</p>
          <p>{convSearch ? 'No conversations match your search.' : 'No conversations yet.'}</p>
          {!convSearch && (
            <button
              onClick={handleOpenNewChat}
              className="mt-3 text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              Start a new conversation →
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredConversations.map((conv) => {
            const isQR = quickReply?.conv_id === conv.conv_id
            const lastMsg = conv.last_message
            const senderUsername = lastMsg?.sender_id === myId
              ? 'You'
              : (lastMsg?.sender_username || conv.other_user?.username || conv.other_user?.name || 'User')
            const preview = lastMsg
              ? `${senderUsername}: ${lastMsg.content || '…'}`
              : 'No messages yet'
            const lastTs = lastMsg?.ts

            return (
              <div
                key={conv.conv_id}
                className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden hover:bg-gray-800/80 transition-colors"
              >
                {/* Clicking the main row opens full chat */}
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                  onClick={() => setActiveConv(conv)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && setActiveConv(conv)}
                  aria-label={`Open chat with ${conv.other_user?.name || 'User'}`}
                >
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
                      {conv.other_user?.username && conv.other_user.username !== conv.other_user.name && (
                        <span className="text-xs text-gray-500 truncate">@{conv.other_user.username}</span>
                      )}
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

                  {/* Timestamp + actions */}
                  <div className="flex flex-col items-end gap-1 shrink-0" onClick={e => e.stopPropagation()}>
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
                      {/* Delete conversation button */}
                      <button
                        onClick={() => handleDeleteConversation(conv.conv_id)}
                        className="text-xs text-gray-500 hover:text-red-400 transition-colors px-1.5 py-0.5 rounded border border-gray-700 hover:border-red-500"
                        title="Delete conversation"
                      >
                        🗑
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
