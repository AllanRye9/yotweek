/**
 * PrivacyPage — Privacy Policy for yotweek.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import NavBar from '../components/NavBar'
import { getUserProfile } from '../api'

const LAST_UPDATED = 'April 2025'

const SECTIONS = [
  {
    title: '1. Introduction',
    body: `yotweek ("we", "our", or "us") is committed to protecting the privacy of all users of the
yotweek platform (the "Platform"). This Privacy Policy explains what personal data we collect, why
we collect it, how we use and protect it, and your rights in relation to that data.

By using the Platform you agree to the collection and use of information as described in this
policy. If you do not agree, please do not use the Platform.`,
  },
  {
    title: '2. Data We Collect',
    body: `We collect the following categories of personal data:

Registration data
  • Email address
  • Display name and username
  • Password (stored as a secure hash — we never store plain-text passwords)

Profile data (optional)
  • Avatar or profile photo
  • Home city or general location (used to pre-fill map coordinates)
  • Vehicle details (drivers only)

Platform activity data
  • Ride posts you create (origin, destination, fare, departure time)
  • Messages sent through the inbox and ride chats
  • Reviews and ratings you submit
  • Live location coordinates you broadcast as a driver
  • Location pins you share in chat

Technical data
  • IP address and approximate geolocation
  • Browser type, operating system, and device identifiers
  • Pages visited and features used (anonymised analytics)
  • Session tokens`,
  },
  {
    title: '3. How We Use Your Data',
    body: `We use the data we collect solely to operate and improve the Platform:

  • To create and manage your account.
  • To display rides, match passengers with drivers, and facilitate messaging.
  • To show your broadcast location on the live driver map (drivers only, when enabled).
  • To send real-time notifications (new messages, proximity alerts, ride updates).
  • To send transactional emails such as password reset links.
  • To moderate content and investigate reports of abuse.
  • To detect and prevent fraud, spam, and security incidents.
  • To improve Platform performance and fix bugs (using anonymised analytics).

We do not use your data for automated decision-making or profiling that produces legal or similarly
significant effects.`,
  },
  {
    title: '4. Legal Basis for Processing',
    body: `Where data protection law requires a legal basis for processing personal data, we rely on:

  • Contractual necessity — to provide the services described in our Terms of Service.
  • Legitimate interests — to operate and improve the Platform, prevent abuse, and ensure security.
  • Consent — for optional features such as location broadcasting.
  • Legal obligation — to comply with applicable law where required.`,
  },
  {
    title: '5. Data Sharing',
    body: `We do not sell, rent, or share your personal data with third parties for marketing purposes.

We share data only in the following limited circumstances:

  • With other users — Your display name, avatar, and driver details are visible to other Platform
    users as part of ride listings and chat threads.
  • With service providers — We use infrastructure providers (hosting, database, email) who process
    data solely on our behalf under data-processing agreements.
  • For legal compliance — We may disclose data if required to do so by law, court order, or to
    protect the rights and safety of our users or the public.`,
  },
  {
    title: '6. Message Encryption',
    body: `All direct messages and ride chats transmitted through the Platform are end-to-end encrypted.
This means that message content is encrypted on your device before transmission and can only be
decrypted by the intended recipient. yotweek staff cannot read the content of your messages.

Location pins shared inside a chat are visible only to participants of that conversation.`,
  },
  {
    title: '7. Location Data',
    body: `Location data is handled as follows:

Driver broadcast location
  When a driver enables "Broadcast Location," their GPS coordinates are transmitted to our server and
  displayed on the live map for all logged-in users. This broadcast is active only while the driver
  has the feature enabled and ceases when they disable it or close the app.

Location pins in chat
  When you share a location pin in a chat, only the participants of that conversation can see it.

Profile location
  If you set a home city or coordinates on your profile, this is used only to pre-fill map defaults
  and is not shared publicly.`,
  },
  {
    title: '8. Data Retention',
    body: `We retain your data for as long as your account is active or as needed to provide the service.
Specifically:

  • Account data is retained until you delete your account.
  • Ride listings are retained for 12 months after the ride departure date.
  • Messages are retained for 24 months after the date sent.
  • Driver location broadcasts are not stored — they are transmitted in real time and not persisted.
  • Analytics data is anonymised and retained indefinitely.

After account deletion, your personal data is purged within 30 days, except where retention is
required by law.`,
  },
  {
    title: '9. Your Rights',
    body: `Depending on your jurisdiction, you may have the following rights regarding your personal data:

  • Access — Request a copy of the data we hold about you.
  • Correction — Request correction of inaccurate or incomplete data.
  • Deletion — Request deletion of your personal data ("right to be forgotten").
  • Portability — Request a machine-readable copy of your data.
  • Objection — Object to certain types of processing.
  • Withdrawal of consent — Withdraw consent at any time where processing is based on consent.

To exercise any of these rights, contact us at support@yotweek.com. We will respond within 30 days.`,
  },
  {
    title: '10. Cookies and Local Storage',
    body: `yotweek uses browser local storage (not third-party tracking cookies) to:

  • Maintain your login session.
  • Remember your theme preference (dark / light / ocean).
  • Cache ride and message data for faster loading.

We do not use advertising cookies or third-party tracking scripts.`,
  },
  {
    title: '11. Children\'s Privacy',
    body: `The Platform is not directed at children under the age of 18. We do not knowingly collect
personal data from anyone under 18. If you believe a minor has created an account, please contact
us at support@yotweek.com and we will promptly delete the account and associated data.`,
  },
  {
    title: '12. Security',
    body: `We take reasonable technical and organisational measures to protect your personal data from
unauthorised access, loss, or disclosure, including:

  • HTTPS (TLS) for all data in transit.
  • End-to-end encryption for all messages.
  • Hashed and salted password storage.
  • Access controls limiting staff access to personal data.

No method of transmission over the Internet is 100 % secure. We cannot guarantee absolute security
and encourage you to use a strong unique password and to log out of shared devices.`,
  },
  {
    title: '13. Third-Party Services',
    body: `The Platform uses OpenStreetMap tiles for map rendering. Map data is fetched from public OSM
servers; no personal data is transmitted to OpenStreetMap beyond your IP address in the HTTP
request headers (standard for any web request).

The Platform also optionally integrates with Nominatim for geocoding (converting place names to
coordinates). No personal data is stored by Nominatim.`,
  },
  {
    title: '14. Changes to This Policy',
    body: `We may update this Privacy Policy from time to time. We will notify registered users of material
changes by email or by displaying a prominent notice on the Platform. The date at the top of this
page reflects the most recent revision.`,
  },
  {
    title: '15. Contact Us',
    body: `If you have questions or concerns about this Privacy Policy or how we handle your personal data,
please contact us:

  Email: support@yotweek.com`,
  },
]

export default function PrivacyPage() {
  const [appUser, setAppUser] = useState(null)

  useEffect(() => {
    getUserProfile()
      .then(u => setAppUser(u))
      .catch(() => setAppUser(false))
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-page)', display: 'flex', flexDirection: 'column' }}>
      <NavBar user={appUser} onLogin={() => {}} title="Privacy Policy" />

      {/* Header */}
      <div style={{ padding: '32px 24px 24px', borderBottom: '1px solid var(--border-color)' }}>
        <h1 style={{ color: 'var(--text-primary)', fontSize: '1.7rem', fontWeight: 800, margin: '0 0 6px' }}>
          🔒 Privacy Policy
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', margin: 0 }}>
          Last updated: {LAST_UPDATED}
        </p>
      </div>

      <main style={{ flex: 1, maxWidth: 760, margin: '0 auto', padding: '36px 24px', width: '100%' }}>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: 32 }}>
          This Privacy Policy describes how yotweek collects, uses, and protects your personal
          information when you use our ride-sharing platform. We are committed to transparency and
          to giving you meaningful control over your data.
        </p>

        {SECTIONS.map(s => (
          <section key={s.title} style={{ marginBottom: 36 }}>
            <h2
              style={{
                color: 'var(--text-primary)',
                fontSize: '1rem',
                fontWeight: 700,
                marginBottom: 12,
              }}
            >
              {s.title}
            </h2>
            <p
              style={{
                color: 'var(--text-secondary)',
                fontSize: '0.85rem',
                lineHeight: 1.85,
                margin: 0,
                whiteSpace: 'pre-line',
              }}
            >
              {s.body}
            </p>
          </section>
        ))}
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
          <Link to="/faq" style={{ color: 'inherit' }}>FAQ</Link> ·{' '}
          <Link to="/terms" style={{ color: 'inherit' }}>Terms of Service</Link>
        </p>
      </footer>
    </div>
  )
}
