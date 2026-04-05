/**
 * RequestsPage — Ride requests with persistent filter bar and live-updating cards.
 */
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getUserProfile, getRideRequests, createRideRequest, cancelRideRequest } from '../api'
import NavBar from '../components/NavBar'

const STATUS_OPTIONS = ['all', 'open', 'accepted', 'closed']

const statusStyle = {
  open:     { bg: 'rgba(16,185,129,0.15)', color: '#6ee7b7' },
  accepted: { bg: 'rgba(59,130,246,0.15)', color: '#93c5fd' },
  closed:   { bg: 'rgba(107,114,128,0.2)', color: '#9ca3af' },
}

export default function RequestsPage() {
  const navigate = useNavigate()
  const [user,      setUser]      = useState(null)
  const [requests,  setRequests]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [creating,  setCreating]  = useState(false)
  const [showForm,  setShowForm]  = useState(false)
  const [error,     setError]     = useState('')

  // Filters
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterOrigin, setFilterOrigin] = useState('')
  const [filterDest,   setFilterDest]   = useState('')

  // Form
  const [form, setForm] = useState({ origin: '', destination: '', desired_date: '', passengers: 1, price_max: '' })

  const loadRequests = useCallback(async () => {
    try {
      const data = await getRideRequests()
      setRequests(data.requests || [])
    } catch {}
  }, [])

  useEffect(() => {
    getUserProfile()
      .then(u => { setUser(u); return loadRequests() })
      .catch(() => navigate('/login', { replace: true }))
      .finally(() => setLoading(false))
  }, [navigate, loadRequests])

  // Live refresh every 20 s
  useEffect(() => {
    const id = setInterval(loadRequests, 20_000)
    return () => clearInterval(id)
  }, [loadRequests])

  const handleCreate = async (e) => {
    e.preventDefault()
    setError('')
    setCreating(true)
    try {
      await createRideRequest(
        form.origin.trim(),
        form.destination.trim(),
        form.desired_date,
        parseInt(form.passengers, 10) || 1,
        null,
        form.price_max ? parseFloat(form.price_max) : null,
      )
      setForm({ origin: '', destination: '', desired_date: '', passengers: 1, price_max: '' })
      setShowForm(false)
      await loadRequests()
    } catch (err) {
      setError(err.message || 'Failed to create request.')
    } finally {
      setCreating(false)
    }
  }

  const handleCancel = async (requestId) => {
    try { await cancelRideRequest(requestId); await loadRequests() }
    catch (err) { setError(err.message || 'Failed to cancel.') }
  }

  const filtered = requests.filter(r => {
    if (filterStatus !== 'all' && r.status !== filterStatus) return false
    if (filterOrigin && !r.origin?.toLowerCase().includes(filterOrigin.toLowerCase())) return false
    if (filterDest   && !r.destination?.toLowerCase().includes(filterDest.toLowerCase())) return false
    return true
  })

  const input = 'w-full rounded-lg px-3 py-2 text-sm outline-none'
  const inputSty = { background: 'var(--bg-input, var(--bg-surface))', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-page)' }}>
      <div className="spinner w-10 h-10" />
    </div>
  )

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-page)', color: 'var(--text-primary)' }}>
      <NavBar user={user || false} title="Ride Requests" />

      <main className="flex-1 max-w-3xl mx-auto w-full p-4 space-y-4">

        {/* Action bar */}
        <div className="flex items-center justify-between">
          <h1 className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>Ride Requests</h1>
          <button
            onClick={() => setShowForm(f => !f)}
            className="text-xs bg-amber-500 hover:bg-amber-400 text-black px-3 py-1.5 rounded-lg font-semibold transition-colors"
          >
            {showForm ? '✕ Close' : '+ New Request'}
          </button>
        </div>

        {/* ── Create form ── */}
        {showForm && (
          <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <h2 className="font-semibold text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>New Ride Request</h2>
            <form onSubmit={handleCreate} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input type="text" placeholder="From (origin)" value={form.origin} onChange={e => setForm(f => ({ ...f, origin: e.target.value }))} required className={input} style={inputSty} />
                <input type="text" placeholder="To (destination)" value={form.destination} onChange={e => setForm(f => ({ ...f, destination: e.target.value }))} required className={input} style={inputSty} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input type="date" value={form.desired_date} onChange={e => setForm(f => ({ ...f, desired_date: e.target.value }))} required className={input} style={inputSty} />
                <input type="number" placeholder="Passengers" min="1" value={form.passengers} onChange={e => setForm(f => ({ ...f, passengers: e.target.value }))} className={input} style={inputSty} />
                <input type="number" placeholder="Max price" min="0" step="0.01" value={form.price_max} onChange={e => setForm(f => ({ ...f, price_max: e.target.value }))} className={input} style={inputSty} />
              </div>
              {error && <p className="text-red-400 text-xs">{error}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={creating} className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black text-xs rounded-lg font-semibold disabled:opacity-50">
                  {creating ? '…' : 'Post Request'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-xs rounded-lg font-medium hover:opacity-80" style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── Persistent Filter Bar ── */}
        <div className="flex flex-wrap gap-2 items-center p-3 rounded-xl sticky top-14 z-10" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          {STATUS_OPTIONS.map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`text-xs px-3 py-1 rounded-full font-semibold transition-colors ${filterStatus === s ? 'bg-amber-500 text-black' : 'hover:opacity-80'}`}
              style={filterStatus !== s ? { color: 'var(--text-secondary)', border: '1px solid var(--border-color)' } : {}}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
          <div className="flex gap-2 ml-auto">
            <input type="text" placeholder="Filter origin…" value={filterOrigin} onChange={e => setFilterOrigin(e.target.value)} className="text-xs rounded-lg px-2 py-1 outline-none w-28" style={{ background: 'var(--bg-input, var(--bg-surface))', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
            <input type="text" placeholder="Filter dest…"   value={filterDest}   onChange={e => setFilterDest(e.target.value)}   className="text-xs rounded-lg px-2 py-1 outline-none w-28" style={{ background: 'var(--bg-input, var(--bg-surface))', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
            {(filterOrigin || filterDest) && (
              <button onClick={() => { setFilterOrigin(''); setFilterDest('') }} className="text-xs text-amber-400 hover:text-amber-300">✕</button>
            )}
          </div>
        </div>

        {/* ── Request List ── */}
        {filtered.length === 0 ? (
          <div className="rounded-xl p-8 text-center text-sm" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
            {requests.length === 0 ? 'No ride requests yet.' : 'No requests match your filters.'}
            {requests.length === 0 && (
              <button onClick={() => setShowForm(true)} className="block mx-auto mt-3 text-xs text-amber-500 hover:text-amber-400">
                Post your first request →
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(req => {
              const sid    = req.request_id || req.id
              const style  = statusStyle[req.status] || statusStyle.closed
              return (
                <div key={sid} className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {req.origin} → {req.destination}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        📅 {req.desired_date} · 👥 {req.passengers} passenger(s)
                        {req.price_max && ` · 💰 max ${req.price_max}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: style.bg, color: style.color }}>
                        {req.status}
                      </span>
                      {req.status === 'open' && (
                        <button onClick={() => handleCancel(sid)} className="text-xs text-red-400 hover:text-red-300 transition-colors">
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
