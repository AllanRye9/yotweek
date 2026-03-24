import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix default marker icon paths broken by bundlers
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({ iconRetinaUrl: markerIcon2x, iconUrl: markerIcon, shadowUrl: markerShadow })

export default function RideShareMap() {
  const mapRef      = useRef(null)
  const instanceRef = useRef(null)

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
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map)

    instanceRef.current = map
    return () => {
      map.remove()
      instanceRef.current = null
    }
  }, [])

  return (
    <div
      ref={mapRef}
      style={{ height: 220, borderRadius: 12, overflow: 'hidden', background: '#1a2233' }}
    />
  )
}
