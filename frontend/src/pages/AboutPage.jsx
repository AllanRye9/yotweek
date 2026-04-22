/**
 * AboutPage — Learn about the yotweek ride-sharing platform.
 */
import { Link } from 'react-router-dom'
import NavBar from '../components/NavBar'
import { useState, useEffect } from 'react'
import { getUserProfile } from '../api'

const FEATURES = [
  {
    icon: '🚗',
    title: 'Ride Share',
    body:
      'Drivers post airport or city rides with auto-calculated fares based on origin and destination coordinates. Passengers see animated ride cards, sort by fare or departure time, and connect with drivers instantly.',
  },
  {
    icon: '📍',
    title: 'Live Driver Map',
    body:
      'An interactive map shows verified drivers within your selected radius, updated every 15 seconds. Tap any driver card to view their vehicle details, rating, and distance from your location.',
  },
  {
    icon: '💬',
    title: 'Real-Time Messaging',
    body:
      'Every ride has a dedicated chat thread. Passengers and drivers exchange text, images, audio recordings, files, and live location pins through an end-to-end encrypted inbox — no third-party apps required.',
  },
  {
    icon: '✅',
    title: 'Journey Confirmation',
    body:
      'Passengers confirm their booking directly inside the ride chat by sharing their name and contact. Drivers receive an instant notification and can view all confirmed passengers from a single dashboard.',
  },
  {
    icon: '🔔',
    title: 'Proximity Alerts',
    body:
      'When a driver is approaching, they send a proximity alert that notifies all confirmed passengers in real time — no more waiting and wondering.',
  },
  {
    icon: '📱',
    title: 'Mobile App',
    body:
      'yotweek is available as a native Flutter app for iOS and Android, giving you the full platform experience — live map, inbox, ride posting, and notifications — on the go.',
  },
]

const HOW_IT_WORKS = [
  {
    step: '1',
    role: 'Passenger',
    actions: [
      'Create a free account and set your location.',
      'Browse available rides on the map or the rides page.',
      'Message the driver through the ride chat.',
      'Confirm your journey with your name and contact.',
      'Receive a proximity alert when the driver is near.',
    ],
  },
  {
    step: '2',
    role: 'Driver',
    actions: [
      'Register as a driver and upload your vehicle details.',
      'Post a ride with your origin, destination, and departure time — fare is calculated automatically.',
      'Broadcast your live location so passengers can find you on the map.',
      'Manage confirmed passengers from your driver dashboard.',
      'Send a proximity alert when you are close to the pickup point.',
    ],
  },
]

