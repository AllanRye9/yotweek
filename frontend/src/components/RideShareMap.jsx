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
 * RideShareMap — OpenStreetMap (Leaflet) map showing available rides, driver
 * locations and the current user's position.
 *
 * Props:
 *  rides            - Array of ride objects with origin_lat/origin_lng
 *  userLocation     - { lat, lng } of the current user (optional)
 *  onRequestRide(ride) - called when user clicks "Request Ride" on a marker
 *  driverLocations  - Array of { lat, lng, name, empty } driver positions
 *  autoLoadDrivers  - When true, polls /api/driver/locations every 15s
 *  onLocationUpdate - Called with {lat, lng} when the map auto-detects location
 */
export default function RideShareMap({ rides = [], userLocation, onRequestRide, driverLocations: propDriverLocations = [], autoLoadDrivers = true, onLocationUpdate }) {
  const mapRef      = useRef(null)
  const instanceRef = useRef(null)
  const markersRef  = useRef([])
  const driverMarkersRef = useRef([])
  const userMarkerRef    = useRef(null)
  const accuracyCircleRef = useRef(null)
  const [selectedRide, setSelectedRide] = useState(null)
  const [driverLocations, setDriverLocations] = useState(propDriverLocations)
  const [liveTracking, setLiveTracking] = useState(false)
  const watchIdRef = useRef(null)

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
    const id = setInterval(refreshDriverLocations, 15_000)
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

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map)

    instanceRef.current = map
    return () => {
      map.remove()
      instanceRef.current = null
    }
  }, [])

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
      const icon = L.divIcon({
        className: '',
        html: `<div style="
          background:#2563eb;color:#fff;border-radius:50%;
          width:32px;height:32px;display:flex;align-items:center;
          justify-content:center;font-size:16px;
          box-shadow:0 2px 8px rgba(0,0,0,0.5);
          border:2px solid #fff;
        ">🚗</div>`,
        iconSize:   [32, 32],
        iconAnchor: [16, 16],
      })

      const marker = L.marker([ride.origin_lat, ride.origin_lng], { icon })
        .addTo(map)
        .on('click', () => setSelectedRide(ride))

      marker.bindTooltip(
        `<strong>${ride.driver_name}</strong><br>${ride.origin} → ${ride.destination}<br>${ride.departure}`,
        { direction: 'top', offset: [0, -16] }
      )

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

    driverLocations.forEach(dl => {
      if (dl.lat == null || dl.lng == null) return
      const icon = L.divIcon({
        className: '',
        html: `<div style="
          background:${dl.empty ? '#16a34a' : '#6b7280'};color:#fff;border-radius:50%;
          width:28px;height:28px;display:flex;align-items:center;
          justify-content:center;font-size:14px;
          box-shadow:0 2px 8px rgba(0,0,0,0.4);
          border:2px solid #fff;
        ">🚙</div>`,
        iconSize:   [28, 28],
        iconAnchor: [14, 14],
      })
      const m = L.marker([dl.lat, dl.lng], { icon })
        .addTo(map)
        .bindTooltip(`${dl.name} — ${dl.empty ? 'Available' : 'Occupied'}`, { direction: 'top' })
      driverMarkersRef.current.push(m)
    })
  }, [driverLocations])

  // ── User location marker ────────────────────────────────────────────────────
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

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="relative ride-map-container" style={{ isolation: 'isolate' }}>
      <div
        ref={mapRef}
        className="ride-map-element"
        style={{ height: 300, borderRadius: 12, overflow: 'hidden', background: '#1a2233', position: 'relative', zIndex: 0 }}
      />

      {/* Live tracking toggle */}
      <div className="absolute top-2 left-2 z-[1000]">
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
      </div>

      {/* Side-panel card for selected ride */}
      {selectedRide && (
        <div className="absolute top-2 right-2 z-[1000] w-52 bg-gray-900/95 border border-gray-600 rounded-xl shadow-2xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-white truncate">{selectedRide.driver_name}</p>
            <button
              onClick={() => setSelectedRide(null)}
              className="text-gray-500 hover:text-gray-300 text-sm leading-none"
            >&#x2715;</button>
          </div>
          <div className="text-xs text-gray-400 space-y-0.5">
            <p>&#x1F4CD; {selectedRide.origin}</p>
            <p>&#x1F3C1; {selectedRide.destination}</p>
            <p>&#x1F550; {selectedRide.departure}</p>
            <p>&#x1F4BA; {selectedRide.seats} seat{selectedRide.seats !== 1 ? 's' : ''}</p>
            {selectedRide.notes && <p className="text-gray-500 text-xs truncate">&#x1F4DD; {selectedRide.notes}</p>}
          </div>
          <button
            onClick={() => { onRequestRide?.(selectedRide); setSelectedRide(null) }}
            className="w-full py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
          >
            Request Ride
          </button>
        </div>
      )}

      {/* Driver count badge */}
      {driverLocations.length > 0 && (
        <div className="absolute bottom-10 right-2 z-[1000] bg-green-900/90 border border-green-700 rounded-full px-2.5 py-0.5 text-xs text-green-300 font-medium">
          {driverLocations.filter(d => d.empty).length} driver{driverLocations.filter(d => d.empty).length !== 1 ? 's' : ''} available
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-2 left-2 z-[1000] flex gap-1.5 flex-wrap">
        {[
          { icon: '&#x1F697;', label: 'Ride' },
          { icon: '&#x1F699;', label: 'Driver' },
          { icon: '&#x1F464;', label: 'You' },
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
