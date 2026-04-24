import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getGroupTrips, createGroupTrip, joinGroupTrip, leaveGroupTrip,
  getTripIdeas, addTripIdea, voteTripIdea,
  getTripChecklist, addChecklistItem, toggleChecklistItem,
  getUserProfile,
} from '../api'
import NavBar from '../components/NavBar'

// ─── Create Trip Form ─────────────────────────────────────────────────────────
function CreateTripForm({ onCreated, onCancel }) {
  const [fields, setFields] = useState({ title: '', description: '', destination: '', start_date: '', end_date: '', max_members: '' })
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const setF = (k, v) => setFields(prev => ({ ...prev, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const data = {
        title:       fields.title.trim(),
        description: fields.description.trim() || undefined,
        destination: fields.destination.trim() || undefined,
        start_date:  fields.start_date || undefined,
        end_date:    fields.end_date   || undefined,
        max_members: fields.max_members ? parseInt(fields.max_members, 10) : undefined,
      }
      const trip = await createGroupTrip(data)
      onCreated?.(trip)
    } catch (err) {
      setError(err.message || 'Failed to create trip.')
    } finally {
      setLoading(false)
    }
  }

  const fs = { width: '100%', background: 'var(--bg-input, var(--bg-surface))', border: '1px solid var(--border-color)', borderRadius: 8, padding: '9px 12px', color: 'var(--text-primary)', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 16, padding: '20px 24px', marginBottom: 16 }}>
      <h2 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.06em' }}>🗺️ New Group Trip</h2>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input type="text" placeholder="Trip title *" value={fields.title} onChange={e => setF('title', e.target.value)} required maxLength={120} style={fs} />
        <input type="text" placeholder="Destination" value={fields.destination} onChange={e => setF('destination', e.target.value)} maxLength={120} style={fs} />
        <textarea placeholder="Description (optional)" value={fields.description} onChange={e => setF('description', e.target.value)} rows={2} maxLength={500} style={{ ...fs, resize: 'vertical', minHeight: 60 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Start Date</label>
            <input type="date" value={fields.start_date} onChange={e => setF('start_date', e.target.value)} style={fs} />
          </div>
          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>End Date</label>
            <input type="date" value={fields.end_date} onChange={e => setF('end_date', e.target.value)} style={fs} />
          </div>
        </div>
        <input type="number" placeholder="Max members (optional)" value={fields.max_members} onChange={e => setF('max_members', e.target.value)} min={2} max={100} style={fs} />
        {error && <p style={{ fontSize: '0.8rem', color: '#f87171' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel} style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.88rem', cursor: 'pointer' }}>
            Cancel
          </button>
          <button type="submit" disabled={loading || !fields.title.trim()} style={{ padding: '8px 22px', borderRadius: 8, border: 'none', background: fields.title.trim() ? 'var(--accent, #f59e0b)' : 'var(--border-color)', color: fields.title.trim() ? 'var(--accent-text, #000)' : 'var(--text-muted)', fontSize: '0.88rem', fontWeight: 600, cursor: fields.title.trim() ? 'pointer' : 'default' }}>
            {loading ? 'Creating…' : 'Create Trip'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Ideas Panel ──────────────────────────────────────────────────────────────
function IdeasPanel({ tripId }) {
  const [ideas,   setIdeas]   = useState([])
  const [text,    setText]    = useState('')
  const [loading, setLoading] = useState(true)
  const [adding,  setAdding]  = useState(false)

  useEffect(() => {
    getTripIdeas(tripId).then(d => setIdeas(d.ideas || d || [])).catch(() => setIdeas([])).finally(() => setLoading(false))
  }, [tripId])

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!text.trim()) return
    setAdding(true)
    try {
      const idea = await addTripIdea(tripId, { title: text.trim() })
      setIdeas(prev => [...prev, idea])
      setText('')
    } catch {} finally { setAdding(false) }
  }

  const handleVote = async (ideaId, val) => {
    try {
      const updated = await voteTripIdea(tripId, ideaId, { vote: val })
      setIdeas(prev => prev.map(i => i.idea_id === ideaId ? { ...i, ...(updated.idea || updated) } : i))
    } catch {}
  }

  const fs = { flex: 1, background: 'var(--bg-input, var(--bg-surface))', border: '1px solid var(--border-color)', borderRadius: 8, padding: '7px 10px', color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none' }

  return (
    <div style={{ marginTop: 14 }}>
      <h4 style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>💡 Ideas</h4>
      {loading && <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Loading…</p>}
      {!loading && ideas.length === 0 && <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>No ideas yet. Add one!</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
        {ideas.map(idea => (
          <div key={idea.idea_id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-surface)', borderRadius: 8, padding: '8px 12px', border: '1px solid var(--border-color)' }}>
            <span style={{ flex: 1, fontSize: '0.85rem', color: 'var(--text-primary)' }}>{idea.title}</span>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <button onClick={() => handleVote(idea.idea_id, 1)} style={{ padding: '2px 8px', borderRadius: 6, border: '1px solid rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.1)', color: '#34d399', cursor: 'pointer', fontSize: '0.8rem' }}>▲ {idea.votes_up || 0}</button>
              <button onClick={() => handleVote(idea.idea_id, -1)} style={{ padding: '2px 8px', borderRadius: 6, border: '1px solid rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.1)', color: '#f87171', cursor: 'pointer', fontSize: '0.8rem' }}>▼ {idea.votes_down || 0}</button>
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8 }}>
        <input type="text" placeholder="Add an idea…" value={text} onChange={e => setText(e.target.value)} maxLength={200} style={fs} />
        <button type="submit" disabled={adding || !text.trim()} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--accent, #f59e0b)', color: 'var(--accent-text, #000)', fontWeight: 600, fontSize: '0.82rem', cursor: text.trim() ? 'pointer' : 'default', opacity: text.trim() ? 1 : 0.5 }}>
          {adding ? '…' : 'Add'}
        </button>
      </form>
    </div>
  )
}

// ─── Checklist Panel ──────────────────────────────────────────────────────────
function ChecklistPanel({ tripId }) {
  const [items,   setItems]   = useState([])
  const [text,    setText]    = useState('')
  const [loading, setLoading] = useState(true)
  const [adding,  setAdding]  = useState(false)

  useEffect(() => {
    getTripChecklist(tripId).then(d => setItems(d.checklist || d || [])).catch(() => setItems([])).finally(() => setLoading(false))
  }, [tripId])

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!text.trim()) return
    setAdding(true)
    try {
      const item = await addChecklistItem(tripId, { text: text.trim() })
      setItems(prev => [...prev, item])
      setText('')
    } catch {} finally { setAdding(false) }
  }

  const handleToggle = async (itemId) => {
    try {
      const updated = await toggleChecklistItem(tripId, itemId)
      setItems(prev => prev.map(i => i.item_id === itemId ? { ...i, ...(updated.item || updated) } : i))
    } catch {}
  }

  const fs = { flex: 1, background: 'var(--bg-input, var(--bg-surface))', border: '1px solid var(--border-color)', borderRadius: 8, padding: '7px 10px', color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none' }

  return (
    <div style={{ marginTop: 14 }}>
      <h4 style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>✅ Checklist</h4>
      {loading && <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Loading…</p>}
      {!loading && items.length === 0 && <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>No items yet.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 10 }}>
        {items.map(item => (
          <label key={item.item_id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', background: 'var(--bg-surface)', borderRadius: 8, padding: '7px 12px', border: '1px solid var(--border-color)' }}>
            <input type="checkbox" checked={!!item.done} onChange={() => handleToggle(item.item_id)} style={{ accentColor: 'var(--accent, #f59e0b)', width: 15, height: 15 }} />
            <span style={{ fontSize: '0.85rem', color: item.done ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: item.done ? 'line-through' : 'none' }}>{item.text}</span>
          </label>
        ))}
      </div>
      <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8 }}>
        <input type="text" placeholder="Add item…" value={text} onChange={e => setText(e.target.value)} maxLength={200} style={fs} />
        <button type="submit" disabled={adding || !text.trim()} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--accent, #f59e0b)', color: 'var(--accent-text, #000)', fontWeight: 600, fontSize: '0.82rem', cursor: text.trim() ? 'pointer' : 'default', opacity: text.trim() ? 1 : 0.5 }}>
          {adding ? '…' : 'Add'}
        </button>
      </form>
    </div>
  )
}

// ─── Trip Card ────────────────────────────────────────────────────────────────
function TripCard({ trip, currentUserId, onJoin, onLeave, onDeleted }) {
  const [expanded, setExpanded] = useState(false)
  const [busy,     setBusy]     = useState(false)

  const isMember = (trip.members || []).some(m => (m.user_id || m) === currentUserId)

  const fmtDate = (s) => { try { return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) } catch { return s } }

  const handleJoinLeave = async () => {
    setBusy(true)
    try {
      if (isMember) { await onLeave(trip.trip_id) }
      else          { await onJoin(trip.trip_id)  }
    } catch {} finally { setBusy(false) }
  }

  return (
    <article style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 16, padding: '16px 20px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{trip.title}</h3>
            {trip.destination && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3 }}>📍 {trip.destination}</span>
            )}
          </div>
          {trip.description && (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '4px 0 8px', lineHeight: 1.45 }}>{trip.description}</p>
          )}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {trip.start_date && <span>📅 {fmtDate(trip.start_date)}{trip.end_date ? ` → ${fmtDate(trip.end_date)}` : ''}</span>}
            <span>👥 {(trip.members || []).length}{trip.max_members ? `/${trip.max_members}` : ''} members</span>
            <span style={{ fontSize: '0.7rem', padding: '1px 8px', borderRadius: 9999, background: trip.status === 'open' ? 'rgba(16,185,129,0.15)' : 'rgba(107,114,128,0.15)', color: trip.status === 'open' ? '#34d399' : 'var(--text-muted)', border: `1px solid ${trip.status === 'open' ? 'rgba(16,185,129,0.3)' : 'var(--border-color)'}` }}>{trip.status || 'open'}</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
          <button
            onClick={handleJoinLeave}
            disabled={busy}
            style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${isMember ? 'rgba(248,113,113,0.4)' : 'rgba(16,185,129,0.4)'}`, background: isMember ? 'rgba(248,113,113,0.1)' : 'rgba(16,185,129,0.1)', color: isMember ? '#f87171' : '#34d399', fontSize: '0.82rem', fontWeight: 600, cursor: busy ? 'default' : 'pointer' }}
          >
            {isMember ? 'Leave' : 'Join'}
          </button>
          <button
            onClick={() => setExpanded(v => !v)}
            style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.82rem', cursor: 'pointer' }}
          >
            {expanded ? '▲ Less' : '▼ More'}
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--border-color)', marginTop: 14, paddingTop: 14 }}>
          {/* Members */}
          <div style={{ marginBottom: 14 }}>
            <h4 style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>👥 Members</h4>
            {(trip.members || []).length === 0 ? (
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>No members yet.</p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {(trip.members || []).map((m, i) => (
                  <span key={i} style={{ fontSize: '0.8rem', padding: '3px 10px', borderRadius: 9999, background: 'var(--bg-surface)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                    {m.name || m.user_id?.slice(0, 8) || m}
                  </span>
                ))}
              </div>
            )}
          </div>

          <IdeasPanel tripId={trip.trip_id} />
          <ChecklistPanel tripId={trip.trip_id} />
        </div>
      )}
    </article>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function GroupTripsPage() {
  const navigate = useNavigate()
  const [user,       setUser]       = useState(null)
  const [trips,      setTrips]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState('')
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    getUserProfile().then(setUser).catch(() => {})
  }, [])

  const loadTrips = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await getGroupTrips()
      setTrips(data.trips || data || [])
    } catch (err) {
      setError(err.message || 'Failed to load trips.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadTrips() }, [loadTrips])

  const handleCreated = (trip) => {
    setTrips(prev => [trip, ...prev])
    setShowCreate(false)
  }

  const handleJoin = async (tripId) => {
    await joinGroupTrip(tripId)
    loadTrips()
  }

  const handleLeave = async (tripId) => {
    await leaveGroupTrip(tripId)
    loadTrips()
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-page)', display: 'flex', flexDirection: 'column' }}>
      <NavBar user={user} onLogout={() => navigate('/')} title="Group Trips" />
      <main style={{ flex: 1, maxWidth: 860, width: '100%', margin: '0 auto', padding: '16px 16px 40px', boxSizing: 'border-box' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h1 style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>🗺️ Group Trips</h1>
          {!showCreate && (
            <button
              onClick={() => setShowCreate(true)}
              style={{ padding: '8px 18px', borderRadius: 10, border: 'none', background: 'var(--accent, #f59e0b)', color: 'var(--accent-text, #000)', fontWeight: 600, fontSize: '0.88rem', cursor: 'pointer' }}
            >
              + New Trip
            </button>
          )}
        </div>

        {showCreate && (
          <CreateTripForm onCreated={handleCreated} onCancel={() => setShowCreate(false)} />
        )}

        {loading && <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>Loading…</div>}
        {!loading && error && (
          <div style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 12, padding: '12px 16px', color: '#f87171', fontSize: '0.85rem', marginBottom: 12 }}>{error}</div>
        )}
        {!loading && !error && trips.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
            <p style={{ fontSize: '2.5rem', marginBottom: 12 }}>✈️</p>
            <p style={{ fontSize: '1rem', marginBottom: 6 }}>No group trips yet.</p>
            <p style={{ fontSize: '0.85rem' }}>Create one and invite fellow travellers!</p>
          </div>
        )}

        {trips.map(trip => (
          <TripCard
            key={trip.trip_id}
            trip={trip}
            currentUserId={user?.user_id}
            onJoin={handleJoin}
            onLeave={handleLeave}
          />
        ))}
      </main>
    </div>
  )
}
