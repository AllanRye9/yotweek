import { useState, useEffect, useRef } from 'react'
import {
  updateUserLocation, userLogout, getRideHistory, getDriverApplication, driverApply,
  updateProfileDetails, uploadAvatar, getNotifications, markNotificationRead, markAllNotificationsRead,
} from '../api'
import socket from '../socket'

// ─── Tab definitions ─────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview',  label: '👤 Profile' },
  { id: 'history',   label: '🚗 Rides'   },
  { id: 'stats',     label: '📊 Stats'   },
  { id: 'driver',    label: '🔑 Driver'  },
  { id: 'inbox',     label: '🔔 Inbox'   },
]

// ─── Avatar component ─────────────────────────────────────────────────────────

function AvatarUpload({ user, onAvatarChange }) {
  const inputRef  = useRef(null)
  const [preview, setPreview] = useState(user?.avatar_url || null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  useEffect(() => { setPreview(user?.avatar_url || null) }, [user?.avatar_url])

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const objectUrl = URL.createObjectURL(file)
    setPreview(objectUrl)
    setLoading(true)
    setError('')
    try {
      const res = await uploadAvatar(file)
      onAvatarChange?.(res.avatar_url)
    } catch (err) {
      setError(err.message || 'Upload failed.')
      setPreview(user?.avatar_url || null)
    } finally {
      setLoading(false)
      e.target.value = ''
    }
  }

  const roleIcon = user?.role === 'driver' ? '🚗' : '🧍'

  return (
    <div className="relative w-16 h-16 shrink-0">
      <div
        className="w-16 h-16 rounded-full overflow-hidden border-2 border-blue-600 bg-blue-800 flex items-center justify-center cursor-pointer hover:border-blue-400 transition-colors"
        onClick={() => inputRef.current?.click()}
        title="Click to change avatar"
      >
        {preview ? (
          <img src={preview} alt="avatar" className="w-full h-full object-cover" />
        ) : (
          <span className="text-3xl">{roleIcon}</span>
        )}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-full">
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
      <button
        className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-blue-600 border border-gray-800 flex items-center justify-center text-white text-xs hover:bg-blue-500 transition-colors"
        onClick={() => inputRef.current?.click()}
        title="Upload avatar"
      >
        +
      </button>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
      {error && <p className="absolute top-full mt-1 text-red-400 text-xs whitespace-nowrap">{error}</p>}
    </div>
  )
}

