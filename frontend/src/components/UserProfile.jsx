import { useState } from 'react'
import { updateUserLocation, userLogout } from '../api'

/**
 * UserProfile — displays logged-in user info and allows location sharing.
 */
export default function UserProfile({ user, onLogout, onLocationUpdate }) {
  const [sharing, setSharing]   = useState(false)
  const [locError, setLocError] = useState('')
  const [locOk, setLocOk]       = useState(false)
  const [saving, setSaving]     = useState(false)

  const handleShareLocation = () => {
    setLocError('')
    setLocOk(false)
    if (!navigator.geolocation) {
      setLocError('Geolocation is not supported by your browser.')
      return
    }
    setSharing(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords
        setSaving(true)
        try {
          await updateUserLocation(lat, lng, '')
          setLocOk(true)
          onLocationUpdate?.({ lat, lng })
        } catch (err) {
          setLocError('Failed to save location.')
        } finally {
          setSaving(false)
          setSharing(false)
        }
      },
      (err) => {
        setSharing(false)
        const msg = err?.code === 1
          ? 'Location permission denied. Please allow location access in your browser.'
          : err?.code === 2
            ? 'Position unavailable. Please check your GPS or network connection.'
            : 'Location request timed out. Please try again.'
        setLocError(msg)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const handleLogout = async () => {
    try { await userLogout() } catch (_) {}
    onLogout?.()
  }

  const roleIcon = user.role === 'driver' ? '🚗' : '🧍'

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900/70 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-blue-700 flex items-center justify-center text-2xl shrink-0">
            {roleIcon}
          </div>
          <div>
            <p className="font-semibold text-white">{user.name}</p>
            <p className="text-xs text-gray-400">{user.email}</p>
            <p className="text-xs text-gray-500 mt-0.5 capitalize">{user.role}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="text-xs text-gray-500 hover:text-red-400 transition-colors"
        >
          Logout
        </button>
      </div>

      {/* Unique ID */}
      <div className="bg-gray-800 rounded-lg px-3 py-2">
        <p className="text-xs text-gray-500 mb-0.5">Your unique ID</p>
        <p className="text-xs font-mono text-gray-300 break-all">{user.user_id}</p>
      </div>

      {/* Location */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-300">📍 Location Sharing</p>
        <p className="text-xs text-gray-500">
          Share your current location so nearby drivers and ride-posts can find you.
        </p>
        <button
          onClick={handleShareLocation}
          disabled={sharing || saving}
          className="w-full py-2 rounded-lg text-sm font-semibold text-white transition-colors bg-green-700 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sharing || saving ? '📡 Getting location…' : '📍 Share My Location'}
        </button>
        {locOk && (
          <p className="text-green-400 text-xs">✅ Location updated successfully!</p>
        )}
        {locError && (
          <p className="text-red-400 text-xs">{locError}</p>
        )}
      </div>

      {/* Joined */}
      <p className="text-xs text-gray-600">
        Member since {new Date(user.created_at).toLocaleDateString()}
      </p>
    </div>
  )
}
