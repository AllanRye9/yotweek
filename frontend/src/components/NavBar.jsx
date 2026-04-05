/**
 * NavBar — Shared navigation bar used across all main pages.
 *
 * Props:
 *   user         {object|null|false}  Current logged-in user (null = loading, false = not logged in)
 *   onLogout     {function}           Called when user clicks "Sign Out"
 *   onLogin      {function}           Called when user clicks "Sign In" (opens auth modal)
 *   title        {string}             Optional page title shown beside logo on mobile
 *   backPath     {string}             If provided, show a "← Back" link instead of nav items
 *   showBack     {boolean}            Alias for backPath !== undefined
 */

import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../App'
import ThemeSelector from './ThemeSelector'
import { userLogout } from '../api'
import { getDashboardPath } from '../routing'
import socket from '../socket'

const NAV_LINKS = [
  { to: '/',              label: '🏠 Home'          },
  { to: '/rides',         label: '🚗 Rides'         },
  { to: '/tourist-sites', label: '🗺️ Tourist Sites' },
  { to: '/map',           label: '📍 Map'           },
  { to: '/inbox',         label: '💬 Inbox'         },
  { to: '/agents',        label: '🧑‍💼 Agents'       },
]

export default function NavBar({ user, onLogout, onLogin, title, backPath }) {
  const { admin } = useAuth()
  const navigate  = useNavigate()
  const location  = useLocation()

  const [menuOpen,     setMenuOpen]     = useState(false)
  const [profileOpen,  setProfileOpen]  = useState(false)
  const [connected,    setConnected]    = useState(socket.connected)
  const profileRef = useRef(null)
  const menuRef    = useRef(null)

  // Track socket connection state
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

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false)
      if (menuRef.current    && !menuRef.current.contains(e.target))    setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Close mobile menu on route change
  useEffect(() => { setMenuOpen(false) }, [location.pathname])

  const handleLogout = async () => {
    setProfileOpen(false)
    setMenuOpen(false)
    try { await userLogout() } catch {}
    onLogout?.()
    navigate('/login', { replace: true })
  }

  const dashPath = getDashboardPath(user || null)

  return (
    <header
      className="sticky top-0 z-50 border-b"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
    >
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-3">

        {/* Logo / back button */}
        {backPath ? (
          <Link
            to={backPath}
            className="flex items-center gap-1.5 text-sm shrink-0"
            style={{ color: 'var(--text-secondary)' }}
          >
            ← {title || 'Back'}
          </Link>
        ) : (
          <Link to="/" className="flex items-center gap-2 shrink-0 font-bold text-lg">
            <img
              src="/yotweek.png"
              alt=""
              width={22}
              height={22}
              style={{ borderRadius: 4 }}
              aria-hidden="true"
            />
            <span className="gradient-text hidden sm:inline">yotweek</span>
            <span className="gradient-text sm:hidden">YOT</span>
          </Link>
        )}

        {/* Page title on mobile (only when not in back mode) */}
        {!backPath && title && (
          <span className="sm:hidden text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
            {title}
          </span>
        )}

        {/* Desktop nav links */}
        {!backPath && (
          <nav className="hidden md:flex items-center gap-1 ml-2">
            {NAV_LINKS.map(({ to, label }) => {
              const active = location.pathname === to
              return (
                <Link
                  key={to}
                  to={to}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    active ? 'bg-amber-500 text-black' : 'hover:opacity-80'
                  }`}
                  style={active ? {} : { color: 'var(--text-secondary)' }}
                >
                  {label}
                </Link>
              )
            })}
          </nav>
        )}

        <div className="flex-1" />

        {/* Connection indicator */}
        <div className="flex items-center gap-1.5 text-xs shrink-0">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-500'}`} />
          <span className="hidden sm:inline" style={{ color: 'var(--text-muted)' }}>
            {connected ? 'Live' : 'Offline'}
          </span>
        </div>

        {/* Theme selector */}
        <ThemeSelector />

        {/* Dashboard shortcut */}
        {user && (
          <Link
            to={dashPath}
            className="hidden sm:inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border transition-colors hover:opacity-80"
            style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
          >
            Dashboard
          </Link>
        )}

        {/* Auth / profile */}
        {user ? (
          <div className="relative shrink-0" ref={profileRef}>
            <button
              onClick={() => setProfileOpen(v => !v)}
              className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center text-sm font-bold text-black focus:outline-none focus:ring-2 focus:ring-amber-400"
              aria-label="Profile menu"
              title={user.name}
            >
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt=""
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                (user.name || '?').charAt(0).toUpperCase()
              )}
            </button>

            {profileOpen && (
              <div
                className="absolute right-0 top-full mt-2 w-48 rounded-xl border shadow-xl z-50 overflow-hidden"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
              >
                <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border-color)' }}>
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                    {user.name}
                  </p>
                  <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                    {user.email}
                  </p>
                </div>

                <nav className="py-1">
                  {[
                    { to: dashPath,         label: '🏠 Dashboard'     },
                    { to: '/profile',       label: '👤 Profile'       },
                    { to: '/inbox',         label: '💬 Inbox'         },
                    { to: '/rides',         label: '🚗 Rides'         },
                    { to: '/tourist-sites', label: '🗺️ Tourist Sites' },
                  ].map(({ to, label }) => (
                    <Link
                      key={to}
                      to={to}
                      onClick={() => setProfileOpen(false)}
                      className="block px-4 py-2 text-sm transition-colors hover:opacity-80"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {label}
                    </Link>
                  ))}
                  {admin && (
                    <Link
                      to="/const"
                      onClick={() => setProfileOpen(false)}
                      className="block px-4 py-2 text-sm transition-colors hover:opacity-80"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      🛠 Admin
                    </Link>
                  )}
                </nav>

                <div className="border-t" style={{ borderColor: 'var(--border-color)' }}>
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-2 text-sm text-red-400 hover:text-red-300 transition-colors"
                  >
                    Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : user === false ? (
          <button
            onClick={onLogin}
            className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors bg-amber-500 hover:bg-amber-400 text-black"
          >
            Sign In
          </button>
        ) : null /* loading */ }

        {/* Mobile hamburger (no back mode) */}
        {!backPath && (
          <div className="relative md:hidden shrink-0" ref={menuRef}>
            <button
              className="p-2 rounded-lg transition-colors hover:opacity-80"
              style={{ color: 'var(--text-secondary)' }}
              onClick={() => setMenuOpen(v => !v)}
              aria-label="Menu"
            >
              {menuOpen ? '✕' : '☰'}
            </button>

            {menuOpen && (
              <div
                className="absolute right-0 top-full mt-1 w-56 rounded-xl border shadow-xl z-50 overflow-hidden"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
              >
                <nav className="py-2">
                  {NAV_LINKS.map(({ to, label }) => (
                    <Link
                      key={to}
                      to={to}
                      className="block px-4 py-2 text-sm transition-colors hover:opacity-80"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {label}
                    </Link>
                  ))}
                  {user && (
                    <>
                      <div className="border-t my-1" style={{ borderColor: 'var(--border-color)' }} />
                      <Link
                        to={dashPath}
                        className="block px-4 py-2 text-sm transition-colors hover:opacity-80"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        🏠 Dashboard
                      </Link>
                      <Link
                        to="/profile"
                        className="block px-4 py-2 text-sm transition-colors hover:opacity-80"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        👤 Profile
                      </Link>
                    </>
                  )}
                  {admin && (
                    <Link
                      to="/const"
                      className="block px-4 py-2 text-sm transition-colors hover:opacity-80"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      🛠 Admin
                    </Link>
                  )}
                  {user === false && (
                    <button
                      onClick={() => { setMenuOpen(false); onLogin?.() }}
                      className="block w-full text-left px-4 py-2 text-sm text-amber-400 hover:text-amber-300 transition-colors"
                    >
                      Sign In / Register
                    </button>
                  )}
                </nav>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
