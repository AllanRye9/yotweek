/**
 * AIPage — Full-page AI assistant with site navigation (MCP).
 * Occupies the entire viewport. Detects navigation intents and executes them.
 */
import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { getUserProfile, aiChat } from '../api'
import { getDashboardPath } from '../routing'

const NAV_INTENTS = [
  { patterns: [/\bmy ride[s]?\b|\bmy booking[s]?\b|\bmine\b.*\bride[s]?\b/i], path: null, dashTab: 'rides', label: 'My Rides' },
  { patterns: [/\brides?\b/i], path: '/rides', label: 'Rides' },
  { patterns: [/\brequest[s]?\b/i], path: '/requests', label: 'Ride Requests' },
  { patterns: [/\bpost\b.*\brequest\b|\bnew request\b/i], path: '/requests', label: 'Post a Request' },
  { patterns: [/\bcompanion[s]?\b|\btravel together\b/i], path: null, dashTab: 'companions', label: 'Companions' },
  { patterns: [/\bmap\b|\bfind driver[s]?\b|\bdriver[s]? near\b/i], path: '/map', label: 'Map' },
  { patterns: [/\bdashboard\b|\bhome\b/i], path: null, dashTab: null, label: 'Dashboard' },
  { patterns: [/\binbox\b|\bmessage[s]?\b|\bchat\b/i], path: '/inbox', label: 'Inbox' },
  { patterns: [/\bnotification[s]?\b/i], path: '/notifications', label: 'Notifications' },
  { patterns: [/\bprofile\b|\bsetting[s]?\b/i], path: '/profile', label: 'Profile' },
]

function detectNavIntent(text) {
  for (const intent of NAV_INTENTS) {
    if (intent.patterns.some(p => p.test(text))) return intent
  }
  return null
}

function NavAction({ intent, user, onNavigate }) {
  const label = intent.label
  return (
    <button
      onClick={() => onNavigate(intent, user)}
      className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full font-semibold transition-all hover:scale-105"
      style={{ background: 'rgba(245,158,11,0.18)', color: '#fcd34d', border: '1px solid rgba(245,158,11,0.35)' }}
    >
      → Go to {label}
    </button>
  )
}

export default function AIPage() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [msgs, setMsgs] = useState([{
    role: 'bot',
    text: "Hi! I'm YotBot 🤖 — your full AI assistant. I can help you find rides, post requests, match companions, navigate the site, and answer any questions. What can I do for you?",
    nav: null,
  }])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    getUserProfile().then(setUser).catch(() => setUser(null))
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs])

  const handleNavigate = (intent, currentUser) => {
    if (intent.path) {
      navigate(intent.path)
    } else if (intent.dashTab) {
      const base = getDashboardPath(currentUser)
      navigate(`${base}?tab=${intent.dashTab}`)
    } else {
      navigate(getDashboardPath(currentUser))
    }
  }

  const send = async (text) => {
    const t = (text || input).trim()
    if (!t || loading) return
    setInput('')
    const navIntent = detectNavIntent(t)
    setMsgs(p => [...p, { role: 'user', text: t, nav: null }])
    setLoading(true)
    try {
      const role = user?.role === 'driver' ? 'driver' : 'dashboard'
      const d = await aiChat(t, role)
      const reply = d.reply || d.message || 'Sorry, I could not respond right now.'
      setMsgs(p => [...p, { role: 'bot', text: reply, nav: navIntent }])
    } catch {
      setMsgs(p => [...p, { role: 'bot', text: 'Sorry, something went wrong. Please try again.', nav: navIntent }])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  const SUGGESTIONS = [
    '🔍 Find a ride for me',
    '📋 Check my bookings',
    '🧳 Find a travel companion',
    '🗺️ Show me the map',
    '📬 Open my inbox',
    '🙋 Post a ride request',
  ]

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-page)', color: 'var(--text-primary)' }}>
      {/* Header */}
      <header className="sticky top-0 z-50 border-b flex items-center gap-3 px-4 h-14 shrink-0"
              style={{ background: 'var(--bg-nav)', borderColor: 'var(--border-color)', backdropFilter: 'blur(12px)' }}>
        <Link to={user ? getDashboardPath(user) : '/'} className="text-sm hover:opacity-70 transition-opacity" style={{ color: 'var(--text-secondary)' }}>
          ← Back
        </Link>
        <div className="flex items-center gap-2 flex-1">
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold"
               style={{ background: 'linear-gradient(135deg, #f59e0b, #fb923c)' }}>🤖</div>
          <div>
            <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>YotBot AI Assistant</p>
          </div>
        </div>
        <span className="live-badge live-badge-green"><span className="live-dot" />Online</span>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4 max-w-2xl w-full mx-auto">
        {msgs.map((m, i) => (
          <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'} fade-in-up`}>
            {m.role === 'bot' && (
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0"
                   style={{ background: 'linear-gradient(135deg, #f59e0b, #fb923c)' }}>🤖</div>
            )}
            <div className="max-w-[80%] space-y-2">
              <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                m.role === 'user' ? 'rounded-br-sm text-black' : 'rounded-bl-sm'
              }`}
                style={m.role === 'user'
                  ? { background: 'linear-gradient(135deg, #f59e0b, #f97316)' }
                  : { background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }
                }>
                {m.text}
              </div>
              {m.role === 'bot' && m.nav && (
                <NavAction intent={m.nav} user={user} onNavigate={handleNavigate} />
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-3 fade-in-up">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0"
                 style={{ background: 'linear-gradient(135deg, #f59e0b, #fb923c)' }}>🤖</div>
            <div className="px-4 py-3 rounded-2xl rounded-bl-sm"
                 style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <span className="inline-flex gap-1 items-center">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      {/* Suggestions (shown only before first user message) */}
      {msgs.filter(m => m.role === 'user').length === 0 && (
        <div className="px-4 pb-3 flex flex-wrap gap-2 justify-center max-w-2xl w-full mx-auto">
          {SUGGESTIONS.map((s, i) => (
            <button key={i} onClick={() => send(s)}
                    className="text-xs px-3 py-1.5 rounded-full transition-all hover:scale-105"
                    style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input bar */}
      <div className="sticky bottom-0 border-t px-4 py-3 shrink-0"
           style={{ background: 'var(--bg-nav)', borderColor: 'var(--border-color)', backdropFilter: 'blur(12px)' }}>
        <div className="max-w-2xl mx-auto flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder="Ask YotBot anything… or say 'take me to my rides'"
            autoFocus
            className="flex-1 rounded-xl px-4 py-3 text-sm outline-none"
            style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', fontSize: 'max(16px, 0.875rem)' }}
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || loading}
            className="px-5 py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 hover:scale-105"
            style={{ background: 'linear-gradient(135deg, #f59e0b, #f97316)', color: '#000' }}
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  )
}
