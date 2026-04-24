import { useState } from 'react'
import { triggerSOS } from '../api'

export default function SOSButton({ isLoggedIn }) {
  const [phase,   setPhase]   = useState('idle') // idle | confirm | sending | done | error
  const [message, setMessage] = useState('')

  if (!isLoggedIn) return null

  const handleClick = () => {
    if (phase === 'idle') setPhase('confirm')
  }

  const handleConfirm = () => {
    setPhase('sending')
    if (!navigator.geolocation) {
      send(null, null)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => send(pos.coords.latitude, pos.coords.longitude),
      ()    => send(null, null),
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }

  const send = async (lat, lng) => {
    try {
      await triggerSOS({ latitude: lat, longitude: lng })
      setMessage('🆘 SOS sent! Emergency contacts have been notified.')
      setPhase('done')
    } catch (err) {
      setMessage(err.message || 'Failed to send SOS.')
      setPhase('error')
    }
  }

  const handleCancel = () => {
    setPhase('idle')
    setMessage('')
  }

  const handleDismiss = () => {
    setPhase('idle')
    setMessage('')
  }

  return (
    <>
      {/* Fixed SOS button */}
      <button
        onClick={handleClick}
        aria-label="Emergency SOS"
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 9999,
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: '#dc2626',
          border: '3px solid #fca5a5',
          color: '#fff',
          fontSize: '0.75rem',
          fontWeight: 900,
          cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(220,38,38,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'transform 0.15s, box-shadow 0.15s',
          letterSpacing: '0.03em',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.boxShadow = '0 6px 24px rgba(220,38,38,0.7)' }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(220,38,38,0.5)' }}
      >
        SOS
      </button>

      {/* Confirmation modal */}
      {phase === 'confirm' && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--bg-card, #1f2937)', border: '1px solid rgba(220,38,38,0.5)', borderRadius: 16, padding: '24px 28px', maxWidth: 360, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize: '2.5rem', textAlign: 'center', marginBottom: 12 }}>🆘</div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f87171', textAlign: 'center', marginBottom: 8 }}>Emergency SOS</h2>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary, #9ca3af)', textAlign: 'center', lineHeight: 1.55, marginBottom: 20 }}>
              Are you sure? This will send an emergency alert with your GPS location to your trusted contacts.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={handleCancel}
                style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid var(--border-color, #374151)', background: 'transparent', color: 'var(--text-secondary, #9ca3af)', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: '#dc2626', color: '#fff', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer' }}
              >
                Send SOS
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sending spinner */}
      {phase === 'sending' && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg-card, #1f2937)', borderRadius: 16, padding: '32px 40px', textAlign: 'center', color: 'var(--text-primary, #f9fafb)' }}>
            <div style={{ fontSize: '2rem', marginBottom: 12 }}>📡</div>
            <p style={{ fontWeight: 600 }}>Sending SOS…</p>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted, #6b7280)', marginTop: 4 }}>Getting your location…</p>
          </div>
        </div>
      )}

      {/* Result feedback */}
      {(phase === 'done' || phase === 'error') && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--bg-card, #1f2937)', border: `1px solid ${phase === 'done' ? 'rgba(16,185,129,0.4)' : 'rgba(248,113,113,0.4)'}`, borderRadius: 16, padding: '24px 28px', maxWidth: 360, width: '100%', textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>{phase === 'done' ? '✅' : '❌'}</div>
            <p style={{ fontSize: '0.95rem', fontWeight: 600, color: phase === 'done' ? '#34d399' : '#f87171', marginBottom: 12 }}>{message}</p>
            {phase === 'done' && (
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted, #6b7280)', marginBottom: 16 }}>
                Stay calm. Help is on the way. You can also call local emergency services.
              </p>
            )}
            <button
              onClick={handleDismiss}
              style={{ padding: '9px 24px', borderRadius: 10, border: '1px solid var(--border-color, #374151)', background: 'transparent', color: 'var(--text-secondary, #9ca3af)', fontWeight: 600, cursor: 'pointer' }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </>
  )
}
