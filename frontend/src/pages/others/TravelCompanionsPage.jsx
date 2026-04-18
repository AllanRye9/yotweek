/**
 * TravelCompanionsPage — Country-wide travel companion matching.
 *
 * Features:
 *  - Persistent filter bar (origin country, destination country, date)
 *  - Companion cards with avatar, name, home city, route, dates, bio, compatibility
 *  - View Profile and Message buttons
 *  - Message: checks for existing thread, creates new if needed
 *  - Post listing, delete own listing
 *  - Auto-refresh every 30 s
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
  aiChat,
} from '../api'

function compatibilityScore(companion, user) {
  if (!user) return 0
  let score = 0
  // Same destination country (+40)
  if (companion.destination_country && user.location_name) {
    if (companion.destination_country.toLowerCase().includes(user.location_name.toLowerCase()) ||
        user.location_name.toLowerCase().includes(companion.destination_country.toLowerCase())) score += 40
  }
  // Same origin city (+20)
  if (companion.origin_city && user.location_name) {
    if (companion.origin_city.toLowerCase().includes(user.location_name.toLowerCase()) ||
        user.location_name.toLowerCase().includes(companion.origin_city.toLowerCase())) score += 20
  }
  // Travel date within 7 days of today (+30)
  if (companion.travel_date) {
    try {
      const diff = Math.abs(new Date(companion.travel_date) - Date.now()) / (1000 * 60 * 60 * 24)
      if (diff <= 7) score += 30
    } catch {}
  }
  // Notes keyword overlap (+10) — simple shared-word check
  if (companion.notes && user.bio) {
    const cWords = new Set(companion.notes.toLowerCase().split(/\W+/).filter(w => w.length > 3))
    const uWords = user.bio.toLowerCase().split(/\W+/).filter(w => w.length > 3)
    if (uWords.some(w => cWords.has(w))) score += 10
  }
  return Math.min(score, 100)
}

function CompatBadge({ score }) {
  if (!score) return null
  const color = score >= 70 ? '#6ee7b7' : score >= 40 ? '#fcd34d' : '#a78bfa'
  const bg    = score >= 70 ? 'rgba(16,185,129,0.15)' : score >= 40 ? 'rgba(245,158,11,0.15)' : 'rgba(139,92,246,0.15)'
  const border= score >= 70 ? 'rgba(16,185,129,0.35)' : score >= 40 ? 'rgba(245,158,11,0.35)' : 'rgba(139,92,246,0.35)'
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: bg, color, border: `1px solid ${border}` }}>
      ✨ {score}% match
    </span>
  )
}

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
  const [aiStarter,    setAiStarter]    = useState({})   // { [companion_id]: { loading, text } }

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

  const handleAiStarter = async (companion) => {
    const id = companion.companion_id
    setAiStarter(p => ({ ...p, [id]: { loading: true, text: null } }))
    try {
      const prompt = `Suggest a friendly, concise opening message for someone wanting to travel with ${companion.poster_name} from ${companion.origin_country}${companion.origin_city ? ` (${companion.origin_city})` : ''} to ${companion.destination_country}${companion.destination_city ? ` (${companion.destination_city})` : ''} on ${companion.travel_date}${companion.notes ? `. They mention: "${companion.notes}"` : ''}. Keep it natural and under 2 sentences.`
      const d = await aiChat(prompt, 'travel_companions')
      setAiStarter(p => ({ ...p, [id]: { loading: false, text: d.reply } }))
    } catch {
      setAiStarter(p => ({ ...p, [id]: { loading: false, text: null } }))
    }
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
        <form onSubmit={handleSearch} className="flex flex-wrap gap-2 items-center p-3 rounded-xl sticky top-14 z-10 overflow-x-auto" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <input type="text" placeholder="From country…" value={fOrigin} onChange={e => setFOrigin(e.target.value)} className="text-xs rounded-lg px-2 py-1.5 outline-none min-w-[120px]" style={inputSty} />
          <input type="text" placeholder="To country…"   value={fDest}   onChange={e => setFDest(e.target.value)}   className="text-xs rounded-lg px-2 py-1.5 outline-none min-w-[120px]" style={inputSty} />
          <input type="date" value={fDate} onChange={e => setFDate(e.target.value)} className="text-xs rounded-lg px-2 py-1.5 outline-none" style={inputSty} />
          <button type="submit" disabled={loading} className="text-xs px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold disabled:opacity-50 shrink-0">
            🔍 Search
          </button>
          {(fOrigin || fDest || fDate) && (
            <button type="button" onClick={() => { setFOrigin(''); setFDest(''); setFDate(''); setTimeout(loadCompanions, 0) }} className="text-xs text-amber-400 hover:text-amber-300 shrink-0">
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
            {companions.map(c => {
              const compat = compatibilityScore(c, user)
              const starter = aiStarter[c.companion_id]
              return (
                <div key={c.companion_id} className="rounded-xl p-4 fade-in-up transition-all duration-200" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                  <div className="flex items-start gap-3">
                    {/* Avatar */}
                    <div className="w-10 h-10 rounded-full bg-purple-700 flex items-center justify-center text-sm font-bold text-white shrink-0">
                      {(c.poster_name || '?').charAt(0).toUpperCase()}
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* Name + compat badge */}
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{c.poster_name}</span>
                        <CompatBadge score={compat} />
                      </div>

                      {/* Route */}
                      <div className="flex items-center gap-1.5 text-sm flex-wrap">
                        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                          🌍 {c.origin_country}{c.origin_city ? ` (${c.origin_city})` : ''}
                        </span>
                        <span style={{ color: 'var(--text-muted)' }}>→</span>
                        <span className="font-medium text-amber-400">
                          {c.destination_country}{c.destination_city ? ` (${c.destination_city})` : ''}
                        </span>
                      </div>

                      {/* Date + notes */}
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
                          📅 {c.travel_date}
                        </span>
                        {c.notes && <p className="text-xs italic" style={{ color: 'var(--text-muted)' }}>"{c.notes}"</p>}
                      </div>

                      {/* AI conversation starter */}
                      {user && user.user_id !== c.user_id && (
                        <div className="mt-2">
                          {!starter?.text && (
                            <button
                              onClick={() => handleAiStarter(c)}
                              disabled={starter?.loading}
                              className="text-xs px-2 py-1 rounded-lg font-medium transition-colors hover:opacity-80 disabled:opacity-50"
                              style={{ background: 'rgba(139,92,246,0.12)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.3)' }}
                            >
                              {starter?.loading ? '✨ Generating…' : '✨ AI Starter'}
                            </button>
                          )}
                          {starter?.text && (
                            <div className="mt-1 rounded-lg px-3 py-2 text-xs italic" style={{ background: 'rgba(139,92,246,0.1)', color: '#c4b5fd', border: '1px solid rgba(139,92,246,0.25)' }}>
                              💡 "{starter.text}"
                              <button onClick={() => setAiStarter(p => ({ ...p, [c.companion_id]: { ...p[c.companion_id], text: null } }))} className="ml-2 text-purple-400 hover:text-purple-200 text-xs">✕</button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Action buttons — stacked on mobile */}
                    <div className="flex flex-col gap-1.5 shrink-0">
                      {user && user.user_id !== c.user_id && (
                        <>
                          <button
                            onClick={() => navigate(`/profile?uid=${c.user_id}`)}
                            className="text-xs px-3 py-1 rounded-lg font-semibold transition-all duration-200 hover:opacity-80"
                            style={{ border: '1px solid var(--border-color)', color: 'var(--text-secondary)', background: 'var(--bg-surface)' }}
                          >
                            👤 Profile
                          </button>
                          <button
                            onClick={() => handleMessage(c.user_id)}
                            disabled={dmLoading[c.user_id]}
                            className="text-xs px-3 py-1 rounded-lg font-semibold disabled:opacity-50 transition-all duration-200 bg-amber-500 hover:bg-amber-400 text-black"
                          >
                            {dmLoading[c.user_id] ? '…' : '💬 Message'}
                          </button>
                        </>
                      )}
                      {user && user.user_id === c.user_id && (
                        <button
                          onClick={() => handleDelete(c.companion_id)}
                          className="text-xs px-3 py-1 rounded-lg text-red-400 hover:text-red-300 transition-all duration-200"
                          style={{ border: '1px solid rgba(248,113,113,0.4)' }}
                        >
                          🗑 Remove
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
