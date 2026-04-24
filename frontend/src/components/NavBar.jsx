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
import ThemeSelector from './ThemeSelector'
import { userLogout } from '../api'
import { getDashboardPath } from '../routing'
import socket from '../socket'

const NAV_LINKS = []

export default function NavBar({ user, onLogout, onLogin, title, backPath }) {
  const navigate  = useNavigate()
  const location  = useLocation()

  const [menuOpen,  setMenuOpen]  = useState(false)
  const [connected, setConnected] = useState(socket.connected)
  const menuRef = useRef(null)

  // Streak: days since account creation (capped at 30 for display purposes)
  const streakDays = user?.created_at
    ? Math.min(Math.floor((Date.now() - new Date(user.created_at).getTime()) / 86400000) + 1, 30)
    : 0

  // Track socket connection state
  useEffect(() => {
    const onConnect    = () => {
      setConnected(true)
      // Re-identify after reconnection
      if (user?.user_id) socket.emit('identify', { user_id: user.user_id })
    }
    const onDisconnect = () => setConnected(false)
    socket.on('connect',    onConnect)
    socket.on('disconnect', onDisconnect)
    setConnected(socket.connected)
    return () => {
      socket.off('connect',    onConnect)
      socket.off('disconnect', onDisconnect)
    }
  }, [user?.user_id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Identify socket with user_id whenever user becomes available
  useEffect(() => {
    if (user?.user_id) socket.emit('identify', { user_id: user.user_id })
  }, [user?.user_id])

  // Close mobile menu on outside click
  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Close mobile menu on route change
  useEffect(() => { setMenuOpen(false) }, [location.pathname])

  const handleLogout = async () => {
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

        {/* Feed & Group Trips shortcuts */}
        {user && (
          <>
            <Link
              to="/feed"
              className="hidden md:inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border transition-colors hover:opacity-80"
              style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
            >
              Feed
            </Link>
            <Link
              to="/group-trips"
              className="hidden md:inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border transition-colors hover:opacity-80"
              style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
            >
              Group Trips
            </Link>
          </>
        )}

        {/* Notifications bell */}
        {user && (
          <Link
            to="/notifications"
            className="relative w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:opacity-80 shrink-0"
            style={{ color: 'var(--text-secondary)' }}
            aria-label="Notifications"
          >
            🔔
          </Link>
        )}

        {/* Auth / profile — top-right avatar always links directly to /profile */}
        {user ? (
          <>
            {streakDays > 0 && (
              <span
                className="hidden sm:inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full shrink-0"
                style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.3)' }}
                title={`${streakDays}-day streak`}
              >
                🔥 {streakDays}
              </span>
            )}
            <Link
              to="/profile"
              className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center text-sm font-bold text-black focus:outline-none focus:ring-2 focus:ring-amber-400 shrink-0 overflow-hidden"
              aria-label="Profile"
              title={user.name}
            >
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt=""
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                  <circle cx="20" cy="20" r="20" fill="#b45309"/>
                  <circle cx="20" cy="15" r="7" fill="#fef3c7"/>
                  <ellipse cx="20" cy="34" rx="12" ry="8" fill="#fef3c7"/>
                </svg>
              )}
            </Link>
          </>
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
                  {user && (
                    <>
                      <Link
                        to={dashPath}
                        className="block px-4 py-2 text-sm transition-colors hover:opacity-80"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        🏠 Dashboard
                      </Link>
                      <Link
                        to="/feed"
                        className="block px-4 py-2 text-sm transition-colors hover:opacity-80"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        📰 Feed
                      </Link>
                      <Link
                        to="/group-trips"
                        className="block px-4 py-2 text-sm transition-colors hover:opacity-80"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        ✈️ Group Trips
                      </Link>
                      <Link
                        to="/profile"
                        className="block px-4 py-2 text-sm transition-colors hover:opacity-80"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        👤 Profile
                      </Link>
                      <Link
                        to="/notifications"
                        className="block px-4 py-2 text-sm transition-colors hover:opacity-80"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        🔔 Notifications
                      </Link>
                      <div className="border-t my-1" style={{ borderColor: 'var(--border-color)' }} />
                      <button
                        onClick={handleLogout}
                        className="block w-full text-left px-4 py-2 text-sm text-red-400 hover:text-red-300 transition-colors"
                      >
                        Sign Out
                      </button>
                    </>
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
