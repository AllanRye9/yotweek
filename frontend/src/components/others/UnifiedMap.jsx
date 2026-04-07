import { useEffect, useRef, useState, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({ iconRetinaUrl: markerIcon2x, iconUrl: markerIcon, shadowUrl: markerShadow })

const STATUS_COLOR = { active: '#22c55e', sold: '#ef4444', rented: '#f59e0b', empty: '#6b7280', occupied: '#ef4444', soon_empty: '#22c55e' }

function formatPrice(price) {
  if (!price) return 'POA'
  return '£' + Number(price).toLocaleString('en-GB') + '/mo'
}

function _propertyIcon(item, isSelected) {
  const color = STATUS_COLOR[item.status] ?? '#6b7280'
  const border = isSelected ? `stroke="#facc15" stroke-width="2.5"` : `stroke="#fff" stroke-width="1.5"`
  const price = formatPrice(item.price)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="90" height="36" viewBox="0 0 90 36">
    <rect x="1" y="1" width="88" height="28" rx="14" ry="14" fill="${color}" ${border}/>
    <polygon points="40,28 45,36 50,28" fill="${color}"/>
    <text x="45" y="19" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" font-weight="700" fill="#fff">${price}</text>
  </svg>`
  return L.divIcon({ html: svg, className: '', iconSize: [90, 36], iconAnchor: [45, 36], popupAnchor: [0, -36] })
}

function _driverIcon(item, isSelected) {
  const isActive = item.empty !== false
  const border = isSelected ? 'border:3px solid #facc15;' : 'border:2px solid #fff;'
  const bg = isActive ? '#16a34a' : '#6b7280'
  if (isActive) {
    return L.divIcon({
      className: '',
      html: `<div class="map-driver-active-wrapper"><div class="map-driver-pulse-ring"></div><div style="background:${bg};color:#fff;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 2px 8px rgba(0,0,0,0.4);${border}position:relative;z-index:1;">🚗</div></div>`,
      iconSize: [44, 44], iconAnchor: [22, 22],
    })
  }
  return L.divIcon({
    className: '',
    html: `<div style="background:${bg};color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,0.4);${border}">🚗</div>`,
    iconSize: [28, 28], iconAnchor: [14, 14],
  })
}

function _agentIcon(item, isSelected) {
  const border = isSelected ? 'border:3px solid #facc15;' : 'border:2px solid #fff;'
  const color = item.availability_status === 'available' ? '#2563eb' : item.availability_status === 'busy' ? '#d97706' : '#6b7280'
  return L.divIcon({
    className: '',
    html: `<div style="background:${color};color:#fff;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 2px 8px rgba(0,0,0,0.4);${border}">🏠</div>`,
    iconSize: [32, 32], iconAnchor: [16, 16],
  })
}

/**
 * UnifiedMap — Shared Leaflet map for ride-share drivers and property listings.
 * Props:
 *   mode         - "drivers" | "properties"
 *   items        - array of items to show on map
 *   selectedId   - id of selected item (highlighted)
 *   onSelectItem - fn(item) called on marker click
 *   userLocation - {lat, lng} or null
 *   onLocationUpdate - fn({lat, lng}) called when geolocation updates
 */

// Tile layer configurations — defined outside the component so the object
// reference is stable across renders and can be safely used in effect deps.
const TILE_LAYERS = {
  street: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions" target="_blank">CARTO</a>',
    maxZoom: 19,
    subdomains: 'abcd',
  },
  satellite: {
    // USGS National Map — public domain US government imagery
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles courtesy of the <a href="https://usgs.gov" target="_blank">U.S. Geological Survey</a>',
    maxZoom: 16,
  },
}

export default function UnifiedMap({ mode, items = [], selectedId, onSelectItem, userLocation, onLocationUpdate, isAuth = true }) {
  const mapRef = useRef(null)
  const instanceRef = useRef(null)
  const markersRef = useRef({})
  const userMarkerRef = useRef(null)
  const watchIdRef = useRef(null)
  const tileLayerRef = useRef(null)
  const [liveTracking, setLiveTracking] = useState(false)
  const [satellite, setSatellite] = useState(false)

  // Init map once
  useEffect(() => {
    if (instanceRef.current || !mapRef.current) return
    const map = L.map(mapRef.current, { zoomControl: true, scrollWheelZoom: true, minZoom: 2, maxZoom: 19 })
    const cfg = TILE_LAYERS.street
    tileLayerRef.current = L.tileLayer(cfg.url, {
      attribution: cfg.attribution, maxZoom: cfg.maxZoom, subdomains: cfg.subdomains ?? '',
    }).addTo(map)
    map.setView([51.505, -0.09], 11)
    instanceRef.current = map
    return () => { map.remove(); instanceRef.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Swap tile layer when satellite toggle changes
  useEffect(() => {
    const map = instanceRef.current
    if (!map) return
    if (tileLayerRef.current) { tileLayerRef.current.remove(); tileLayerRef.current = null }
    const cfg = satellite ? TILE_LAYERS.satellite : TILE_LAYERS.street
    tileLayerRef.current = L.tileLayer(cfg.url, {
      attribution: cfg.attribution, maxZoom: cfg.maxZoom, subdomains: cfg.subdomains ?? '',
    })
    tileLayerRef.current.addTo(map)
    tileLayerRef.current.on('tileerror', () => {
      // Fallback to street view if satellite tiles fail to load
      if (satellite) setSatellite(false)
    })
  }, [satellite, setSatellite])

  // Update item markers when items, mode, or selectedId changes
  useEffect(() => {
    const map = instanceRef.current
    if (!map) return
    Object.values(markersRef.current).forEach(m => m.remove())
    markersRef.current = {}
    items.forEach(item => {
      if (item.lat == null || item.lng == null) return
      const id = item.property_id ?? item.id ?? item.user_id
      let icon
      if (mode === 'properties') {
        if (item.property_id) {
          icon = _propertyIcon(item, id === selectedId)
        } else {
          icon = _agentIcon(item, id === selectedId)
        }
      } else {
        icon = _driverIcon(item, id === selectedId)
      }
      const marker = L.marker([item.lat, item.lng], { icon })
      // Tooltip
      let tooltip = ''
      if (!isAuth) {
        tooltip = `<strong>🔒 Login to view details</strong><br><span style="color:#9ca3af;font-size:11px">Click to sign in / register</span>`
      } else if (mode === 'drivers') {
        tooltip = `<strong>${item.name || 'Driver'}</strong><br>${item.empty !== false ? '🟢 Available' : '🔴 Occupied'}${item.seats ? `<br>💺 ${item.seats} seat${item.seats !== 1 ? 's' : ''}` : ''}${item.distance_km != null ? `<br>📍 ${item.distance_km} km` : ''}`
      } else if (item.property_id) {
        const sl = { active: '🟢 Active', sold: '🔴 Sold', rented: '🟡 Rented', empty: '⚪ Empty', occupied: '🔴 Occupied', soon_empty: '🟢 Soon Empty' }
        tooltip = `<strong>${item.title || item.address}</strong><br>${sl[item.status] ?? item.status}${item.price ? `<br>£${Number(item.price).toLocaleString('en-GB')}/mo` : ''}${item.distance_km != null ? `<br>📍 ${item.distance_km} km` : ''}`
      } else {
        tooltip = `<strong>${item.name}</strong><br>${item.availability_status ?? ''}${item.distance_km != null ? `<br>📍 ${item.distance_km} km` : ''}`
      }
      marker.bindTooltip(tooltip, { direction: 'top', offset: [0, -16] })
      marker.on('click', () => onSelectItem?.(item))
      marker.addTo(map)
      markersRef.current[id] = marker
    })
  }, [items, mode, selectedId, onSelectItem, isAuth])

  // Pan to selected item
  useEffect(() => {
    const map = instanceRef.current
    if (!map || selectedId == null) return
    const m = markersRef.current[selectedId]
    if (m) { map.setView(m.getLatLng(), Math.max(map.getZoom(), 14), { animate: true }) }
  }, [selectedId])

  // User location marker
  useEffect(() => {
    const map = instanceRef.current
    if (!map) return
    userMarkerRef.current?.remove()
    userMarkerRef.current = null
    if (!userLocation?.lat) return
    const icon = L.divIcon({
      className: '',
      html: liveTracking
        ? `<div class="map-location-pulse-wrapper"><div class="map-location-pulse-ring"></div><div style="background:#7c3aed;color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,0.5);border:2px solid #fff;position:relative;z-index:1;">&#x1F464;</div></div>`
        : `<div style="background:#7c3aed;color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,0.5);border:2px solid #fff;">&#x1F464;</div>`,
      iconSize: liveTracking ? [46, 46] : [26, 26],
      iconAnchor: liveTracking ? [23, 23] : [13, 13],
    })
    userMarkerRef.current = L.marker([userLocation.lat, userLocation.lng], { icon })
      .addTo(map)
      .bindTooltip(liveTracking ? '📍 You (live)' : 'Your location', { permanent: false })
    map.setView([userLocation.lat, userLocation.lng], Math.max(instanceRef.current.getZoom(), 12))
  }, [userLocation, liveTracking])

  // Live tracking
  useEffect(() => {
    if (!liveTracking) {
      if (watchIdRef.current != null) { navigator.geolocation?.clearWatch(watchIdRef.current); watchIdRef.current = null }
      return
    }
    if (!navigator.geolocation) return
    watchIdRef.current = navigator.geolocation.watchPosition(
      ({ coords }) => onLocationUpdate?.({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy }),
      () => setLiveTracking(false),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
    )
    return () => { if (watchIdRef.current != null) { navigator.geolocation?.clearWatch(watchIdRef.current); watchIdRef.current = null } }
  }, [liveTracking, onLocationUpdate])

  return (
    <div className="relative" style={{ isolation: 'isolate' }}>
      <div ref={mapRef} style={{ height: 360, borderRadius: 12, overflow: 'hidden', background: '#1a2233', position: 'relative', zIndex: 0 }} />

      {/* Live tracking toggle + satellite toggle */}
      <div className="absolute top-2 left-2 z-[1000] flex gap-1.5">
        <button
          onClick={() => setLiveTracking(t => !t)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold shadow-lg transition-colors ${liveTracking ? 'bg-blue-600 text-white' : 'bg-gray-900/90 text-gray-300 border border-gray-600 hover:bg-gray-800'}`}
          title={liveTracking ? 'Stop live tracking' : 'Start live location tracking'}
          aria-label={liveTracking ? 'Stop live tracking' : 'Start live tracking'}
        >
          <span className={`w-2 h-2 rounded-full ${liveTracking ? 'bg-white animate-pulse' : 'bg-gray-500'}`} />
          {liveTracking ? 'Live' : 'Track me'}
        </button>
        <button
          onClick={() => setSatellite(s => !s)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold shadow-lg transition-colors ${satellite ? 'bg-emerald-600 text-white' : 'bg-gray-900/90 text-gray-300 border border-gray-600 hover:bg-gray-800'}`}
          title={satellite ? 'Switch to street view' : 'Switch to satellite view'}
          aria-label={satellite ? 'Street view' : 'Satellite view'}
        >
          {satellite ? '🗺 Street' : '🛰 Satellite'}
        </button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-2 left-2 z-[1000] flex gap-1.5 flex-wrap">
        {mode === 'drivers' ? (
          <>
            <div className="flex items-center gap-1 bg-gray-900/80 rounded-full px-2 py-0.5 text-xs text-gray-300"><span>🟢</span><span>Available</span></div>
            <div className="flex items-center gap-1 bg-gray-900/80 rounded-full px-2 py-0.5 text-xs text-gray-300"><span>⚫</span><span>Occupied</span></div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1 bg-gray-900/80 rounded-full px-2 py-0.5 text-xs text-gray-300"><span style={{color:'#22c55e'}}>●</span><span>Active</span></div>
            <div className="flex items-center gap-1 bg-gray-900/80 rounded-full px-2 py-0.5 text-xs text-gray-300"><span style={{color:'#ef4444'}}>●</span><span>Sold</span></div>
            <div className="flex items-center gap-1 bg-gray-900/80 rounded-full px-2 py-0.5 text-xs text-gray-300"><span style={{color:'#f59e0b'}}>●</span><span>Rented</span></div>
          </>
        )}
        <div className="flex items-center gap-1 bg-gray-900/80 rounded-full px-2 py-0.5 text-xs text-gray-300"><span>👤</span><span>You</span></div>
      </div>
    </div>
  )
}
