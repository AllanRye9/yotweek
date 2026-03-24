import { useState, useEffect } from 'react'
import { updateUserLocation, userLogout, getRideHistory, getDriverApplication, driverApply } from '../api'

// ─── Sub-tabs ────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview',    label: '👤 Overview' },
  { id: 'history',     label: '🚗 Ride History' },
  { id: 'stats',       label: '📊 Statistics' },
  { id: 'driver',      label: '🔑 Driver Role' },
]

// ─── Ride History table ──────────────────────────────────────────────────────

function RideHistoryTab({ userId }) {
  const [rides,   setRides]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [sort,    setSort]    = useState({ col: 'created_at', dir: 'desc' })
  const [filter,  setFilter]  = useState('all')

  useEffect(() => {
    getRideHistory()
      .then(d => setRides(d.rides || []))
      .catch(() => setRides([]))
      .finally(() => setLoading(false))
  }, [userId])

  if (loading) return <div className="text-gray-500 text-sm py-4">Loading…</div>
  if (!rides?.length)
    return <p className="text-gray-500 text-sm py-4">No ride history yet.</p>

  const filtered = filter === 'all' ? rides : rides.filter(r => r.status === filter)
  const sorted   = [...filtered].sort((a, b) => {
    const av = a[sort.col] ?? ''
    const bv = b[sort.col] ?? ''
    return sort.dir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1)
  })

  const toggleSort = (col) => setSort(s => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc' }))

  const statusColors = {
    open:      'text-blue-400',
    taken:     'text-green-400',
    cancelled: 'text-red-400',
  }

  return (
    <div className="space-y-3">
      {/* Filter chips */}
      <div className="flex gap-2 flex-wrap">
        {['all','open','taken','cancelled'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors capitalize ${
              filter === f
                ? 'bg-blue-700 border-blue-600 text-white'
                : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700 hover:text-white'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <table className="w-full text-xs text-left">
          <thead className="bg-gray-800/80 text-gray-400">
            <tr>
              {[['created_at','Date'], ['origin','From'], ['destination','To'], ['departure','Departure'], ['seats','Seats'], ['status','Status']].map(([col, label]) => (
                <th
                  key={col}
                  onClick={() => toggleSort(col)}
                  className="px-3 py-2 cursor-pointer hover:text-white select-none"
                >
                  {label} {sort.col === col ? (sort.dir === 'asc' ? '↑' : '↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => (
              <tr key={r.ride_id} className="border-t border-gray-700/60 hover:bg-gray-800/40">
                <td className="px-3 py-2 text-gray-400">{new Date(r.created_at).toLocaleDateString()}</td>
                <td className="px-3 py-2 text-gray-300 max-w-[120px] truncate">{r.origin}</td>
                <td className="px-3 py-2 text-gray-300 max-w-[120px] truncate">{r.destination}</td>
                <td className="px-3 py-2 text-gray-400">{r.departure}</td>
                <td className="px-3 py-2 text-gray-300">{r.seats}</td>
                <td className={`px-3 py-2 capitalize font-medium ${statusColors[r.status] || 'text-gray-400'}`}>{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Statistics tab ──────────────────────────────────────────────────────────

function StatsTab({ user }) {
  const [rides,   setRides]   = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getRideHistory()
      .then(d => setRides(d.rides || []))
      .catch(() => setRides([]))
      .finally(() => setLoading(false))
  }, [user?.user_id])

  if (loading) return <div className="text-gray-500 text-sm py-4">Loading…</div>

  const total     = rides?.length ?? 0
  const completed = rides?.filter(r => r.status === 'taken').length ?? 0
  const cancelled = rides?.filter(r => r.status === 'cancelled').length ?? 0
  const cancelRate = total > 0 ? ((cancelled / total) * 100).toFixed(0) : 0

  const stats = [
    { icon: '🚗', label: 'Total Rides Posted', value: total },
    { icon: '✅', label: 'Completed Rides',     value: completed },
    { icon: '❌', label: 'Cancellations',        value: cancelled },
    { icon: '📉', label: 'Cancellation Rate',    value: `${cancelRate}%` },
  ]

  return (
    <div className="grid grid-cols-2 gap-3">
      {stats.map(s => (
        <div key={s.label} className="bg-gray-800/60 rounded-xl p-4 border border-gray-700/60">
          <div className="text-2xl mb-1">{s.icon}</div>
          <div className="text-xl font-bold text-white">{s.value}</div>
          <div className="text-xs text-gray-400 mt-0.5">{s.label}</div>
        </div>
      ))}
    </div>
  )
}

// ─── Driver Role tab ─────────────────────────────────────────────────────────

function DriverRoleTab({ user }) {
  const [app,     setApp]     = useState(null)  // null = loading
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  const [ok,      setOk]      = useState('')
  const [form, setForm] = useState({
    vehicle_make: '', vehicle_model: '', vehicle_year: new Date().getFullYear(),
    vehicle_color: '', license_plate: '',
  })

  useEffect(() => {
    if (user?.role === 'driver') { setLoading(false); return }
    getDriverApplication()
      .then(d => setApp(d.application))
      .catch(() => setApp(null))
      .finally(() => setLoading(false))
  }, [user?.user_id, user?.role])

  if (user?.role === 'driver') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 bg-green-900/30 border border-green-700 rounded-xl p-4">
          <span className="text-3xl">🏅</span>
          <div>
            <p className="font-semibold text-green-300">Verified Trusted Driver</p>
            <p className="text-xs text-green-400">Background Checked · Insurance Valid</p>
          </div>
        </div>
        <p className="text-xs text-gray-500">
          Your driver role is active. You can post rides and use Driver Alerts.
        </p>
      </div>
    )
  }

  if (loading) return <div className="text-gray-500 text-sm py-4">Loading…</div>

  if (app?.status === 'pending') {
    return (
      <div className="bg-yellow-900/30 border border-yellow-700 rounded-xl p-4 space-y-2">
        <p className="text-yellow-300 font-semibold">⏳ Application Under Review</p>
        <p className="text-xs text-yellow-400">
          Your driver application is being reviewed by our team. We'll notify you once it's approved.
        </p>
        <div className="text-xs text-gray-400 mt-2 space-y-1">
          <p>🚗 {app.vehicle_year} {app.vehicle_make} {app.vehicle_model} ({app.vehicle_color})</p>
          <p>🔤 Plate: {app.license_plate}</p>
        </div>
      </div>
    )
  }

  if (app?.status === 'rejected') {
    return (
      <div className="bg-red-900/30 border border-red-700 rounded-xl p-4">
        <p className="text-red-300 font-semibold">❌ Application Rejected</p>
        <p className="text-xs text-red-400 mt-1">Your application was not approved. You may re-apply below.</p>
      </div>
    )
  }

  // Show application form
  const handleChange = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(''); setOk('')
    if (!form.vehicle_make.trim() || !form.vehicle_model.trim() || !form.license_plate.trim())
      return setError('Vehicle make, model and license plate are required.')
    setSaving(true)
    try {
      await driverApply(
        form.vehicle_make.trim(), form.vehicle_model.trim(),
        parseInt(form.vehicle_year), form.vehicle_color.trim(), form.license_plate.trim()
      )
      setOk('Application submitted! Our team will review it shortly.')
      setApp({ status: 'pending', ...form })
    } catch (err) {
      setError(err.message || 'Failed to submit application.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-400">
        Apply for the Driver role to post shared rides and use Driver Alerts. Fill in your vehicle details below.
      </p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text" placeholder="Make (e.g. Toyota)"
            value={form.vehicle_make} onChange={handleChange('vehicle_make')}
            className="rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
          <input
            type="text" placeholder="Model (e.g. Camry)"
            value={form.vehicle_model} onChange={handleChange('vehicle_model')}
            className="rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number" placeholder="Year" min="1990" max={new Date().getFullYear()+1}
            value={form.vehicle_year} onChange={handleChange('vehicle_year')}
            className="rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
          <input
            type="text" placeholder="Color"
            value={form.vehicle_color} onChange={handleChange('vehicle_color')}
            className="rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <input
          type="text" placeholder="License Plate"
          value={form.license_plate} onChange={handleChange('license_plate')}
          className="w-full rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
        />
        {error && <p className="text-red-400 text-xs bg-red-900/30 border border-red-800 rounded-lg px-3 py-2">{error}</p>}
        {ok    && <p className="text-green-400 text-xs bg-green-900/30 border border-green-800 rounded-lg px-3 py-2">{ok}</p>}
        <button
          type="submit" disabled={saving}
          className="w-full py-2.5 rounded-lg font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Submitting…' : 'Submit Driver Application'}
        </button>
      </form>
    </div>
  )
}

// ─── Overview tab ────────────────────────────────────────────────────────────

function OverviewTab({ user, onLocationUpdate }) {
  const [sharing,  setSharing]  = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [locError, setLocError] = useState('')
  const [locOk,    setLocOk]    = useState(false)

  const handleShareLocation = () => {
    setLocError('')
    setLocOk(false)
    if (!navigator.geolocation) { setLocError('Geolocation not supported.'); return }
    setSharing(true)
    navigator.geolocation.getCurrentPosition(
      async ({ coords: { latitude: lat, longitude: lng } }) => {
        setSaving(true)
        try {
          await updateUserLocation(lat, lng, '')
          setLocOk(true)
          onLocationUpdate?.({ lat, lng })
        } catch {
          setLocError('Failed to save location.')
        } finally {
          setSaving(false)
          setSharing(false)
        }
      },
      (err) => {
        setSharing(false)
        setLocError(
          err?.code === 1 ? 'Location permission denied.'
          : err?.code === 2 ? 'Position unavailable.'
          : 'Location request timed out.'
        )
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const roleIcon  = user.role === 'driver' ? '🚗' : '🧍'
  const badges    = user.role === 'driver'
    ? ['Background Checked', 'Insurance Valid']
    : []

  return (
    <div className="space-y-4">
      {/* Avatar + info */}
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-blue-700 flex items-center justify-center text-3xl shrink-0">
          {roleIcon}
        </div>
        <div>
          <p className="font-semibold text-white text-base">{user.name}</p>
          <p className="text-xs text-gray-400">{user.email}</p>
          <p className="text-xs text-gray-500 mt-0.5 capitalize">{user.role}</p>
          {badges.length > 0 && (
            <div className="flex gap-1 mt-1 flex-wrap">
              {badges.map(b => (
                <span key={b} className="text-xs px-2 py-0.5 rounded-full bg-green-900/50 text-green-300 border border-green-700/60">{b}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Unique ID */}
      <div className="bg-gray-800 rounded-lg px-3 py-2">
        <p className="text-xs text-gray-500 mb-0.5">User ID</p>
        <p className="text-xs font-mono text-gray-300 break-all">{user.user_id}</p>
      </div>

      {/* Location sharing */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-300">📍 Location Sharing</p>
        <button
          onClick={handleShareLocation}
          disabled={sharing || saving}
          className="w-full py-2 rounded-lg text-sm font-semibold text-white bg-green-700 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {sharing || saving ? '📡 Getting location…' : '📍 Share My Location'}
        </button>
        {locOk    && <p className="text-green-400 text-xs">✅ Location updated!</p>}
        {locError && <p className="text-red-400 text-xs">{locError}</p>}
      </div>

      <p className="text-xs text-gray-600">
        Member since {new Date(user.created_at).toLocaleDateString()}
      </p>
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

/**
 * UserProfile — comprehensive dashboard for the logged-in user.
 *
 * Props:
 *   user             – logged-in user object
 *   onLogout()       – called after logout
 *   onLocationUpdate – called with {lat, lng} when location is shared
 */
export default function UserProfile({ user, onLogout, onLocationUpdate }) {
  const [tab, setTab] = useState('overview')

  const handleLogout = async () => {
    try { await userLogout() } catch (_) {}
    onLogout?.()
  }

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900/70 overflow-hidden">
      {/* Logout bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700/60 bg-gray-800/40">
        <span className="text-xs text-gray-400 font-medium">{user.name}</span>
        <button
          onClick={handleLogout}
          className="text-xs text-gray-500 hover:text-red-400 transition-colors"
        >
          Logout
        </button>
      </div>

      {/* Sub-tabs */}
      <div className="flex overflow-x-auto border-b border-gray-700/60 bg-gray-800/20">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
              tab === t.id
                ? 'border-b-2 border-blue-500 text-blue-400'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-4">
        {tab === 'overview' && (
          <OverviewTab user={user} onLocationUpdate={onLocationUpdate} />
        )}
        {tab === 'history' && (
          <RideHistoryTab userId={user.user_id} />
        )}
        {tab === 'stats' && (
          <StatsTab user={user} />
        )}
        {tab === 'driver' && (
          <DriverRoleTab user={user} />
        )}
      </div>
    </div>
  )
}