// ─── Ride History tab ─────────────────────────────────────────────────────────

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

  if (loading) return <div className="text-gray-500 text-sm py-4">Loading...</div>
  if (!rides?.length) return <p className="text-gray-500 text-sm py-4">No ride history yet.</p>

  const filtered = filter === 'all' ? rides : rides.filter(r => r.status === filter)
  const sorted   = [...filtered].sort((a, b) => {
    const av = a[sort.col] ?? ''
    const bv = b[sort.col] ?? ''
    return sort.dir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1)
  })
  const toggleSort = (col) => setSort(s => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc' }))
  const statusColors = { open: 'text-blue-400', taken: 'text-green-400', cancelled: 'text-red-400' }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {['all','open','taken','cancelled'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors capitalize ${
              filter === f ? 'bg-blue-700 border-blue-600 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700 hover:text-white'
            }`}>{f}</button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <table className="w-full text-xs text-left">
          <thead className="bg-gray-800/80 text-gray-400">
            <tr>
              {[['created_at','Date'],['origin','From'],['destination','To'],['departure','Departs'],['seats','Seats'],['status','Status']].map(([col, lbl]) => (
                <th key={col} onClick={() => toggleSort(col)} className="px-3 py-2 cursor-pointer hover:text-white select-none">
                  {lbl} {sort.col === col ? (sort.dir === 'asc' ? '↑' : '↓') : ''}
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

// ─── Statistics tab ───────────────────────────────────────────────────────────

function StatsTab({ user }) {
  const [rides,   setRides]   = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getRideHistory()
      .then(d => setRides(d.rides || []))
      .catch(() => setRides([]))
      .finally(() => setLoading(false))
  }, [user?.user_id])

  if (loading) return <div className="text-gray-500 text-sm py-4">Loading...</div>

  const total      = rides?.length ?? 0
  const completed  = rides?.filter(r => r.status === 'taken').length ?? 0
  const cancelled  = rides?.filter(r => r.status === 'cancelled').length ?? 0
  const open       = rides?.filter(r => r.status === 'open').length ?? 0
  const cancelRate = total > 0 ? ((cancelled / total) * 100).toFixed(0) : 0

  const stats = [
    { icon: '🚗', label: 'Total Rides',   value: total,             color: 'text-blue-400'   },
    { icon: '✅',    label: 'Completed',      value: completed,         color: 'text-green-400'  },
    { icon: '🟢', label: 'Open Rides',     value: open,              color: 'text-cyan-400'   },
    { icon: '❌',    label: 'Cancellations',  value: cancelled,         color: 'text-red-400'    },
    { icon: '📉', label: 'Cancel Rate',    value: `${cancelRate}%`,  color: 'text-orange-400' },
    { icon: '👤', label: 'Role',           value: user?.role,        color: 'text-purple-400' },
  ]

  return (
    <div className="grid grid-cols-2 gap-3">
      {stats.map(s => (
        <div key={s.label} className="bg-gray-800/60 rounded-xl p-4 border border-gray-700/60">
          <div className="text-2xl mb-1">{s.icon}</div>
          <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
          <div className="text-xs text-gray-400 mt-0.5 capitalize">{s.label}</div>
        </div>
      ))}
    </div>
  )
}

// ─── Driver Role tab ──────────────────────────────────────────────────────────

function DriverRoleTab({ user }) {
  const [app,    setApp]     = useState(null)
  const [loading,setLoading] = useState(true)
  const [saving, setSaving]  = useState(false)
  const [error,  setError]   = useState('')
  const [ok,     setOk]      = useState('')
  const [form, setForm] = useState({
    vehicle_make: '', vehicle_model: '', vehicle_year: new Date().getFullYear(),
    vehicle_color: '', license_plate: '', subscription_type: 'monthly',
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
            <p className="font-semibold text-green-300 flex items-center gap-2">
              Verified Trusted Driver
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-800 text-green-200 border border-green-600">✅ Verified</span>
            </p>
            <p className="text-xs text-green-400">Background Checked · Insurance Valid · Can Post Rides</p>
          </div>
        </div>
        <div className="rounded-lg bg-green-950/40 border border-green-800/50 px-3 py-2 text-xs text-green-400">
          🚗 You can post Airport Pickup rides and use Driver Alerts. Your profile shows a verified badge to passengers.
        </div>
        <p className="text-xs text-gray-500">Your driver role is active. You can post rides and use Driver Alerts.</p>
      </div>
    )
  }

  if (loading) return <div className="text-gray-500 text-sm py-4">Loading...</div>

  if (app?.status === 'pending') {
    return (
      <div className="bg-yellow-900/30 border border-yellow-700 rounded-xl p-4 space-y-2">
        <p className="text-yellow-300 font-semibold">Application Under Review</p>
        <p className="text-xs text-yellow-400">Your driver application is being reviewed. You will be notified once approved.</p>
        <div className="text-xs text-gray-400 mt-2 space-y-1">
          <p>{app.vehicle_year} {app.vehicle_make} {app.vehicle_model} ({app.vehicle_color})</p>
          <p>Plate: {app.license_plate}</p>
          {app.subscription_type && (
            <p>Subscription: <span className="capitalize text-yellow-300">{app.subscription_type}</span></p>
          )}
        </div>
      </div>
    )
  }

  if (app?.status === 'rejected') {
    return (
      <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 space-y-3">
        <p className="text-red-300 font-semibold">Application Rejected</p>
        <p className="text-xs text-red-400 mt-1">Your application was not approved. You may re-apply below.</p>
      </div>
    )
  }

  const handleChange = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setOk('')
    if (!form.vehicle_make.trim() || !form.vehicle_model.trim() || !form.license_plate.trim())
      return setError('Vehicle make, model and license plate are required.')
    setSaving(true)
    try {
      await driverApply(form.vehicle_make.trim(), form.vehicle_model.trim(), parseInt(form.vehicle_year), form.vehicle_color.trim(), form.license_plate.trim(), form.subscription_type)
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
      <div className="rounded-lg bg-blue-950/40 border border-blue-800/50 p-3 text-xs text-blue-300 space-y-1">
        <p className="font-semibold">🚗 Become a Verified Driver</p>
        <p className="text-blue-400/80">
          Register your vehicle and choose a subscription plan. Once approved by our team, your profile
          will show a <strong>verified badge</strong> and you&apos;ll gain access to post Airport Pickup rides.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <input type="text" placeholder="Make (e.g. Toyota)" value={form.vehicle_make} onChange={handleChange('vehicle_make')}
            className="rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" required />
          <input type="text" placeholder="Model (e.g. Camry)" value={form.vehicle_model} onChange={handleChange('vehicle_model')}
            className="rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" required />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input type="number" placeholder="Year" min="1990" max={new Date().getFullYear()+1} value={form.vehicle_year} onChange={handleChange('vehicle_year')}
            className="rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" required />
          <input type="text" placeholder="Color" value={form.vehicle_color} onChange={handleChange('vehicle_color')}
            className="rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <input type="text" placeholder="License Plate" value={form.license_plate} onChange={handleChange('license_plate')}
          className="w-full rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" required />

        {/* Subscription plan */}
        <div className="space-y-1.5">
          <label className="text-xs text-gray-400 font-medium">Subscription Plan</label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: 'monthly', label: '📅 Monthly', desc: 'Billed monthly' },
              { value: 'yearly',  label: '📆 Yearly',  desc: 'Best value — save 2 months' },
            ].map(opt => (
              <button key={opt.value} type="button"
                onClick={() => setForm(f => ({ ...f, subscription_type: opt.value }))}
                className={`rounded-xl border p-3 text-left transition-all ${
                  form.subscription_type === opt.value
                    ? 'border-blue-500 bg-blue-900/40 text-blue-300'
                    : 'border-gray-700 bg-gray-800/60 text-gray-400 hover:border-gray-500 hover:text-gray-300'
                }`}>
                <p className="text-xs font-semibold">{opt.label}</p>
                <p className="text-xs opacity-70 mt-0.5">{opt.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-red-400 text-xs bg-red-900/30 border border-red-800 rounded-lg px-3 py-2">{error}</p>}
        {ok    && <p className="text-green-400 text-xs bg-green-900/30 border border-green-800 rounded-lg px-3 py-2">{ok}</p>}
        <button type="submit" disabled={saving}
          className="w-full py-2.5 rounded-lg font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          {saving ? 'Submitting...' : 'Submit Driver Application'}
        </button>
      </form>
    </div>
  )
}

// ─── Inbox tab ────────────────────────────────────────────────────────────────

function InboxTab({ unreadCount, onUnreadChange }) {
  const [notifications, setNotifications] = useState(null)
  const [loading,       setLoading]       = useState(true)
  const [markingAll,    setMarkingAll]     = useState(false)

  const load = () => {
    setLoading(true)
    getNotifications()
      .then(d => {
        setNotifications(d.notifications || [])
        onUnreadChange?.(d.unread || 0)
      })
      .catch(() => setNotifications([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    const handler = () => load()
    socket.on('notification', handler)
    return () => socket.off('notification', handler)
  }, [])

  const handleMarkRead = async (notifId) => {
    await markNotificationRead(notifId).catch(() => {})
    setNotifications(prev => prev.map(n => n.notif_id === notifId ? { ...n, read: 1 } : n))
    onUnreadChange?.(prev => Math.max(0, (typeof prev === 'number' ? prev : 0) - 1))
  }

  const handleMarkAll = async () => {
    setMarkingAll(true)
    await markAllNotificationsRead().catch(() => {})
    setNotifications(prev => prev.map(n => ({ ...n, read: 1 })))
    onUnreadChange?.(0)
    setMarkingAll(false)
  }

  const typeIcons = {
    driver_approved: '🎉',
    driver_rejected: '❌',
    ride_taken:      '✅',
    system:          'ℹ️',
  }

  if (loading) return <div className="text-gray-500 text-sm py-4">Loading...</div>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400 font-medium">
          {notifications?.length ?? 0} notification{(notifications?.length ?? 0) !== 1 ? 's' : ''}
          {unreadCount > 0 && <span className="ml-2 text-blue-400">&middot; {unreadCount} unread</span>}
        </p>
        {unreadCount > 0 && (
          <button onClick={handleMarkAll} disabled={markingAll}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50">
            {markingAll ? 'Marking...' : 'Mark all read'}
          </button>
        )}
      </div>

      {notifications?.length === 0 && (
        <p className="text-gray-500 text-sm py-4 text-center">Your inbox is empty.</p>
      )}

      <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
        {notifications?.map(n => (
          <div
            key={n.notif_id}
            className={`rounded-xl p-3 border transition-colors ${
              n.read ? 'bg-gray-800/30 border-gray-700/40 cursor-default' : 'bg-blue-900/20 border-blue-700/50 cursor-pointer hover:bg-blue-900/30'
            }`}
            onClick={() => !n.read && handleMarkRead(n.notif_id)}
          >
            <div className="flex items-start gap-2">
              <span className="text-lg shrink-0">{typeIcons[n.type] || 'ℹ️'}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className={`text-xs font-semibold truncate ${n.read ? 'text-gray-300' : 'text-white'}`}>{n.title}</p>
                  {!n.read && <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">{n.body}</p>
                <p className="text-xs text-gray-600 mt-1">{new Date(n.created_at).toLocaleString()}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Overview tab ─────────────────────────────────────────────────────────────

function OverviewTab({ user, onLocationUpdate, onUserUpdate }) {
  const [sharing,    setSharing]    = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [locError,   setLocError]   = useState('')
  const [locOk,      setLocOk]      = useState(false)
  const [editMode,   setEditMode]   = useState(false)
  const [name,       setName]       = useState(user.name || '')
  const [bio,        setBio]        = useState(user.bio  || '')
  const [saveOk,     setSaveOk]     = useState(false)
  const [saveErr,    setSaveErr]    = useState('')
  const [continuous, setContinuous] = useState(false)
  const watchIdRef = useRef(null)

  useEffect(() => {
    setName(user.name || '')
    setBio(user.bio  || '')
  }, [user.user_id])

  useEffect(() => {
    if (!continuous) {
      if (watchIdRef.current != null) {
        navigator.geolocation?.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
      return
    }
    if (!navigator.geolocation) { setLocError('Geolocation not supported.'); return }
    watchIdRef.current = navigator.geolocation.watchPosition(
      async ({ coords: { latitude: lat, longitude: lng } }) => {
        try {
          await updateUserLocation(lat, lng, '')
          setLocOk(true)
          onLocationUpdate?.({ lat, lng })
        } catch (_) {}
      },
      (err) => {
        setLocError(
          err?.code === 1 ? 'Location permission denied.'
          : err?.code === 2 ? 'Position unavailable.'
          : 'Location request timed out.'
        )
        setContinuous(false)
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    )
    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation?.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
    }
  }, [continuous])

  const handleShareOnce = () => {
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

  const handleSaveProfile = async () => {
    setSaveErr('')
    setSaveOk(false)
    if (!name.trim()) { setSaveErr('Name cannot be empty.'); return }
    try {
      const res = await updateProfileDetails(name.trim(), bio.trim())
      onUserUpdate?.(res.user)
      setSaveOk(true)
      setEditMode(false)
      setTimeout(() => setSaveOk(false), 3000)
    } catch (err) {
      setSaveErr(err.message || 'Failed to save profile.')
    }
  }

  const badges = user.role === 'driver' ? ['Background Checked', 'Insurance Valid'] : []

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <AvatarUpload user={user} onAvatarChange={(url) => onUserUpdate?.({ ...user, avatar_url: url })} />
        <div className="flex-1 min-w-0">
          {editMode ? (
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full rounded-lg bg-gray-800 border border-blue-600 text-gray-100 text-sm font-semibold p-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-1" />
          ) : (
            <p className="font-semibold text-white text-base truncate flex items-center gap-2">
              {user.name}
              {user.role === 'driver' && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-900/60 text-green-300 border border-green-700/50 font-normal">✅ Verified</span>
              )}
            </p>
          )}
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

      <div>
        <p className="text-xs text-gray-400 font-medium mb-1">About me</p>
        {editMode ? (
          <textarea value={bio} onChange={e => setBio(e.target.value)}
            placeholder="Add a short personal description..." maxLength={500} rows={3}
            className="w-full rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
        ) : (
          <p className="text-sm text-gray-300 min-h-[2.5rem]">
            {user.bio || <em className="text-gray-600">No description yet.</em>}
          </p>
        )}
      </div>

      <div className="flex gap-2">
        {editMode ? (
          <>
            <button onClick={handleSaveProfile}
              className="flex-1 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 transition-colors">
              Save
            </button>
            <button onClick={() => { setEditMode(false); setName(user.name); setBio(user.bio || '') }}
              className="flex-1 py-1.5 rounded-lg text-xs font-semibold text-gray-400 bg-gray-800 hover:bg-gray-700 transition-colors">
              Cancel
            </button>
          </>
        ) : (
          <button onClick={() => setEditMode(true)}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold text-gray-300 bg-gray-800 hover:bg-gray-700 border border-gray-700 transition-colors">
            Edit Profile
          </button>
        )}
      </div>
      {saveOk  && <p className="text-green-400 text-xs">Profile saved!</p>}
      {saveErr && <p className="text-red-400 text-xs">{saveErr}</p>}

      <div className="bg-gray-800 rounded-lg px-3 py-2">
        <p className="text-xs text-gray-500 mb-0.5">User ID</p>
        <p className="text-xs font-mono text-gray-300 break-all">{user.user_id}</p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-300">Location Sharing</p>
        <div className="flex gap-2">
          <button onClick={handleShareOnce} disabled={sharing || saving || continuous}
            className="flex-1 py-2 rounded-lg text-xs font-semibold text-white bg-green-700 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            {sharing || saving ? 'Getting...' : 'Share Once'}
          </button>
          <button onClick={() => setContinuous(c => !c)}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${
              continuous ? 'text-white bg-red-600 hover:bg-red-500' : 'text-white bg-blue-700 hover:bg-blue-600'
            }`}>
            {continuous ? 'Stop Live' : 'Live Track'}
          </button>
        </div>
        {continuous && (
          <p className="text-xs text-blue-400 flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            Live location tracking active...
          </p>
        )}
        {locOk    && <p className="text-green-400 text-xs">Location updated!</p>}
        {locError && <p className="text-red-400 text-xs">{locError}</p>}
      </div>

      <p className="text-xs text-gray-600">Member since {new Date(user.created_at).toLocaleDateString()}</p>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function UserProfile({ user: initialUser, onLogout, onLocationUpdate, onUserUpdate }) {
  const [tab,      setTab]      = useState('overview')
  const [user,     setUser]     = useState(initialUser)
  const [unread,   setUnread]   = useState(0)
  const [expanded, setExpanded] = useState(true)

  useEffect(() => { setUser(initialUser) }, [initialUser])

  useEffect(() => {
    const fetchUnread = () =>
      getNotifications().then(d => setUnread(d.unread || 0)).catch(() => {})
    fetchUnread()
    const id = setInterval(fetchUnread, 30_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const handler = () =>
      getNotifications().then(d => setUnread(d.unread || 0)).catch(() => {})
    socket.on('notification', handler)
    return () => socket.off('notification', handler)
  }, [])

  const handleLogout = async () => {
    try { await userLogout() } catch (_) {}
    onLogout?.()
  }

  const handleUserUpdate = (updated) => {
    if (!updated) return
    const merged = { ...user, ...updated }
    setUser(merged)
    onUserUpdate?.(merged)
  }

  const tabsWithBadge = TABS.map(t =>
    t.id === 'inbox' && unread > 0 ? { ...t, badge: unread } : t
  )

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900/70 overflow-hidden">
      {/* ── Header with collapse toggle ── */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700/60 bg-gray-800/40">
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-2 text-xs text-gray-300 hover:text-white transition-colors min-w-0 flex-1"
          title={expanded ? 'Collapse profile' : 'Expand profile'}
        >
          <span className={`shrink-0 transition-transform duration-300 ${expanded ? 'rotate-0' : '-rotate-90'}`}>▾</span>
          <span className="font-medium truncate">{user.name}</span>
          {user.role === 'driver' && (
            <span className="shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-green-900/60 text-green-300 border border-green-700/50">✅</span>
          )}
          {unread > 0 && (
            <span className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
        <button onClick={handleLogout} className="text-xs text-gray-500 hover:text-red-400 transition-colors shrink-0 ml-3">
          Logout
        </button>
      </div>

      {/* ── Animated body ── */}
      <div
        style={{
          maxHeight: expanded ? '2000px' : '0px',
          opacity:   expanded ? 1 : 0,
          overflow:  'hidden',
          transition: 'max-height 0.35s ease, opacity 0.25s ease',
        }}
      >
        <div className="flex overflow-x-auto border-b border-gray-700/60 bg-gray-800/20">
          {tabsWithBadge.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`shrink-0 px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap relative ${
                tab === t.id ? 'border-b-2 border-blue-500 text-blue-400' : 'text-gray-500 hover:text-gray-300'
              }`}>
              {t.label}
              {t.badge > 0 && (
                <span className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold">
                  {t.badge > 9 ? '9+' : t.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="p-4">
          {tab === 'overview' && <OverviewTab user={user} onLocationUpdate={onLocationUpdate} onUserUpdate={handleUserUpdate} />}
          {tab === 'history'  && <RideHistoryTab userId={user.user_id} />}
          {tab === 'stats'    && <StatsTab user={user} />}
          {tab === 'driver'   && <DriverRoleTab user={user} />}
          {tab === 'inbox'    && <InboxTab unreadCount={unread} onUnreadChange={setUnread} />}
        </div>
      </div>
    </div>
  )
}
