import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import RideChat from '../components/RideChat'
import RaiseRequest from '../components/RaiseRequest'
import UserAuth from '../components/UserAuth'
import ThemeSelector from '../components/ThemeSelector'
import UserProfile from '../components/UserProfile'
import {
  getUserProfile, getNotifications, markAllNotificationsRead,
  listRides, estimateFare, geocodeAddress, postRide, cancelRide, aiChat,
} from '../api'
import socket from '../socket'

// ── Uganda Districts ──────────────────────────────────────────────────────────
const UGANDA_DISTRICTS = [
  'Abim', 'Adjumani', 'Agago', 'Alebtong', 'Amolatar', 'Amudat', 'Amuria', 'Amuru',
  'Apac', 'Arua', 'Budaka', 'Bududa', 'Bugiri', 'Buhweju', 'Buikwe', 'Bukedea',
  'Bukomansimbi', 'Bukwa', 'Bulambuli', 'Buliisa', 'Bundibugyo', 'Bunyangabu',
  'Bushenyi', 'Busia', 'Butaleja', 'Butebo', 'Buvuma', 'Buyende', 'Dokolo',
  'Gomba', 'Gulu', 'Hoima', 'Ibanda', 'Iganga', 'Isingiro', 'Jinja', 'Kaabong',
  'Kabale', 'Kabarole', 'Kaberamaido', 'Kagadi', 'Kakumiro', 'Kalangala',
  'Kaliro', 'Kalungu', 'Kampala', 'Kamuli', 'Kamwenge', 'Kanungu', 'Kapchorwa',
  'Kapelebyong', 'Kasanda', 'Kasese', 'Katakwi', 'Kayunga', 'Kazo', 'Kibale',
  'Kiboga', 'Kibuku', 'Kikuube', 'Kiruhura', 'Kiryandongo', 'Kisoro', 'Kitgum',
  'Koboko', 'Kole', 'Kotido', 'Kumi', 'Kwania', 'Kween', 'Kyankwanzi',
  'Kyegegwa', 'Kyenjojo', 'Kyotera', 'Lamwo', 'Lira', 'Luuka', 'Luwero',
  'Lwengo', 'Lyantonde', 'Madi-Okollo', 'Manafwa', 'Maracha', 'Masaka',
  'Masindi', 'Mayuge', 'Mbale', 'Mbarara', 'Mitooma', 'Mityana', 'Moroto',
  'Moyo', 'Mpigi', 'Mubende', 'Mukono', 'Nabilatuk', 'Nakapiripirit', 'Nakaseke',
  'Nakasongola', 'Namayingo', 'Namisindwa', 'Namutumba', 'Napak', 'Nebbi',
  'Ngora', 'Ntoroko', 'Ntungamo', 'Nwoya', 'Obongi', 'Omoro', 'Otuke', 'Oyam',
  'Pader', 'Pakwach', 'Pallisa', 'Rakai', 'Rubanda', 'Rubirizi', 'Rukiga',
  'Rukungiri', 'Rwampara', 'Sembabule', 'Serere', 'Sheema', 'Sironko', 'Soroti',
  'Tororo', 'Wakiso', 'Yumbe', 'Zombo',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDep(dep) {
  if (!dep) return ''
  try { return new Date(dep).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return dep }
}

// ── Post Ride Modal ───────────────────────────────────────────────────────────

function PostRideModal({ onClose, onPosted }) {
  const [form, setForm] = useState({
    origin: '', destination: '', departure: '', seats: 1,
    fare: '', vehicle_type: 'sedan', vehicle_color: '', notes: '',
    share_ride: true,  // user preference: allow sharing
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState('')
  const [originCoords, setOriginCoords]   = useState(null)
  const [destCoords, setDestCoords]       = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleGeocode = async (field) => {
    const addr = field === 'origin' ? form.origin : form.destination
    if (!addr.trim()) return
    try {
      const d = await geocodeAddress(addr)
      if (d?.lat && d?.lng) {
        field === 'origin' ? setOriginCoords(d) : setDestCoords(d)
      }
    } catch {}
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.origin || !form.destination || !form.departure) {
      setError('Origin, destination, and departure are required.')
      return
    }
    setSubmitting(true)
    try {
      await postRide(
        form.origin, form.destination, form.departure,
        parseInt(form.seats, 10),
        form.notes,
        originCoords?.lat || null, originCoords?.lng || null,
        destCoords?.lat || null,   destCoords?.lng || null,
        form.fare ? parseFloat(form.fare) : null,
        form.share_ride ? 'shared' : 'airport',
        form.vehicle_color, form.vehicle_type, ''
      )
      onPosted()
      onClose()
    } catch (e) {
      setError(e?.message || 'Failed to post ride')
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls = 'w-full rounded-lg px-3 py-2 text-sm outline-none'
  const inputSty = { background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="w-full max-w-md rounded-xl border p-6 space-y-4"
           style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>🚗 Post a Ride</h3>
          <button onClick={onClose} className="text-lg leading-none opacity-60 hover:opacity-100">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <input placeholder="Origin (e.g. Kampala, Entebbe)" value={form.origin}
                   list="origin-suggestions"
                   onChange={e => set('origin', e.target.value)}
                   onBlur={() => handleGeocode('origin')}
                   className={inputCls} style={inputSty} />
            <datalist id="origin-suggestions">
              {UGANDA_DISTRICTS.map(d => <option key={d} value={d} />)}
              <option value="Entebbe International Airport" />
              <option value="Kampala City Centre" />
            </datalist>
          </div>
          <div>
            <input placeholder="Destination (e.g. Jinja, Mbarara)" value={form.destination}
                   list="dest-suggestions"
                   onChange={e => set('destination', e.target.value)}
                   onBlur={() => handleGeocode('destination')}
                   className={inputCls} style={inputSty} />
            <datalist id="dest-suggestions">
              {UGANDA_DISTRICTS.map(d => <option key={d} value={d} />)}
              <option value="Entebbe International Airport" />
              <option value="Kampala City Centre" />
            </datalist>
          </div>
          <input type="datetime-local" value={form.departure}
                 onChange={e => set('departure', e.target.value)}
                 className={inputCls} style={inputSty} />
          <div className="grid grid-cols-2 gap-3">
            <input type="number" min="1" max="20" placeholder="Seats" value={form.seats}
                   onChange={e => set('seats', e.target.value)}
                   className={inputCls} style={inputSty} />
            <input type="number" min="0" step="0.01" placeholder="Fare ($)" value={form.fare}
                   onChange={e => set('fare', e.target.value)}
                   className={inputCls} style={inputSty} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <select value={form.vehicle_type} onChange={e => set('vehicle_type', e.target.value)}
                    className={inputCls} style={inputSty}>
              <option value="sedan">Sedan</option>
              <option value="suv">SUV</option>
              <option value="van">Van</option>
              <option value="truck">Truck</option>
              <option value="minibus">Minibus</option>
              <option value="other">Other</option>
            </select>
            <input placeholder="Vehicle color" value={form.vehicle_color}
                   onChange={e => set('vehicle_color', e.target.value)}
                   className={inputCls} style={inputSty} />
          </div>
          <textarea placeholder="Notes (optional)" value={form.notes}
                    onChange={e => set('notes', e.target.value)}
                    rows={2} className={inputCls} style={inputSty} />
          <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={form.share_ride} onChange={e => set('share_ride', e.target.checked)}
                   className="w-4 h-4 rounded" />
            <span>Allow passengers to share this ride</span>
          </label>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button type="submit" disabled={submitting}
                  className="w-full px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-amber-500 hover:bg-amber-400 text-black disabled:opacity-50">
            {submitting ? 'Posting…' : 'Post Ride'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Currency helpers ──────────────────────────────────────────────────────────
// Maps IANA timezone prefix → { currency, symbol }
const TZ_CURRENCY = {
  'Africa/Lagos': { currency: 'NGN', symbol: '₦' },
  'Africa/Nairobi': { currency: 'KES', symbol: 'KSh' },
  'Africa/Accra': { currency: 'GHS', symbol: 'GH₵' },
  'Africa/Johannesburg': { currency: 'ZAR', symbol: 'R' },
  'Africa/Cairo': { currency: 'EGP', symbol: 'E£' },
  'Europe/London': { currency: 'GBP', symbol: '£' },
  'Europe/Paris': { currency: 'EUR', symbol: '€' },
  'Europe/Berlin': { currency: 'EUR', symbol: '€' },
  'Europe/Rome': { currency: 'EUR', symbol: '€' },
  'Europe/Madrid': { currency: 'EUR', symbol: '€' },
  'Europe/Amsterdam': { currency: 'EUR', symbol: '€' },
  'Europe/Brussels': { currency: 'EUR', symbol: '€' },
  'Europe/Vienna': { currency: 'EUR', symbol: '€' },
  'Europe/Warsaw': { currency: 'PLN', symbol: 'zł' },
  'Europe/Stockholm': { currency: 'SEK', symbol: 'kr' },
  'Europe/Oslo': { currency: 'NOK', symbol: 'kr' },
  'Europe/Copenhagen': { currency: 'DKK', symbol: 'kr' },
  'America/New_York': { currency: 'USD', symbol: '$' },
  'America/Chicago': { currency: 'USD', symbol: '$' },
  'America/Denver': { currency: 'USD', symbol: '$' },
  'America/Los_Angeles': { currency: 'USD', symbol: '$' },
  'America/Toronto': { currency: 'CAD', symbol: 'CA$' },
  'America/Vancouver': { currency: 'CAD', symbol: 'CA$' },
  'America/Sao_Paulo': { currency: 'BRL', symbol: 'R$' },
  'America/Mexico_City': { currency: 'MXN', symbol: 'MX$' },
  'America/Buenos_Aires': { currency: 'ARS', symbol: '$' },
  'America/Bogota': { currency: 'COP', symbol: '$' },
  'Asia/Kolkata': { currency: 'INR', symbol: '₹' },
  'Asia/Calcutta': { currency: 'INR', symbol: '₹' },
  'Asia/Tokyo': { currency: 'JPY', symbol: '¥' },
  'Asia/Shanghai': { currency: 'CNY', symbol: '¥' },
  'Asia/Seoul': { currency: 'KRW', symbol: '₩' },
  'Asia/Singapore': { currency: 'SGD', symbol: 'S$' },
  'Asia/Dubai': { currency: 'AED', symbol: 'د.إ' },
  'Asia/Riyadh': { currency: 'SAR', symbol: '﷼' },
  'Asia/Karachi': { currency: 'PKR', symbol: '₨' },
  'Asia/Dhaka': { currency: 'BDT', symbol: '৳' },
  'Asia/Jakarta': { currency: 'IDR', symbol: 'Rp' },
  'Asia/Manila': { currency: 'PHP', symbol: '₱' },
  'Asia/Bangkok': { currency: 'THB', symbol: '฿' },
  'Asia/Kuala_Lumpur': { currency: 'MYR', symbol: 'RM' },
  'Australia/Sydney': { currency: 'AUD', symbol: 'A$' },
  'Australia/Melbourne': { currency: 'AUD', symbol: 'A$' },
  'Pacific/Auckland': { currency: 'NZD', symbol: 'NZ$' },
}

function detectLocalCurrency() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (TZ_CURRENCY[tz]) return TZ_CURRENCY[tz]
    // Partial match on continent prefix
    for (const [key, val] of Object.entries(TZ_CURRENCY)) {
      const prefix = tz.split('/')[0]
      if (key.startsWith(prefix + '/')) return val
    }
  } catch {}
  return { currency: 'USD', symbol: '$' }
}

async function fetchExchangeRate(from, to) {
  if (from === to) return 1
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${to}`)
    if (!res.ok) return null
    const data = await res.json()
    return data?.rates?.[to] ?? null
  } catch { return null }
}

// ── Fare Estimator ────────────────────────────────────────────────────────────

function FareEstimator() {
  const [start, setStart]   = useState('')
  const [dest, setDest]     = useState('')
  const [seats, setSeats]   = useState(1)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr]       = useState('')
  const [localInfo, setLocalInfo] = useState(null)   // { currency, symbol, rate, localFare }
  const [rateLoading, setRateLoading] = useState(false)
  const [locationStatus, setLocationStatus] = useState('')  // '' | 'detecting' | 'detected' | 'error'

  // Detect local currency on mount
  useEffect(() => {
    const info = detectLocalCurrency()
    setLocalInfo(info)
    if (info.currency !== 'USD') {
      setLocationStatus('detecting')
      fetchExchangeRate('USD', info.currency).then(rate => {
        if (rate) {
          setLocalInfo(prev => ({ ...prev, rate }))
          setLocationStatus('detected')
        } else {
          setLocationStatus('error')
        }
      })
    } else {
      setLocationStatus('detected')
    }
  }, [])

  const handleEstimate = async () => {
    if (!start || !dest) { setErr('Enter start and destination'); return }
    setErr('')
    setLoading(true)
    try {
      const d = await estimateFare(start, dest, seats)
      setResult(d)
      // Refresh exchange rate when result arrives
      if (localInfo?.currency && localInfo.currency !== 'USD') {
        setRateLoading(true)
        const rate = await fetchExchangeRate('USD', localInfo.currency)
        if (rate) setLocalInfo(prev => ({ ...prev, rate }))
        setRateLoading(false)
      }
    } catch (e) {
      setErr(e?.message || 'Failed to estimate')
    } finally {
      setLoading(false)
    }
  }

  const inputSty = { background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }

  const fmtLocal = (usd) => {
    if (!localInfo?.rate || localInfo.currency === 'USD') return null
    const local = usd * localInfo.rate
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: localInfo.currency, maximumFractionDigits: 0 }).format(local)
    } catch {
      return `${localInfo.symbol}${local.toFixed(0)}`
    }
  }

  return (
    <div className="rounded-xl border overflow-hidden"
         style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-2 border-b" style={{ borderColor: 'var(--border-color)', background: 'linear-gradient(135deg, #f59e0b12, #d9770612)' }}>
        <span className="text-base">💰</span>
        <div className="flex-1">
          <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Fare Estimator</h4>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>$1 per km — instant price estimate</p>
        </div>
        {locationStatus === 'detected' && localInfo?.currency !== 'USD' && (
          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(16,185,129,0.15)', color: '#6ee7b7' }}>
            📍 {localInfo.currency}
          </span>
        )}
        {locationStatus === 'detecting' && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>📍 detecting…</span>
        )}
      </div>
      <div className="p-4 space-y-3">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-green-400 text-xs pointer-events-none">📍</span>
          <input placeholder="From — e.g. London Heathrow" value={start} onChange={e => setStart(e.target.value)}
                 className="w-full rounded-lg pl-8 pr-3 py-2 text-sm outline-none" style={inputSty} />
        </div>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-400 text-xs pointer-events-none">🏁</span>
          <input placeholder="To — e.g. Manchester City Centre" value={dest} onChange={e => setDest(e.target.value)}
                 className="w-full rounded-lg pl-8 pr-3 py-2 text-sm outline-none" style={inputSty} />
        </div>
        {/* Seats stepper */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>👥 Seats:</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setSeats(s => Math.max(1, s - 1))} type="button"
                    className="w-7 h-7 rounded-lg text-sm font-bold flex items-center justify-center hover:opacity-80"
                    style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>−</button>
            <span className="text-sm font-bold w-4 text-center" style={{ color: 'var(--text-primary)' }}>{seats}</span>
            <button onClick={() => setSeats(s => Math.min(20, s + 1))} type="button"
                    className="w-7 h-7 rounded-lg text-sm font-bold flex items-center justify-center hover:opacity-80"
                    style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>+</button>
          </div>
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <button onClick={handleEstimate} disabled={loading}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors bg-amber-500 hover:bg-amber-400 text-black disabled:opacity-50">
          {loading ? '⏳ Estimating…' : '🔍 Estimate Fare'}
        </button>
        {result && (
          <div className="rounded-xl p-4 space-y-2" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)' }}>
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>📏 Distance</span>
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{result.dist_km?.toFixed(1)} km</span>
            </div>
            <div className="h-px" style={{ background: 'var(--border-color)' }} />
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>💵 Total fare (USD)</span>
              <span className="text-base font-bold text-amber-400">${result.total_fare?.toFixed(2)}</span>
            </div>
            {fmtLocal(result.total_fare) && !rateLoading && (
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>📍 Local ({localInfo.currency})</span>
                <span className="text-sm font-bold" style={{ color: '#6ee7b7' }}>{fmtLocal(result.total_fare)}</span>
              </div>
            )}
            {rateLoading && <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>Converting currency…</p>}
            {seats > 1 && result.per_seat_cost != null && (
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>👥 Per seat</span>
                <div className="text-right">
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>${result.per_seat_cost?.toFixed(2)}</span>
                  {fmtLocal(result.per_seat_cost) && !rateLoading && (
                    <span className="text-xs ml-1" style={{ color: 'var(--text-muted)' }}>≈ {fmtLocal(result.per_seat_cost)}</span>
                  )}
                </div>
              </div>
            )}
            {(result.origin_display || result.dest_display) && (
              <p className="text-xs pt-1 truncate" style={{ color: 'var(--text-muted)' }}>
                {result.origin_display} → {result.dest_display}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── AI Assistant ──────────────────────────────────────────────────────────────

const QUICK_SUGGESTIONS = [
  '🔍 Search a ride for me',
  '📝 Help me book a ride',
  'How is fare calculated?',
  'Is it safe to share rides?',
]

// MCP (Model Context Protocol) booking flow state machine
// States: idle → search → confirm_search → fill_details → confirm_book → booked
const MCP_PROMPTS = {
  search: [
    { field: 'origin',      prompt: '📍 Where are you departing from? (e.g. Kampala)' },
    { field: 'destination', prompt: '🏁 Where are you heading? (e.g. Jinja)' },
    { field: 'date',        prompt: '📅 What date do you want to travel? (e.g. tomorrow, 2026-05-10)' },
  ],
}

function TypingIndicator() {
  return (
    <div className="flex justify-start gap-2 items-end">
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-sm shrink-0">🤖</div>
      <div className="px-4 py-3 rounded-2xl rounded-bl-sm" style={{ background: 'var(--bg-surface)' }}>
        <span className="flex gap-1 items-center h-3">
          {[0, 1, 2].map(i => (
            <span key={i} className="w-1.5 h-1.5 rounded-full bg-amber-400"
              style={{ animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />
          ))}
        </span>
      </div>
    </div>
  )
}

function AIAssistant({ rides = [], onBookRide }) {
  const [open, setOpen]       = useState(false)
  const [messages, setMessages] = useState([{
    role: 'bot',
    text: 'Hi! I\'m YotBot 🤖 — your AI ride assistant. I can help you search for rides, fill booking forms, and answer any questions! Try "Search a ride for me" or ask me anything.',
    ts: Date.now(),
  }])
  const [input, setInput]     = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef             = useRef(null)
  const inputRef              = useRef(null)

  // MCP booking flow state
  const [mcpFlow,    setMcpFlow]    = useState(null)   // null | 'search'
  const [mcpStep,    setMcpStep]    = useState(0)
  const [mcpData,    setMcpData]    = useState({})     // collected form data
  const [mcpResults, setMcpResults] = useState([])     // matching rides

  useEffect(() => {
    if (open) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
      inputRef.current?.focus()
    }
  }, [messages, open])

  const pushBot = (text, extra = {}) => {
    setMessages(prev => [...prev, { role: 'bot', text, ts: Date.now(), ...extra }])
  }

  const pushUser = (text) => {
    setMessages(prev => [...prev, { role: 'user', text, ts: Date.now() }])
  }

  // Start the MCP search flow
  const startSearchFlow = () => {
    setMcpFlow('search')
    setMcpStep(0)
    setMcpData({})
    setMcpResults([])
    pushBot(MCP_PROMPTS.search[0].prompt)
  }

  // Process MCP flow input
  const processMcpInput = (text) => {
    const steps = MCP_PROMPTS.search
    const field  = steps[mcpStep].field
    const updated = { ...mcpData, [field]: text }
    setMcpData(updated)

    const nextStep = mcpStep + 1

    if (nextStep < steps.length) {
      setMcpStep(nextStep)
      pushBot(steps[nextStep].prompt)
    } else {
      // All fields collected — search rides
      setMcpFlow('searching')
      const { origin, destination } = updated
      const matching = rides.filter(r => {
        const o = (r.origin || '').toLowerCase()
        const d = (r.destination || '').toLowerCase()
        const oq = (origin || '').toLowerCase()
        const dq = (destination || '').toLowerCase()
        return (oq && o.includes(oq)) || (dq && d.includes(dq)) ||
               (oq && d.includes(oq)) || (dq && o.includes(dq))
      })
      setMcpResults(matching)
      setMcpFlow('results')

      if (matching.length === 0) {
        pushBot(`I couldn't find rides from "${origin}" to "${destination}". 😔 You can raise a ride request so drivers see it! Try the 🙋 Requests tab.`, { type: 'no_results' })
        setMcpFlow(null)
      } else {
        pushBot(
          `✅ Found ${matching.length} ride${matching.length !== 1 ? 's' : ''} from ${origin} to ${destination}! Here are the options:`,
          { type: 'results', rides: matching }
        )
      }
    }
  }

  const handleSend = async (text) => {
    const trimmed = (text || input).trim()
    if (!trimmed || loading) return
    pushUser(trimmed)
    setInput('')

    // Check for MCP flow triggers first
    const lower = trimmed.toLowerCase()

    if (mcpFlow === 'search' || mcpFlow === null && (
      lower.includes('search') || lower.includes('find a ride') ||
      lower.includes('look for') || lower.includes('book a ride') ||
      lower.includes('help me book') || lower.includes('search a ride')
    )) {
      if (mcpFlow === 'search') {
        processMcpInput(trimmed)
        return
      } else {
        startSearchFlow()
        return
      }
    }

    if (mcpFlow === 'results' && lower.includes('book')) {
      // User wants to book one of the results
      if (mcpResults.length > 0) {
        const ride = mcpResults[0]
        pushBot(`Great! I'll open the booking chat for "${ride.origin} → ${ride.destination}" with ${ride.driver_name || 'the driver'} 🚗`)
        setMcpFlow(null)
        setMcpResults([])
        setTimeout(() => onBookRide?.(ride), 500)
        return
      }
    }

    if (mcpFlow) {
      processMcpInput(trimmed)
      return
    }

    // Regular AI chat
    setLoading(true)
    try {
      const d = await aiChat(trimmed, 'rides')
      pushBot(d.reply)
    } catch {
      pushBot('Sorry, I couldn\'t process that. Please try again!')
    } finally {
      setLoading(false)
    }
  }

  const inputSty = { background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }

  return (
    <div className="rounded-xl border overflow-hidden"
         style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
      {/* Header — always visible */}
      <button onClick={() => setOpen(v => !v)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:opacity-90 transition-opacity"
              style={{ background: open ? 'linear-gradient(135deg, #f59e0b18, #d9770618)' : 'transparent' }}>
        <div className="relative shrink-0">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-lg shadow-md">🤖</div>
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-400 border-2 driver-online-pulse" style={{ borderColor: 'var(--bg-card)' }} />
        </div>
        <div className="flex-1 text-left">
          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>YotBot AI Assistant</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {mcpFlow === 'search' ? `🔍 Collecting ride details… (step ${mcpStep + 1}/${MCP_PROMPTS.search.length})` : 'Search, book, and ask anything about rides'}
          </p>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full font-medium mr-1" style={{ background: 'rgba(16,185,129,0.15)', color: '#6ee7b7' }}>
          Online
        </span>
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <>
          {/* Chat messages */}
          <div className="h-72 overflow-y-auto px-4 py-3 space-y-3"
               style={{ background: 'var(--bg-page)', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)' }}>
            {messages.map((m, i) => (
              <div key={i} className={`flex gap-2 items-end ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                {m.role === 'bot' && (
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-sm shrink-0">🤖</div>
                )}
                <div className={`max-w-[85%] space-y-1 ${m.role === 'user' ? 'items-end flex flex-col' : ''}`}>
                  <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                    m.role === 'user'
                      ? 'rounded-br-sm bg-amber-500 text-black'
                      : 'rounded-bl-sm'
                  }`}
                  style={m.role !== 'user' ? { background: 'var(--bg-surface)', color: 'var(--text-primary)' } : {}}>
                    {m.text}
                  </div>
                  {/* Inline ride results from MCP search */}
                  {m.type === 'results' && m.rides && m.rides.length > 0 && (
                    <div className="space-y-1 w-full">
                      {m.rides.slice(0, 4).map(r => (
                        <button key={r.ride_id}
                          onClick={() => { pushUser(`Book ride: ${r.origin} → ${r.destination}`); onBookRide?.(r) }}
                          className="w-full text-left p-2 rounded-xl text-xs transition-all hover:opacity-90"
                          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}>
                          <div className="font-semibold truncate">🚗 {r.origin} → {r.destination}</div>
                          <div className="flex gap-2 mt-0.5" style={{ color: 'var(--text-muted)' }}>
                            {r.fare ? <span>💰 ${r.fare}</span> : null}
                            <span>💺 {r.seats} seat{r.seats !== 1 ? 's' : ''}</span>
                            {r.driver_name && <span>👤 {r.driver_name}</span>}
                          </div>
                          <div className="mt-1 text-amber-400 font-semibold">Tap to book →</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && <TypingIndicator />}
            <div ref={bottomRef} />
          </div>

          {/* Quick suggestions (only when few messages) */}
          {messages.length <= 2 && !loading && !mcpFlow && (
            <div className="px-4 py-2 flex gap-2 overflow-x-auto" style={{ borderBottom: '1px solid var(--border-color)' }}>
              {QUICK_SUGGESTIONS.map((s, i) => (
                <button key={i} onClick={() => handleSend(s)}
                        className="shrink-0 text-xs px-3 py-1.5 rounded-full font-medium hover:opacity-80 transition-opacity whitespace-nowrap"
                        style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* MCP flow progress indicator */}
          {mcpFlow === 'search' && (
            <div className="px-4 py-2 flex gap-1" style={{ borderBottom: '1px solid var(--border-color)', background: 'rgba(245,158,11,0.06)' }}>
              {MCP_PROMPTS.search.map((_, idx) => (
                <div key={idx} className={`flex-1 h-1 rounded-full transition-colors ${
                  idx < mcpStep ? 'bg-green-400' : idx === mcpStep ? 'bg-amber-400' : 'bg-gray-700'
                }`} />
              ))}
            </div>
          )}

          {/* Input bar */}
          <div className="flex gap-2 p-3">
            <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
                   onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                   placeholder={mcpFlow === 'search' ? `Type your answer…` : 'Ask YotBot anything…'}
                   maxLength={300}
                   className="flex-1 rounded-xl px-3 py-2 text-sm outline-none"
                   style={inputSty} />
            <button onClick={() => handleSend()} disabled={!input.trim() || loading}
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-sm bg-amber-500 hover:bg-amber-400 text-black disabled:opacity-40 shrink-0 transition-colors">
              ➤
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Main RidesPage ────────────────────────────────────────────────────────────

export default function RidesPage() {
  const navigate = useNavigate()
  const [appUser, setAppUser]             = useState(null)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [profileOpen, setProfileOpen]     = useState(false)
  const profileRef                        = useRef(null)

  // Rides
  const [rides, setRides]               = useState([])
  const [ridesLoading, setRidesLoading] = useState(true)
  const [ridesError, setRidesError]     = useState('')
  const [selectedRide, setSelectedRide] = useState(null)
  const [showPostForm, setShowPostForm] = useState(false)

  // Filters
  const [searchText, setSearchText] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [seatsFilter, setSeatsFilter] = useState('')
  const [priceSort, setPriceSort] = useState('')  // '' | 'asc' | 'desc'
  const [districtFilter, setDistrictFilter] = useState('')  // Uganda district

  // Right panel
  const [rightTab, setRightTab] = useState('rides')

  // Notifications
  const [notifs, setNotifs]       = useState([])
  const [showNotifs, setShowNotifs] = useState(false)
  const notifRef                   = useRef(null)
  const unread                     = notifs.filter(n => !n.read).length

  // Load user
  useEffect(() => {
    getUserProfile().then(u => setAppUser(u)).catch(() => setAppUser(null))
  }, [])

  // Load notifications
  useEffect(() => {
    getNotifications().then(d => setNotifs(d.notifications || [])).catch(() => {})
  }, [])

  // Real-time notifications
  useEffect(() => {
    const onNotif = (n) => setNotifs(prev => [n, ...prev])
    socket.on('dm_notification', onNotif)
    socket.on('ride_chat_notification', onNotif)
    return () => {
      socket.off('dm_notification', onNotif)
      socket.off('ride_chat_notification', onNotif)
    }
  }, [])

  // Load rides
  const loadRides = () => {
    setRidesLoading(true)
    setRidesError('')
    listRides()
      .then(d => setRides(d.rides || []))
      .catch(() => setRidesError('Failed to load rides'))
      .finally(() => setRidesLoading(false))
  }
  useEffect(() => { loadRides() }, [])

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false)
      if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotifs(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleCancelRide = async (rideId, e) => {
    e.stopPropagation()
    try { await cancelRide(rideId); loadRides() } catch {}
  }

  const handleMarkAllRead = async () => {
    try { await markAllNotificationsRead(); setNotifs(prev => prev.map(n => ({ ...n, read: true }))) } catch {}
  }

  // Filter rides
  const filteredRides = rides.filter(r => {
    const q = searchText.toLowerCase()
    const matchText = !q || r.origin?.toLowerCase().includes(q) || r.destination?.toLowerCase().includes(q)
    const matchDate = !dateFilter || (r.departure && r.departure.startsWith(dateFilter))
    const matchSeats = !seatsFilter || (r.seats >= parseInt(seatsFilter, 10))
    const matchDistrict = !districtFilter || r.origin?.toLowerCase().includes(districtFilter.toLowerCase()) || r.destination?.toLowerCase().includes(districtFilter.toLowerCase())
    return matchText && matchDate && matchSeats && matchDistrict
  }).sort((a, b) => {
    if (!priceSort) return 0
    const fa = a.fare ?? Infinity
    const fb = b.fare ?? Infinity
    return priceSort === 'asc' ? fa - fb : fb - fa
  })

  const inputCls = 'rounded-lg px-3 py-2 text-sm outline-none'
  const inputSty = { background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }

  return (
    <div style={{ background: 'var(--bg-page)', minHeight: '100vh' }}>
      {/* Header */}
      <header className="sticky top-0 z-30 border-b"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}>
        <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-4">
          {/* Home + brand */}
          <Link to="/" className="flex items-center gap-2 text-amber-500 font-bold text-lg leading-none whitespace-nowrap hover:text-amber-400 transition-colors">
            🏠
          </Link>
          <Link to="/rides" className="text-amber-500 font-bold text-lg leading-none whitespace-nowrap hover:text-amber-400 transition-colors">
            🚗 YotRides
          </Link>

          {/* Nav — desktop only; on mobile the tab bar below the ride list is used */}
          <nav className="hidden sm:flex gap-1 ml-2">
            {[['rides', '🗺️ Rides'], ['requests', '🙋 Requests']].map(([id, label]) => (
              <button key={id} onClick={() => setRightTab(id)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${rightTab === id ? 'bg-amber-500 text-black' : 'hover:opacity-80'}`}
                      style={rightTab !== id ? { color: 'var(--text-secondary)' } : {}}>
                {label}
              </button>
            ))}
          </nav>

          <div className="flex-1" />

          {/* Right controls */}
          <div className="flex items-center gap-2">
            <ThemeSelector />

            {/* Notifications */}
            <div className="relative" ref={notifRef}>
              <button onClick={() => setShowNotifs(v => !v)}
                      className="relative p-2 rounded-lg hover:opacity-80 transition-opacity"
                      style={{ color: 'var(--text-secondary)' }}>
                🔔
                {unread > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-xs flex items-center justify-center leading-none font-bold">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </button>
              {showNotifs && (
                <div className="absolute right-0 top-full mt-1 w-72 rounded-xl border shadow-xl z-50 overflow-hidden"
                     style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
                  <div className="flex items-center justify-between px-3 py-2 border-b"
                       style={{ borderColor: 'var(--border-color)' }}>
                    <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Notifications</span>
                    {unread > 0 && (
                      <button onClick={handleMarkAllRead} className="text-xs text-amber-500 hover:text-amber-400">Mark all read</button>
                    )}
                  </div>
                  <div className="max-h-64 overflow-y-auto divide-y" style={{ borderColor: 'var(--border-color)' }}>
                    {notifs.length === 0 ? (
                      <p className="text-xs px-3 py-4 text-center" style={{ color: 'var(--text-muted)' }}>No notifications</p>
                    ) : notifs.slice(0, 20).map((n, i) => (
                      <div key={n.id || i} className={`px-3 py-2 text-xs ${!n.read ? 'opacity-100' : 'opacity-60'}`}
                           style={{ color: 'var(--text-primary)' }}>
                        <p className="font-medium">{n.title || n.type || 'Notification'}</p>
                        <p style={{ color: 'var(--text-muted)' }}>{n.message || n.body || ''}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Inbox */}
            <button onClick={() => navigate('/inbox')}
                    className="p-2 rounded-lg hover:opacity-80 transition-opacity"
                    style={{ color: 'var(--text-secondary)' }}>
              💬
            </button>

            {/* Auth / avatar */}
            {appUser ? (
              <div className="relative" ref={profileRef}>
                <button onClick={() => setProfileOpen(v => !v)}
                        className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center text-sm font-bold text-black">
                  {appUser.name?.charAt(0)?.toUpperCase() || '?'}
                </button>
                {profileOpen && (
                  <div className="absolute right-0 top-full mt-1 z-50">
                    <UserProfile user={appUser} onLogout={() => { setAppUser(null); setProfileOpen(false) }}
                                 onUserUpdate={u => u && setAppUser(p => ({ ...p, ...u }))} />
                  </div>
                )}
              </div>
            ) : (
              <button onClick={() => setShowAuthModal(true)}
                      className="px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-500 hover:bg-amber-400 text-black">
                Sign in
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto p-4 flex flex-col md:flex-row gap-4">
        {/* Left — ride list */}
        <section className="flex-1 min-w-0 space-y-4">
          {/* Top bar */}
          <div className="flex flex-wrap items-center gap-2">
            {appUser?.role === 'driver' && (
              <button onClick={() => setShowPostForm(true)}
                      className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-amber-500 hover:bg-amber-400 text-black">
                + Post a Ride
              </button>
            )}
            <button onClick={loadRides}
                    className="px-3 py-2 rounded-lg text-sm transition-colors hover:opacity-80"
                    style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
              ↺ Refresh
            </button>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <input placeholder="Search origin / destination…" value={searchText}
                   onChange={e => setSearchText(e.target.value)}
                   className={`${inputCls} flex-1 min-w-40`} style={inputSty} />
            <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)}
                   className={inputCls} style={inputSty} />
            <input type="number" min="1" max="20" placeholder="Min seats" value={seatsFilter}
                   onChange={e => setSeatsFilter(e.target.value)}
                   className={`${inputCls} w-28`} style={inputSty} />
            <select value={priceSort} onChange={e => setPriceSort(e.target.value)}
                    className={`${inputCls} w-36`} style={inputSty}>
              <option value="">💰 Price: any</option>
              <option value="asc">💰 Low → High</option>
              <option value="desc">💰 High → Low</option>
            </select>
            <select value={districtFilter} onChange={e => setDistrictFilter(e.target.value)}
                    className={`${inputCls} w-40`} style={inputSty}>
              <option value="">🇺🇬 All Districts</option>
              {UGANDA_DISTRICTS.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          {/* Ride list */}
          {ridesLoading ? (
            <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading rides…</p>
          ) : ridesError ? (
            <p className="text-sm py-4 text-center text-red-400">{ridesError}</p>
          ) : filteredRides.length === 0 ? (
            <div className="rounded-xl border p-8 text-center space-y-3"
                 style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
              <p className="text-4xl">🚗</p>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No rides found.</p>
              <button onClick={() => setRightTab('requests')}
                      className="text-sm text-amber-500 hover:text-amber-400 underline">
                Raise a request →
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredRides.map(ride => (
                <div key={ride.ride_id}
                     className="rounded-xl border p-4 flex items-start justify-between gap-3 hover:opacity-90 transition-opacity"
                     style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="font-semibold text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                      {ride.origin} → {ride.destination}
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                      <span>💰 {ride.fare ? '$' + ride.fare : 'Ask driver'}</span>
                      <span>🪑 {ride.seats} seat(s)</span>
                      {(ride.vehicle_color || ride.vehicle_type) && (
                        <span>🚙 {[ride.vehicle_color, ride.vehicle_type].filter(Boolean).join(' ')}</span>
                      )}
                      {ride.driver_name && <span>👤 {ride.driver_name}</span>}
                      <span>🕐 {fmtDep(ride.departure)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => setSelectedRide(ride)}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500 hover:bg-amber-400 text-black transition-colors">
                      💬 Book
                    </button>
                    {appUser?.user_id === ride.user_id && (
                      <button onClick={(e) => handleCancelRide(ride.ride_id, e)}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:opacity-80"
                              style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
                        🗑️
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Right — tabs: full width on mobile, fixed sidebar on desktop */}
        <aside className="w-full md:w-80 md:flex-shrink-0 space-y-3">
          {/* Mobile-only tab bar (desktop uses header nav) */}
          <div className="flex rounded-xl overflow-hidden border sm:hidden"
               style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
            {[['rides', '🗺️ Rides'], ['requests', '🙋 Requests']].map(([id, label]) => (
              <button key={id} onClick={() => setRightTab(id)}
                      className={`flex-1 py-2 text-xs font-medium transition-colors ${rightTab === id ? 'bg-amber-500 text-black' : 'hover:opacity-80'}`}
                      style={rightTab !== id ? { color: 'var(--text-secondary)' } : {}}>
                {label}
              </button>
            ))}
          </div>

          {rightTab === 'rides' && (
            <div className="space-y-3">
              {appUser?.role === 'driver' ? (
                <div className="rounded-xl border p-4"
                     style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
                  <p className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Driver Tools</p>
                  <button onClick={() => setShowPostForm(true)}
                          className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-amber-500 hover:bg-amber-400 text-black transition-colors">
                    + Post a New Ride
                  </button>
                </div>
              ) : (
                <FareEstimator />
              )}
              <AIAssistant rides={filteredRides} onBookRide={setSelectedRide} />
            </div>
          )}

          {rightTab === 'requests' && (
            <div className="space-y-3">
              <RaiseRequest user={appUser} />
              <AIAssistant rides={filteredRides} onBookRide={setSelectedRide} />
            </div>
          )}
        </aside>
      </main>

      {/* Chat overlay */}
      {selectedRide && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center sm:p-6"
             style={{ background: 'rgba(0,0,0,0.75)' }}
             onClick={() => setSelectedRide(null)}>
          <div className="w-full sm:w-[90vw] sm:max-w-2xl h-[90vh] sm:h-[82vh] sm:rounded-2xl rounded-t-2xl overflow-hidden shadow-2xl"
               onClick={e => e.stopPropagation()}>
            <RideChat ride={selectedRide} user={appUser} onClose={() => setSelectedRide(null)} />
          </div>
        </div>
      )}

      {/* Post ride modal */}
      {showPostForm && (
        <PostRideModal onClose={() => setShowPostForm(false)} onPosted={loadRides} />
      )}

      {/* Auth modal */}
      {showAuthModal && (
        <UserAuth onClose={() => setShowAuthModal(false)}
                  onLogin={u => { setAppUser(u); setShowAuthModal(false) }} />
      )}
    </div>
  )
}
