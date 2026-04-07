/**
 * TouristSitesContent — Core content panel for tourist attractions.
 *
 * Reusable content block without page chrome (no navbar, no footer).
 * Used by TouristSitesPage (full page) and UserDashboard (inline tab).
 *
 * Props:
 *  initialLat  - optional starting latitude (skips geolocation prompt)
 *  initialLng  - optional starting longitude
 */

import { useState, useEffect, useCallback } from 'react'

// ─── Category config ───────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: 'all',           label: '🌐 All',           tags: [] },
  { id: 'museum',        label: '🏛 Museums',        tags: ['tourism=museum', 'tourism=gallery', 'tourism=artwork'] },
  { id: 'park',          label: '🌿 Parks & Nature', tags: ['leisure=park', 'leisure=nature_reserve', 'leisure=garden', 'boundary=national_park', 'natural=peak', 'natural=waterfall', 'natural=beach', 'natural=volcano'] },
  { id: 'historic',      label: '🏰 Historic',       tags: ['historic=*', 'tourism=monument', 'tourism=ruins', 'tourism=castle'] },
  { id: 'religious',     label: '⛪ Religious',       tags: ['amenity=place_of_worship'] },
  { id: 'viewpoint',     label: '🔭 Viewpoints',     tags: ['tourism=viewpoint', 'tourism=attraction'] },
  { id: 'entertainment', label: '🎭 Entertainment',  tags: ['tourism=theme_park', 'tourism=zoo', 'tourism=aquarium', 'leisure=stadium'] },
]

const FALLBACK_ATTRACTIONS = [
  { id: 'f1',  name: 'The Colosseum',          category: 'historic',      country: 'Italy',        description: 'Ancient Roman amphitheatre and iconic historic site.',        emoji: '🏛', wiki: 'Colosseum',                img: 'https://picsum.photos/seed/colosseum/400/200' },
  { id: 'f2',  name: 'Eiffel Tower',            category: 'viewpoint',     country: 'France',       description: 'Iron lattice tower on the Champ de Mars in Paris.',           emoji: '🗼', wiki: 'Eiffel_Tower',              img: 'https://picsum.photos/seed/eiffel/400/200'    },
  { id: 'f3',  name: 'Serengeti National Park', category: 'park',          country: 'Tanzania',     description: 'Vast plains famous for the annual wildebeest migration.',      emoji: '🦁', wiki: 'Serengeti_National_Park',   img: 'https://picsum.photos/seed/serengeti/400/200' },
  { id: 'f4',  name: 'Great Wall of China',     category: 'historic',      country: 'China',        description: 'Ancient fortification stretching thousands of kilometers.',    emoji: '🏯', wiki: 'Great_Wall_of_China',       img: 'https://picsum.photos/seed/greatwall/400/200' },
  { id: 'f5',  name: 'Machu Picchu',            category: 'historic',      country: 'Peru',         description: 'Inca citadel set high in the Andes Mountains.',               emoji: '🏔', wiki: 'Machu_Picchu',              img: 'https://picsum.photos/seed/machu/400/200'     },
  { id: 'f6',  name: 'Louvre Museum',           category: 'museum',        country: 'France',       description: "World's largest art museum and home of the Mona Lisa.",      emoji: '🎨', wiki: 'Louvre',                    img: 'https://picsum.photos/seed/louvre/400/200'    },
  { id: 'f7',  name: 'Angkor Wat',              category: 'religious',     country: 'Cambodia',     description: 'Largest religious monument in the world.',                    emoji: '🕌', wiki: 'Angkor_Wat',                img: 'https://picsum.photos/seed/angkor/400/200'    },
  { id: 'f8',  name: 'Sydney Opera House',      category: 'entertainment', country: 'Australia',    description: 'Multi-venue performing arts centre and global icon.',          emoji: '🎭', wiki: 'Sydney_Opera_House',        img: 'https://picsum.photos/seed/sydney/400/200'    },
  { id: 'f9',  name: 'Table Mountain',          category: 'viewpoint',     country: 'South Africa', description: 'Flat-topped mountain with panoramic views of Cape Town.',      emoji: '🔭', wiki: 'Table_Mountain',            img: 'https://picsum.photos/seed/tablemtn/400/200'  },
  { id: 'f10', name: 'Petra',                   category: 'historic',      country: 'Jordan',       description: 'Archaeological city famous for rock-cut architecture.',       emoji: '🏺', wiki: 'Petra',                     img: 'https://picsum.photos/seed/petra/400/200'     },
  { id: 'f11', name: 'Galápagos Islands',       category: 'park',          country: 'Ecuador',      description: 'Volcanic islands home to extraordinary wildlife diversity.',   emoji: '🐢', wiki: 'Galápagos_Islands',         img: 'https://picsum.photos/seed/galapagos/400/200' },
  { id: 'f12', name: 'Hagia Sophia',            category: 'religious',     country: 'Turkey',       description: 'Former cathedral and mosque, now a historic museum.',         emoji: '🕌', wiki: 'Hagia_Sophia',              img: 'https://picsum.photos/seed/hagiasophia/400/200' },
]

