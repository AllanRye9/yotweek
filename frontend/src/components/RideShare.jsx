import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { listRides, postRide, cancelRide, takeRide, updateDriverLocation, getNearbyDrivers, calculateFare, calculateSharedFare } from '../api'
import { playDriverAlertSound, playRideTakenSound, playNewRideSound } from '../sounds'
import socket from '../socket'
import RideChat from './RideChat'

/** Haversine distance in km between two lat/lng points. */
function _distKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Build the default booking message sent to a driver, prompting the client to share details. */
function _buildClientBookingMsg(ride, userName) {
  return (
    `Hi ${ride.driver_name || 'Driver'}, I need an airport pickup from ${ride.origin} to ${ride.destination}. Please find my details below:\n\n` +
    `Name: ${userName || '[your name]'}\n` +
    `Contact: [your phone/WhatsApp]\n` +
    `Current Location: [please share your location]\n\n` +
    `Are you available?`
  )
}

/** Default sections shown when showSections is not specified */
const DEFAULT_SECTIONS = { form: true, list: true, dashboard: true, driverBroadcast: true }

/**
 * Inline fare calculator widget for a single ride.
 * Lets a passenger choose how many seats to book (shared or whole vehicle)
 * and see the proportional cost.
 */
function FareCalculator({ ride }) {
  const totalSeats = ride.seats || 1
  const totalFare  = ride.fare  ?? null
  const [bookedSeats, setBookedSeats]   = useState(1)
  const [result,      setResult]        = useState(null)
  const [loading,     setLoading]       = useState(false)
  const [error,       setError]         = useState('')

  const calc = async (seats) => {
    if (totalFare == null) { setError('Fare not set for this ride.'); return }
    setLoading(true)
    setError('')
    try {
      const d = await calculateSharedFare(totalFare, totalSeats, seats)
      setResult(d)
    } catch (e) {
      setError(e.message || 'Calculation failed.')
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e) => {
    const v = Math.min(Math.max(1, Number(e.target.value)), totalSeats)
    setBookedSeats(v)
    setResult(null)
  }

  if (totalFare == null) return (
    <p className="text-xs text-gray-500 italic">Fare not available for this ride.</p>
  )

  return (
    <div className="mt-2 rounded-lg border border-indigo-800/50 bg-indigo-950/30 p-3 space-y-2">
      <p className="text-xs font-semibold text-indigo-300 flex items-center gap-1.5">🧮 Fare Calculator</p>
      <p className="text-xs text-indigo-400/70">
        Total fare: <strong className="text-indigo-300">${totalFare.toFixed(2)}</strong> for {totalSeats} seat{totalSeats !== 1 ? 's' : ''} · Rate: $1.00/km
      </p>
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-400 shrink-0">Seats to book:</label>
        <input type="number" min={1} max={totalSeats} value={bookedSeats} onChange={handleChange}
          className="w-16 rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-xs p-1.5 text-center focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        <span className="text-xs text-gray-500">of {totalSeats}</span>
        <button onClick={() => calc(bookedSeats)} disabled={loading}
          className="ml-auto text-xs px-3 py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-600 text-white font-semibold disabled:opacity-50 transition-colors">
          {loading ? '…' : 'Calculate'}
        </button>
      </div>

      {/* Quick select buttons */}
      <div className="flex gap-1.5 flex-wrap">
        {Array.from({ length: totalSeats }, (_, i) => i + 1).map(n => (
          <button key={n} onClick={() => { setBookedSeats(n); calc(n) }}
            className={`text-xs px-2 py-1 rounded-full border transition-colors ${
              bookedSeats === n && result
                ? 'bg-indigo-700 border-indigo-600 text-white'
                : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700 hover:text-white'
            }`}>
            {n === totalSeats ? `${n} 🚐 Whole` : `${n} seat${n > 1 ? 's' : ''}`}
          </button>
        ))}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {result && (
        <div className={`rounded-lg px-3 py-2 border text-xs ${result.is_full_vehicle
          ? 'bg-amber-900/30 border-amber-700/50'
          : 'bg-green-900/30 border-green-700/50'}`}>
          {result.is_full_vehicle ? (
            <p className="text-amber-300 font-semibold">🚐 Full Vehicle — You pay: <strong>${result.amount_owed.toFixed(2)}</strong></p>
          ) : (
            <>
              <p className="text-green-300 font-semibold">
                🤝 Shared Ride ({result.booked_seats}/{result.total_seats} seats) — You pay: <strong>${result.amount_owed.toFixed(2)}</strong>
              </p>
              <p className="text-green-400/70 mt-0.5">
                ${result.per_seat_cost.toFixed(2)}/seat · Save ${(result.total_fare - result.amount_owed).toFixed(2)} vs full vehicle
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function RideShare({ user, onRidesChange, requestedRide, onRequestedRideHandled, showSections }) {
  const sections = { ...DEFAULT_SECTIONS, ...(showSections || {}) }
  const isDriver = user?.role === 'driver'
  const [rides, setRides] = useState([])
  const [loading, setLoading] = useState(false)
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState('')
  const [postOk, setPostOk] = useState('')
  const [driverAlert, setDriverAlert] = useState(null)
  const [alertVisible, setAlertVisible] = useState(false)
  const [alertLog, setAlertLog] = useState([])
  const alertTimerRef = useRef(null)
  const [origin, setOrigin] = useState('')
  const [destination, setDest] = useState('')
  const [departure, setDeparture] = useState('')
  const [seats, setSeats] = useState(1)
  const [notes, setNotes] = useState('')
  const [contact, setContact] = useState('')
  const [geoLoading, setGeoLoading] = useState(false)
  const [originLat, setOriginLat] = useState(null)
  const [originLng, setOriginLng] = useState(null)
  const [destLat, setDestLat] = useState(null)
  const [destLng, setDestLng] = useState(null)
  const [fare, setFare] = useState(null)
  const [fareLoading, setFareLoading] = useState(false)
  const [geoDestLoading, setGeoDestLoading] = useState(false)
  const [focusedField, setFocusedField] = useState(null)
  const [broadcasting, setBroadcasting] = useState(false)
  const [broadcastMsg, setBroadcastMsg] = useState('')
  const [nearbyDrivers, setNearbyDrivers] = useState([])
  const [chatRide, setChatRide] = useState(null)
  const [chatDefaultMsg, setChatDefaultMsg] = useState('')
  // Location search filter
  const [locationFilter, setLocationFilter] = useState('')
  const [userLat, setUserLat] = useState(user?.lat ?? null)
  const [userLng, setUserLng] = useState(user?.lng ?? null)
  const [gettingUserLoc, setGettingUserLoc] = useState(false)
  // Track which ride has the fare calculator open
  const [calcOpenRideId, setCalcOpenRideId] = useState(null)

  const loadRides = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listRides()
      setRides(data.rides || [])
    } catch (_) {}
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadRides() }, [loadRides])

  // Notify parent of rides changes (for map)
  useEffect(() => { onRidesChange?.(rides) }, [rides, onRidesChange])

  // Sync user location from profile
  useEffect(() => {
    setUserLat(user?.lat ?? null)
    setUserLng(user?.lng ?? null)
  }, [user?.lat, user?.lng])

  // Open chat from map "Request Ride" with a pre-filled default message
  useEffect(() => {
    if (requestedRide) {
      setChatRide(requestedRide.ride)
      setChatDefaultMsg(requestedRide.defaultMsg || '')
      onRequestedRideHandled?.()
    }
  }, [requestedRide]) // eslint-disable-line react-hooks/exhaustive-deps

  // Filtered + sorted ride list
  const filteredRides = useMemo(() => {
    const q = locationFilter.trim().toLowerCase()
    let list = rides
    if (q) {
      list = list.filter(r =>
        (r.origin      || '').toLowerCase().includes(q) ||
        (r.destination || '').toLowerCase().includes(q)
      )
    }
    // Sort open rides by distance from user location (nearest first)
    if (userLat != null && userLng != null) {
      list = [...list].sort((a, b) => {
        const aOpen = a.status === 'open' && a.origin_lat != null
        const bOpen = b.status === 'open' && b.origin_lat != null
        if (!aOpen && !bOpen) return 0
        if (!aOpen) return 1
        if (!bOpen) return -1
        const da = _distKm(userLat, userLng, a.origin_lat, a.origin_lng)
        const db = _distKm(userLat, userLng, b.origin_lat, b.origin_lng)
        return da - db
      })
    }
    return list
  }, [rides, locationFilter, userLat, userLng])

  // Available origin locations for autocomplete suggestions
  const locationSuggestions = useMemo(() => {
    const origins = rides
      .filter(r => r.status === 'open' && r.origin)
      .map(r => r.origin)
    return [...new Set(origins)].slice(0, 8)
  }, [rides])

  const handleGetUserLocation = () => {
    if (!navigator.geolocation) return
    setGettingUserLoc(true)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setUserLat(coords.latitude)
        setUserLng(coords.longitude)
        setGettingUserLoc(false)
      },
      () => setGettingUserLoc(false),
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }

  // Auto-calculate fare when both origin and destination coords are available
  useEffect(() => {
    if (originLat == null || originLng == null || destLat == null || destLng == null) return
    let cancelled = false
    setFareLoading(true)
    calculateFare(originLat, originLng, destLat, destLng)
      .then(d => { if (!cancelled) setFare(d.fare) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setFareLoading(false) })
    return () => { cancelled = true }
  }, [originLat, originLng, destLat, destLng])


  useEffect(() => {
    const onNewRide = (ride) => { setRides(prev => [ride, ...prev]); playNewRideSound() }
    const onCancelled = ({ ride_id }) => setRides(prev => prev.map(r => r.ride_id === ride_id ? { ...r, status: 'cancelled' } : r))
    const onTaken = ({ ride_id }) => { setRides(prev => prev.map(r => r.ride_id === ride_id ? { ...r, status: 'taken' } : r)); playRideTakenSound() }
    const onDriverNearby = (data) => {
      playDriverAlertSound()
      setDriverAlert(data)
      setAlertVisible(true)
      setAlertLog(prev => [{ ...data, receivedAt: Date.now() }, ...prev.slice(0, 19)])
      if (alertTimerRef.current) clearTimeout(alertTimerRef.current)
      alertTimerRef.current = setTimeout(() => { setAlertVisible(false); setTimeout(() => setDriverAlert(null), 500) }, 8000)
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

  useEffect(() => { if (user?.user_id) socket.emit('identify', { user_id: user.user_id }) }, [user])

  const handleGeoOrigin = () => {
    if (!navigator.geolocation) return
    setGeoLoading(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => { setOriginLat(pos.coords.latitude); setOriginLng(pos.coords.longitude); setOrigin(`${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`); setGeoLoading(false) },
      () => setGeoLoading(false),
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }

  const handleGeoDest = () => {
    if (!navigator.geolocation) return
    setGeoDestLoading(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => { setDestLat(pos.coords.latitude); setDestLng(pos.coords.longitude); setGeoDestLoading(false) },
      () => setGeoDestLoading(false),
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }

  const handlePost = async (e) => {
    e.preventDefault(); setPostError(''); setPostOk('')
    if (!user) { setPostError('Please login first.'); return }
    setPosting(true)
    try {
      const notesTrimmed = notes.trim()
      const notesWithContact = contact.trim() ? `${notesTrimmed}${notesTrimmed ? ' | ' : ''}Contact: ${contact.trim()}` : notesTrimmed
      const data = await postRide(origin, destination, departure, seats, notesWithContact, originLat, originLng, destLat, destLng, fare)
      setPostOk(`Ride posted! ID: ${data.ride_id.slice(0, 8)}…`)
      setOrigin(''); setDest(''); setDeparture(''); setSeats(1); setNotes(''); setContact('')
      setOriginLat(null); setOriginLng(null); setDestLat(null); setDestLng(null); setFare(null)
    } catch (err) { setPostError(err.message || 'Failed to post ride.') }
    finally { setPosting(false) }
  }

  const handleCancel = async (rideId) => {
    try { await cancelRide(rideId); setRides(prev => prev.map(r => r.ride_id === rideId ? { ...r, status: 'cancelled' } : r)) }
    catch (err) { alert(err.message || 'Cancel failed.') }
  }

  const handleTake = async (rideId) => {
    try { await takeRide(rideId); setRides(prev => prev.map(r => r.ride_id === rideId ? { ...r, status: 'taken' } : r)); playRideTakenSound() }
    catch (err) { alert(err.message || 'Failed to mark ride as taken.') }
  }

  const handleBroadcast = () => {
    if (!navigator.geolocation) { setBroadcastMsg('Geolocation not supported.'); return }
    setBroadcasting(true)
    // Find the driver's open ride to include seat count
    const openRide = rides.find(r => r.status === 'open' && r.user_id === user?.user_id)
    const emptySeatCount = openRide?.seats ?? 0
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await updateDriverLocation(pos.coords.latitude, pos.coords.longitude, true, emptySeatCount)
          setBroadcastMsg('📡 Your empty-car alert was sent to nearby passengers!')
          const d = await getNearbyDrivers(pos.coords.latitude, pos.coords.longitude, 20)
          setNearbyDrivers(d.drivers || [])
        } catch (err) { setBroadcastMsg(err.message || 'Broadcast failed.') }
        finally { setBroadcasting(false); setTimeout(() => setBroadcastMsg(''), 6000) }
      },
      () => { setBroadcastMsg('Location permission denied.'); setBroadcasting(false) },
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }

  const StatusTag = ({ status }) => {
    const cfg = {
      open:      { cls: 'ride-tag-open',      label: '🟢 Open'      },
      taken:     { cls: 'ride-tag-taken',     label: '🟡 Taken'     },
      cancelled: { cls: 'ride-tag-cancelled', label: '🔴 Cancelled' },
    }
    const { cls, label } = cfg[status] ?? cfg.open
    return <span className={`ride-status-tag ${cls}`}>{label}</span>
  }

  const statsOpen      = rides.filter(r => r.status === 'open').length
  const statsTaken     = rides.filter(r => r.status === 'taken').length
  const statsCancelled = rides.filter(r => r.status === 'cancelled').length

  const inputCls = (field) =>
    `w-full rounded-lg bg-gray-800 border text-gray-100 text-sm p-2.5 focus:outline-none ride-form-input transition-all duration-200 ${
      focusedField === field
        ? 'border-blue-400 ring-2 ring-blue-500/40 ride-form-input-focused shadow-[0_0_12px_rgba(59,130,246,0.25)]'
        : 'border-gray-600'
    }`

  return (
    <div className="space-y-6">

      {/* ── Chat modal overlay ── */}
      {chatRide && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 ride-chat-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) { setChatRide(null); setChatDefaultMsg('') } }}
        >
          <div className="ride-chat-modal w-full sm:w-[420px] sm:max-w-full h-[80vh] sm:h-[520px] bg-gray-900 border border-gray-700 sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col overflow-hidden">
            <RideChat ride={chatRide} user={user} defaultMessage={chatDefaultMsg} onClose={() => { setChatRide(null); setChatDefaultMsg('') }} />
          </div>
        </div>
      )}

      {/* ── Driver nearby alert toast ── */}
      {driverAlert && (
        <div className={`fixed top-4 right-4 z-50 max-w-xs bg-green-900 border border-green-500 rounded-xl p-4 shadow-2xl driver-alert-toast ${alertVisible ? 'driver-alert-enter' : 'driver-alert-exit'}`}>
          <div className="flex items-center gap-2 mb-1">
            <span className="driver-alert-icon text-xl">🚗</span>
            <p className="text-green-300 font-semibold text-sm">Driver Nearby!</p>
          </div>
          <p className="text-green-200 text-xs">{driverAlert.message}</p>
          {driverAlert.driver_name && <p className="text-green-400 text-xs mt-1 font-medium">👤 {driverAlert.driver_name}</p>}
          {driverAlert.seats > 0 && <p className="text-green-300 text-xs mt-0.5">💺 {driverAlert.seats} empty seat{driverAlert.seats !== 1 ? 's' : ''}</p>}
        </div>
      )}

      {/* ── Dashboard ── */}
      {sections.dashboard && (
      <div className="ride-dashboard rounded-xl border border-gray-700 bg-gray-900/50 p-4 space-y-3">
        <h3 className="font-semibold text-gray-200 text-sm flex items-center gap-2">📊 Ride Dashboard</h3>
        <div className="grid grid-cols-3 gap-2">
          <div className="ride-stat-card rounded-lg bg-green-900/25 border border-green-700/40 p-3 text-center">
            <p className="text-2xl font-bold text-green-400">{statsOpen}</p>
            <p className="text-xs text-green-300/80 mt-0.5">Open</p>
          </div>
          <div className="ride-stat-card rounded-lg bg-amber-900/25 border border-amber-700/40 p-3 text-center">
            <p className="text-2xl font-bold text-amber-400">{statsTaken}</p>
            <p className="text-xs text-amber-300/80 mt-0.5">Taken</p>
          </div>
          <div className="ride-stat-card rounded-lg bg-red-900/20 border border-red-800/40 p-3 text-center">
            <p className="text-2xl font-bold text-red-400">{statsCancelled}</p>
            <p className="text-xs text-red-300/80 mt-0.5">Cancelled</p>
          </div>
        </div>
        {alertLog.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs text-gray-400 font-medium flex items-center gap-1.5">
              <span className="driver-pulse-icon">🚗</span> Recent Driver Alerts
            </p>
            <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
              {alertLog.map((a, i) => (
                <div key={i} className="flex items-center justify-between gap-2 bg-green-900/20 border border-green-700/30 rounded-lg px-2.5 py-1.5 text-xs">
                  <span className="text-green-300 font-medium truncate">🚗 {a.driver_name || 'Driver'} — {a.empty ? 'empty car' : 'occupied'}</span>
                  <span className="text-gray-500 shrink-0">{new Date(a.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      )}

      {/* ── Driver broadcast ── */}
      {sections.driverBroadcast && isDriver && (
        <div className="rounded-xl border border-yellow-700/60 bg-yellow-900/20 p-4 space-y-3">
          <h3 className="font-semibold text-yellow-300 flex items-center gap-2">
            <span className="driver-pulse-icon">🚗</span> Broadcast Your Location
          </h3>
          <p className="text-xs text-yellow-200/70">Let nearby passengers know your car is empty and available.</p>
          <button onClick={handleBroadcast} disabled={broadcasting}
            className="w-full py-2 rounded-lg text-sm font-semibold text-white bg-yellow-700 hover:bg-yellow-600 disabled:opacity-50 transition-colors driver-broadcast-btn">
            {broadcasting
              ? <span className="flex items-center justify-center gap-2"><span className="inline-block driver-broadcast-spinner" />Broadcasting…</span>
              : '📡 Alert Nearby Passengers (Empty Car)'}
          </button>
          {broadcastMsg && <p className={`text-xs ${broadcastMsg.startsWith('📡') ? 'text-green-300' : 'text-red-300'}`}>{broadcastMsg}</p>}
          {nearbyDrivers.length > 0 && <div className="text-xs text-yellow-200/60">{nearbyDrivers.length} other driver(s) nearby.</div>}
        </div>
      )}

      {/* ── Post a ride (verified drivers only) ── */}
      {sections.form && user && !isDriver && (
        <div className="rounded-xl border border-blue-800/50 bg-blue-950/30 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">✈️</span>
            <div>
              <p className="text-sm font-semibold text-blue-300">Post Airport Pickup — Drivers Only</p>
              <p className="text-xs text-blue-400/70 mt-0.5">
                Register as a verified driver from your profile to post pickup rides and earn on the platform.
              </p>
            </div>
          </div>
        </div>
      )}
      {sections.form && isDriver && (
        <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-4 space-y-4">
          <h3 className="font-semibold text-gray-200 flex items-center gap-2">
            <span className="ride-post-icon">✈️</span> Post Airport Pickup
            <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-green-900/60 text-green-300 border border-green-700/50">✅ Verified Driver</span>
          </h3>
          <form onSubmit={handlePost} className="space-y-3">
            <div className="flex gap-2">
              <div className="flex-1 ride-field-wrap">
                <input type="text" placeholder="✈️ Airport / Pickup Location" value={origin}
                  onChange={e => setOrigin(e.target.value)} onFocus={() => setFocusedField('origin')} onBlur={() => setFocusedField(null)}
                  required className={inputCls('origin')} />
                {focusedField === 'origin' && <span className="ride-field-hint text-xs text-blue-400/80">✈️ Which airport are you picking up from?</span>}
              </div>
              <button type="button" title="Use my current location as pickup" onClick={handleGeoOrigin} disabled={geoLoading}
                className="px-3 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm transition-colors disabled:opacity-50">
                {geoLoading ? '…' : '📍'}
              </button>
            </div>

            <div className="flex gap-2">
              <div className="flex-1 ride-field-wrap">
                <input type="text" placeholder="🏁 Destination" value={destination}
                  onChange={e => setDest(e.target.value)} onFocus={() => setFocusedField('dest')} onBlur={() => setFocusedField(null)}
                  required className={inputCls('dest')} />
                {focusedField === 'dest' && <span className="ride-field-hint text-xs text-blue-400/80">🏁 Where are you dropping passengers off?</span>}
              </div>
              <button type="button" title="Use my current location as destination" onClick={handleGeoDest} disabled={geoDestLoading}
                className="px-3 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm transition-colors disabled:opacity-50">
                {geoDestLoading ? '…' : '📍'}
              </button>
            </div>

            {/* Auto-calculated fare display */}
            {(fareLoading || fare != null) && (
              <div className="flex items-center gap-2 bg-green-900/30 border border-green-700/50 rounded-lg px-3 py-2">
                <span className="text-green-400 text-sm">💰</span>
                {fareLoading
                  ? <span className="text-green-300 text-xs">Calculating fare…</span>
                  : <span className="text-green-300 text-xs font-semibold">Estimated Fare: ${fare?.toFixed(2)} · Rate: $1.00/km</span>}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="ride-field-wrap">
                <label className="text-xs text-gray-400 mb-1 block">Pickup Time</label>
                <input type="datetime-local" value={departure}
                  onChange={e => setDeparture(e.target.value)} onFocus={() => setFocusedField('departure')} onBlur={() => setFocusedField(null)}
                  required className={inputCls('departure')} />
                {focusedField === 'departure' && <span className="ride-field-hint text-xs text-blue-400/80">🕐 When are you picking up?</span>}
              </div>
              <div className="ride-field-wrap">
                <label className="text-xs text-gray-400 mb-1 block">Available Seats</label>
                <input type="number" min={1} max={20} value={seats}
                  onChange={e => setSeats(Number(e.target.value))} onFocus={() => setFocusedField('seats')} onBlur={() => setFocusedField(null)}
                  className={inputCls('seats')} />
                {focusedField === 'seats' && <span className="ride-field-hint text-xs text-blue-400/80">💺 How many passengers can you take?</span>}
              </div>
            </div>

            <div className="ride-field-wrap">
              <input type="text" placeholder="Contact (phone / WhatsApp / email)" value={contact}
                onChange={e => setContact(e.target.value)} onFocus={() => setFocusedField('contact')} onBlur={() => setFocusedField(null)}
                className={inputCls('contact')} />
              {focusedField === 'contact' && <span className="ride-field-hint text-xs text-blue-400/80">📞 How should passengers reach you?</span>}
            </div>

            <div className="ride-field-wrap">
              <textarea placeholder="Notes (optional) — e.g. luggage allowed, vehicle type…" value={notes}
                onChange={e => setNotes(e.target.value)} onFocus={() => setFocusedField('notes')} onBlur={() => setFocusedField(null)}
                rows={2} className={`${inputCls('notes')} resize-none`} />
              {focusedField === 'notes' && <span className="ride-field-hint text-xs text-blue-400/80">📝 Any extra details for passengers?</span>}
            </div>

            {postError && <p className="text-red-400 text-xs bg-red-900/30 border border-red-800 rounded-lg px-3 py-2">{postError}</p>}
            {postOk    && <p className="text-green-400 text-xs bg-green-900/30 border border-green-800 rounded-lg px-3 py-2">✅ {postOk}</p>}

            <button type="submit" disabled={posting}
              className="ride-post-btn w-full py-2.5 rounded-lg font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition-all">
              {posting
                ? <span className="flex items-center justify-center gap-2"><span className="inline-block driver-broadcast-spinner" />Posting…</span>
                : '✈️ Post Airport Pickup'}
            </button>
          </form>
        </div>
      )}

      {/* ── Available rides ── */}
      {sections.list && (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-200">🗺️ Airport Pickups</h3>
          <button onClick={loadRides} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">↺ Refresh</button>
        </div>

        {/* Location search filter */}
        <div className="space-y-2">
          <div className="flex gap-2 items-center">
            <div className="relative flex-1">
              <input
                type="text"
                placeholder="🔍 Filter by location (origin or destination)…"
                value={locationFilter}
                onChange={e => setLocationFilter(e.target.value)}
                list="location-suggestions"
                className="w-full rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 pr-8"
              />
              {locationFilter && (
                <button
                  onClick={() => setLocationFilter('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs"
                  title="Clear filter"
                >✕</button>
              )}
              <datalist id="location-suggestions">
                {locationSuggestions.map(s => <option key={s} value={s} />)}
              </datalist>
            </div>
            <button
              onClick={handleGetUserLocation}
              disabled={gettingUserLoc}
              title="Use my location to sort nearest rides first"
              className={`px-3 py-2 rounded-lg text-sm transition-colors shrink-0 ${
                userLat != null
                  ? 'bg-green-800/60 text-green-300 border border-green-700/50 hover:bg-green-700/60'
                  : 'bg-gray-700 hover:bg-gray-600 text-gray-300 border border-gray-600'
              } disabled:opacity-50`}
            >
              {gettingUserLoc ? '…' : userLat != null ? '📍 Near me' : '📍'}
            </button>
          </div>
          {userLat != null && (
            <p className="text-xs text-green-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
              Showing nearest rides first · {filteredRides.filter(r => r.status === 'open').length} open ride{filteredRides.filter(r => r.status === 'open').length !== 1 ? 's' : ''}
            </p>
          )}
          {locationFilter && !userLat && (
            <p className="text-xs text-gray-500">
              {filteredRides.length} result{filteredRides.length !== 1 ? 's' : ''} for "{locationFilter}"
            </p>
          )}
        </div>

        {loading && <div className="flex justify-center py-8"><div className="spinner w-8 h-8" /></div>}
        {!loading && filteredRides.length === 0 && (
          <div className="text-center py-10 text-gray-500 text-sm">
            {locationFilter ? `No rides matching "${locationFilter}".` : 'No rides posted yet. Be the first!'}
          </div>
        )}

        {filteredRides.map(ride => {
          const distKm = (userLat != null && ride.origin_lat != null)
            ? _distKm(userLat, userLng, ride.origin_lat, ride.origin_lng)
            : null
          return (
          <div key={ride.ride_id}
            className={`ride-card ride-card-enter rounded-xl border p-4 space-y-2 transition-all ${
              ride.status === 'taken'     ? 'border-amber-700/60 bg-amber-900/10'
            : ride.status === 'cancelled' ? 'border-red-800/40 bg-red-900/10 opacity-60'
            : 'border-gray-700 bg-gray-800/60 hover:border-gray-600'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <StatusTag status={ride.status} />
                  <span className="font-semibold text-white text-sm">✈️ {ride.origin}</span>
                  <span className="text-gray-500 text-xs">→</span>
                  <span className="font-semibold text-blue-300 text-sm">{ride.destination}</span>
                  {distKm != null && ride.status === 'open' && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-900/50 text-green-300 border border-green-700/50">
                      📍 {distKm < 1 ? `${(distKm * 1000).toFixed(0)}m` : `${distKm.toFixed(1)}km`}
                    </span>
                  )}
                  {ride.fare != null && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-900/50 text-blue-300 border border-blue-700/50 font-semibold">
                      💰 ${Number(ride.fare).toFixed(2)}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400">
                  🕐 {new Date(ride.departure).toLocaleString()} · 💺 {ride.seats} seat{ride.seats !== 1 ? 's' : ''} · 👤 {ride.driver_name}
                </p>
                {ride.notes && !ride.notes.includes('Contact:') && (
                  <p className="text-xs text-gray-500 mt-1 italic">"{ride.notes}"</p>
                )}
                {ride.notes && ride.notes.includes('Contact:') && (() => {
                  const contactVal = ride.notes.split('Contact:')[1]?.trim() ?? ''
                  const notePart   = ride.notes.includes('| Contact:') ? ride.notes.split('| Contact:')[0].trim() : ''
                  return (
                    <>
                      {notePart  && <p className="text-xs text-gray-500 mt-1 italic">"{notePart}"</p>}
                      {contactVal && <p className="text-xs text-blue-400 mt-1">📞 {contactVal}</p>}
                    </>
                  )
                })()}
              </div>
              <div className="flex flex-col gap-1.5 shrink-0">
                {ride.status === 'open' && (
                  <button onClick={() => { setChatRide(ride); setChatDefaultMsg(_buildClientBookingMsg(ride, user?.name)) }}
                    className="ride-chat-btn text-xs text-blue-400 hover:text-blue-300 border border-blue-700/50 hover:border-blue-500 rounded-lg px-2 py-1 transition-colors flex items-center gap-1">
                    💬 Book
                  </button>
                )}
                {ride.status === 'open' && ride.fare != null && (
                  <button
                    onClick={() => setCalcOpenRideId(id => id === ride.ride_id ? null : ride.ride_id)}
                    className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-800/50 hover:border-indigo-600 rounded-lg px-2 py-1 transition-colors flex items-center gap-1">
                    🧮 Fare
                  </button>
                )}
                {user && ride.user_id === user.user_id && ride.status === 'open' && (
                  <>
                    <button onClick={() => handleTake(ride.ride_id)}
                      className="text-xs text-amber-400 hover:text-amber-300 border border-amber-700/50 hover:border-amber-500 rounded-lg px-2 py-1 transition-colors">
                      ✅ Mark Taken
                    </button>
                    <button onClick={() => handleCancel(ride.ride_id)}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors">
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
            {/* Fare calculator (toggle per ride) */}
            {calcOpenRideId === ride.ride_id && (
              <FareCalculator ride={ride} />
            )}
            <p className="text-xs text-gray-600">Posted {new Date(ride.created_at).toLocaleDateString()}</p>
          </div>
          )
        })}
      </div>
      )}
    </div>
  )
}
