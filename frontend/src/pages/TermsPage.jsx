/**
 * TermsPage — Terms of Service for yotweek.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import NavBar from '../components/NavBar'
import { getUserProfile } from '../api'

const LAST_UPDATED = 'April 2025'

const SECTIONS = [
  {
    title: '1. Acceptance of Terms',
    body: `By accessing or using yotweek (the "Platform"), you agree to be bound by these Terms of
Service ("Terms"). If you do not agree with any part of these Terms, you may not use the Platform.

We may update these Terms from time to time. We will notify registered users of material changes by
email or by displaying a notice on the Platform. Continued use of the Platform after an update
constitutes acceptance of the revised Terms.`,
  },
  {
    title: '2. Description of Service',
    body: `yotweek is a free, community-driven ride-sharing platform that facilitates connections between
passengers seeking rides and drivers offering seats. The Platform provides tools including a live
driver location map, real-time messaging, journey confirmation, and proximity notifications.

yotweek is a technology platform only. We are not a transportation carrier, taxi company, or
transport service. All ride arrangements are made directly between passengers and drivers. yotweek
does not own vehicles, employ drivers, or guarantee the availability of any ride.`,
  },
  {
    title: '3. Eligibility',
    body: `You must be at least 18 years old to create an account and use the Platform. By registering you
represent that:

  • You are at least 18 years of age.
  • You have the legal capacity to enter into a binding agreement.
  • You will provide accurate and complete registration information.
  • You will keep your account credentials confidential.

You are responsible for all activity that occurs under your account.`,
  },
  {
    title: '4. User Accounts',
    body: `To access most features of the Platform you must register for a free account. When you register
you agree to provide truthful information and to keep it up to date.

You must not share your account credentials with any other person. You are solely responsible for
maintaining the security of your account. Notify us immediately at support@yotweek.com if you
suspect unauthorised access to your account.

We reserve the right to suspend or terminate accounts that violate these Terms, engage in fraudulent
activity, or pose a safety risk to other users.`,
  },
  {
    title: '5. Driver Verification',
    body: `Drivers who wish to broadcast their location and post rides must complete the driver
verification process by submitting valid vehicle details and identification. A verified badge
indicates that the submitted documents have been reviewed.

Verification does not constitute an endorsement of a driver's character, driving ability, or
fitness to transport passengers. Passengers are responsible for their own judgment when choosing
to ride with a driver.`,
  },
  {
    title: '6. Acceptable Use',
    body: `You agree not to use the Platform to:

  • Post false, misleading, or fraudulent ride listings.
  • Harass, threaten, or intimidate other users.
  • Share content that is illegal, defamatory, obscene, or infringes intellectual-property rights.
  • Collect or harvest other users' personal data without consent.
  • Circumvent, disable, or interfere with security features of the Platform.
  • Use automated scripts, bots, or crawlers to access the Platform without prior written consent.
  • Impersonate any person or entity.

We reserve the right to remove any content and suspend any account that violates this section.`,
  },
  {
    title: '7. Fares and Payments',
    body: `All fares displayed on the Platform are calculated automatically based on origin and destination
coordinates using the rate set by the driver. Fares are agreed directly between the passenger and
the driver. yotweek does not process, hold, or guarantee any payment.

Any financial dispute arising from a ride arrangement is solely between the passenger and the
driver. yotweek is not a party to these transactions and accepts no liability for payment
disagreements.`,
  },
  {
    title: '8. Content',
    body: `You retain ownership of content you submit to the Platform (messages, reviews, profile
information). By submitting content you grant yotweek a non-exclusive, worldwide, royalty-free
licence to store, display, and transmit that content solely for the purpose of operating the
Platform.

You represent that you have the right to submit any content you post, and that it does not violate
any third-party rights or applicable law.

Reviews and ratings must be honest and based on genuine experience. We reserve the right to remove
reviews that we determine in our sole discretion to be fake, defamatory, or otherwise in violation
of these Terms.`,
  },
  {
    title: '9. Privacy',
    body: `Our Privacy Policy, available at /privacy, explains how we collect, use, and protect your
personal information. By using the Platform you agree to the collection and use of information in
accordance with that policy.`,
  },
  {
    title: '10. Limitation of Liability',
    body: `To the fullest extent permitted by applicable law:

  • yotweek is provided on an "as is" and "as available" basis without warranty of any kind.
  • We do not warrant that the Platform will be uninterrupted, error-free, or secure.
  • We are not liable for any indirect, incidental, special, consequential, or punitive damages
    arising from your use of the Platform.
  • We are not liable for any harm arising from a ride arrangement facilitated through the Platform,
    including personal injury, property damage, or financial loss.

Our total aggregate liability for any claim arising out of these Terms shall not exceed the greater
of (a) the amount you paid us in the twelve months preceding the claim or (b) USD 50.00.`,
  },
  {
    title: '11. Indemnification',
    body: `You agree to indemnify and hold harmless yotweek and its officers, directors, employees, and
agents from any claim, demand, liability, loss, or expense (including reasonable legal fees) arising
from:

  • Your use of the Platform.
  • Your violation of these Terms.
  • Any ride arrangement you enter into through the Platform.
  • Your violation of any third-party right.`,
  },
  {
    title: '12. Termination',
    body: `We may suspend or terminate your access to the Platform at any time, with or without notice,
for any reason including violation of these Terms.

You may delete your account at any time by contacting support@yotweek.com. Upon termination, your
right to use the Platform ceases immediately. Provisions of these Terms that by their nature should
survive termination will continue to apply.`,
  },
  {
    title: '13. Governing Law',
    body: `These Terms are governed by and construed in accordance with applicable law. Any dispute arising
from these Terms or your use of the Platform shall be resolved through good-faith negotiation in
the first instance. If negotiation fails, disputes shall be submitted to the competent courts of
the jurisdiction in which yotweek is registered.`,
  },
  {
    title: '14. Contact',
    body: `If you have questions about these Terms, please contact us at support@yotweek.com.`,
  },
]

export default function TermsPage() {
  const [appUser, setAppUser] = useState(null)

  useEffect(() => {
    getUserProfile()
      .then(u => setAppUser(u))
      .catch(() => setAppUser(false))
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-page)', display: 'flex', flexDirection: 'column' }}>
      <NavBar user={appUser} onLogin={() => {}} title="Terms of Service" />

      {/* Header */}
      <div style={{ padding: '32px 24px 24px', borderBottom: '1px solid var(--border-color)' }}>
        <h1 style={{ color: 'var(--text-primary)', fontSize: '1.7rem', fontWeight: 800, margin: '0 0 6px' }}>
          📋 Terms of Service
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', margin: 0 }}>
          Last updated: {LAST_UPDATED}
        </p>
      </div>

      <main style={{ flex: 1, maxWidth: 760, margin: '0 auto', padding: '36px 24px', width: '100%' }}>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: 32 }}>
          Please read these Terms of Service carefully before using yotweek. These Terms govern your
          access to and use of the yotweek platform, including the website at yotweek.com and the
          associated mobile applications.
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
          <Link to="/privacy" style={{ color: 'inherit' }}>Privacy Policy</Link>
        </p>
      </footer>
    </div>
  )
}
