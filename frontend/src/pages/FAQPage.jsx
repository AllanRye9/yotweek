/**
 * FAQPage — Frequently asked questions about yotweek.
 */
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import NavBar from '../components/NavBar'
import { getUserProfile } from '../api'

const SECTIONS = [
  {
    heading: 'Getting Started',
    items: [
      {
        q: 'Is yotweek free to use?',
        a: 'Yes — yotweek is completely free for both passengers and drivers. There are no subscription fees, no booking commissions, and no premium tiers. Fares are agreed directly between the passenger and driver.',
      },
      {
        q: 'Do I need an account to browse rides?',
        a: 'You can explore the public home page without an account, but you need a free account to browse available rides, view the live driver map, or send messages.',
      },
      {
        q: 'How do I create an account?',
        a: 'Click "Create Free Account" on the home page or visit /register. You only need an email address and a password. Verification is optional but recommended for drivers.',
      },
      {
        q: 'Is there a mobile app?',
        a: 'Yes. yotweek is available as a Flutter app for iOS and Android. The mobile app shares the same backend as the web platform, so all your rides, messages, and notifications sync instantly.',
      },
    ],
  },
  {
    heading: 'For Passengers',
    items: [
      {
        q: 'How do I find a ride?',
        a: 'After logging in, go to the Rides page (/rides) to see all available rides. You can sort by fare or departure time. Alternatively, open the Live Driver Map (/map) to see verified drivers currently near you.',
      },
      {
        q: 'How do I book a ride?',
        a: 'Open the ride you are interested in and click "Chat with driver." Introduce yourself in the ride chat and agree on pickup details. When ready, click "Confirm Journey" in the chat to send the driver your name and contact.',
      },
      {
        q: 'Will I be notified when the driver is nearby?',
        a: 'Yes. Drivers can send a proximity alert to all confirmed passengers from their dashboard. You will receive a real-time notification in the app and inbox when this alert is sent.',
      },
      {
        q: 'Can I cancel a booking?',
        a: 'Rides on yotweek are arranged directly between passengers and drivers. If you need to cancel, message the driver as early as possible through the ride chat so they can update their passenger list.',
      },
      {
        q: 'How is the fare calculated?',
        a: 'Drivers set a base fare when posting a ride. The platform auto-calculates the per-seat cost from the origin and destination coordinates. The final fare is always visible on the ride card before you start chatting.',
      },
    ],
  },
  {
    heading: 'For Drivers',
    items: [
      {
        q: 'How do I register as a driver?',
        a: 'Create a standard account and then go to your Profile page. Toggle "Register as Driver" and follow the steps to upload your vehicle details and identification. Your profile will show a verified badge once approved.',
      },
      {
        q: 'How do I post a ride?',
        a: 'Go to the Rides page and click "Post a Ride." Enter your origin, destination, departure time, available seats, and vehicle details. The fare is calculated automatically from your coordinates — you can adjust the base rate if needed.',
      },
      {
        q: 'How do I broadcast my location on the map?',
        a: 'From your Driver Dashboard, enable "Broadcast Location." Your position will appear on the live driver map and update automatically every 15 seconds for passengers nearby.',
      },
      {
        q: 'How do I see who has confirmed my ride?',
        a: 'Open your Driver Dashboard and select the ride. The "Confirmed Passengers" tab lists everyone who has confirmed their journey, including their name and contact details.',
      },
      {
        q: 'How do I send a proximity alert?',
        a: 'When you are approaching the pickup point, open your ride in the Driver Dashboard and click "Send Proximity Alert." All confirmed passengers will receive an instant notification.',
      },
    ],
  },
  {
    heading: 'Messaging & Inbox',
    items: [
      {
        q: 'Is messaging on yotweek private?',
        a: 'Yes. All direct messages and ride chats are end-to-end encrypted. Only the participants in a conversation can read its contents. yotweek staff cannot access message content.',
      },
      {
        q: 'What can I share in a chat?',
        a: 'You can send text, images, audio recordings, documents, and live location pins. The ride chat also includes the "Confirm Journey" button for passengers.',
      },
      {
        q: 'How do I find a previous conversation?',
        a: 'Open the Inbox (/inbox). All your direct messages and ride chats appear in a single unified thread list. Use the search bar at the top to find a conversation by driver or passenger name.',
      },
    ],
  },
  {
    heading: 'Safety & Trust',
    items: [
      {
        q: 'How does yotweek verify drivers?',
        a: 'Drivers submit their vehicle details and identification for review. Once approved, their profile displays a verified badge. Passengers can see a driver\'s rating and vehicle information before messaging them.',
      },
      {
        q: 'How do reviews work?',
        a: 'Any user can leave a star rating and written review on the platform. Reviews are displayed publicly on the home page and help passengers make informed decisions about which drivers to book.',
      },
      {
        q: 'What should I do if I have a safety concern?',
        a: 'If you experience or witness unsafe behaviour, contact us immediately at support@yotweek.com. Include as much detail as possible — ride ID, driver username, and a description of the incident.',
      },
    ],
  },
  {
    heading: 'Account & Privacy',
    items: [
      {
        q: 'How do I update my profile or password?',
        a: 'Go to your Profile page (/profile). From there you can update your display name, avatar, location, vehicle details, and password.',
      },
      {
        q: 'How do I delete my account?',
        a: 'Send an account deletion request to support@yotweek.com from the email address registered on your account. We will confirm deletion within 5 business days.',
      },
      {
        q: 'What data does yotweek collect?',
        a: 'We collect the information you provide when registering (email, name) and activity data needed to operate the platform (ride posts, messages, location broadcasts). We do not sell personal data to third parties. See our Privacy Policy for full details.',
      },
    ],
  },
]

