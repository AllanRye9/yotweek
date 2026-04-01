/**
 * AgentsPage — Dedicated page for agent registration and status.
 *
 * Allows users to register as property agents. Registered and approved
 * agents gain the ability to post and manage property listings.
 */

import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import UserAuth from '../components/UserAuth'
import UserProfile from '../components/UserProfile'
import AgentRegistration from '../components/AgentRegistration'
import { getUserProfile } from '../api'

export default function AgentsPage() {
  const [appUser, setAppUser]           = useState(null)
  const [userLoading, setUserLoading]   = useState(true)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [profileOpen, setProfileOpen]   = useState(false)
  const profileRef = useRef(null)

  useEffect(() => {
    getUserProfile()
      .then(u => setAppUser(u))
      .catch(() => setAppUser(false))
      .finally(() => setUserLoading(false))
  }, [])

  useEffect(() => {
    const h = (e) => { if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-page)', display: 'flex', flexDirection: 'column' }}>
      {showAuthModal && !appUser && (
        <UserAuth
          onSuccess={u => { setAppUser(u); setShowAuthModal(false) }}
          onClose={() => setShowAuthModal(false)}
        />
      )}

      {/* ── Navbar ── */}
      <header style={{
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-color)',
        padding: '12px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link to="/" style={{ color: '#3b82f6', fontWeight: 800, fontSize: '1.15rem', textDecoration: 'none' }}>
            🏠 YOT
          </Link>
          <nav style={{ display: 'flex', gap: 12 }}>
            <Link to="/" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textDecoration: 'none' }}>Home</Link>
            <Link to="/properties" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textDecoration: 'none' }}>Properties</Link>
            <Link to="/agents" style={{ color: '#3b82f6', fontSize: '0.85rem', fontWeight: 600, textDecoration: 'none' }}>Agents</Link>
            <Link to="/property-inbox" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textDecoration: 'none' }}>Inbox</Link>
          </nav>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div ref={profileRef} style={{ position: 'relative' }}>
            {userLoading ? null : appUser ? (
              <div>
                <button
                  type="button"
                  onClick={() => setProfileOpen(o => !o)}
                  style={{
                    background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 8,
                    padding: '6px 12px', color: 'var(--text-primary)', fontSize: '0.82rem', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  {appUser.avatar_url ? (
                    <img src={appUser.avatar_url} alt="" style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ fontSize: '1rem' }}>👤</span>
                  )}
                  {appUser.name}
                </button>
                {profileOpen && (
                  <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 200 }}>
                    <UserProfile user={appUser} onUpdate={u => { setAppUser(u); setProfileOpen(false) }} />
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowAuthModal(true)}
                style={{
                  background: '#3b82f6', color: '#fff', border: 'none',
                  borderRadius: 8, padding: '7px 16px', fontSize: '0.82rem',
                  fontWeight: 600, cursor: 'pointer',
                }}
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── Page content ── */}
      <main style={{ flex: 1, padding: '32px 20px', maxWidth: 680, margin: '0 auto', width: '100%' }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ color: 'var(--text-primary)', fontSize: '1.6rem', fontWeight: 800, margin: '0 0 6px' }}>
            🧑‍💼 Agent Registration
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: 0 }}>
            Register as a verified property agent to list and manage properties on our platform.
          </p>
        </div>

        {appUser ? (
          <AgentRegistration />
        ) : (
          <div style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 12,
            padding: '24px',
            textAlign: 'center',
          }}>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 16, fontSize: '0.9rem' }}>
              Sign in to register as an agent or check your application status.
            </p>
            <button
              type="button"
              onClick={() => setShowAuthModal(true)}
              style={{
                background: '#3b82f6', color: '#fff', border: 'none',
                borderRadius: 8, padding: '9px 20px', fontSize: '0.85rem',
                fontWeight: 600, cursor: 'pointer',
              }}
            >
              Sign In to Continue
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
