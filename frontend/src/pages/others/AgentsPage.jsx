/**
 * AgentsPage — Dedicated page for agent registration and status.
 *
 * Users can apply to become a property agent, check their application
 * status, and learn about the benefits of being a listed agent.
 */

import { useState, useEffect } from 'react'
import NavBar from '../components/NavBar'
import AgentRegistration from '../components/AgentRegistration'
import UserAuth from '../components/UserAuth'
import { getUserProfile } from '../api'

export default function AgentsPage() {
  const [appUser,      setAppUser]      = useState(null)
  const [showAuthModal,setShowAuthModal]= useState(false)

  useEffect(() => {
    getUserProfile()
      .then(u => setAppUser(u))
      .catch(() => setAppUser(false))
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-page)', display: 'flex', flexDirection: 'column' }}>
      {showAuthModal && !appUser && (
        <UserAuth
          onSuccess={u => { setAppUser(u); setShowAuthModal(false) }}
          onClose={() => setShowAuthModal(false)}
        />
      )}

      {/* Shared NavBar */}
      <NavBar
        user={appUser}
        onLogin={() => setShowAuthModal(true)}
        title="Agents"
      />

      {/* ── Page header ── */}
      <div style={{ padding: '24px 20px 0', maxWidth: 720, margin: '0 auto', width: '100%' }}>
        <h1 style={{ color: 'var(--text-primary)', fontSize: '1.6rem', fontWeight: 800, margin: '0 0 6px' }}>
          🧑‍💼 Agent Registration
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: '0 0 24px' }}>
          Join our network of verified property agents. Submit your application below and an admin will review it shortly.
        </p>
      </div>

      {/* ── Registration form ── */}
      <div style={{ flex: 1, padding: '0 20px 40px', maxWidth: 720, margin: '0 auto', width: '100%' }}>
        {appUser ? (
          <AgentRegistration />
        ) : (
          <div style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border-color)',
            borderRadius: 16, padding: '32px 24px', textAlign: 'center',
          }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 16 }}>
              Please sign in to apply as an agent or check your application status.
            </p>
            <button
              type="button"
              onClick={() => setShowAuthModal(true)}
              style={{
                background: '#3b82f6', color: '#fff', border: 'none',
                borderRadius: 8, padding: '10px 24px', fontSize: '0.9rem',
                fontWeight: 600, cursor: 'pointer',
              }}
            >
              Sign In to Continue
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
