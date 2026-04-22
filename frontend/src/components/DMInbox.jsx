import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import socket from '../socket'
import {
  dmListConversations, dmStartConversation, dmSendMessage, dmGetContacts, dmDeleteConversation,
  dmDeleteMessage, searchUsers, getRideChatInbox,
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

const CLICK_ANIMATION_DURATION = 200

export default function DMInbox({ currentUser }) {
  const navigate = useNavigate()
  const [conversations,  setConversations]  = useState([])
  const [rideChats,      setRideChats]      = useState([])
  const [rideChatsLoading, setRideChatsLoading] = useState(true)
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
  const [clickedConv,    setClickedConv]    = useState(null)  // for click animation
  const [showAllConvs,   setShowAllConvs]   = useState(false) // show more than 6
  const [showAllRideChats, setShowAllRideChats] = useState(false) // show more ride chats
  const prevUnreadRef    = useRef(0)
  const searchTimerRef   = useRef(null)

  const CONV_PAGE_SIZE = 6
  const myId = currentUser?.user_id

  // ── Load ride chat conversations ──────────────────────────────────────────

  const loadRideChats = useCallback(async () => {
    try {
      const data = await getRideChatInbox()
      setRideChats(data.conversations || [])
    } catch {
      // ignore
    } finally {
      setRideChatsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!myId) return
    loadRideChats()
  }, [myId, loadRideChats])

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

    const onNotif = () => {
      loadConversations()
    }
    const onRideNotif = () => {
      loadRideChats()
    }

    socket.on('dm_notification', onNotif)
    socket.on('ride_chat_notification', onRideNotif)
    return () => {
      socket.off('dm_notification', onNotif)
      socket.off('ride_chat_notification', onRideNotif)
    }
  }, [myId, loadConversations, loadRideChats])

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

  // ── Delete last message in a conversation ─────────────────────────────────

  const handleDeleteLastMessage = async (conv, e) => {
    e.stopPropagation()
    const msgId = conv.last_message?.msg_id
    if (!msgId) return
    if (!window.confirm('Delete this message?')) return
    try {
      await dmDeleteMessage(msgId)
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
  // (handled inline in two-panel layout below)

  // ── Build user list for new chat ─────────────────────────────────────────────
  // If user has typed a search query, show live search results; otherwise show previous contacts
  const filteredUsers = userSearch.trim()
    ? searchResults
    : contacts.filter(u => u.name.toLowerCase().includes(userSearch.toLowerCase()))

  // ── Filtered conversation list ────────────────────────────────────────────

  const filteredConversations = convSearch.trim()
    ? conversations.filter(c => c.other_user?.name?.toLowerCase().includes(convSearch.toLowerCase()))
    : conversations

  const visibleConversations = showAllConvs ? filteredConversations : filteredConversations.slice(0, CONV_PAGE_SIZE)

  return (
    <div className="flex h-[600px] rounded-xl overflow-x-hidden overflow-y-hidden border border-gray-700 bg-gray-900">

      {/* ── Left panel: Thread list (30% desktop / full mobile) ── */}
      <div className={`flex flex-col border-r border-gray-700 bg-gray-900/80
        ${activeConv ? 'hidden md:flex' : 'flex'}
        w-full md:w-[30%] md:min-w-[220px] md:max-w-[280px]`}>

        {/* Panel header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-700 shrink-0">
          <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
            💬 Messages
            {totalUnread > 0 && (
              <span className="bg-blue-600 text-white text-xs px-1.5 py-0.5 rounded-full">
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            )}
          </h2>
          <div className="flex gap-1.5 items-center">
            <button
              onClick={loadConversations}
              className="text-xs text-gray-500 hover:text-gray-200 transition-colors"
              title="Refresh"
            >
              ↺
            </button>
            <button
              onClick={handleOpenNewChat}
              className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded-lg transition-colors"
            >
              + New
            </button>
          </div>
        </div>

        {/* Search */}
        {conversations.length > 0 && (
          <div className="px-2 py-1.5 border-b border-gray-700/50 shrink-0">
            <input
              type="text"
              placeholder="Search messages…"
              value={convSearch}
              onChange={e => setConvSearch(e.target.value)}
              className="w-full rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-xs px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        )}

        {/* New chat picker */}
        {showNewChat && (
          <div className="mx-2 my-1.5 bg-gray-800 border border-gray-700 rounded-xl p-3 space-y-2 shrink-0">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-white">Start a conversation</p>
              <button
                onClick={() => { setShowNewChat(false); setUserSearch(''); setSearchResults([]) }}
                className="text-gray-500 hover:text-gray-300 text-base leading-none"
              >
                ✕
              </button>
            </div>
            <div className="relative">
              <input
                type="text"
                placeholder="Search username…"
                value={userSearch}
                onChange={e => handleUserSearchChange(e.target.value)}
                autoFocus
                className="w-full rounded-lg bg-gray-900 border border-gray-600 text-gray-100 text-xs px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {searchLoading && (
                <span className="absolute right-2 top-2 text-gray-400 text-xs">⏳</span>
              )}
            </div>
            {filteredUsers.length === 0 ? (
              <p className="text-xs text-gray-500 text-center py-1">
                {userSearch.trim()
                  ? (searchLoading ? 'Searching…' : 'No users found.')
                  : (contacts.length === 0
                    ? 'Type a username to search.'
                    : 'No contacts match.')}
              </p>
            ) : (
              <div className="space-y-0.5 max-h-36 overflow-y-auto">
                {filteredUsers.map((u) => (
                  <button
                    key={u.user_id}
                    onClick={() => handleStartConversation(u.user_id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-700 transition-colors text-left"
                  >
                    <div className="w-7 h-7 rounded-full bg-blue-700 flex items-center justify-center text-xs font-bold text-white shrink-0">
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs text-white block truncate">{u.name}</span>
                      {u.username && u.username !== u.name && (
                        <span className="text-xs text-gray-400 block truncate">@{u.username}</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Thread list — scrollable */}
        <div className="flex-1 overflow-y-auto">
          {/* Ride share threads */}
          {!rideChatsLoading && rideChats.length > 0 && (() => {
            const sortedRideChats = [...rideChats].sort((a, b) => (b.ts || 0) - (a.ts || 0))
            const visibleRideChats = showAllRideChats ? sortedRideChats : sortedRideChats.slice(0, 6)
            return (
              <>
                <p className="text-xs font-semibold text-amber-400 uppercase tracking-wide px-3 pt-2 pb-1">🚗 Ride Share</p>
                {visibleRideChats.map((conv, i) => (
                  <div
                    key={conv.msg_id || i}
                    className="flex items-start gap-2 px-3 py-2.5 border-b border-gray-800/60 hover:bg-amber-900/10 transition-colors cursor-pointer"
                    style={{
                      transform: clickedConv === `ride-${i}` ? 'scale(0.97)' : '',
                      transition: `transform ${CLICK_ANIMATION_DURATION}ms ease`,
                    }}
                    onClick={() => {
                      setClickedConv(`ride-${i}`)
                      setTimeout(() => setClickedConv(null), CLICK_ANIMATION_DURATION)
                      navigate('/rides')
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => e.key === 'Enter' && navigate('/rides')}
                    aria-label={`Ride chat: ${conv.ride_info?.origin || 'Ride'} to ${conv.ride_info?.destination || '…'}`}
                  >
                    <div className="w-8 h-8 rounded-full bg-amber-800 flex items-center justify-center text-xs shrink-0 mt-0.5">🚗</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-amber-200 truncate">
                        {conv.ride_info?.origin || 'Ride'} → {conv.ride_info?.destination || '…'}
                      </p>
                      <p className="text-xs text-gray-400 truncate">
                        {conv.is_mine ? 'You: ' : `${conv.sender_name || 'Driver'}: `}{conv.text || '[message]'}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                      <span className="text-xs text-gray-600">
                        {conv.ts ? new Date(conv.ts * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}
                      </span>
                      {conv.msg_id && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            // Ride chat message deletion not available from inbox — navigate to ride
                            navigate('/rides')
                          }}
                          className="text-xs text-gray-600 hover:text-amber-400 transition-colors p-0.5 rounded"
                          title="Open ride chat to manage messages"
                        >
                          💬
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {sortedRideChats.length > 6 && (
                  <button
                    onClick={() => setShowAllRideChats(v => !v)}
                    className="w-full text-xs text-amber-400 hover:text-amber-300 py-2 border-t border-gray-800/60 transition-colors"
                  >
                    {showAllRideChats ? 'Show less ▲' : `Show more (${sortedRideChats.length - 6} more) ▼`}
                  </button>
                )}
                {conversations.length > 0 && (
                  <p className="text-xs font-semibold text-blue-400 uppercase tracking-wide px-3 pt-2 pb-1">💬 Direct Messages</p>
                )}
              </>
            )
          })()}

          {/* DM threads */}
          {loading ? (
            <div className="flex justify-center py-6">
              <div className="spinner w-5 h-5" />
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="text-center text-xs text-gray-500 py-8 px-3">
              <p className="text-2xl mb-1">💬</p>
              <p>{convSearch ? 'No matches.' : 'No conversations yet.'}</p>
              {!convSearch && (
                <button
                  onClick={handleOpenNewChat}
                  className="mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Start one →
                </button>
              )}
            </div>
          ) : (
            <>
            {visibleConversations.map((conv) => {
              const isQR = quickReply?.conv_id === conv.conv_id
              const isActive = activeConv?.conv_id === conv.conv_id
              const lastMsg = conv.last_message
              const senderUsername = lastMsg?.sender_id === myId
                ? 'You'
                : (lastMsg?.sender_username || conv.other_user?.username || conv.other_user?.name || 'User')
              const preview = lastMsg
                ? `${senderUsername}: ${lastMsg.content || '…'}`
                : 'No messages yet'
              const lastTs = lastMsg?.ts
              const isOnline = conv.other_user?.online_status === 'online'

              return (
                <div
                  key={conv.conv_id}
                  className={`border-b border-gray-800/60 transition-colors ${
                    isActive ? 'bg-blue-900/30 border-l-2 border-l-blue-500' : 'hover:bg-gray-800/50'
                  }`}
                  style={{
                    transform: clickedConv === conv.conv_id ? 'scale(0.98)' : '',
                    transition: `transform ${CLICK_ANIMATION_DURATION}ms ease`,
                  }}
                >
                  <div
                    className="flex items-center gap-2 px-3 py-2.5 cursor-pointer"
                    onClick={() => {
                      setClickedConv(conv.conv_id)
                      setTimeout(() => { setClickedConv(null); setActiveConv(conv) }, CLICK_ANIMATION_DURATION)
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => e.key === 'Enter' && setActiveConv(conv)}
                    aria-label={`Open chat with ${conv.other_user?.name || 'User'}`}
                  >
                    {/* Avatar */}
                    <div className="relative shrink-0">
                      <div className="w-9 h-9 rounded-full bg-blue-700 flex items-center justify-center text-xs font-bold text-white">
                        {conv.other_user?.name?.charAt(0)?.toUpperCase() || '?'}
                      </div>
                      {/* Online status dot */}
                      <span
                        className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-gray-900 ${isOnline ? 'bg-green-400' : 'bg-gray-600'}`}
                        title={isOnline ? 'Active now' : 'Offline'}
                      />
                      {conv.unread_count > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-blue-500 border border-gray-900 flex items-center justify-center text-white text-[9px] font-bold">
                          {conv.unread_count > 9 ? '9+' : conv.unread_count}
                        </span>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <p className={`text-xs truncate ${conv.unread_count > 0 ? 'font-bold text-white' : 'font-semibold text-gray-200'}`}>
                          {conv.other_user?.name || 'User'}
                        </p>
                        <span className="text-xs text-gray-600 shrink-0">{fmtTime(lastTs)}</span>
                      </div>
                      <p className={`text-xs truncate mt-0.5 ${conv.unread_count > 0 ? 'text-gray-200' : 'text-gray-500'}`}>
                        {preview.slice(0, 50)}{preview.length > 50 ? '…' : ''}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-1 shrink-0 ml-1" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => isQR ? (setQuickReply(null), setQuickText('')) : (setQuickReply(conv), setQuickText(''))}
                        className="text-xs text-gray-500 hover:text-blue-300 transition-colors p-1 rounded"
                        title="Quick reply"
                      >
                        ↩
                      </button>
                      {conv.last_message?.msg_id && (
                        <button
                          onClick={(e) => handleDeleteLastMessage(conv, e)}
                          className="text-xs text-gray-600 hover:text-orange-400 transition-colors p-1 rounded"
                          title="Delete last message"
                        >
                          🗑✉
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteConversation(conv.conv_id)}
                        className="text-xs text-gray-600 hover:text-red-400 transition-colors p-1 rounded"
                        title="Delete conversation"
                      >
                        🗑
                      </button>
                    </div>
                  </div>

                  {/* Quick reply */}
                  {isQR && (
                    <div className="px-3 pb-2 flex gap-2">
                      <input
                        type="text"
                        autoFocus
                        value={quickText}
                        onChange={e => setQuickText(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleQuickReply(conv) }}
                        placeholder={`Reply to ${conv.other_user?.name || 'User'}…`}
                        maxLength={1000}
                        className="flex-1 rounded-lg bg-gray-900 border border-gray-600 text-gray-100 text-xs px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-0"
                      />
                      <button
                        onClick={() => handleQuickReply(conv)}
                        disabled={!quickText.trim() || sendingQR}
                        className="rounded-lg px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs transition-colors shrink-0"
                      >
                        Send
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
            {/* Show more / Show less */}
            {filteredConversations.length > CONV_PAGE_SIZE && (
              <button
                onClick={() => setShowAllConvs(v => !v)}
                className="w-full text-xs text-blue-400 hover:text-blue-300 py-2 border-t border-gray-800/60 transition-colors"
              >
                {showAllConvs ? 'Show less ▲' : `Show more (${filteredConversations.length - CONV_PAGE_SIZE} more) ▼`}
              </button>
            )}
            </>
          )}
        </div>
      </div>

      {/* ── Right panel: Chat box (70% desktop / full mobile) ── */}
      <div className={`flex-1 flex flex-col overflow-hidden
        ${!activeConv ? 'hidden md:flex' : 'flex'}`}>
        {activeConv ? (
          <DMChat
            conv={activeConv}
            currentUser={currentUser}
            onClose={() => { setActiveConv(null); loadConversations() }}
            onBack={() => setActiveConv(null)}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-6">
            <p className="text-4xl">💬</p>
            <p className="text-sm text-gray-400">Select a conversation to start chatting</p>
            <button
              onClick={handleOpenNewChat}
              className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg transition-colors"
            >
              + New Message
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

