/**
 * TravelCompanionsPage — Dedicated page for country-wide travel companion matching.
 *
 * Features:
 *  - Persistent filter bar (origin country, destination country, date)
 *  - Live-updating card list (auto-refresh every 30 s)
 *  - Post listing action, delete own, message via DM
 *  - Clear action hierarchy: Post → Filter → Browse → Message/Remove
 */
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import NavBar from '../components/NavBar'
import UserAuth from '../components/UserAuth'
import {
  getUserProfile,
  listTravelCompanions,
  createTravelCompanion,
  deleteTravelCompanion,
  dmStartConversation,
} from '../api'

export default function TravelCompanionsPage() {
  const navigate = useNavigate()
  const [user,         setUser]         = useState(null)
  const [showAuth,     setShowAuth]     = useState(false)
  const [companions,   setCompanions]   = useState([])
  const [loading,      setLoading]      = useState(true)
  const [searchError,  setSearchError]  = useState('')
  const [showForm,     setShowForm]     = useState(false)
  const [posting,      setPosting]      = useState(false)
  const [postError,    setPostError]    = useState('')
  const [dmLoading,    setDmLoading]    = useState({})

  // Filter state
  const [fOrigin, setFOrigin] = useState('')
  const [fDest,   setFDest]   = useState('')
  const [fDate,   setFDate]   = useState('')

  // Post form state
  const [form, setForm] = useState({ origin: '', dest: '', originCity: '', destCity: '', date: '', notes: '' })
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const loadCompanions = useCallback(async () => {
    setSearchError('')
    try {
      const data = await listTravelCompanions(fOrigin.trim() || null, fDest.trim() || null, fDate || null)
      setCompanions(data.companions || [])
    } catch (err) {
      setSearchError(err.message || 'Failed to load companions.')
    }
  }, [fOrigin, fDest, fDate])

  useEffect(() => {
    getUserProfile().then(u => setUser(u)).catch(() => setUser(false))
    loadCompanions().finally(() => setLoading(false))
  }, []) // eslint-disable-line

  // Auto-refresh every 30 s
  useEffect(() => {
    const id = setInterval(loadCompanions, 30_000)
    return () => clearInterval(id)
  }, [loadCompanions])

  const handleSearch = (e) => { e.preventDefault(); loadCompanions() }

  const handlePost = async (e) => {
    e.preventDefault()
    if (!user) { setShowAuth(true); return }
    setPosting(true); setPostError('')
    try {
      await createTravelCompanion(form.origin.trim(), form.dest.trim(), form.date, form.originCity.trim(), form.destCity.trim(), form.notes.trim())
      setForm({ origin: '', dest: '', originCity: '', destCity: '', date: '', notes: '' })
      setShowForm(false)
      await loadCompanions()
    } catch (err) {
      setPostError(err.message || 'Failed to post listing.')
    } finally { setPosting(false) }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this listing?')) return
    try { await deleteTravelCompanion(id); setCompanions(p => p.filter(c => c.companion_id !== id)) }
    catch (err) { alert(err.message || 'Failed to remove.') }
  }

  const handleMessage = async (toUserId) => {
    if (!user) { setShowAuth(true); return }
    setDmLoading(p => ({ ...p, [toUserId]: true }))
    try {
      await dmStartConversation(toUserId)
      navigate('/inbox')
    } catch (err) { alert(err.message || 'Failed to start conversation.') }
    finally { setDmLoading(p => ({ ...p, [toUserId]: false })) }
  }

  const inputCls = 'rounded-lg px-3 py-2 text-sm outline-none w-full'
  const inputSty = { background: 'var(--bg-input, var(--bg-surface))', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-page)', color: 'var(--text-primary)' }}>
      {showAuth && !user && (
        <UserAuth onSuccess={u => { setUser(u); setShowAuth(false) }} onClose={() => setShowAuth(false)} />
      )}
      <NavBar user={user} onLogin={() => setShowAuth(true)} title="Travel Companions" />

      <main className="flex-1 max-w-3xl mx-auto w-full p-4 space-y-4">

        {/* Header + action */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-bold text-base">🌍 Travel Companions</h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Find someone traveling the same route.</p>
          </div>
          <button
            onClick={() => { if (!user) { setShowAuth(true); return } setShowForm(v => !v) }}
            className="text-xs bg-amber-500 hover:bg-amber-400 text-black px-3 py-1.5 rounded-lg font-semibold transition-colors"
          >
            {showForm ? '✕ Close' : '+ Post Listing'}
          </button>
        </div>

        {/* ── Post Form ── */}
        {showForm && (
          <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <h2 className="font-semibold text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>Post Your Travel Companion Listing</h2>
            <form onSubmit={handlePost} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>From Country *</label>
                  <input type="text" placeholder="e.g. United Kingdom" value={form.origin} onChange={e => setF('origin', e.target.value)} required className={inputCls} style={inputSty} />
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>To Country *</label>
                  <input type="text" placeholder="e.g. France" value={form.dest} onChange={e => setF('dest', e.target.value)} required className={inputCls} style={inputSty} />
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>From City</label>
                  <input type="text" placeholder="e.g. London" value={form.originCity} onChange={e => setF('originCity', e.target.value)} className={inputCls} style={inputSty} />
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>To City</label>
                  <input type="text" placeholder="e.g. Paris" value={form.destCity} onChange={e => setF('destCity', e.target.value)} className={inputCls} style={inputSty} />
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>Travel Date *</label>
                  <input type="date" value={form.date} onChange={e => setF('date', e.target.value)} required className={inputCls} style={inputSty} />
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>Notes</label>
                  <input type="text" placeholder="e.g. Looking for company" value={form.notes} onChange={e => setF('notes', e.target.value)} className={inputCls} style={inputSty} />
                </div>
              </div>
              {postError && <p className="text-red-400 text-xs">{postError}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={posting} className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black text-xs rounded-lg font-semibold disabled:opacity-50">
                  {posting ? '…' : '🌍 Post Listing'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-xs rounded-lg hover:opacity-80" style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── Persistent Filter Bar ── */}
        <form onSubmit={handleSearch} className="flex flex-wrap gap-2 items-center p-3 rounded-xl sticky top-14 z-10" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <input type="text" placeholder="From country…" value={fOrigin} onChange={e => setFOrigin(e.target.value)} className="text-xs rounded-lg px-2 py-1.5 outline-none w-32" style={inputSty} />
          <input type="text" placeholder="To country…"   value={fDest}   onChange={e => setFDest(e.target.value)}   className="text-xs rounded-lg px-2 py-1.5 outline-none w-32" style={inputSty} />
          <input type="date" value={fDate} onChange={e => setFDate(e.target.value)} className="text-xs rounded-lg px-2 py-1.5 outline-none" style={inputSty} />
          <button type="submit" disabled={loading} className="text-xs px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold disabled:opacity-50">
            🔍 Search
          </button>
          {(fOrigin || fDest || fDate) && (
            <button type="button" onClick={() => { setFOrigin(''); setFDest(''); setFDate(''); setTimeout(loadCompanions, 0) }} className="text-xs text-amber-400 hover:text-amber-300">
              ✕ Clear
            </button>
          )}
        </form>

        {/* ── Companion List ── */}
        {loading ? (
          <div className="flex justify-center py-8"><div className="spinner w-8 h-8" /></div>
        ) : searchError ? (
          <p className="text-red-400 text-xs">{searchError}</p>
        ) : companions.length === 0 ? (
          <div className="rounded-xl p-8 text-center text-sm" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
            <p className="text-3xl mb-2">🌍</p>
            No companion listings found.
            {user && (
              <button onClick={() => setShowForm(true)} className="block mx-auto mt-3 text-xs text-amber-500 hover:text-amber-400">
                Be the first to post →
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {companions.map(c => (
              <div key={c.companion_id} className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                        🌍 {c.origin_country}{c.origin_city ? ` (${c.origin_city})` : ''}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>→</span>
                      <span className="font-semibold text-sm text-amber-400">
                        {c.destination_country}{c.destination_city ? ` (${c.destination_city})` : ''}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
                        📅 {c.travel_date}
                      </span>
                    </div>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>👤 {c.poster_name}</p>
                    {c.notes && <p className="text-xs italic mt-0.5" style={{ color: 'var(--text-muted)' }}>"{c.notes}"</p>}
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {user && user.user_id !== c.user_id && (
                      <button
                        onClick={() => handleMessage(c.user_id)}
                        disabled={dmLoading[c.user_id]}
                        className="text-xs px-3 py-1 rounded-lg font-semibold disabled:opacity-50 transition-colors bg-amber-500 hover:bg-amber-400 text-black"
                      >
                        {dmLoading[c.user_id] ? '…' : '💬 Message'}
                      </button>
                    )}
                    {user && user.user_id === c.user_id && (
                      <button
                        onClick={() => handleDelete(c.companion_id)}
                        className="text-xs px-3 py-1 rounded-lg text-red-400 hover:text-red-300 transition-colors"
                        style={{ border: '1px solid rgba(248,113,113,0.4)' }}
                      >
                        🗑 Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
