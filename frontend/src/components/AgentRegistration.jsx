import { useState, useEffect } from 'react'
import { submitAgentApplication, getAgentApplicationStatus } from '../api'

/**
 * AgentRegistration — Form for users to register as property agents.
 *
 * Only approved agents can post properties. Once submitted the application
 * goes to admin review. The component also shows the current application
 * status if one already exists.
 *
 * Props:
 *  onClose  - optional callback when the user dismisses the panel
 */
export default function AgentRegistration({ onClose }) {
  const [status,      setStatus]      = useState(null)   // existing application
  const [loading,     setLoading]     = useState(true)
  const [submitting,  setSubmitting]  = useState(false)
  const [error,       setError]       = useState('')
  const [success,     setSuccess]     = useState(false)

  // form fields
  const [fullName,       setFullName]       = useState('')
  const [email,          setEmail]          = useState('')
  const [phone,          setPhone]          = useState('')
  const [agencyName,     setAgencyName]     = useState('')
  const [licenseNumber,  setLicenseNumber]  = useState('')

  useEffect(() => {
    getAgentApplicationStatus()
      .then(res => { setStatus(res?.application || null) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!fullName.trim())          return setError('Full name is required.')
    if (!email.trim())             return setError('Email is required.')
    if (!licenseNumber.trim())     return setError('License or ID number is required.')

    setSubmitting(true)
    try {
      await submitAgentApplication({
        full_name:      fullName.trim(),
        email:          email.trim(),
        phone:          phone.trim(),
        agency_name:    agencyName.trim(),
        license_number: licenseNumber.trim(),
      })
      setSuccess(true)
      // Refresh status
      const res = await getAgentApplicationStatus()
      setStatus(res?.application || null)
    } catch (err) {
      setError(err.message || 'Submission failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-gray-400">
        <span>Loading…</span>
      </div>
    )
  }

  const statusBadge = {
    pending:  { label: 'Pending Review',  cls: 'bg-yellow-600/20 text-yellow-400 border-yellow-700' },
    approved: { label: 'Approved ✓',      cls: 'bg-green-600/20  text-green-400  border-green-700'  },
    rejected: { label: 'Rejected',        cls: 'bg-red-600/20    text-red-400    border-red-700'    },
  }

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-700 p-6 max-w-lg w-full mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-white">Agent Registration</h2>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 text-lg leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        )}
      </div>

      {/* Existing application status */}
      {status && (
        <div className={`mb-4 px-4 py-3 rounded-lg border text-sm ${statusBadge[status.status]?.cls || 'bg-gray-700 text-gray-300 border-gray-600'}`}>
          <p className="font-semibold">{statusBadge[status.status]?.label || status.status}</p>
          {status.status === 'pending' && (
            <p className="mt-1 text-xs opacity-80">Your application is under review. We will notify you once a decision has been made.</p>
          )}
          {status.status === 'approved' && (
            <p className="mt-1 text-xs opacity-80">You are a verified agent and can post properties.</p>
          )}
          {status.status === 'rejected' && (
            <p className="mt-1 text-xs opacity-80">Your application was not approved. You may re-submit with updated information.</p>
          )}
        </div>
      )}

      {/* Only show form if not already approved or pending */}
      {(!status || status.status === 'rejected') && !success && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-gray-400">
            Submit your details below to register as a property agent. Your application will be reviewed by an admin.
          </p>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Full Name *</label>
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Jane Smith"
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Email *</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="jane@agency.com"
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Phone Number</label>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="+1 555 000 0000"
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Agency Name (optional)</label>
            <input
              type="text"
              value={agencyName}
              onChange={e => setAgencyName(e.target.value)}
              placeholder="Smith Realty Ltd."
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">License / ID Number *</label>
            <input
              type="text"
              value={licenseNumber}
              onChange={e => setLicenseNumber(e.target.value)}
              placeholder="REA-123456"
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              required
            />
            <p className="mt-1 text-xs text-gray-500">Enter your professional real-estate license or business registration number.</p>
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
          >
            {submitting ? 'Submitting…' : 'Submit Application'}
          </button>
        </form>
      )}

      {success && (
        <div className="text-center py-4">
          <p className="text-2xl mb-2">✅</p>
          <p className="text-white font-semibold">Application submitted!</p>
          <p className="text-sm text-gray-400 mt-1">You will receive a notification once your application has been reviewed.</p>
        </div>
      )}

      {status?.status === 'pending' && !success && (
        <p className="text-xs text-gray-500 mt-4 text-center">
          Need to update your details? Re-submit and your previous application will be replaced.
        </p>
      )}
    </div>
  )
}
