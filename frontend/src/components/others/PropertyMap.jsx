/**
 * PropertyMap — Leaflet map displaying property pins colour-coded by status.
 *
 * Props:
 *   properties       – Array of property objects (see DEMO_PROPERTIES shape)
 *   selectedId       – ID of the currently selected property (pans + opens popup)
 *   onSelectProperty – Called with property object when a pin is clicked
 *   userLocation     – { lat, lng } of the current user (optional)
 *   closestId        – ID of the closest available property (highlighted ring)
 */

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix default marker paths broken by bundlers
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon   from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({ iconRetinaUrl: markerIcon2x, iconUrl: markerIcon, shadowUrl: markerShadow })

// Status → colour mapping
const STATUS_COLOR = {
  empty:      '#6b7280', // grey
  occupied:   '#ef4444', // red
  soon_empty: '#22c55e', // green
}

const STATUS_LABEL = {
  empty:      'Empty',
  occupied:   'Occupied',
  soon_empty: 'Soon Empty',
}

function _buildIcon(status, isClosest) {
  const color = STATUS_COLOR[status] ?? '#6b7280'
  const ring  = isClosest ? `<circle cx="14" cy="14" r="13" fill="none" stroke="#facc15" stroke-width="3" stroke-dasharray="4 2"/>` : ''
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
      ${ring}
      <path d="M14 2C8.477 2 4 6.477 4 12c0 7.5 10 22 10 22s10-14.5 10-22C24 6.477 19.523 2 14 2z"
            fill="${color}" stroke="#fff" stroke-width="1.5"/>
      <circle cx="14" cy="12" r="4" fill="white" opacity="0.85"/>
    </svg>`
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    popupAnchor: [0, -36],
    tooltipAnchor: [14, -20],
  })
}

export default function PropertyMap({
  properties = [],
  selectedId = null,
  onSelectProperty,
  userLocation = null,
  closestId = null,
}) {
  const mapRef        = useRef(null)
  const instanceRef   = useRef(null)
  const markersRef    = useRef({})   // id → L.Marker
  const userMarkerRef = useRef(null)

  // Initialise map once
  useEffect(() => {
    if (instanceRef.current || !mapRef.current) return
    const center = userLocation
      ? [userLocation.lat, userLocation.lng]
      : [51.505, -0.09]
    const map = L.map(mapRef.current, { zoomControl: true, scrollWheelZoom: true })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)
    map.setView(center, 11)
    instanceRef.current = map
    return () => {
      map.remove()
      instanceRef.current = null
    }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // Sync property markers whenever the list or closestId changes
  useEffect(() => {
    const map = instanceRef.current
    if (!map) return

    // Remove stale markers
    Object.values(markersRef.current).forEach(m => m.remove())
    markersRef.current = {}

    properties.forEach(prop => {
      if (prop.lat == null || prop.lng == null) return
      const isClosest = prop.id === closestId
      const icon = _buildIcon(prop.status, isClosest)
      const marker = L.marker([prop.lat, prop.lng], { icon })

      // Tooltip (hover)
      const dist = prop._dist != null ? ` · ${prop._dist} km` : ''
      marker.bindTooltip(
        `<b>${prop.address}</b><br/>`
        + `<span style="color:${STATUS_COLOR[prop.status]}">${STATUS_LABEL[prop.status]}</span>`
        + dist,
        { direction: 'top', offset: [0, -36] },
      )

      // Popup (click)
      const agentLine = prop.agent_name
        ? `<div style="margin-top:4px;font-size:0.78rem;color:#9ca3af">Agent: ${prop.agent_name}</div>`
        : ''
      const availLine = prop.available_date
        ? `<div style="font-size:0.78rem;color:#9ca3af">Available: ${prop.available_date}</div>`
        : ''
      marker.bindPopup(
        `<div style="min-width:180px;font-family:sans-serif">
          <div style="font-weight:700;margin-bottom:4px">${prop.address}</div>
          <div style="display:inline-block;padding:2px 8px;border-radius:9999px;background:${STATUS_COLOR[prop.status]}22;color:${STATUS_COLOR[prop.status]};font-size:0.78rem;font-weight:600">${STATUS_LABEL[prop.status]}</div>
          <div style="font-size:0.78rem;color:#9ca3af;margin-top:4px">${prop.size ?? ''}</div>
          ${availLine}
          ${agentLine}
          ${isClosest ? '<div style="margin-top:4px;font-size:0.75rem;color:#facc15">⭐ Closest available</div>' : ''}
        </div>`,
        { maxWidth: 260 },
      )

      marker.on('click', () => onSelectProperty?.(prop))
      marker.addTo(map)
      markersRef.current[prop.id] = marker
    })
  }, [properties, closestId])  // eslint-disable-line react-hooks/exhaustive-deps

  // Pan to selected property and open its popup
  useEffect(() => {
    const map = instanceRef.current
    if (!map || selectedId == null) return
    const marker = markersRef.current[selectedId]
    if (!marker) return
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 14), { animate: true })
    marker.openPopup()
  }, [selectedId])

  // User location marker
  useEffect(() => {
    const map = instanceRef.current
    if (!map) return
    if (userMarkerRef.current) { userMarkerRef.current.remove(); userMarkerRef.current = null }
    if (!userLocation) return
    const icon = L.divIcon({
      html: `<div style="width:14px;height:14px;background:#3b82f6;border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 4px #3b82f622"></div>`,
      className: '',
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    })
    userMarkerRef.current = L.marker([userLocation.lat, userLocation.lng], { icon })
      .bindTooltip('Your location', { direction: 'top' })
      .addTo(map)
  }, [userLocation])

  return (
    <div
      ref={mapRef}
      style={{ width: '100%', height: '100%', minHeight: 300, borderRadius: 10 }}
    />
  )
}