const CATEGORY_IMAGES = {
  museum:        'https://picsum.photos/seed/museum42/400/200',
  park:          'https://picsum.photos/seed/park77/400/200',
  historic:      'https://picsum.photos/seed/ruins33/400/200',
  religious:     'https://picsum.photos/seed/church88/400/200',
  viewpoint:     'https://picsum.photos/seed/view55/400/200',
  entertainment: 'https://picsum.photos/seed/entertain19/400/200',
  default:       'https://picsum.photos/seed/tourist01/400/200',
}

function _categoryFromTags(tags = {}) {
  const t = tags.tourism || ''
  const h = tags.historic || ''
  const l = tags.leisure || ''
  const a = tags.amenity || ''
  const n = tags.natural || ''
  if (t === 'museum' || t === 'gallery' || t === 'artwork') return 'museum'
  if (t === 'castle' || t === 'ruins' || t === 'monument' || h) return 'historic'
  if (t === 'viewpoint' || t === 'attraction') return 'viewpoint'
  if (t === 'zoo' || t === 'aquarium' || t === 'theme_park' || l === 'stadium') return 'entertainment'
  if (l === 'park' || l === 'nature_reserve' || l === 'garden' || n === 'peak' || n === 'waterfall' || n === 'beach' || n === 'volcano') return 'park'
  if (a === 'place_of_worship') return 'religious'
  return 'default'
}

function _distKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function _tourismEmoji(tags = {}) {
  const t = tags.tourism || ''
  const h = tags.historic || ''
  const l = tags.leisure || ''
  const a = tags.amenity || ''
  const n = tags.natural || ''
  if (t === 'museum' || t === 'gallery') return '🏛'
  if (t === 'artwork') return '🎨'
  if (t === 'monument') return '🗿'
  if (t === 'castle' || t === 'ruins' || h) return '🏰'
  if (t === 'viewpoint') return '🔭'
  if (t === 'zoo') return '🦁'
  if (t === 'aquarium') return '🐟'
  if (t === 'theme_park') return '🎡'
  if (l === 'park' || l === 'nature_reserve' || l === 'garden') return '🌿'
  if (l === 'stadium') return '🏟'
  if (a === 'place_of_worship') return '⛪'
  if (n === 'peak' || n === 'volcano') return '⛰️'
  if (n === 'waterfall') return '💧'
  if (n === 'beach') return '🏖️'
  if (n === 'cave_entrance') return '🕳️'
  return '📍'
}

async function fetchNearbyAttractions(lat, lng, radiusKm = 25) {
  const radius = radiusKm * 1000
  const query = `
[out:json][timeout:60];
(
  node["tourism"~"museum|gallery|artwork|monument|ruins|castle|viewpoint|attraction|zoo|aquarium|theme_park|information|hotel|hostel|chalet|alpine_hut|camp_site|caravan_site|picnic_site|wilderness_hut"](around:${radius},${lat},${lng});
  way["tourism"~"museum|gallery|monument|ruins|castle|viewpoint|attraction|zoo|aquarium|theme_park"](around:${radius},${lat},${lng});
  node["historic"~"monument|ruins|castle|fort|archaeological_site|building|church|wayside_shrine|battlefield|manor|palace|memorial"](around:${radius},${lat},${lng});
  way["historic"~"monument|ruins|castle|fort|archaeological_site|building|church|battlefield|manor|palace"](around:${radius},${lat},${lng});
  node["leisure"~"park|nature_reserve|stadium|garden|beach_resort|marina|golf_course|sports_centre"](around:${radius},${lat},${lng});
  way["leisure"~"park|nature_reserve|garden"](around:${radius},${lat},${lng});
  node["amenity"="place_of_worship"](around:${radius},${lat},${lng});
  way["amenity"="place_of_worship"](around:${radius},${lat},${lng});
  node["natural"~"peak|volcano|waterfall|hot_spring|geyser|cave_entrance|beach|cliff|arch|rock|stone"](around:${radius},${lat},${lng});
  node["boundary"="national_park"](around:${radius},${lat},${lng});
  way["boundary"="national_park"](around:${radius},${lat},${lng});
  node["landuse"="recreation_ground"](around:${radius},${lat},${lng});
);
out body center 200;
`
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: query,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  if (!res.ok) throw new Error('Overpass API error')
  const data = await res.json()
  return (data.elements || [])
    .filter(el => el.tags?.name)
    .map(el => {
      const lat = el.lat ?? el.center?.lat
      const lng = el.lon ?? el.center?.lon
      return {
        id: String(el.id),
        name: el.tags.name,
        lat,
        lng,
        tags: el.tags,
        emoji: _tourismEmoji(el.tags),
        category: _categoryFromTags(el.tags),
        description: el.tags.description || el.tags['description:en'] || el.tags.wikipedia?.replace(/_/g, ' ') || '',
        wikidata: el.tags.wikidata,
        wikipedia: el.tags.wikipedia,
        website: el.tags.website || el.tags['contact:website'] || '',
        phone: el.tags.phone || el.tags['contact:phone'] || '',
        openingHours: el.tags.opening_hours || '',
        address: [el.tags['addr:street'], el.tags['addr:city']].filter(Boolean).join(', '),
      }
    })
    .filter(el => el.lat != null && el.lng != null)
}

