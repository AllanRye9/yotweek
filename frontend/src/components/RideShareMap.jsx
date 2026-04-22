import { useEffect, useRef, useState, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { getAllDriverLocations } from '../api'
import socket from '../socket'

// Fix default marker icon paths broken by bundlers
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({ iconRetinaUrl: markerIcon2x, iconUrl: markerIcon, shadowUrl: markerShadow })

/**
 * Extract a phone/contact number from a ride notes string.
 * Looks for "Contact: <value>" pattern inserted by RideShare.
 */
function _extractContact(notes) {
  if (!notes) return null
  const m = notes.match(/Contact:\s*([^\|]+)/i)
  return m ? m[1].trim() : null
}

/**
 * Compute a human-readable countdown to a departure string like "2026-03-25T14:30".
 * Returns { label, urgent } where urgent=true when < 30 min away.
 */
function _countdown(departure) {
  if (!departure) return null
  const dep = new Date(departure)
  if (isNaN(dep.getTime())) return null
  const diff = dep - Date.now()
  if (diff <= 0) return { label: 'Departed', urgent: false }
  const totalMin = Math.floor(diff / 60000)
  const hrs = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  const label = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`
  return { label, urgent: totalMin < 30 }
}

// ── Haversine distance (km) ─────────────────────────────────────────────────
function _haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const DRIVER_PROXIMITY_KM = 5

/**
 * RideShareMap — OpenStreetMap (Leaflet) map showing available rides, driver
 * locations and the current user's position.
 *
 * Props:
 *  rides            - Array of ride objects with origin_lat/origin_lng
 *  userLocation     - { lat, lng } of the current user (optional)
 *  onRequestRide(ride) - called when user clicks "Request Ride" on a marker
 *  driverLocations  - Array of { lat, lng, name, empty } driver positions
 *  autoLoadDrivers  - When true, continuously fetches drivers every 5s
 *  onLocationUpdate - Called with {lat, lng} when the map auto-detects location
 */
export default function RideShareMap({ rides = [], userLocation, onRequestRide, onOpenChat, driverLocations: propDriverLocations = [], autoLoadDrivers = true, onLocationUpdate, mapHeight = 300, confirmedLocations = [] }) {
  const mapRef      = useRef(null)
  const instanceRef = useRef(null)
  const tileLayerRef = useRef(null)
  const markersRef  = useRef([])
  const driverMarkersRef = useRef([])
  const confirmedMarkersRef = useRef([])
  const userMarkerRef    = useRef(null)
  const accuracyCircleRef = useRef(null)
  const [selectedRide, setSelectedRide] = useState(null)
  const [driverLocations, setDriverLocations] = useState(propDriverLocations)
  const [liveTracking, setLiveTracking] = useState(false)
  const watchIdRef = useRef(null)
  // Map language: 'en' = English (default), 'local' = locale-aware
  const [mapLang, setMapLang] = useState('en')
  // Countdown tick — re-renders the panel every minute
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  // Keep driverLocations in sync with props
  useEffect(() => {
    if (propDriverLocations.length > 0 || !autoLoadDrivers) {
      setDriverLocations(propDriverLocations)
    }
  }, [propDriverLocations, autoLoadDrivers])

  // Auto-load driver locations from API
  const refreshDriverLocations = useCallback(() => {
    if (!autoLoadDrivers) return
    getAllDriverLocations()
      .then(d => setDriverLocations(d.drivers || []))
      .catch(() => {})
  }, [autoLoadDrivers])

  useEffect(() => {
    refreshDriverLocations()
    const id = setInterval(refreshDriverLocations, 5_000)
    return () => clearInterval(id)
  }, [refreshDriverLocations])

  // Listen for driver_nearby socket events to refresh immediately
  useEffect(() => {
    const handler = () => refreshDriverLocations()
    socket.on('driver_nearby', handler)
    return () => socket.off('driver_nearby', handler)
  }, [refreshDriverLocations])

  // ── Initialise map ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (instanceRef.current || !mapRef.current) return

    const map = L.map(mapRef.current, {
      center:      [20, 0],
      zoom:        2,
      minZoom:     1,
      maxZoom:     18,
      zoomControl: true,
      attributionControl: true,
    })

    // Default to English CartoDB tiles
    tileLayerRef.current = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      {
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions" target="_blank">CARTO</a>',
        maxZoom: 19,
        subdomains: 'abcd',
      }
    ).addTo(map)

    instanceRef.current = map
    return () => {
      map.remove()
      instanceRef.current = null
      tileLayerRef.current = null
    }
  }, [])

  // ── Swap tile layer when language changes ────────────────────────────────────
  useEffect(() => {
    const map = instanceRef.current
    if (!map) return
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current)
    }
    if (mapLang === 'en') {
      tileLayerRef.current = L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
        {
          attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions" target="_blank">CARTO</a>',
          maxZoom: 19,
          subdomains: 'abcd',
        }
      ).addTo(map)
    } else {
      // Local language: standard OSM tiles (renders names in local script)
      tileLayerRef.current = L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
          attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
          maxZoom: 19,
        }
      ).addTo(map)
    }
  }, [mapLang])

  // ── Ride markers ────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = instanceRef.current
    if (!map) return

    // Clear old markers
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    const ridesWithCoords = rides.filter(r =>
      r.status === 'open' &&
      r.origin_lat != null && r.origin_lng != null
    )

    ridesWithCoords.forEach(ride => {
      const cd = _countdown(ride.departure)
      const urgent = cd?.urgent
      const icon = L.divIcon({
        className: '',
        html: `<div style="
          background:${urgent ? '#dc2626' : '#2563eb'};color:#fff;border-radius:50%;
          width:32px;height:32px;display:flex;align-items:center;
          justify-content:center;font-size:16px;
          box-shadow:0 2px 8px rgba(0,0,0,0.5);
          border:2px solid #fff;
        ">🚗</div>`,
        iconSize:   [32, 32],
        iconAnchor: [16, 16],
      })

      const contact = _extractContact(ride.notes)
      const tooltipHtml = [
        `<strong>${ride.driver_name || 'Driver'}</strong>`,
        `${ride.origin} → ${ride.destination}`,
        cd ? `⏱ ${cd.label}` : ride.departure,
        `💺 ${ride.seats} seat${ride.seats !== 1 ? 's' : ''}`,
        contact ? `📞 ${contact}` : null,
      ].filter(Boolean).join('<br>')

      const marker = L.marker([ride.origin_lat, ride.origin_lng], { icon })
        .addTo(map)
        .on('click', () => setSelectedRide(ride))

      marker.bindTooltip(tooltipHtml, { direction: 'top', offset: [0, -16] })

      markersRef.current.push(marker)
    })

    // Auto-fit if we have markers
    if (ridesWithCoords.length > 0) {
      const group = L.featureGroup(markersRef.current)
      map.fitBounds(group.getBounds().pad(0.3))
    }
  }, [rides])

  // ── Driver location markers ─────────────────────────────────────────────────
  useEffect(() => {
    const map = instanceRef.current
    if (!map) return

    driverMarkersRef.current.forEach(m => m.remove())
    driverMarkersRef.current = []

    // Filter to drivers within 5 km of user when location is known
    const proximityFiltered = userLocation?.lat != null
      ? driverLocations.filter(dl =>
          dl.lat != null && dl.lng != null &&
          _haversineKm(userLocation.lat, userLocation.lng, dl.lat, dl.lng) <= DRIVER_PROXIMITY_KM
        )
      : driverLocations

    proximityFiltered.forEach(dl => {
      if (dl.lat == null || dl.lng == null) return
      // Animated pulsing icon for active (empty/available) drivers
      const isActive = dl.empty
      const isVerified = dl.verified === true
      const verifiedBadge = isVerified
        ? `<span style="position:absolute;top:-4px;right:-4px;background:#2563eb;border-radius:50%;width:12px;height:12px;display:flex;align-items:center;justify-content:center;font-size:8px;border:1px solid #fff;z-index:2;" title="Verified Driver">✓</span>`
        : ''
      const icon = L.divIcon({
        className: '',
        html: isActive
          ? `<div class="map-driver-active-wrapper" style="position:relative;">
               <div class="map-driver-pulse-ring"></div>
               <div style="
                 background:#16a34a;color:#fff;border-radius:50%;
                 width:28px;height:28px;display:flex;align-items:center;
                 justify-content:center;font-size:14px;
                 box-shadow:0 2px 8px rgba(0,0,0,0.4);
                 border:2px solid #fff;position:relative;z-index:1;
               ">🚙${verifiedBadge}</div>
             </div>`
          : `<div style="position:relative;display:inline-block;">
               <div style="
                 background:#6b7280;color:#fff;border-radius:50%;
                 width:28px;height:28px;display:flex;align-items:center;
                 justify-content:center;font-size:14px;
                 box-shadow:0 2px 8px rgba(0,0,0,0.4);
                 border:2px solid #fff;
               ">🚙${verifiedBadge}</div>
             </div>`,
        iconSize:   isActive ? [44, 44] : [28, 28],
        iconAnchor: isActive ? [22, 22] : [14, 14],
      })
      const seatsLine = dl.seats != null ? `<br>💺 ${dl.seats} seat${dl.seats !== 1 ? 's' : ''}` : ''
      const verifiedLine = isVerified ? '<br><span style="color:#60a5fa;">✓ Verified Driver</span>' : ''
      const m = L.marker([dl.lat, dl.lng], { icon })
        .addTo(map)
        .bindTooltip(
          `<strong>${dl.name}</strong>${verifiedLine}<br>${dl.empty ? '🟢 Available' : '🔴 Occupied'}${seatsLine}`,
          { direction: 'top' }
        )
      driverMarkersRef.current.push(m)
    })
  }, [driverLocations, userLocation])

  // ── Confirmed passenger location markers ───────────────────────────────────
  useEffect(() => {
    const map = instanceRef.current
    if (!map) return

    confirmedMarkersRef.current.forEach(m => m.remove())
    confirmedMarkersRef.current = []

    confirmedLocations.forEach(p => {
      if (p.lat == null || p.lng == null) return
      const icon = L.divIcon({
        className: '',
        html: `<div style="
          background:#7c3aed;color:#fff;border-radius:50%;
          width:26px;height:26px;display:flex;align-items:center;
          justify-content:center;font-size:13px;
          box-shadow:0 2px 8px rgba(0,0,0,0.4);
          border:2px solid #fff;
        ">📍</div>`,
        iconSize:   [26, 26],
        iconAnchor: [13, 13],
      })
      const m = L.marker([p.lat, p.lng], { icon })
        .addTo(map)
        .bindTooltip(`<strong>${p.name || 'Passenger'}</strong><br>Confirmed pickup`, { direction: 'top' })
      confirmedMarkersRef.current.push(m)
    })
  }, [confirmedLocations])
  useEffect(() => {
    const map = instanceRef.current
    if (!map) return

    userMarkerRef.current?.remove()
    userMarkerRef.current = null
    accuracyCircleRef.current?.remove()
    accuracyCircleRef.current = null

    if (userLocation?.lat == null) return

    // Use animated pulse marker when live tracking is active
    const icon = L.divIcon({
      className: '',
      html: liveTracking
        ? `<div class="map-location-pulse-wrapper">
             <div class="map-location-pulse-ring"></div>
             <div style="
               background:#7c3aed;color:#fff;border-radius:50%;
               width:26px;height:26px;display:flex;align-items:center;
               justify-content:center;font-size:13px;
               box-shadow:0 2px 8px rgba(0,0,0,0.5);
               border:2px solid #fff;position:relative;z-index:1;
             ">&#x1F464;</div>
           </div>`
        : `<div style="
            background:#7c3aed;color:#fff;border-radius:50%;
            width:26px;height:26px;display:flex;align-items:center;
            justify-content:center;font-size:13px;
            box-shadow:0 2px 8px rgba(0,0,0,0.5);
            border:2px solid #fff;
          ">&#x1F464;</div>`,
      iconSize:   [liveTracking ? 46 : 26, liveTracking ? 46 : 26],
      iconAnchor: [liveTracking ? 23 : 13, liveTracking ? 23 : 13],
    })
    userMarkerRef.current = L.marker([userLocation.lat, userLocation.lng], { icon })
      .addTo(map)
      .bindTooltip(liveTracking ? '📍 You (live)' : 'Your location', { permanent: false })

    if (userLocation.accuracy) {
      accuracyCircleRef.current = L.circle([userLocation.lat, userLocation.lng], {
        radius:      userLocation.accuracy,
        color:       '#7c3aed',
        fillColor:   '#7c3aed',
        fillOpacity: 0.08,
        weight:      1,
      }).addTo(map)
    }

    map.setView([userLocation.lat, userLocation.lng], 13)
  }, [userLocation, liveTracking])

  // ── Live location tracking via watchPosition ────────────────────────────────
  useEffect(() => {
    if (!liveTracking) {
      if (watchIdRef.current != null) {
        navigator.geolocation?.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
      return
    }
    if (!navigator.geolocation) return
    watchIdRef.current = navigator.geolocation.watchPosition(
      ({ coords }) => {
        onLocationUpdate?.({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy })
      },
      () => setLiveTracking(false),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
    )
    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation?.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
    }
  }, [liveTracking, onLocationUpdate])

  // ── Selected-ride panel helpers ─────────────────────────────────────────────
  const rideContact  = selectedRide ? _extractContact(selectedRide.notes) : null
  const rideCountdown = selectedRide ? _countdown(selectedRide.departure) : null
  // Strip "Contact: ..." from displayed notes
  const rideNotes    = selectedRide?.notes
    ? selectedRide.notes.replace(/\s*\|\s*Contact:[^|]*/i, '').replace(/Contact:[^|]*/i, '').trim()
    : null

  // Build a default request message for the ride
  const _buildDefaultMsg = (ride) =>
    `Hi ${ride.driver_name || 'there'}, I'd like to request a seat on your ride from ${ride.origin} to ${ride.destination}. Are you still available?`

  const handleRequestRide = (ride) => {
    if (onOpenChat) {
      onOpenChat(ride, _buildDefaultMsg(ride))
    } else {
      onRequestRide?.(ride)
    }
    setSelectedRide(null)
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="relative ride-map-container" style={{ isolation: 'isolate', height: typeof mapHeight === 'string' && mapHeight !== '300' ? mapHeight : undefined }}>
      <div
        ref={mapRef}
        className="ride-map-element"
        style={{ height: mapHeight, borderRadius: 0, overflow: 'hidden', background: '#1a2233', position: 'relative', zIndex: 0 }}
      />

      {/* Live tracking toggle */}
      <div className="absolute top-2 left-2 z-[1000] flex gap-1.5">
        <button
          onClick={() => setLiveTracking(t => !t)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold shadow-lg transition-colors ${
            liveTracking
              ? 'bg-blue-600 text-white'
              : 'bg-gray-900/90 text-gray-300 border border-gray-600 hover:bg-gray-800'
          }`}
          title={liveTracking ? 'Stop live tracking' : 'Start live location tracking'}
        >
          <span className={`w-2 h-2 rounded-full ${liveTracking ? 'bg-white animate-pulse' : 'bg-gray-500'}`} />
          {liveTracking ? 'Live' : 'Track me'}
        </button>

        {/* Map language selector */}
        <select
          value={mapLang}
          onChange={e => setMapLang(e.target.value)}
          className="px-2 py-1 rounded-full text-xs font-semibold bg-gray-900/90 text-gray-300 border border-gray-600 hover:bg-gray-800 shadow-lg cursor-pointer"
          title="Map language"
        >
          <option value="en">🌐 English</option>
          <option value="local">🗺 Local</option>
        </select>
      </div>

      {/* Side-panel card for selected ride */}
      {selectedRide && (
        <div className="absolute top-2 right-2 z-[1000] w-56 bg-gray-900/97 border border-gray-600 rounded-xl shadow-2xl p-3 space-y-2 backdrop-blur">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-white truncate">{selectedRide.driver_name}</p>
            <button
              onClick={() => setSelectedRide(null)}
              className="text-gray-500 hover:text-gray-300 text-sm leading-none shrink-0 ml-1"
            >&#x2715;</button>
          </div>
          <div className="text-xs text-gray-300 space-y-1">
            <p className="flex items-center gap-1"><span>📍</span><span className="truncate">{selectedRide.origin}</span></p>
            <p className="flex items-center gap-1"><span>🏁</span><span className="truncate">{selectedRide.destination}</span></p>
            <div className="flex items-center gap-1">
              <span>⏱</span>
              {rideCountdown ? (
                <span className={rideCountdown.urgent ? 'text-red-400 font-semibold' : 'text-gray-300'}>
                  {rideCountdown.label === 'Departed' ? 'Departed' : `Departs in ${rideCountdown.label}`}
                </span>
              ) : (
                <span>{selectedRide.departure}</span>
              )}
            </div>
            <p className="flex items-center gap-1">
              <span>💺</span>
              <span className="font-semibold text-green-400">{selectedRide.seats}</span>
              <span>empty seat{selectedRide.seats !== 1 ? 's' : ''}</span>
            </p>
            {rideContact && (
              <p className="flex items-center gap-1">
                <span>📞</span>
                <a
                  href={`tel:${rideContact}`}
                  className="text-blue-400 hover:text-blue-300 truncate"
                  onClick={e => e.stopPropagation()}
                >{rideContact}</a>
              </p>
            )}
            {rideNotes && (
              <p className="flex items-start gap-1 text-gray-400">
                <span className="shrink-0">📝</span>
                <span className="line-clamp-2">{rideNotes}</span>
              </p>
            )}
          </div>
          <button
            onClick={() => handleRequestRide(selectedRide)}
            className="w-full py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
          >
            💬 Request Ride
          </button>
        </div>
      )}

      {/* Driver count badge */}
      {driverLocations.length > 0 && (() => {
        const proximityFiltered = userLocation?.lat != null
          ? driverLocations.filter(dl => dl.lat != null && dl.lng != null &&
              _haversineKm(userLocation.lat, userLocation.lng, dl.lat, dl.lng) <= DRIVER_PROXIMITY_KM)
          : driverLocations
        const availCount = proximityFiltered.filter(d => d.empty).length
        return (
          <div className="absolute bottom-10 right-2 z-[1000] bg-green-900/90 border border-green-700 rounded-full px-2.5 py-0.5 text-xs text-green-300 font-medium">
            {availCount} driver{availCount !== 1 ? 's' : ''} available{userLocation?.lat != null ? ' · within 5 km' : ''}
          </div>
        )
      })()}

      {/* Legend */}
      <div className="absolute bottom-2 left-2 z-[1000] flex gap-1.5 flex-wrap">
        {[
          { icon: '&#x1F697;', label: 'Pickup' },
          { icon: '&#x1F699;', label: 'Driver' },
          { icon: '&#x1F464;', label: 'You' },
          { icon: '✓', label: 'Verified' },
        ].map(l => (
          <div key={l.label} className="flex items-center gap-1 bg-gray-900/80 rounded-full px-2 py-0.5 text-xs text-gray-300">
            <span dangerouslySetInnerHTML={{ __html: l.icon }} />
            <span>{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