function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false)
  return (
    <div
      style={{
        border: '1px solid var(--border-color)',
        borderRadius: 10,
        marginBottom: 8,
        background: 'var(--bg-card)',
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          background: 'none',
          border: 'none',
          padding: '14px 18px',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          color: 'var(--text-primary)',
          fontWeight: 600,
          fontSize: '0.9rem',
          lineHeight: 1.5,
        }}
        aria-expanded={open}
      >
        <span>{q}</span>
        <span
          style={{
            fontSize: '1.1rem',
            flexShrink: 0,
            transition: 'transform 0.2s',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            color: '#60a5fa',
          }}
        >
          ▾
        </span>
      </button>
      {open && (
        <div
          style={{
            padding: '0 18px 16px',
            color: 'var(--text-secondary)',
            fontSize: '0.85rem',
            lineHeight: 1.75,
            borderTop: '1px solid var(--border-color)',
            paddingTop: 14,
          }}
        >
          {a}
        </div>
      )}
    </div>
  )
}

export default function FAQPage() {
  const [appUser, setAppUser] = useState(null)

  useEffect(() => {
    getUserProfile()
      .then(u => setAppUser(u))
      .catch(() => setAppUser(false))
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-page)', display: 'flex', flexDirection: 'column' }}>
      <NavBar user={appUser} onLogin={() => {}} title="FAQ" />

      {/* Header */}
      <div style={{ padding: '32px 24px 24px', borderBottom: '1px solid var(--border-color)', textAlign: 'center' }}>
        <h1 style={{ color: 'var(--text-primary)', fontSize: '1.8rem', fontWeight: 800, margin: '0 0 10px' }}>
          ❓ Frequently Asked Questions
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: '0 auto', maxWidth: 540 }}>
          Everything you need to know about yotweek — from getting started to staying safe on the road.
        </p>
      </div>

      <main style={{ flex: 1, maxWidth: 760, margin: '0 auto', padding: '36px 24px', width: '100%' }}>
        {SECTIONS.map(section => (
          <section key={section.heading} style={{ marginBottom: 40 }}>
            <h2
              style={{
                color: '#60a5fa',
                fontSize: '1rem',
                fontWeight: 700,
                marginBottom: 16,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              {section.heading}
            </h2>
            {section.items.map(item => (
              <FAQItem key={item.q} q={item.q} a={item.a} />
            ))}
          </section>
        ))}

        {/* Still have questions */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: 14,
            padding: '28px 24px',
            textAlign: 'center',
            marginTop: 12,
          }}
        >
          <h2 style={{ color: 'var(--text-primary)', fontSize: '1.1rem', fontWeight: 700, marginBottom: 8 }}>
            Still have questions?
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 16 }}>
            Our support team is happy to help. Reach out at any time.
          </p>
          <a
            href="mailto:support@yotweek.com"
            style={{
              display: 'inline-block',
              padding: '10px 24px',
              background: '#2563eb',
              color: '#fff',
              borderRadius: 10,
              fontWeight: 600,
              fontSize: '0.9rem',
              textDecoration: 'none',
            }}
          >
            Email Support
          </a>
        </div>
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
          <Link to="/about" style={{ color: 'inherit' }}>About</Link> ·{' '}
          <Link to="/terms" style={{ color: 'inherit' }}>Terms</Link> ·{' '}
          <Link to="/privacy" style={{ color: 'inherit' }}>Privacy</Link>
        </p>
      </footer>
    </div>
  )
}
