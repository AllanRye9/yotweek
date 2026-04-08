import { useState, useEffect, useCallback, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Reviews from '../components/Reviews'
import ThemeSelector from '../components/ThemeSelector'
import UserAuth from '../components/UserAuth'
import RideShare from '../components/RideShare'
import { getUserProfile } from '../api'
import { getDashboardPath } from '../routing'
import socket from '../socket'

function RideShareEmbed({ user }) {
  return (
    <div style={{ minHeight: 300 }}>
      <RideShare
        user={user}
        onRidesChange={() => {}}
        requestedRide={null}
        onRequestedRideHandled={() => {}}
        showSections={{ form: true, list: true, dashboard: false, driverBroadcast: false }}
      />
    </div>
  )
}

/** Returns true when n is a power-of-10 milestone worth celebrating (≥ 100).
 * Checks whether n equals the nearest power of 10 within ±0.5 integer units
 * (i.e., exactly 100, 1000, 10000, 100000, …).
 */
function isRoundMilestone(n) {
  if (!n || n < 100) return false
  const exp = Math.round(Math.log10(n))
  return Math.abs(n - Math.pow(10, exp)) < 0.5
}

/** How much the value must grow beyond a milestone before the celebration stops.
 *  5 % means: if the milestone was 1000, celebrations stop once value ≥ 1050. */
const MILESTONE_GROWTH_THRESHOLD = 0.05

/** Animate a numeric counter from its previous value to a new target.
 * Every 15 minutes the counter re-animates from 0 to the current value so
 * the digits visibly "spin up" even when the underlying value has not changed.
 *
 * @param {number|null} target   - The target number to animate toward.
 * @param {number}      duration - Animation duration in ms (default 1800).
 * @returns {number} The current animated display value.
 */
function useAnimatedCounter(target, duration = 1800) {
  const [display, setDisplay] = useState(0)
  const prevRef = useRef(0)
  const rafRef  = useRef(null)
  // Incrementing this key resets prevRef to 0 and forces a re-animation.
  const [periodicTick, setPeriodicTick] = useState(0)

  // Every 15 minutes, reset the start position and trigger a fresh animation.
  useEffect(() => {
    const id = setInterval(() => {
      prevRef.current = 0
      setPeriodicTick(t => t + 1)
    }, 15 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (target == null) return
    const start = prevRef.current
    const diff  = target - start
    // Skip only when there is genuinely nothing to animate (diff = 0 and this
    // is not a forced periodic re-animation where prevRef was already reset).
    if (diff === 0) return
    const t0 = performance.now()
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const tick = (now) => {
      const p    = Math.min((now - t0) / duration, 1)
      const ease = 1 - Math.pow(1 - p, 3) // cubic ease-out
      setDisplay(Math.round(start + diff * ease))
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        prevRef.current = target
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [target, duration, periodicTick])

  return display
}

// ---------------------------------------------------------------------------
// Celebration confetti overlay
// ---------------------------------------------------------------------------

/** Inject the CSS keyframes for the confetti particles once. */
function useCelebrationStyles() {
  useEffect(() => {
    const id = 'yot-celebration-styles'
    if (document.getElementById(id)) return
    const el = document.createElement('style')
    el.id = id
    el.textContent = `
@keyframes confettiFall {
  0%   { transform: translateY(-20px) rotate(0deg);   opacity: 1; }
  80%  { opacity: 1; }
  100% { transform: translateY(90vh) rotate(720deg); opacity: 0; }
}
@keyframes celebFadeIn  { from { opacity: 0; transform: scale(0.7); } to { opacity: 1; transform: scale(1); } }
@keyframes celebFadeOut { from { opacity: 1; } to { opacity: 0; } }
.celeb-banner {
  animation: celebFadeIn 0.4s ease-out both, celebFadeOut 0.5s ease-in 3.5s both;
}
.confetti-particle {
  position: fixed;
  top: 0;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  pointer-events: none;
  animation: confettiFall linear both;
  z-index: 9500;
}
`
    document.head.appendChild(el)
  }, [])
}

const CONFETTI_COLORS = [
  '#dc2626', '#ea580c', '#d97706', '#16a34a',
  '#2563eb', '#7c3aed', '#db2777', '#0891b2',
]

/**
 * Full-screen confetti burst + congratulations banner.
 * Rendered at the React root so it overlays everything.
 */
function CelebrationOverlay({ value, label, celebKey, onDone }) {
  useCelebrationStyles()
  const [visible, setVisible] = useState(true)

  // Auto-dismiss after 4 s
  useEffect(() => {
    setVisible(true)
    const id = setTimeout(() => { setVisible(false); onDone?.() }, 4000)
    return () => clearTimeout(id)
  }, [celebKey, onDone])

  if (!visible) return null

  // Deterministic-ish set of particles based on celebKey
  const particles = Array.from({ length: 28 }, (_, i) => {
    const seed   = (celebKey * 31 + i * 17) % 100
    const left   = ((seed * 7 + i * 13) % 100)
    const delay  = (seed % 12) / 10
    const dur    = 2.5 + (seed % 15) / 10
    const color  = CONFETTI_COLORS[i % CONFETTI_COLORS.length]
    const size   = 7 + (i % 7)
    const shape  = i % 3 === 0 ? '0' : i % 3 === 1 ? '2px' : '50%'
    return { left, delay, dur, color, size, shape }
  })

  return (
    <>
      {/* Confetti particles */}
      {particles.map((p, i) => (
        <div
          key={i}
          className="confetti-particle"
          style={{
            left:             `${p.left}%`,
            backgroundColor:  p.color,
            width:            p.size,
            height:           p.size,
            borderRadius:     p.shape,
            animationDelay:   `${p.delay}s`,
            animationDuration:`${p.dur}s`,
          }}
        />
      ))}

      {/* Congratulations banner */}
      <div
        role="alert"
        aria-live="polite"
        style={{
          position:   'fixed',
          top:        '18%',
          left:       '50%',
          transform:  'translateX(-50%)',
          zIndex:     9600,
          background: 'linear-gradient(135deg,#1e1b4b,#312e81)',
          border:     '2px solid #6366f1',
          borderRadius: 16,
          padding:    '18px 28px',
          textAlign:  'center',
          boxShadow:  '0 8px 40px rgba(99,102,241,0.6)',
          minWidth:   260,
          maxWidth:   360,
          pointerEvents: 'none',
        }}
        className="celeb-banner"
      >
        <div style={{ fontSize: '2rem', lineHeight: 1 }}>🎉</div>
        <div style={{ color: '#fff', fontWeight: 700, fontSize: '1rem', marginTop: 6 }}>
          Congratulations!
        </div>
        <div style={{ color: '#c7d2fe', fontSize: '0.82rem', marginTop: 4 }}>
          {value.toLocaleString()} {label}
        </div>
      </div>
    </>
  )
}

/**
 * Detects when a stat value hits a round-number milestone and triggers a
 * celebration overlay.  Re-triggers every 15 minutes while the value is still
 * within 5 % of the milestone; stops once it has grown by ≥ 5 %.
 */
function useCelebration(value) {
  const [celebState, setCelebState] = useState({ active: false, key: 0 })
  const milestoneRef = useRef(null)
  const valueRef     = useRef(value)
  useEffect(() => { valueRef.current = value }, [value])

  // Trigger when value first hits a round milestone.
  useEffect(() => {
    if (value == null || value < 100) return
    if (isRoundMilestone(value) && milestoneRef.current !== value) {
      milestoneRef.current = value
      setCelebState(prev => ({ active: true, key: prev.key + 1 }))
    }
  }, [value])

  // Every 15 minutes, re-trigger if still within the growth threshold of the milestone.
  useEffect(() => {
    const id = setInterval(() => {
      const milestone = milestoneRef.current
      if (milestone == null) return
      const cur = valueRef.current
      if (cur != null && cur < milestone * (1 + MILESTONE_GROWTH_THRESHOLD)) {
        setCelebState(prev => ({ active: true, key: prev.key + 1 }))
      } else {
        milestoneRef.current = null
        setCelebState(prev => ({ ...prev, active: false }))
      }
    }, 15 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  const dismiss = useCallback(() => setCelebState(prev => ({ ...prev, active: false })), [])
  return { ...celebState, dismiss }
}

/** Displays a labelled stat that animates from 0 (or its prior value) to `value`.
 * Shows a confetti celebration when the value hits a round milestone.
 * @param {Object} props
 * @param {number} props.value - The numeric value to display.
 * @param {string} props.label - The caption shown below the number.
 * @param {string} props.icon  - Emoji icon shown before the number.
 */
function AnimatedCounter({ value, label, icon }) {
  const count  = useAnimatedCounter(value ?? 0)
  const celeb  = useCelebration(value)
  return (
    <>
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-2xl sm:text-3xl font-bold text-white tabular-nums">
          {icon} {count.toLocaleString()}
        </span>
        <span className="text-xs text-gray-400 uppercase tracking-wide">{label}</span>
      </div>

      {celeb.active && (
        <CelebrationOverlay
          value={value}
          label={label}
          celebKey={celeb.key}
          onDone={celeb.dismiss}
        />
      )}
    </>
  )
}

const TABS = [
  { id: 'rides',   label: '🚗 Ride Share',    icon: '🚗' },
]

const SERVICE_CARDS = [
  { id: 'rides',   icon: '🚗', title: 'Ride Share',      desc: 'Post rides, find drivers & travel together' },
  { id: 'map',     icon: '🗺️', title: 'Live Driver Map',  desc: 'Real-time locations of available drivers' },
  { id: 'chat',    icon: '💬', title: 'Ride Chat',        desc: 'Message drivers & passengers in real time' },
  { id: 'profile', icon: '👤', title: 'Your Profile',     desc: 'Manage your account, rides & preferences' },
]

/** Feature cards linking to core platform sections. */
function ServiceCards({ onNavigateRides, user, onLoginPrompt }) {
  const navigate = useNavigate()

  const requireAuth = (fn) => () => {
    if (user === false || user === null) {
      // null = still loading, false = not logged in
      if (user === false) { onLoginPrompt?.(); return }
      return // still loading — do nothing
    }
    fn()
  }

  const handlers = {
    rides:   requireAuth(onNavigateRides || (() => navigate('/rides'))),
    map:     requireAuth(() => navigate('/map')),
    chat:    requireAuth(() => navigate('/inbox')),
    profile: requireAuth(() => navigate('/profile')),
  }

  return (
    <div className="service-cards-grid" role="tablist" aria-label="Services">
      {SERVICE_CARDS.map((c, i) => (
        <button
          key={c.id}
          role="tab"
          aria-selected={i === 0}
          className={`service-card ${i === 0 ? 'service-card-active' : ''}`}
          onClick={() => handlers[c.id]?.()}
        >
          <span className="service-card-icon" aria-hidden="true">{c.icon}</span>
          <div className="service-card-title">{c.title}</div>
          <div className="service-card-desc">{c.desc}</div>
        </button>
      ))}
    </div>
  )
}

export default function Home() {
  const navigate  = useNavigate()
  const [connected, setConnected] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const tab = 'rides'

  // Platform user state (separate from admin)
  const [appUser, setAppUser]     = useState(null)  // null=unknown, false=not logged in, object=logged in
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [userLoading, setUserLoading]     = useState(true)

  // Ref to the tab-panel container so we can scroll to it on card click
  const tabPanelRef = useRef(null)
  const fabRef = useRef(null)
  const fabDrag = useRef({ active: false, moved: false, startX: 0, startY: 0, origRight: 24, origBottom: 24 })

  useEffect(() => {
    const fab = fabRef.current
    if (!fab) return
    const onPointerDown = (e) => {
      fabDrag.current.active = true
      fabDrag.current.moved = false
      fabDrag.current.startX = e.clientX
      fabDrag.current.startY = e.clientY
      fabDrag.current.origRight  = parseFloat(fab.dataset.right  ?? '24')
      fabDrag.current.origBottom = parseFloat(fab.dataset.bottom ?? '24')
      fab.setPointerCapture(e.pointerId)
      e.preventDefault()
    }
    const onPointerMove = (e) => {
      if (!fabDrag.current.active) return
      const dx = e.clientX - fabDrag.current.startX
      const dy = e.clientY - fabDrag.current.startY
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) fabDrag.current.moved = true
      const right  = Math.max(8, Math.min(fabDrag.current.origRight  - dx, window.innerWidth  - (fab.offsetWidth  || 52) - 8))
      const bottom = Math.max(8, Math.min(fabDrag.current.origBottom + dy, window.innerHeight - (fab.offsetHeight || 52) - 8))
      fab.style.right  = right  + 'px'
      fab.style.bottom = bottom + 'px'
      fab.dataset.right  = right
      fab.dataset.bottom = bottom
    }
    const onPointerUp = () => {
      if (!fabDrag.current.active) return
      fabDrag.current.active = false
      if (!fabDrag.current.moved) setHelpOpen(true)
    }
    fab.addEventListener('pointerdown',  onPointerDown)
    fab.addEventListener('pointermove',  onPointerMove)
    fab.addEventListener('pointerup',    onPointerUp)
    fab.addEventListener('pointercancel', () => { fabDrag.current.active = false })
    return () => {
      fab.removeEventListener('pointerdown',  onPointerDown)
      fab.removeEventListener('pointermove',  onPointerMove)
      fab.removeEventListener('pointerup',    onPointerUp)
    }
  }, [])

  // Socket.IO connection indicator
  useEffect(() => {
    const onConnect    = () => setConnected(true)
    const onDisconnect = () => setConnected(false)
    socket.on('connect',    onConnect)
    socket.on('disconnect', onDisconnect)
    setConnected(socket.connected)
    return () => {
      socket.off('connect',    onConnect)
      socket.off('disconnect', onDisconnect)
    }
  }, [])

  // Load platform user session on mount; redirect to dashboard if already logged in
  useEffect(() => {
    getUserProfile()
      .then(u => {
        setAppUser(u)
        // Already logged in — send to the correct role-based dashboard
        navigate(getDashboardPath(u), { replace: true })
      })
      .catch(() => setAppUser(false))
      .finally(() => setUserLoading(false))
  }, [navigate])

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Global auth modal — accessible from hero CTA and navbar */}
      {showAuthModal && !appUser && (
        <UserAuth
          onSuccess={(u) => { setAppUser(u); setShowAuthModal(false); navigate(getDashboardPath(u), { replace: true }) }}
          onClose={() => setShowAuthModal(false)}
        />
      )}
      {/* ── Navbar ── */}
      <nav className="sticky top-0 z-50 bg-gray-950/95 backdrop-blur border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 flex items-center h-14 gap-4">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 text-xl font-bold text-white shrink-0">
            <img src="/yotweek.png" alt="" width={22} height={22} style={{ borderRadius: 4 }} aria-hidden="true" />
            <span className="gradient-text hidden sm:inline">yotweek</span>
            <span className="gradient-text sm:hidden">YOT</span>
          </Link>

          {/* Stats badges */}
          <div className="flex-1" />

          {/* Connection dot */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-500'}`} />
            <span className="text-gray-500 hidden sm:inline">{connected ? 'Live' : 'Offline'}</span>
          </div>

          {/* Theme selector */}
          <ThemeSelector />

          {/* User profile avatar — top-right navbar */}
          {!userLoading && (
            <div className="relative">
              {appUser ? (
                <button
                  onClick={() => navigate('/profile')}
                  className="nav-profile-btn w-8 h-8 rounded-full bg-blue-700 hover:bg-blue-600 flex items-center justify-center text-base transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                  aria-label="Profile"
                  title={appUser.name}
                >
                  {appUser.avatar_url ? (
                    <img src={appUser.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                  ) : (
                    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full rounded-full">
                      <circle cx="20" cy="20" r="20" fill="#1e3a5f"/>
                      <circle cx="20" cy="15" r="7" fill="#60a5fa"/>
                      <ellipse cx="20" cy="34" rx="12" ry="8" fill="#60a5fa"/>
                    </svg>
                  )}
                </button>
              ) : (
                <button
                  onClick={() => { setShowAuthModal(true) }}
                  className="text-xs px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-white transition-colors hidden sm:inline-flex items-center gap-1"
                >
                  Login / Register
                </button>
              )}
            </div>
          )}

          {/* Mobile menu */}
          <button
            className="btn-ghost btn-sm sm:hidden"
            onClick={() => setMenuOpen(m => !m)}
            aria-label="Menu"
          >
            {menuOpen ? '✕' : '☰'}
          </button>
        </div>

        {/* Mobile dropdown */}
        {menuOpen && (
          <div className="sm:hidden border-t border-gray-800 bg-gray-900 px-4 py-3 space-y-2">
          </div>
        )}
      </nav>

      {/* ── Hero ── */}
      <div className="bg-gradient-to-b from-gray-900 to-gray-950 border-b border-gray-800 py-[19px] sm:py-[27px] px-4">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">
            <span className="gradient-text">yotweek</span> — Ride Sharing Made Simple
          </h1>
          <p className="text-gray-400 text-xs sm:text-sm">
            Find a ride · Offer seats · Chat with drivers · Travel together — All Free.
          </p>
          <p className="text-gray-500 text-xs mt-1">
            Real-time ride sharing powered by live driver location tracking.
          </p>

          {/* Sign up CTA for non-logged-in users */}
          {!userLoading && !appUser && (
            <div className="mt-5 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={() => setShowAuthModal(true)}
                className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-colors shadow-lg shadow-blue-900/40"
              >
                Create Free Account
              </button>
              <button
                onClick={() => setShowAuthModal(true)}
                className="px-5 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 hover:text-white text-sm transition-colors"
              >
                Sign In
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Main Content ── */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 pt-[15px] sm:pt-[19px] pb-20 sm:pb-8">
        {/* Animated service cards — glowing borders, random interchange */}
        <ServiceCards onNavigateRides={() => navigate('/rides')} user={appUser} onLoginPrompt={() => setShowAuthModal(true)} />

        {/* Ride Share & Driver Alerts — dedicated page link */}
        <div className="mt-2 flex justify-center gap-3 flex-wrap">
          <Link
            to="/rides"
            className="text-sm px-4 py-1.5 rounded-full border transition-colors bg-gray-800/60 border-gray-700 text-gray-400 hover:bg-yellow-700 hover:border-yellow-600 hover:text-yellow-100"
          >
            🚗 Browse Rides
          </Link>
          <Link
            to="/map"
            className="text-sm px-4 py-1.5 rounded-full border transition-colors bg-gray-800/60 border-gray-700 text-gray-400 hover:bg-blue-700 hover:border-blue-600 hover:text-blue-100"
          >
            🗺️ Live Driver Map
          </Link>
          <Link
            to="/inbox"
            className="text-sm px-4 py-1.5 rounded-full border transition-colors bg-gray-800/60 border-gray-700 text-gray-400 hover:bg-green-700 hover:border-green-600 hover:text-green-100"
          >
            💬 Messages
          </Link>
        </div>

        <div className="h-4" />

        {/* Tab panels */}
        <div className="card" ref={tabPanelRef}>
          {tab === 'rides'   && (
            appUser
              ? <RideShareEmbed user={appUser} />
              : <div className="text-center py-10 space-y-4">
                  <div className="text-5xl">🚗</div>
                  <h3 className="text-lg font-bold text-white">Ride Share</h3>
                  <p className="text-sm text-gray-400">Sign in to post rides, find drivers, and get real-time alerts.</p>
                  <button
                    onClick={() => setShowAuthModal(true)}
                    className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-colors"
                  >
                    Login / Register
                  </button>
                </div>
          )}
        </div>

        {/* Reviews */}
        <div className="mt-[27px]">
          <Reviews />
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-gray-800 py-8 px-4 pb-safe text-center text-xs text-gray-500">
        <div className="max-w-3xl mx-auto space-y-4">
          {/* Brand */}
          <div className="flex items-center justify-center gap-2">
            <img src="/yotweek.png" alt="" width={18} height={18} style={{ borderRadius: 4 }} aria-hidden="true" />
            <span className="gradient-text font-bold text-sm">yotweek</span>
          </div>
          <p className="text-gray-600">Connecting passengers and drivers across communities.</p>
          {/* Links */}
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-gray-600">
            <a href="/rides" className="hover:text-gray-300 transition-colors">🚗 Browse Rides</a>
            <a href="/map" className="hover:text-gray-300 transition-colors">🗺️ Live Map</a>
            <a href="/inbox" className="hover:text-gray-300 transition-colors">💬 Messages</a>
            <a href="/profile" className="hover:text-gray-300 transition-colors">👤 Profile</a>
          </div>
          {/* Legal */}
          <div className="border-t border-gray-800 pt-4 space-y-1">
            <p>
              <a href="mailto:support@yotweek.com" className="hover:text-gray-400 transition-colors">
                support@yotweek.com
              </a>
            </p>
            <p>yotweek © {new Date().getFullYear()} · Ride safely and responsibly.</p>
          </div>
        </div>
      </footer>

      {/* ── Draggable Help FAB ── */}
      <button
        ref={fabRef}
        data-right="24"
        data-bottom="24"
        aria-label="Help — click for a guide to all features"
        title="Help"
        style={{
          position: 'fixed',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
          right: 24,
          zIndex: 9000,
          width: 52, height: 52, borderRadius: '50%',
          background: 'linear-gradient(135deg,#dc2626,#b91c1c)',
          color: '#fff', border: 'none', cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(220,38,38,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.25rem', userSelect: 'none', touchAction: 'none',
        }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setHelpOpen(true) } }}
      >
        ?
      </button>

      {/* ── Help Modal ── */}
      {helpOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            zIndex: 9100, display: 'flex', alignItems: 'center',
            justifyContent: 'center', padding: 16,
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
          }}
          onClick={e => { if (e.target === e.currentTarget) setHelpOpen(false) }}
        >
          <div style={{
            background: '#111827', border: '1px solid #1f2937',
            borderRadius: 16, maxWidth: 580, width: '100%',
            maxHeight: '90vh', overflowY: 'auto',
            boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
          }}>
            {/* Modal header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '18px 20px 14px', borderBottom: '1px solid #1f2937',
              position: 'sticky', top: 0, background: '#111827', zIndex: 1,
              borderRadius: '16px 16px 0 0',
            }}>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#f3f4f6', display: 'flex', alignItems: 'center', gap: 8 }}>
                ❓ yotweek — Help Guide
              </h2>
              <button
                onClick={() => setHelpOpen(false)}
                style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '1.1rem', padding: '4px 8px', borderRadius: 6 }}
                aria-label="Close help"
              >✕</button>
            </div>

            {/* Modal body */}
            <div style={{ padding: '16px 20px 20px', fontSize: '0.82rem', color: '#9ca3af', lineHeight: 1.7 }}>
              <HelpSection icon="⬇" title="Single Video Download">
                <ol style={{ paddingLeft: 18, margin: 0 }}>
                  <li>Paste a video URL (YouTube, TikTok, Instagram, Twitter/X, Facebook and 1,000+ sites) into the URL box.</li>
                  <li>Click <strong>Get Info</strong> to fetch the title, duration, and thumbnail.</li>
                  <li>Choose your <strong>Quality</strong> and <strong>Format</strong> then click <strong>Download</strong>.</li>
                  <li>The file is prepared on the server and a download link appears automatically.</li>
                </ol>
              </HelpSection>
              <HelpDivider />
              <HelpSection icon="📄" title="CV Generator">
                <ol style={{ paddingLeft: 18, margin: 0 }}>
                  <li>Switch to the <strong>CV Generator</strong> tab.</li>
                  <li>Step through the wizard — Personal Info, Summary, Experience, Education, Skills, Extras, and Theme.</li>
                  <li>Watch the <strong>live preview</strong> update on the right as you type.</li>
                  <li>Choose from 8 professional themes, optionally add a logo, then click <strong>Generate PDF CV</strong>.</li>
                  <li>Use <strong>← Previous</strong> to go back and edit any earlier step.</li>
                </ol>
              </HelpSection>
              <HelpDivider />
              <HelpSection icon="🔄" title="Doc Converter">
                <ol style={{ paddingLeft: 18, margin: 0 }}>
                  <li>Switch to the <strong>Doc Converter</strong> tab.</li>
                  <li>Upload a PDF, Word (.docx), Excel (.xlsx), JPEG, or PNG file.</li>
                  <li>Choose the target format (e.g. PDF → Word, JPEG → PDF).</li>
                  <li>Click <strong>Convert &amp; Download</strong> to receive the converted file.</li>
                </ol>
              </HelpSection>
              <HelpDivider />
              <HelpSection icon="📁" title="File Manager">
                All processed files are listed here. Preview in the built-in player, download, or delete files to free up server space.
              </HelpSection>
              <HelpDivider />
              <HelpSection icon="↕" title="Moving the Help Button">
                Drag the <strong>?</strong> button to any corner of the screen. A short tap/click opens this guide; a longer press-and-drag repositions it.
              </HelpSection>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function HelpSection({ icon, title, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 700, color: '#dc2626', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>{icon}</span> {title}
      </div>
      <div>{children}</div>
    </div>
  )
}

function HelpDivider() {
  return <hr style={{ border: 'none', borderTop: '1px solid #1f2937', margin: '12px 0' }} />
}
