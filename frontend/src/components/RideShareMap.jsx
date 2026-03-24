import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix default marker icon paths broken by bundlers
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({ iconRetinaUrl: markerIcon2x, iconUrl: markerIcon, shadowUrl: markerShadow })

/**
 * RideShareMap — OpenStreetMap (Leaflet) map showing available rides as markers.
 *
 * Props:
 *  rides        - Array of ride objects with origin_lat/origin_lng
 *  userLocation - { lat, lng } of the current user (optional)
 *  onRequestRide(ride) - called when user clicks "Request Ride" on a marker
 *  driverLocations - Array of { lat, lng, name, empty } driver positions
 */
export default function RideShareMap({ rides = [], userLocation, onRequestRide, driverLocations = [] }) {
  const mapRef      = useRef(null)
  const instanceRef = useRef(null)
  const markersRef  = useRef([])
  const driverMarkersRef = useRef([])
  const userMarkerRef    = useRef(null)
  const [selectedRide, setSelectedRide] = useState(null)

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

    if (userLocation?.lat == null) return

    const icon = L.divIcon({
      className: '',
      html: `<div style="
        background:#7c3aed;color:#fff;border-radius:50%;
        width:26px;height:26px;display:flex;align-items:center;
        justify-content:center;font-size:13px;
        box-shadow:0 2px 8px rgba(0,0,0,0.5);
        border:2px solid #fff;
      ">👤</div>`,
      iconSize:   [26, 26],
      iconAnchor: [13, 13],
    })
    userMarkerRef.current = L.marker([userLocation.lat, userLocation.lng], { icon })
      .addTo(map)
      .bindTooltip('Your location', { permanent: false })

    map.setView([userLocation.lat, userLocation.lng], 12)
  }, [userLocation])

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="relative">
      <div
        ref={mapRef}
        style={{ height: 260, borderRadius: 12, overflow: 'hidden', background: '#1a2233' }}
      />

      {/* Side-panel card for selected ride */}
      {selectedRide && (
        <div className="absolute top-2 right-2 z-[1000] w-52 bg-gray-900/95 border border-gray-600 rounded-xl shadow-2xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-white truncate">{selectedRide.driver_name}</p>
            <button
              onClick={() => setSelectedRide(null)}
              className="text-gray-500 hover:text-gray-300 text-sm leading-none"
            >✕</button>
          </div>
          <div className="text-xs text-gray-400 space-y-0.5">
            <p>📍 {selectedRide.origin}</p>
            <p>🏁 {selectedRide.destination}</p>
            <p>🕐 {selectedRide.departure}</p>
            <p>💺 {selectedRide.seats} seat{selectedRide.seats !== 1 ? 's' : ''}</p>
            {selectedRide.notes && <p className="text-gray-500 text-xs truncate">📝 {selectedRide.notes}</p>}
          </div>
          <button
            onClick={() => { onRequestRide?.(selectedRide); setSelectedRide(null) }}
            className="w-full py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
          >
            Request Ride
          </button>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-2 left-2 z-[1000] flex gap-1.5 flex-wrap">
        {[
          { color: '#2563eb', icon: '🚗', label: 'Ride' },
          { color: '#16a34a', icon: '🚙', label: 'Driver (free)' },
          { color: '#7c3aed', icon: '👤', label: 'You' },
        ].map(l => (
          <div key={l.label} className="flex items-center gap-1 bg-gray-900/80 rounded-full px-2 py-0.5 text-xs text-gray-300">
            <span>{l.icon}</span>
            <span>{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