export default function AboutPage() {
  const [appUser, setAppUser] = useState(null)
  const [showAuthModal, setShowAuthModal] = useState(false)

  useEffect(() => {
    getUserProfile()
      .then(u => setAppUser(u))
      .catch(() => setAppUser(false))
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-page)', display: 'flex', flexDirection: 'column' }}>
      <NavBar user={appUser} onLogin={() => setShowAuthModal(true)} title="About" />

      {/* Hero */}
      <section
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)',
          padding: '48px 24px 40px',
          textAlign: 'center',
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        <h1 style={{ color: '#fff', fontSize: '2rem', fontWeight: 800, margin: '0 0 12px' }}>
          About <span style={{ color: '#60a5fa' }}>yotweek</span>
        </h1>
        <p
          style={{
            color: '#94a3b8',
            fontSize: '1rem',
            maxWidth: 600,
            margin: '0 auto 24px',
            lineHeight: 1.7,
          }}
        >
          yotweek is a free, community-driven ride-sharing platform that connects passengers with
          verified drivers through a live map, real-time messaging, and instant journey confirmation
          — no subscription, no hidden fees.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link
            to="/rides"
            style={{
              padding: '10px 24px',
              background: '#2563eb',
              color: '#fff',
              borderRadius: 10,
              fontWeight: 600,
              fontSize: '0.9rem',
              textDecoration: 'none',
            }}
          >
            Browse Rides
          </Link>
          <Link
            to="/register"
            style={{
              padding: '10px 24px',
              background: 'transparent',
              color: '#94a3b8',
              borderRadius: 10,
              fontWeight: 600,
              fontSize: '0.9rem',
              border: '1px solid #334155',
              textDecoration: 'none',
            }}
          >
            Create Free Account
          </Link>
        </div>
      </section>

      <main style={{ flex: 1, maxWidth: 860, margin: '0 auto', padding: '40px 24px', width: '100%' }}>

        {/* Mission */}
        <section style={{ marginBottom: 48 }}>
          <h2 style={{ color: 'var(--text-primary)', fontSize: '1.4rem', fontWeight: 700, marginBottom: 16 }}>
            Our Mission
          </h2>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: 14 }}>
            Ride sharing should be simple, affordable, and safe. yotweek was built to remove the
            barriers that keep drivers and passengers apart — complicated booking flows, expensive
            subscriptions, and unreliable communication.
          </p>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: 14 }}>
            Every feature on the platform — from the live driver map to the end-to-end encrypted
            inbox — is designed with one goal: connect people who need to get somewhere with drivers
            who are already heading there.
          </p>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
            yotweek is completely free to use. There are no subscription fees, no booking
            commissions, and no premium tiers. The fare displayed on each ride is agreed directly
            between the passenger and driver.
          </p>
        </section>

        {/* Features */}
        <section style={{ marginBottom: 48 }}>
          <h2 style={{ color: 'var(--text-primary)', fontSize: '1.4rem', fontWeight: 700, marginBottom: 24 }}>
            Platform Features
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 20,
            }}
          >
            {FEATURES.map(f => (
              <div
                key={f.title}
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 14,
                  padding: '20px 18px',
                }}
              >
                <div style={{ fontSize: '1.6rem', marginBottom: 10 }}>{f.icon}</div>
                <h3
                  style={{
                    color: 'var(--text-primary)',
                    fontSize: '0.95rem',
                    fontWeight: 700,
                    marginBottom: 8,
                  }}
                >
                  {f.title}
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.83rem', lineHeight: 1.7, margin: 0 }}>
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section style={{ marginBottom: 48 }}>
          <h2 style={{ color: 'var(--text-primary)', fontSize: '1.4rem', fontWeight: 700, marginBottom: 24 }}>
            How It Works
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 24 }}>
            {HOW_IT_WORKS.map(hw => (
              <div
                key={hw.role}
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 14,
                  padding: '22px 20px',
                }}
              >
                <h3
                  style={{
                    color: '#60a5fa',
                    fontSize: '1rem',
                    fontWeight: 700,
                    marginBottom: 14,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      background: '#1e3a5f',
                      borderRadius: '50%',
                      width: 28,
                      height: 28,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.85rem',
                      fontWeight: 800,
                      color: '#93c5fd',
                      flexShrink: 0,
                    }}
                  >
                    {hw.step}
                  </span>
                  For {hw.role}s
                </h3>
                <ol style={{ paddingLeft: 18, margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.8 }}>
                  {hw.actions.map((a, i) => (
                    <li key={i} style={{ marginBottom: 4 }}>{a}</li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </section>

        {/* Safety */}
        <section style={{ marginBottom: 48 }}>
          <h2 style={{ color: 'var(--text-primary)', fontSize: '1.4rem', fontWeight: 700, marginBottom: 16 }}>
            Safety &amp; Trust
          </h2>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: 14 }}>
            Every driver on yotweek goes through a verification process before their profile is
            marked as verified. Passengers can view a driver's rating, vehicle details, and distance
            from their location before initiating a booking.
          </p>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: 14 }}>
            All direct messages and ride chats are end-to-end encrypted. Location data shared in
            chat is only visible to conversation participants. yotweek never sells user data to
            third parties.
          </p>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
            Passengers can leave public reviews after a trip, helping build a transparent community
            of trustworthy drivers and reliable passengers.
          </p>
        </section>

        {/* Technology */}
        <section style={{ marginBottom: 48 }}>
          <h2 style={{ color: 'var(--text-primary)', fontSize: '1.4rem', fontWeight: 700, marginBottom: 16 }}>
            Technology
          </h2>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: 14 }}>
            yotweek is built on a modern, open-source technology stack. The web frontend uses
            React, Vite, and Tailwind CSS. The backend is a Python FastAPI server with Socket.IO
            for real-time WebSocket communication. Maps are powered by Leaflet and OpenStreetMap.
          </p>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
            The mobile app is built with Flutter, sharing the same backend API and Socket.IO
            channels as the web platform. It is available for both iOS and Android.
          </p>
        </section>

        {/* CTA */}
        <section
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: 16,
            padding: '32px 24px',
            textAlign: 'center',
          }}
        >
          <h2 style={{ color: 'var(--text-primary)', fontSize: '1.2rem', fontWeight: 700, marginBottom: 10 }}>
            Ready to get started?
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 20 }}>
            Create a free account in seconds and start sharing rides today.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link
              to="/register"
              style={{
                padding: '10px 28px',
                background: '#2563eb',
                color: '#fff',
                borderRadius: 10,
                fontWeight: 600,
                fontSize: '0.9rem',
                textDecoration: 'none',
              }}
            >
              Create Free Account
            </Link>
            <Link
              to="/faq"
              style={{
                padding: '10px 28px',
                background: 'transparent',
                color: 'var(--text-secondary)',
                borderRadius: 10,
                fontWeight: 600,
                fontSize: '0.9rem',
                border: '1px solid var(--border-color)',
                textDecoration: 'none',
              }}
            >
              Read the FAQ
            </Link>
          </div>
        </section>
      </main>

      <footer
        style={{
          borderTop: '1px solid var(--border-color)',
          padding: '20px 24px',
          textAlign: 'center',
          fontSize: '0.78rem',
          color: 'var(--text-secondary)',
        }}
      >
        <p>
          yotweek © {new Date().getFullYear()} ·{' '}
          <Link to="/" style={{ color: 'inherit' }}>Home</Link> ·{' '}
          <Link to="/faq" style={{ color: 'inherit' }}>FAQ</Link> ·{' '}
          <Link to="/terms" style={{ color: 'inherit' }}>Terms</Link> ·{' '}
          <Link to="/privacy" style={{ color: 'inherit' }}>Privacy</Link>
        </p>
      </footer>
    </div>
  )
}
