import { useState, useEffect, useCallback, useRef } from 'react'
import { listRides, postRide, cancelRide, takeRide, updateDriverLocation, getNearbyDrivers } from '../api'
import { playDriverAlertSound, playRideTakenSound, playNewRideSound } from '../sounds'
import socket from '../socket'

/**
 * RideShare — post shared rides, see available rides, and (for drivers)
 * broadcast an empty-car geolocation alert to nearby users.
 *
 * Features:
 * - Status tags (open / taken / cancelled) with colours
 * - "Mark as Taken" button for the ride poster
 * - Contact info on each card
 * - Animated driver-nearby alert toast
 * - Web Audio sound notifications
 */
export default function RideShare({ user }) {
  const isDriver = user?.role === 'driver'

  /* ── State ── */
  const [rides, setRides]               = useState([])
  const [loading, setLoading]           = useState(false)
  const [posting, setPosting]           = useState(false)
  const [postError, setPostError]       = useState('')
  const [postOk, setPostOk]             = useState('')
  const [driverAlert, setDriverAlert]   = useState(null)
  const [alertVisible, setAlertVisible] = useState(false)
  const alertTimerRef                   = useRef(null)

  /* Post-ride form */
  const [origin, setOrigin]         = useState('')
  const [destination, setDest]      = useState('')
  const [departure, setDeparture]   = useState('')
  const [seats, setSeats]           = useState(1)
  const [notes, setNotes]           = useState('')
  const [contact, setContact]       = useState('')
  const [geoLoading, setGeoLoading] = useState(false)
  const [originLat, setOriginLat]   = useState(null)
  const [originLng, setOriginLng]   = useState(null)

  /* Driver broadcast */
  const [broadcasting, setBroadcasting] = useState(false)
  const [broadcastMsg, setBroadcastMsg] = useState('')
  const [nearbyDrivers, setNearbyDrivers] = useState([])

  /* ── Load rides ── */
  const loadRides = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listRides()
      setRides(data.rides || [])
    } catch (_) {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadRides() }, [loadRides])

  /* ── Socket.IO real-time updates ── */
  useEffect(() => {
    const onNewRide = (ride) => {
      setRides(prev => [ride, ...prev])
      playNewRideSound()
    }
    const onCancelled = ({ ride_id }) => {
      setRides(prev => prev.map(r =>
        r.ride_id === ride_id ? { ...r, status: 'cancelled' } : r
      ))
    }
    const onTaken = ({ ride_id }) => {
      setRides(prev => prev.map(r =>
        r.ride_id === ride_id ? { ...r, status: 'taken' } : r
      ))
      playRideTakenSound()
    }
    const onDriverNearby = (data) => {
      playDriverAlertSound()
      setDriverAlert(data)
      setAlertVisible(true)
      if (alertTimerRef.current) clearTimeout(alertTimerRef.current)
      alertTimerRef.current = setTimeout(() => {
        setAlertVisible(false)
        setTimeout(() => setDriverAlert(null), 500)
      }, 8000)
    }

    socket.on('new_ride', onNewRide)
    socket.on('ride_cancelled', onCancelled)
    socket.on('ride_taken', onTaken)
    socket.on('driver_nearby', onDriverNearby)

    return () => {
      socket.off('new_ride', onNewRide)
      socket.off('ride_cancelled', onCancelled)
      socket.off('ride_taken', onTaken)
      socket.off('driver_nearby', onDriverNearby)
    }
  }, [])

  /* ── Identify user to socket ── */
  useEffect(() => {
    if (user?.user_id) {
      socket.emit('identify', { user_id: user.user_id })
    }
  }, [user])

  /* ── Geo-fill origin ── */
  const handleGeoOrigin = () => {
    if (!navigator.geolocation) return
    setGeoLoading(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOriginLat(pos.coords.latitude)
        setOriginLng(pos.coords.longitude)
        setOrigin(`${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`)
        setGeoLoading(false)
      },
      () => setGeoLoading(false),
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }

  /* ── Post ride ── */
  const handlePost = async (e) => {
    e.preventDefault()
    setPostError('')
    setPostOk('')
    if (!user) { setPostError('Please login first.'); return }
    setPosting(true)
    try {
      const notesTrimmed = notes.trim()
      const notesWithContact = contact.trim()
        ? `${notesTrimmed}${notesTrimmed ? ' | ' : ''}Contact: ${contact.trim()}`
        : notesTrimmed
      const data = await postRide(origin, destination, departure, seats, notesWithContact, originLat, originLng)
      setPostOk(`Ride posted! ID: ${data.ride_id.slice(0, 8)}…`)
      setOrigin(''); setDest(''); setDeparture(''); setSeats(1); setNotes(''); setContact('')
      setOriginLat(null); setOriginLng(null)
    } catch (err) {
      setPostError(err.message || 'Failed to post ride.')
    } finally {
      setPosting(false)
    }
  }

  /* ── Cancel own ride ── */
  const handleCancel = async (rideId) => {
    try {
      await cancelRide(rideId)
      setRides(prev => prev.map(r =>
        r.ride_id === rideId ? { ...r, status: 'cancelled' } : r
      ))
    } catch (err) {
      alert(err.message || 'Cancel failed.')
    }
  }

  /* ── Mark ride as taken ── */
  const handleTake = async (rideId) => {
    try {
      await takeRide(rideId)
      setRides(prev => prev.map(r =>
        r.ride_id === rideId ? { ...r, status: 'taken' } : r
      ))
      playRideTakenSound()
    } catch (err) {
      alert(err.message || 'Failed to mark ride as taken.')
    }
  }

  /* ── Driver broadcast ── */
  const handleBroadcast = () => {
    if (!navigator.geolocation) {
      setBroadcastMsg('Geolocation not supported.')
      return
    }
    setBroadcasting(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await updateDriverLocation(pos.coords.latitude, pos.coords.longitude, true)
          setBroadcastMsg('📡 Your empty-car alert was sent to nearby passengers!')
          const d = await getNearbyDrivers(pos.coords.latitude, pos.coords.longitude, 20)
          setNearbyDrivers(d.drivers || [])
        } catch (err) {
          setBroadcastMsg(err.message || 'Broadcast failed.')
        } finally {
          setBroadcasting(false)
          setTimeout(() => setBroadcastMsg(''), 6000)
        }
      },
      () => {
        setBroadcastMsg('Location permission denied.')
        setBroadcasting(false)
      },
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }

  /* ── Status tag helper ── */
  const StatusTag = ({ status }) => {
    const cfg = {
      open:      { cls: 'ride-tag-open',      label: '🟢 Open'      },
      taken:     { cls: 'ride-tag-taken',     label: '🟡 Taken'     },
      cancelled: { cls: 'ride-tag-cancelled', label: '🔴 Cancelled' },
    }
    const { cls, label } = cfg[status] ?? cfg.open
    return <span className={`ride-status-tag ${cls}`}>{label}</span>
  }

  return (
    <div className="space-y-6">
      {/* ── Driver nearby alert toast (animated) ── */}
      {driverAlert && (
        <div className={`fixed top-4 right-4 z-50 max-w-xs bg-green-900 border border-green-500 rounded-xl p-4 shadow-2xl driver-alert-toast ${alertVisible ? 'driver-alert-enter' : 'driver-alert-exit'}`}>
          <div className="flex items-center gap-2 mb-1">
            <span className="driver-alert-icon text-xl">🚗</span>
            <p className="text-green-300 font-semibold text-sm">Driver Nearby!</p>
          </div>
          <p className="text-green-200 text-xs">{driverAlert.message}</p>
          {driverAlert.driver_name && (
            <p className="text-green-400 text-xs mt-1 font-medium">👤 {driverAlert.driver_name}</p>
          )}
        </div>
      )}

      {/* ── Driver: broadcast location ── */}
      {isDriver && (
        <div className="rounded-xl border border-yellow-700/60 bg-yellow-900/20 p-4 space-y-3">
          <h3 className="font-semibold text-yellow-300 flex items-center gap-2">
            <span className="driver-pulse-icon">🚗</span> Broadcast Your Location
          </h3>
          <p className="text-xs text-yellow-200/70">
            Let nearby passengers know your car is empty and available.
          </p>
          <button
            onClick={handleBroadcast}
            disabled={broadcasting}
            className="w-full py-2 rounded-lg text-sm font-semibold text-white bg-yellow-700 hover:bg-yellow-600 disabled:opacity-50 transition-colors driver-broadcast-btn"
          >
            {broadcasting
              ? <span className="flex items-center justify-center gap-2"><span className="inline-block driver-broadcast-spinner" />Broadcasting…</span>
              : '📡 Alert Nearby Passengers (Empty Car)'}
          </button>
          {broadcastMsg && (
            <p className={`text-xs ${broadcastMsg.startsWith('📡') ? 'text-green-300' : 'text-red-300'}`}>
              {broadcastMsg}
            </p>
          )}
          {nearbyDrivers.length > 0 && (
            <div className="text-xs text-yellow-200/60">
              {nearbyDrivers.length} other driver(s) nearby.
            </div>
          )}
        </div>
      )}

      {/* ── Post a ride ── */}
      {user && (
        <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-4 space-y-4">
          <h3 className="font-semibold text-gray-200">📌 Post a Shared Ride</h3>
          <form onSubmit={handlePost} className="space-y-3">
            {/* Origin */}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Origin / pickup location"
                value={origin}
                onChange={e => setOrigin(e.target.value)}
                required
                className="flex-1 rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                title="Use my current location"
                onClick={handleGeoOrigin}
                disabled={geoLoading}
                className="px-3 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm transition-colors disabled:opacity-50"
              >
                {geoLoading ? '…' : '📍'}
              </button>
            </div>

            <input
              type="text"
              placeholder="Destination"
              value={destination}
              onChange={e => setDest(e.target.value)}
              required
              className="w-full rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Departure</label>
                <input
                  type="datetime-local"
                  value={departure}
                  onChange={e => setDeparture(e.target.value)}
                  required
                  className="w-full rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Available Seats</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={seats}
                  onChange={e => setSeats(Number(e.target.value))}
                  className="w-full rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <input
              type="text"
              placeholder="Contact (phone / WhatsApp / email)"
              value={contact}
              onChange={e => setContact(e.target.value)}
              className="w-full rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <textarea
              placeholder="Notes (optional) — e.g. luggage allowed, price…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />

            {postError && (
              <p className="text-red-400 text-xs bg-red-900/30 border border-red-800 rounded-lg px-3 py-2">
                {postError}
              </p>
            )}
            {postOk && (
              <p className="text-green-400 text-xs bg-green-900/30 border border-green-800 rounded-lg px-3 py-2">
                ✅ {postOk}
              </p>
            )}

            <button
              type="submit"
              disabled={posting}
              className="w-full py-2.5 rounded-lg font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition-colors"
            >
              {posting ? 'Posting…' : '🚀 Post Ride'}
            </button>
          </form>
        </div>
      )}

      {/* ── Available rides ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-200">🗺️ Rides</h3>
          <button
            onClick={loadRides}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            ↺ Refresh
          </button>
        </div>

        {loading && (
          <div className="flex justify-center py-8">
            <div className="spinner w-8 h-8" />
          </div>
        )}

        {!loading && rides.length === 0 && (
          <div className="text-center py-10 text-gray-500 text-sm">
            No rides posted yet. Be the first!
          </div>
        )}

        {rides.map(ride => (
          <div
            key={ride.ride_id}
            className={`ride-card rounded-xl border p-4 space-y-2 transition-all ${
              ride.status === 'taken'
                ? 'border-amber-700/60 bg-amber-900/10'
                : ride.status === 'cancelled'
                ? 'border-red-800/40 bg-red-900/10 opacity-60'
                : 'border-gray-700 bg-gray-800/60 hover:border-gray-600'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <StatusTag status={ride.status} />
                  <span className="font-semibold text-white text-sm">{ride.origin}</span>
                  <span className="text-gray-500 text-xs">→</span>
                  <span className="font-semibold text-blue-300 text-sm">{ride.destination}</span>
                </div>
                <p className="text-xs text-gray-400">
                  🕐 {new Date(ride.departure).toLocaleString()} · 💺 {ride.seats} seat{ride.seats !== 1 ? 's' : ''} · 👤 {ride.driver_name}
                </p>
                {ride.notes && !ride.notes.includes('Contact:') && (
                  <p className="text-xs text-gray-500 mt-1 italic">"{ride.notes}"</p>
                )}
                {ride.notes && ride.notes.includes('Contact:') && (() => {
                  const contactVal = ride.notes.split('Contact:')[1]?.trim() ?? ''
                  const notePart   = ride.notes.includes('| Contact:')
                    ? ride.notes.split('| Contact:')[0].trim()
                    : ''
                  return (
                    <>
                      {notePart && (
                        <p className="text-xs text-gray-500 mt-1 italic">"{notePart}"</p>
                      )}
                      {contactVal && (
                        <p className="text-xs text-blue-400 mt-1">
                          📞 {contactVal}
                        </p>
                      )}
                    </>
                  )
                })()}
              </div>

              {/* Action buttons — only for the poster's own open ride */}
              {user && ride.user_id === user.user_id && ride.status === 'open' && (
                <div className="flex flex-col gap-1.5 shrink-0">
                  <button
                    onClick={() => handleTake(ride.ride_id)}
                    className="text-xs text-amber-400 hover:text-amber-300 border border-amber-700/50 hover:border-amber-500 rounded-lg px-2 py-1 transition-colors"
                  >
                    ✅ Mark Taken
                  </button>
                  <button
                    onClick={() => handleCancel(ride.ride_id)}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
            <p className="text-xs text-gray-600">
              Posted {new Date(ride.created_at).toLocaleDateString()}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