// ─── Attraction Card ──────────────────────────────────────────────────────────

function AttractionCard({ attraction, userLat, userLng }) {
  const distKm = (userLat != null && attraction.lat != null)
    ? _distKm(userLat, userLng, attraction.lat, attraction.lng)
    : null

  const mapsUrl = attraction.lat
    ? `https://www.google.com/maps?q=${attraction.lat},${attraction.lng}`
    : null

  const wikiUrl = attraction.wikipedia
    ? `https://en.wikipedia.org/wiki/${encodeURIComponent(attraction.wikipedia.replace(/^en:/, '').trim())}`
    : attraction.wiki
    ? `https://en.wikipedia.org/wiki/${attraction.wiki}`
    : null

  const imgSrc = attraction.img || CATEGORY_IMAGES[attraction.category] || CATEGORY_IMAGES.default
  const [imgErr, setImgErr] = useState(false)

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1.5px solid var(--border-color)',
      borderRadius: 16,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      transition: 'transform 0.2s, box-shadow 0.2s',
      animation: 'ride-card-in 0.35s cubic-bezier(0.34,1.56,0.64,1) both',
    }}
    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.2)' }}
    onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '' }}
    >
      {/* Hero banner */}
      <div style={{
        height: 130,
        position: 'relative',
        flexShrink: 0,
        overflow: 'hidden',
        background: 'linear-gradient(135deg, var(--bg-surface) 0%, var(--bg-input) 100%)',
      }}>
        {!imgErr ? (
          <img
            src={imgSrc}
            alt={attraction.name}
            onError={() => setImgErr(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '4rem',
          }}>
            {attraction.emoji}
          </div>
        )}
        <div style={{
          position: 'absolute', bottom: 8, left: 10,
          background: 'rgba(0,0,0,0.55)', borderRadius: 9999,
          padding: '2px 8px', fontSize: '1.1rem',
        }}>
          {attraction.emoji}
        </div>
        {distKm != null && (
          <span style={{
            position: 'absolute', top: 8, right: 8,
            background: distKm < 5 ? '#14532d' : 'rgba(0,0,0,0.6)',
            color: distKm < 5 ? '#86efac' : '#d1d5db',
            border: `1px solid ${distKm < 5 ? '#16a34a' : 'transparent'}`,
            borderRadius: 9999, padding: '3px 10px', fontSize: '0.72rem', fontWeight: 700,
          }}>
            📍 {distKm < 1 ? `${(distKm * 1000).toFixed(0)} m` : `${distKm.toFixed(1)} km`}
          </span>
        )}
        {attraction.country && !attraction.lat && (
          <span style={{
            position: 'absolute', top: 8, right: 8,
            background: 'rgba(0,0,0,0.6)', color: '#d1d5db',
            borderRadius: 9999, padding: '3px 10px', fontSize: '0.72rem',
          }}>
            {attraction.country}
          </span>
        )}
      </div>

      {/* Details */}
      <div style={{ padding: '14px 16px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h3 style={{ color: 'var(--text-primary)', fontSize: '1rem', fontWeight: 700, margin: 0, lineHeight: 1.3 }}>
          {attraction.name}
        </h3>

        {attraction.address && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', margin: 0 }}>
            📍 {attraction.address}
          </p>
        )}

        {attraction.description && (
          <p style={{
            color: 'var(--text-secondary)', fontSize: '0.82rem', margin: 0, lineHeight: 1.5,
            display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {attraction.description}
          </p>
        )}

        {attraction.openingHours && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', margin: 0 }}>
            🕐 {attraction.openingHours}
          </p>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 8, flexWrap: 'wrap' }}>
          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                flex: 1, background: '#3b82f6', color: '#fff', border: 'none',
                borderRadius: 8, padding: '7px 10px', fontSize: '0.78rem',
                fontWeight: 600, cursor: 'pointer', textDecoration: 'none',
                textAlign: 'center',
              }}
            >
              🗺 View on Map
            </a>
          )}
          {wikiUrl && (
            <a
              href={wikiUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                flex: 1,
                background: 'var(--bg-input)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: 8, padding: '7px 10px', fontSize: '0.78rem',
                fontWeight: 600, cursor: 'pointer', textDecoration: 'none',
                textAlign: 'center',
              }}
            >
              📖 Wikipedia
            </a>
          )}
          {attraction.website && (
            <a
              href={attraction.website.startsWith('http') ? attraction.website : `https://${attraction.website}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                background: 'var(--bg-input)', color: 'var(--text-secondary)',
                border: '1px solid var(--border-color)', borderRadius: 8,
                padding: '7px 10px', fontSize: '0.78rem', fontWeight: 600,
                textDecoration: 'none', textAlign: 'center',
              }}
            >
              🌐
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main content component ───────────────────────────────────────────────────

export default function TouristSitesContent({ initialLat = null, initialLng = null }) {
  // Show fallback attractions immediately so there's always content visible on first load.
  // Real data replaces the fallback once the user's location is determined.
  const [attractions, setAttractions]   = useState(FALLBACK_ATTRACTIONS)
  const [loading,     setLoading]       = useState(false)
  const [category,    setCategory]      = useState('all')
  const [searchQuery, setSearchQuery]   = useState('')
  const [usingFallback, setUsingFallback] = useState(true)

  const [userLat, setUserLat] = useState(initialLat)
  const [userLng, setUserLng] = useState(initialLng)
  const [locStatus, setLocStatus]       = useState('idle')
  const [radiusKm,  setRadiusKm]        = useState(25)

  // Auto-request location on mount if not provided
  useEffect(() => {
    if (initialLat != null || !navigator.geolocation) return
    setLocStatus('locating')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setUserLat(coords.latitude)
        setUserLng(coords.longitude)
        setLocStatus('found')
      },
      () => setLocStatus('denied'),
      { enableHighAccuracy: false, timeout: 10000 },
    )
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchAttractions = useCallback(async (lat, lng, radius) => {
    setLoading(true)
    setUsingFallback(false)
    try {
      const data = await fetchNearbyAttractions(lat, lng, radius)
      if (data.length === 0) {
        setAttractions(FALLBACK_ATTRACTIONS)
        setUsingFallback(true)
      } else {
        const sorted = [...data].sort((a, b) => _distKm(lat, lng, a.lat, a.lng) - _distKm(lat, lng, b.lat, b.lng))
        setAttractions(sorted)
      }
    } catch {
      setAttractions(FALLBACK_ATTRACTIONS)
      setUsingFallback(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (userLat != null && userLng != null) {
      fetchAttractions(userLat, userLng, radiusKm)
    } else if (locStatus === 'denied') {
      setAttractions(FALLBACK_ATTRACTIONS)
      setUsingFallback(true)
    }
  }, [userLat, userLng, radiusKm, locStatus, fetchAttractions])

  const handleGetLocation = () => {
    if (!navigator.geolocation) return
    setLocStatus('locating')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { setUserLat(coords.latitude); setUserLng(coords.longitude); setLocStatus('found') },
      () => setLocStatus('denied'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const displayedAttractions = (() => {
    const cat = CATEGORIES.find(c => c.id === category)
    let filtered = attractions

    if (cat && cat.id !== 'all') {
      filtered = filtered.filter(a => {
        if (!a.tags) return false
        return cat.tags.some(tagExpr => {
          const [key, val] = tagExpr.split('=')
          if (val === '*') return a.tags[key] != null
          return a.tags[key] === val
        })
      })
    }

    const q = searchQuery.trim().toLowerCase()
    if (q) {
      filtered = filtered.filter(a =>
        a.name.toLowerCase().includes(q) ||
        (a.description || '').toLowerCase().includes(q) ||
        (a.address || '').toLowerCase().includes(q) ||
        (a.country || '').toLowerCase().includes(q),
      )
    }
    return filtered
  })()

  return (
    <div>
      {/* ── Header controls ── */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: 0 }}>
              {usingFallback
                ? 'Showing popular global attractions — share your location for nearby sites'
                : userLat != null
                ? `${displayedAttractions.length} attraction${displayedAttractions.length !== 1 ? 's' : ''} within ${radiusKm} km`
                : 'Discovering tourist attractions near you…'}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={radiusKm}
              onChange={e => setRadiusKm(Number(e.target.value))}
              style={{
                background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)',
                borderRadius: 8, padding: '5px 8px', fontSize: '0.78rem', cursor: 'pointer',
              }}
              aria-label="Search radius"
            >
              {[5, 10, 25, 50, 100].map(r => (
                <option key={r} value={r}>Within {r} km</option>
              ))}
            </select>

            <button
              onClick={handleGetLocation}
              disabled={locStatus === 'locating'}
              style={{
                background: locStatus === 'found' ? '#14532d' : 'var(--bg-input)',
                color: locStatus === 'found' ? '#86efac' : 'var(--text-secondary)',
                border: `1px solid ${locStatus === 'found' ? '#16a34a' : 'var(--border-color)'}`,
                borderRadius: 8, padding: '5px 10px', fontSize: '0.78rem',
                fontWeight: 600, cursor: locStatus === 'locating' ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              {locStatus === 'locating'
                ? <><span className="spinner w-3 h-3" style={{ display: 'inline-block' }} /> Locating…</>
                : locStatus === 'found'
                ? '📍 Location found'
                : '📍 Share my location'}
            </button>
          </div>
        </div>

        {/* Search bar */}
        <input
          type="text"
          placeholder="Search attractions by name, description, or place…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{
            width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border-color)',
            borderRadius: 10, padding: '7px 12px', fontSize: '0.83rem', color: 'var(--text-primary)',
            boxSizing: 'border-box', marginBottom: 10,
          }}
        />

        {/* Category filter pills */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setCategory(cat.id)}
              style={{
                borderRadius: 9999, padding: '4px 12px', fontSize: '0.75rem',
                fontWeight: 600, cursor: 'pointer',
                border: category === cat.id ? '2px solid #3b82f6' : '1px solid var(--border-color)',
                background: category === cat.id ? 'rgba(59,130,246,0.18)' : 'var(--bg-input)',
                color: category === cat.id ? '#60a5fa' : 'var(--text-secondary)',
                transition: 'all 0.15s',
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Fallback notice ── */}
      {usingFallback && !loading && (
        <div style={{
          marginBottom: 14,
          background: 'rgba(30,64,175,0.15)',
          border: '1px solid rgba(59,130,246,0.3)',
          borderRadius: 10, padding: '10px 14px',
          color: '#93c5fd', fontSize: '0.8rem',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span>ℹ️</span>
          <span>
            {locStatus === 'denied'
              ? 'Location access was denied. Showing a selection of popular global landmarks.'
              : 'Could not find attractions near your location. Showing popular global landmarks instead.'}
          </span>
        </div>
      )}

      {/* ── Attraction Grid ── */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div className="spinner w-10 h-10" />
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Searching for attractions near you…</p>
        </div>
      ) : displayedAttractions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
          <div style={{ fontSize: '3rem', marginBottom: 12 }}>🗺️</div>
          <p>No attractions found.{searchQuery ? ' Try a different search term.' : ' Try expanding your radius or sharing your location.'}</p>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{ marginTop: 10, background: 'none', border: '1px solid var(--border-color)', borderRadius: 8, padding: '6px 14px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.8rem' }}
            >
              Clear search
            </button>
          )}
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: '16px',
        }}>
          {displayedAttractions.map((attraction, idx) => (
            <div key={attraction.id} style={{ animationDelay: `${Math.min(idx, 8) * 0.05}s` }}>
              <AttractionCard
                attraction={attraction}
                userLat={userLat}
                userLng={userLng}
              />
            </div>
          ))}
        </div>
      )}

      {!usingFallback && displayedAttractions.length > 0 && (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.72rem', textAlign: 'center', marginTop: 16 }}>
          Attraction data via <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa' }}>OpenStreetMap</a>
        </p>
      )}
    </div>
  )
}
