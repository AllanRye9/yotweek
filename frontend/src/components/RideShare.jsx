import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { listRides, postRide, cancelRide, takeRide, updateDriverLocation, getNearbyDrivers, calculateFare, calculateSharedFare, estimateFare, alertRideClients } from '../api'
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

export default function RideShare({ user, onRidesChange, requestedRide, onRequestedRideHandled, showSections, openChatRideId, onChatOpened }) {
  const sections = { ...DEFAULT_SECTIONS, ...(showSections || {}) }
  const isDriver = user?.role === 'driver'
  const PAGE_SIZE = 12
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
  const [vehicleColor, setVehicleColor] = useState('')
  const [vehicleType, setVehicleType] = useState('')
  const [plateNumber, setPlateNumber] = useState('')
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
  // Private client alert (driver arrival)
  const [alertingClients, setAlertingClients] = useState(false)
  const [alertClientMsg, setAlertClientMsg] = useState('')
  const [arrivedAlert, setArrivedAlert] = useState(null)       // driver_arrived event payload
  const [arrivedVisible, setArrivedVisible] = useState(false)
  const arrivedTimerRef = useRef(null)
  // Location search filter
  const [locationFilter, setLocationFilter] = useState('')
  const [userLat, setUserLat] = useState(user?.lat ?? null)
  const [userLng, setUserLng] = useState(user?.lng ?? null)
  const [gettingUserLoc, setGettingUserLoc] = useState(false)
  // Track which ride has the fare calculator open
  const [calcOpenRideId, setCalcOpenRideId] = useState(null)
  // Advanced search / filter state
  const [rideTypeFilter, setRideTypeFilter] = useState('all')  // 'all' | 'airport' | 'standard'
  const [sortBy, setSortBy] = useState('departure')             // 'departure' | 'fare_asc' | 'fare_desc'
  const [postRideType, setPostRideType] = useState('airport')   // for the post form
  const [newRideIds, setNewRideIds] = useState(new Set())
  const [page, setPage] = useState(1)

  // Fare estimation panel (input search + estimate)
  const [estimateStart, setEstimateStart]       = useState('')
  const [estimateDest, setEstimateDest]         = useState('')
  const [estimateSeats, setEstimateSeats]       = useState(1)
  const [estimateResult, setEstimateResult]     = useState(null)
  const [estimateLoading, setEstimateLoading]   = useState(false)
  const [estimateError, setEstimateError]       = useState('')
  const [showEstimator, setShowEstimator]       = useState(false)

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

  // Deep-link: open chat for a specific ride_id (from notification click)
  useEffect(() => {
    if (!openChatRideId || rides.length === 0) return
    const ride = rides.find(r => r.ride_id === openChatRideId)
    if (ride) {
      setChatRide(ride)
      setChatDefaultMsg('')
      onChatOpened?.()
    }
  }, [openChatRideId, rides]) // eslint-disable-line react-hooks/exhaustive-deps

  // Filtered + sorted ride list
  const filteredRides = useMemo(() => {
    const q = locationFilter.trim().toLowerCase()
    let list = rides

    // Location text filter
    if (q) {
      list = list.filter(r =>
        (r.origin      || '').toLowerCase().includes(q) ||
        (r.destination || '').toLowerCase().includes(q)
      )
    }

    // Ride type filter
    if (rideTypeFilter !== 'all') {
      list = list.filter(r => (r.ride_type || 'airport') === rideTypeFilter)
    }

    // Sort
    if (sortBy === 'fare_asc') {
      list = [...list].sort((a, b) => (a.fare ?? Infinity) - (b.fare ?? Infinity))
    } else if (sortBy === 'fare_desc') {
      list = [...list].sort((a, b) => (b.fare ?? -Infinity) - (a.fare ?? -Infinity))
    } else if (sortBy === 'departure') {
      // Sort open rides by distance from user location (nearest first), else by departure
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
    }

    return list
  }, [rides, locationFilter, rideTypeFilter, sortBy, userLat, userLng])

  // Paginated slice
  const totalPages = Math.max(1, Math.ceil(filteredRides.length / PAGE_SIZE))
  const pagedRides = filteredRides.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1) }, [locationFilter, rideTypeFilter, sortBy])

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

  const handleEstimateFare = async () => {
    if (!estimateStart.trim() || !estimateDest.trim()) {
      setEstimateError('Please enter both a start location and a destination.')
      return
    }
    setEstimateLoading(true)
    setEstimateError('')
    setEstimateResult(null)
    try {
      const result = await estimateFare(estimateStart.trim(), estimateDest.trim(), estimateSeats)
      setEstimateResult(result)
    } catch (e) {
      setEstimateError(e.message || 'Could not estimate fare. Try a more specific address.')
    } finally {
      setEstimateLoading(false)
    }
  }


  useEffect(() => {
    const onNewRide = (ride) => {
      setRides(prev => [ride, ...prev])
      playNewRideSound()
      // Mark this ride as freshly posted for highlight animation
      setNewRideIds(prev => new Set([...prev, ride.ride_id]))
      setTimeout(() => setNewRideIds(prev => { const s = new Set(prev); s.delete(ride.ride_id); return s }), 8000)
    }
    const onCancelled = ({ ride_id }) => setRides(prev => prev.map(r => r.ride_id === ride_id ? { ...r, status: 'cancelled' } : r))
    const onTaken = ({ ride_id }) => { setRides(prev => prev.map(r => r.ride_id === ride_id ? { ...r, status: 'taken' } : r)); playRideTakenSound() }
    const onDriverNearby = (data) => {
      // Calculate distance to driver if coordinates available
      const driverLat = data.lat
      const driverLng = data.lng
      let distKm = null
      if (driverLat != null && driverLng != null && userLat != null && userLng != null) {
        distKm = _distKm(userLat, userLng, driverLat, driverLng)
      }
      const isVeryClose = distKm != null && distKm <= 6
      playDriverAlertSound()
      setDriverAlert({ ...data, distKm, isVeryClose })
      setAlertVisible(true)
      setAlertLog(prev => [{ ...data, distKm, isVeryClose, receivedAt: Date.now() }, ...prev.slice(0, 19)])
      if (alertTimerRef.current) clearTimeout(alertTimerRef.current)
      // Very close drivers stay visible longer
      const duration = isVeryClose ? 12000 : 8000
      alertTimerRef.current = setTimeout(() => { setAlertVisible(false); setTimeout(() => setDriverAlert(null), 500) }, duration)
    }
    const onDriverArrived = (data) => {
      playDriverAlertSound()
      setArrivedAlert(data)
      setArrivedVisible(true)
      if (arrivedTimerRef.current) clearTimeout(arrivedTimerRef.current)
      arrivedTimerRef.current = setTimeout(() => {
        setArrivedVisible(false)
        setTimeout(() => setArrivedAlert(null), 500)
      }, 15000)
    }
    socket.on('new_ride', onNewRide)
    socket.on('ride_cancelled', onCancelled)
    socket.on('ride_taken', onTaken)
    socket.on('driver_nearby', onDriverNearby)
    socket.on('driver_arrived', onDriverArrived)
    return () => {
      socket.off('new_ride', onNewRide)
      socket.off('ride_cancelled', onCancelled)
      socket.off('ride_taken', onTaken)
      socket.off('driver_nearby', onDriverNearby)
      socket.off('driver_arrived', onDriverArrived)
    }
  }, [userLat, userLng])

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
      const data = await postRide(origin, destination, departure, seats, notesWithContact, originLat, originLng, destLat, destLng, fare, postRideType, vehicleColor, vehicleType, plateNumber)
      setPostOk(`Ride posted! ID: ${data.ride_id.slice(0, 8)}…`)
      setOrigin(''); setDest(''); setDeparture(''); setSeats(1); setNotes(''); setContact('')
      setVehicleColor(''); setVehicleType(''); setPlateNumber('')
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

  const handleAlertClients = async (rideId) => {
    setAlertingClients(true)
    setAlertClientMsg('')
    try {
      const data = await alertRideClients(rideId)
      if (data.alerted === 0) {
        setAlertClientMsg('ℹ️ No booked clients to alert yet.')
      } else if (data.alerted === 1) {
        setAlertClientMsg('✅ Your client has been notified that you have arrived!')
      } else {
        setAlertClientMsg(`✅ ${data.alerted} clients have been notified that you have arrived!`)
      }
    } catch (err) {
      setAlertClientMsg(err.message || 'Failed to send arrival alert.')
    } finally {
      setAlertingClients(false)
      setTimeout(() => setAlertClientMsg(''), 8000)
    }
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
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6 bg-black/70 ride-chat-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) { setChatRide(null); setChatDefaultMsg('') } }}
        >
          <div className="ride-chat-modal w-full sm:w-[90vw] sm:max-w-2xl h-[90vh] sm:h-[82vh] bg-gray-900 border border-gray-700 sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col overflow-hidden">
            <RideChat ride={chatRide} user={user} defaultMessage={chatDefaultMsg} onClose={() => { setChatRide(null); setChatDefaultMsg('') }} />
          </div>
        </div>
      )}

      {/* ── Driver nearby alert toast ── */}
      {driverAlert && (
        <div className={`fixed top-4 right-4 z-50 max-w-xs rounded-xl p-4 shadow-2xl driver-alert-toast ${alertVisible ? 'driver-alert-enter' : 'driver-alert-exit'} ${
          driverAlert.isVeryClose
            ? 'driver-alert-very-close bg-emerald-900 border-2 border-emerald-400'
            : 'bg-green-900 border border-green-500'
        }`}>
          {driverAlert.isVeryClose && (
            <div className="driver-alert-proximity-ring" />
          )}
          <div className="flex items-center gap-2 mb-1">
            <span className={`driver-alert-icon text-xl ${driverAlert.isVeryClose ? 'driver-alert-icon-urgent' : ''}`}>🚗</span>
            <p className={`font-semibold text-sm ${driverAlert.isVeryClose ? 'text-emerald-200' : 'text-green-300'}`}>
              {driverAlert.isVeryClose ? '🔥 Driver Very Close!' : 'Driver Nearby!'}
            </p>
          </div>
          {driverAlert.isVeryClose && driverAlert.distKm != null && (
            <div className="driver-alert-dist-badge mb-1">
              📍 Only {driverAlert.distKm < 1 ? `${(driverAlert.distKm * 1000).toFixed(0)}m` : `${driverAlert.distKm.toFixed(1)}km`} away!
            </div>
          )}
          <p className="text-green-200 text-xs">{driverAlert.message}</p>
          {driverAlert.driver_name && <p className="text-green-400 text-xs mt-1 font-medium">👤 {driverAlert.driver_name}</p>}
          {driverAlert.seats > 0 && <p className="text-green-300 text-xs mt-0.5">💺 {driverAlert.seats} empty seat{driverAlert.seats !== 1 ? 's' : ''}</p>}
          {driverAlert.lat != null && driverAlert.lng != null && (
            <a
              href={`https://www.google.com/maps?q=${driverAlert.lat},${driverAlert.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 text-xs text-blue-300 hover:text-blue-200 underline flex items-center gap-1"
            >
              🗺️ View on Google Maps
            </a>
          )}
        </div>
      )}

      {/* ── Driver arrived toast (shown to passengers) ── */}
      {arrivedAlert && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[90vw] max-w-sm rounded-xl p-4 shadow-2xl border-2 border-blue-400 bg-blue-900 driver-alert-toast ${arrivedVisible ? 'driver-alert-enter' : 'driver-alert-exit'}`}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">📍</span>
            <p className="font-bold text-sm text-blue-200">Your Driver Has Arrived!</p>
          </div>
          <p className="text-blue-100 text-xs">{arrivedAlert.message}</p>
          {arrivedAlert.driver_name && (
            <p className="text-blue-300 text-xs mt-1 font-medium">👤 {arrivedAlert.driver_name}</p>
          )}
          {arrivedAlert.origin && (
            <p className="text-blue-400 text-xs mt-0.5">📍 {arrivedAlert.origin} → {arrivedAlert.destination}</p>
          )}
          <button
            onClick={() => { setArrivedVisible(false); setTimeout(() => setArrivedAlert(null), 300) }}
            className="mt-2 text-xs text-blue-400 hover:text-blue-200 transition-colors"
          >
            Dismiss ✕
          </button>
        </div>
      )}



      {/* ── Driver broadcast ── */}
      {sections.driverBroadcast && isDriver && (
        <div className="rounded-xl border border-yellow-700/60 bg-yellow-900/20 p-4 space-y-3">
          <h3 className="font-semibold text-yellow-300 flex items-center gap-2">
            <span className="driver-pulse-icon">🚗</span> Broadcast Your Location
          </h3>
          <p className="text-xs text-yellow-200/70">Let nearby passengers know your car is empty and available.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button onClick={handleBroadcast} disabled={broadcasting}
              className="py-2 rounded-lg text-sm font-semibold text-white bg-yellow-700 hover:bg-yellow-600 disabled:opacity-50 transition-colors driver-broadcast-btn">
              {broadcasting
                ? <span className="flex items-center justify-center gap-2"><span className="inline-block driver-broadcast-spinner" />Broadcasting…</span>
                : '📡 Alert Nearby Passengers (Empty Car)'}
            </button>
            {/* Private client alert: alert clients who booked this ride that driver has arrived */}
            {rides.some(r => r.status === 'open' && r.user_id === user?.user_id) && (
              <button
                onClick={() => {
                  const myRide = rides.find(r => r.status === 'open' && r.user_id === user?.user_id)
                  if (myRide) handleAlertClients(myRide.ride_id)
                }}
                disabled={alertingClients}
                className="py-2 rounded-lg text-sm font-semibold text-white bg-blue-700 hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                {alertingClients
                  ? <span className="flex items-center justify-center gap-2"><span className="inline-block driver-broadcast-spinner" />Alerting…</span>
                  : '📍 I\'ve Arrived! Alert My Clients'}
              </button>
            )}
          </div>
          {broadcastMsg && <p className={`text-xs ${broadcastMsg.startsWith('📡') ? 'text-green-300' : 'text-red-300'}`}>{broadcastMsg}</p>}
          {alertClientMsg && <p className={`text-xs ${alertClientMsg.startsWith('✅') ? 'text-green-300' : alertClientMsg.startsWith('ℹ') ? 'text-blue-300' : 'text-red-300'}`}>{alertClientMsg}</p>}
          {nearbyDrivers.length > 0 && <div className="text-xs text-yellow-200/60">{nearbyDrivers.length} other driver(s) nearby.</div>}
        </div>
      )}

      {/* ── Post a ride (verified drivers only) ── */}
      {sections.form && user && !isDriver && (
        <div className="rounded-xl border border-blue-800/50 bg-blue-950/30 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">✈️</span>
            <div>
              <p className="text-sm font-semibold text-blue-300">Post Ride — Drivers Only</p>
              <p className="text-xs text-blue-400/70 mt-0.5">
                Register as a verified driver from your profile to post rides and earn on the platform.
              </p>
            </div>
          </div>
        </div>
      )}
      {sections.form && isDriver && (
        <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-200 text-sm flex items-center gap-1.5">
              <span className="ride-post-icon">🚗</span> Post a Ride
            </h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/60 text-green-300 border border-green-700/50">✅ Driver</span>
          </div>

          {/* Ride type selector — compact inline tabs */}
          <div className="flex gap-1.5">
            {[
              { value: 'airport',  label: '✈️ Airport Pickup' },
              { value: 'standard', label: '🚗 Standard Ride'  },
            ].map(opt => (
              <button key={opt.value} type="button"
                onClick={() => setPostRideType(opt.value)}
                className={`flex-1 rounded-lg border py-1.5 text-center transition-all text-xs font-medium ${
                  postRideType === opt.value
                    ? 'border-blue-500 bg-blue-900/40 text-blue-300'
                    : 'border-gray-700 bg-gray-800/60 text-gray-400 hover:border-gray-500 hover:text-gray-300'
                }`}>
                {opt.label}
              </button>
            ))}
          </div>

          <form onSubmit={handlePost} className="space-y-2">
            {/* Origin + Destination in one grid row */}
            <div className="grid grid-cols-2 gap-1.5">
              <div className="flex gap-1">
                <input type="text" placeholder={postRideType === 'airport' ? '✈️ Pickup' : '📍 Pickup'} value={origin}
                  onChange={e => setOrigin(e.target.value)}
                  required className={`${inputCls('origin')} flex-1 min-w-0`} />
                <button type="button" title="My location" onClick={handleGeoOrigin} disabled={geoLoading}
                  className="px-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs transition-colors disabled:opacity-50">
                  {geoLoading ? '…' : '📍'}
                </button>
              </div>
              <div className="flex gap-1">
                <input type="text" placeholder="🏁 Destination" value={destination}
                  onChange={e => setDest(e.target.value)}
                  required className={`${inputCls('dest')} flex-1 min-w-0`} />
                <button type="button" title="My location" onClick={handleGeoDest} disabled={geoDestLoading}
                  className="px-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs transition-colors disabled:opacity-50">
                  {geoDestLoading ? '…' : '📍'}
                </button>
              </div>
            </div>

            {/* Fare display */}
            {(fareLoading || fare != null) && (
              <div className="flex items-center gap-1.5 bg-green-900/30 border border-green-700/50 rounded-lg px-2.5 py-1.5">
                <span className="text-green-400 text-xs">💰</span>
                {fareLoading
                  ? <span className="text-green-300 text-xs">Calculating…</span>
                  : <span className="text-green-300 text-xs font-semibold">~${fare?.toFixed(2)} · $1/km</span>}
              </div>
            )}

            {/* Pickup time + Seats in one row */}
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <input type="datetime-local" value={departure}
                  onChange={e => setDeparture(e.target.value)}
                  required className={inputCls('departure')} title="Pickup time" />
              </div>
              <div>
                <input type="number" min={1} max={20} value={seats}
                  onChange={e => setSeats(Number(e.target.value))}
                  className={inputCls('seats')} placeholder="Seats" title="Available seats" />
              </div>
            </div>

            {/* Contact + Notes in one row */}
            <div className="grid grid-cols-2 gap-1.5">
              <input type="text" placeholder="📞 Contact" value={contact}
                onChange={e => setContact(e.target.value)}
                className={inputCls('contact')} />
              <textarea placeholder="📝 Notes (optional)" value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={1} className={`${inputCls('notes')} resize-none`} />
            </div>

            {/* Vehicle details row */}
            <div className="grid grid-cols-3 gap-1.5">
              <input type="text" placeholder="🎨 Vehicle Color" value={vehicleColor}
                onChange={e => setVehicleColor(e.target.value)}
                className={inputCls('vehicleColor')} />
              <select value={vehicleType} onChange={e => setVehicleType(e.target.value)}
                className={`${inputCls('vehicleType')} bg-gray-800`}>
                <option value="">🚗 Type</option>
                <option value="Sedan">Sedan</option>
                <option value="SUV">SUV</option>
                <option value="Minivan">Minivan</option>
                <option value="Hatchback">Hatchback</option>
                <option value="Truck">Truck</option>
                <option value="Bus">Bus</option>
                <option value="Other">Other</option>
              </select>
              <input type="text" placeholder="🔢 Plate No." value={plateNumber}
                onChange={e => setPlateNumber(e.target.value)}
                className={inputCls('plateNumber')} />
            </div>

            {postError && <p className="text-red-400 text-xs bg-red-900/30 border border-red-800 rounded-lg px-2.5 py-1.5">{postError}</p>}
            {postOk    && <p className="text-green-400 text-xs bg-green-900/30 border border-green-800 rounded-lg px-2.5 py-1.5">✅ {postOk}</p>}

            <button type="submit" disabled={posting}
              className="ride-post-btn w-full py-2 rounded-lg font-semibold text-white text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition-all">
              {posting
                ? <span className="flex items-center justify-center gap-2"><span className="inline-block driver-broadcast-spinner" />Posting…</span>
                : postRideType === 'airport' ? '✈️ Post Airport Pickup' : '🚗 Post Standard Ride'}
            </button>
          </form>
        </div>
      )}

      {/* ── Available rides ── */}
      {sections.list && (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-200">🗺️ All Rides</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setShowEstimator(v => !v); setEstimateResult(null); setEstimateError('') }}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${showEstimator ? 'bg-indigo-700 border-indigo-600 text-white' : 'border-gray-600 text-gray-400 hover:text-white hover:border-gray-500'}`}
            >
              💰 Estimate Fare
            </button>
            <button onClick={loadRides} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">↺ Refresh</button>
          </div>
        </div>

        {/* ── Fare Estimation Panel ── */}
        {showEstimator && (
          <div className="rounded-xl border border-indigo-700/50 bg-indigo-900/10 p-4 space-y-3">
            <p className="text-xs font-semibold text-indigo-300 flex items-center gap-1.5">
              💰 Fare Estimator{estimateResult ? ` · $${estimateResult.rate_per_km}/km` : ' · $1/km'}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Start Location</label>
                <input
                  type="text"
                  placeholder="e.g. Nairobi CBD"
                  value={estimateStart}
                  onChange={e => { setEstimateStart(e.target.value); setEstimateResult(null) }}
                  onKeyDown={e => { if (e.key === 'Enter') handleEstimateFare() }}
                  className="w-full rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Destination</label>
                <input
                  type="text"
                  placeholder="e.g. JKIA Airport"
                  value={estimateDest}
                  onChange={e => { setEstimateDest(e.target.value); setEstimateResult(null) }}
                  onKeyDown={e => { if (e.key === 'Enter') handleEstimateFare() }}
                  className="w-full rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-400">Seats</label>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={estimateSeats}
                  onChange={e => setEstimateSeats(Math.max(1, Math.min(8, Number(e.target.value))))}
                  className="w-14 rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm px-2 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <button
                onClick={handleEstimateFare}
                disabled={estimateLoading || !estimateStart.trim() || !estimateDest.trim()}
                className="flex-1 sm:flex-none rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm px-4 py-1.5 transition-colors"
              >
                {estimateLoading ? '…' : '🧮 Calculate'}
              </button>
            </div>
            {estimateError && (
              <p className="text-xs text-red-400 bg-red-900/20 border border-red-700/40 rounded-lg px-3 py-2">{estimateError}</p>
            )}
            {estimateResult && (
              <div className="rounded-lg bg-gray-800/70 border border-gray-700 p-3 space-y-1.5">
                <p className="text-xs text-gray-400">
                  📍 {estimateResult.origin_display} → {estimateResult.dest_display}
                </p>
                <div className="flex flex-wrap gap-3">
                  <span className="text-sm font-semibold text-white">
                    📏 {estimateResult.dist_km} km
                  </span>
                  <span className="text-sm font-semibold text-blue-300">
                    💰 Total fare: ${estimateResult.total_fare.toFixed(2)}
                  </span>
                  {estimateResult.seats > 1 && (
                    <span className="text-sm font-semibold text-emerald-300">
                      👤 ${estimateResult.per_seat_cost.toFixed(2)}/person ({estimateResult.seats} seats)
                    </span>
                  )}
                  <span className="text-xs text-gray-500 self-center">
                    @ ${estimateResult.rate_per_km}/km
                  </span>
                </div>
                {/* Show a note when the result is for a different route than currently typed */}
                {(estimateStart.trim() !== estimateResult.start || estimateDest.trim() !== estimateResult.destination) && (
                  <p className="text-xs text-amber-400">⚠️ This is an estimate. Actual fare may vary based on driver's confirmed route.</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Advanced search bar ── */}
        <div className="rounded-xl border border-gray-700/70 bg-gray-900/60 p-3 space-y-2">
          <p className="text-xs text-gray-400 font-semibold flex items-center gap-1.5">🔍 Search &amp; Filter</p>
          <div className="flex gap-2 items-center">
            <div className="relative flex-1">
              <input
                type="text"
                placeholder="Filter by location (origin or destination)…"
                value={locationFilter}
                onChange={e => setLocationFilter(e.target.value)}
                list="location-suggestions"
                className="w-full rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 pr-8"
              />
              {locationFilter && (
                <button onClick={() => setLocationFilter('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs" title="Clear">✕</button>
              )}
              <datalist id="location-suggestions">
                {locationSuggestions.map(s => <option key={s} value={s} />)}
              </datalist>
            </div>
            <button onClick={handleGetUserLocation} disabled={gettingUserLoc}
              title="Use my location to sort nearest rides first"
              className={`px-3 py-2 rounded-lg text-sm transition-colors shrink-0 border disabled:opacity-50 ${
                userLat != null ? 'bg-green-800/60 text-green-300 border-green-700/50 hover:bg-green-700/60' : 'bg-gray-700 hover:bg-gray-600 text-gray-300 border-gray-600'
              }`}>
              {gettingUserLoc ? '…' : userLat != null ? '📍 Near me' : '📍'}
            </button>
          </div>

          {/* Filter pills */}
          <div className="flex flex-wrap gap-2 items-center">
            {/* Ride type */}
            <div className="flex gap-1">
              {[['all','🌐 All'], ['airport','✈️ Airport'], ['standard','🚗 Standard']].map(([val, lbl]) => (
                <button key={val} onClick={() => setRideTypeFilter(val)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    rideTypeFilter === val ? 'bg-blue-700 border-blue-600 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700 hover:text-white'
                  }`}>{lbl}</button>
              ))}
            </div>

            {/* Sort */}
            <div className="flex gap-1 ml-auto">
              <span className="text-xs text-gray-500 self-center">Sort:</span>
              {[
                ['departure',  '🕐 Time'],
                ['fare_asc',   '💰 Low price'],
                ['fare_desc',  '💰 High price'],
              ].map(([val, lbl]) => (
                <button key={val} onClick={() => setSortBy(val)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    sortBy === val ? 'bg-indigo-700 border-indigo-600 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700 hover:text-white'
                  }`}>{lbl}</button>
              ))}
            </div>
          </div>

          {/* Status summary */}
          {userLat != null && (
            <p className="text-xs text-green-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
              Showing nearest rides first · {filteredRides.filter(r => r.status === 'open').length} open
            </p>
          )}
          {filteredRides.length > 0 && (
            <p className="text-xs text-gray-500">
              {filteredRides.length} ride{filteredRides.length !== 1 ? 's' : ''} found
              {filteredRides.length > PAGE_SIZE && ` · Page ${page} of ${totalPages}`}
            </p>
          )}
        </div>

        {loading && <div className="flex justify-center py-8"><div className="spinner w-8 h-8" /></div>}
        {!loading && filteredRides.length === 0 && (
          <div className="text-center py-10 text-gray-500 text-sm">
            {locationFilter || rideTypeFilter !== 'all' ? 'No rides matching your search.' : 'No rides posted yet. Be the first!'}
          </div>
        )}

        {pagedRides.map(ride => {
          const distKm = (userLat != null && ride.origin_lat != null)
            ? _distKm(userLat, userLng, ride.origin_lat, ride.origin_lng)
            : null
          const rideTypeLabel = (ride.ride_type || 'airport') === 'airport' ? '✈️' : '🚗'
          return (
          <div key={ride.ride_id}
            className={`ride-card ride-card-enter rounded-xl border p-3 sm:p-4 space-y-2 transition-all ${
              newRideIds.has(ride.ride_id)
                ? 'border-blue-400 bg-blue-900/20 ride-card-new'
              : ride.status === 'taken'     ? 'border-amber-700/60 bg-amber-900/10'
              : ride.status === 'cancelled' ? 'border-red-800/40 bg-red-900/10 opacity-60'
              : 'border-gray-700 bg-gray-800/60 hover:border-gray-600'}`}>
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <StatusTag status={ride.status} />
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-700/60 text-gray-300 border border-gray-600/50">
                    {rideTypeLabel} {(ride.ride_type || 'airport') === 'airport' ? 'Airport' : 'Standard'}
                  </span>
                  <span className="font-semibold text-white text-sm">{rideTypeLabel} {ride.origin}</span>
                  <span className="text-gray-500 text-xs">→</span>
                  <span className="font-semibold text-blue-300 text-sm">{ride.destination}</span>
                  {distKm != null && ride.status === 'open' && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full border font-medium ${
                      distKm <= 6
                        ? 'bg-emerald-900/60 text-emerald-300 border-emerald-700/60 driver-close-badge'
                        : 'bg-green-900/50 text-green-300 border-green-700/50'
                    }`}>
                      📍 {distKm < 1 ? `${(distKm * 1000).toFixed(0)}m` : `${distKm.toFixed(1)}km`}
                      {distKm <= 6 && ' 🔥'}
                    </span>
                  )}
                  {ride.fare != null ? (
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-900/50 text-blue-300 border border-blue-700/50 font-semibold">
                      💰 ${Number(ride.fare).toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-700/50 text-gray-400 border border-gray-600/50 font-semibold">
                      💰 Fare TBD
                    </span>
                  )}
                  {ride.fare != null && ride.seats > 1 && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-900/50 text-emerald-300 border border-emerald-700/50 font-semibold">
                      👤 ${(Number(ride.fare) / ride.seats).toFixed(2)}/person
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">
                  🕐 {new Date(ride.departure).toLocaleString()} · 💺 {ride.seats} seat{ride.seats !== 1 ? 's' : ''} · 👤 {ride.driver_name}
                </p>
                {(ride.vehicle_color || ride.vehicle_type || ride.plate_number) && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    {ride.vehicle_type && <span className="mr-2">🚗 {ride.vehicle_type}</span>}
                    {ride.vehicle_color && <span className="mr-2">🎨 {ride.vehicle_color}</span>}
                    {ride.plate_number && <span>🔢 {ride.plate_number}</span>}
                  </p>
                )}
                {ride.origin_lat != null && ride.origin_lng != null && (
                  <a
                    href={`https://www.google.com/maps?q=${ride.origin_lat},${ride.origin_lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:text-blue-300 underline flex items-center gap-1 mt-0.5"
                  >
                    🗺️ View pickup on Google Maps
                  </a>
                )}
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
              <div className="flex flex-row sm:flex-col gap-1.5 shrink-0 flex-wrap">
                {ride.status === 'open' && !isDriver && (!user || user.user_id !== ride.user_id) && (
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

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2 border-t border-gray-700/50">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="text-xs px-4 py-2 rounded-lg border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
            >
              ← Back
            </button>
            <div className="flex gap-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1).slice(
                Math.max(0, page - 3), Math.min(totalPages, page + 2)
              ).map(p => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`text-xs w-7 h-7 rounded-lg border transition-colors ${
                    p === page ? 'bg-blue-700 border-blue-600 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="text-xs px-4 py-2 rounded-lg border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
            >
              Next →
            </button>
          </div>
        )}
      </div>
      )}
    </div>
  )
}
