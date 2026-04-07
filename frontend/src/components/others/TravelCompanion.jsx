import { useState, useEffect, useCallback } from 'react'
import { createTravelCompanion, listTravelCompanions, deleteTravelCompanion, dmStartConversation } from '../api'

/**
 * TravelCompanion — Country-wide travel companion matching feature.
 *
 * Users can:
 *  - Search for companions traveling from country A to country B on a given date
 *  - Post their own travel companion listing
 *  - Message a companion via the DM system
 *  - Remove their own listing
 */
export default function TravelCompanion({ user, onOpenDM }) {
  // Search state
  const [searchOrigin,  setSearchOrigin]  = useState('')
  const [searchDest,    setSearchDest]    = useState('')
  const [searchDate,    setSearchDate]    = useState('')
  const [companions,    setCompanions]    = useState([])
  const [loading,       setLoading]       = useState(false)
  const [searchError,   setSearchError]   = useState('')

  // Post form state
  const [showForm,      setShowForm]      = useState(false)
  const [formOrigin,    setFormOrigin]    = useState('')
  const [formDest,      setFormDest]      = useState('')
  const [formOriginCity,  setFormOriginCity]  = useState('')
  const [formDestCity,    setFormDestCity]    = useState('')
  const [formDate,      setFormDate]      = useState('')
  const [formNotes,     setFormNotes]     = useState('')
  const [posting,       setPosting]       = useState(false)
  const [postError,     setPostError]     = useState('')
  const [postOk,        setPostOk]        = useState('')

  // DM state
  const [dmLoading,     setDmLoading]     = useState({})

  const loadCompanions = useCallback(async () => {
    setLoading(true)
    setSearchError('')
    try {
      const data = await listTravelCompanions(
        searchOrigin.trim() || null,
        searchDest.trim() || null,
        searchDate || null,
      )
      setCompanions(data.companions || [])
    } catch (err) {
      setSearchError(err.message || 'Failed to load companions.')
    } finally {
      setLoading(false)
    }
  }, [searchOrigin, searchDest, searchDate])

  useEffect(() => { loadCompanions() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = (e) => {
    e.preventDefault()
    loadCompanions()
  }

  const handlePost = async (e) => {
    e.preventDefault()
    setPostError('')
    setPostOk('')
    if (!user) { setPostError('Please login to post a companion listing.'); return }
    setPosting(true)
    try {
      await createTravelCompanion(
        formOrigin.trim(), formDest.trim(), formDate,
        formOriginCity.trim(), formDestCity.trim(), formNotes.trim()
      )
      setPostOk('✅ Companion listing posted!')
      setFormOrigin(''); setFormDest(''); setFormDate('')
      setFormOriginCity(''); setFormDestCity(''); setFormNotes('')
      setShowForm(false)
      await loadCompanions()
    } catch (err) {
      setPostError(err.message || 'Failed to post listing.')
    } finally {
      setPosting(false)
    }
  }

  const handleDelete = async (companionId) => {
    if (!window.confirm('Remove this companion listing?')) return
    try {
      await deleteTravelCompanion(companionId)
      setCompanions(prev => prev.filter(c => c.companion_id !== companionId))
    } catch (err) {
      alert(err.message || 'Failed to remove listing.')
    }
  }

  const handleMessageCompanion = async (companionUserId) => {
    if (!user) { alert('Please login to message.'); return }
    if (companionUserId === user.user_id) { alert("That's you!"); return }
    setDmLoading(prev => ({ ...prev, [companionUserId]: true }))
    try {
      const data = await dmStartConversation(companionUserId)
      onOpenDM?.(data.conv_id)
    } catch (err) {
      alert(err.message || 'Failed to start conversation.')
    } finally {
      setDmLoading(prev => ({ ...prev, [companionUserId]: false }))
    }
  }

  const inputCls = 'rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-xs px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500 w-full'

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-200 flex items-center gap-2">
            🌍 Travel Companions
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">Find someone traveling country-wide on the same route.</p>
        </div>
        {user && (
          <button
            onClick={() => { setShowForm(v => !v); setPostError(''); setPostOk('') }}
            className={`text-xs px-3 py-1.5 rounded-lg border font-semibold transition-colors ${
              showForm
                ? 'bg-purple-700 border-purple-600 text-white'
                : 'border-gray-600 text-gray-400 hover:text-white hover:border-gray-500'
            }`}
          >
            {showForm ? '✕ Cancel' : '+ Post Listing'}
          </button>
        )}
      </div>

      {/* Post form */}
      {showForm && (
        <form onSubmit={handlePost} className="rounded-xl border border-purple-700/40 bg-purple-900/10 p-4 space-y-3">
          <p className="text-xs font-semibold text-purple-300">📋 Post Your Travel Companion Listing</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-400 block mb-1">From Country *</label>
              <input type="text" placeholder="e.g. United Kingdom" value={formOrigin}
                onChange={e => setFormOrigin(e.target.value)} required className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">To Country *</label>
              <input type="text" placeholder="e.g. France" value={formDest}
                onChange={e => setFormDest(e.target.value)} required className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-400 block mb-1">From City</label>
              <input type="text" placeholder="e.g. London" value={formOriginCity}
                onChange={e => setFormOriginCity(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">To City</label>
              <input type="text" placeholder="e.g. Paris" value={formDestCity}
                onChange={e => setFormDestCity(e.target.value)} className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Travel Date *</label>
              <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)}
                required className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Notes</label>
              <input type="text" placeholder="e.g. Looking for company" value={formNotes}
                onChange={e => setFormNotes(e.target.value)} className={inputCls} />
            </div>
          </div>
          {postError && <p className="text-red-400 text-xs">{postError}</p>}
          {postOk    && <p className="text-green-400 text-xs">{postOk}</p>}
          <button type="submit" disabled={posting}
            className="w-full py-2 rounded-lg bg-purple-700 hover:bg-purple-600 text-white text-sm font-semibold disabled:opacity-50 transition-colors">
            {posting ? 'Posting…' : '🌍 Post Companion Listing'}
          </button>
        </form>
      )}

      {/* Search */}
      <form onSubmit={handleSearch} className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <input type="text" placeholder="From Country" value={searchOrigin}
            onChange={e => setSearchOrigin(e.target.value)} className={inputCls} />
          <input type="text" placeholder="To Country" value={searchDest}
            onChange={e => setSearchDest(e.target.value)} className={inputCls} />
          <input type="date" value={searchDate}
            onChange={e => setSearchDate(e.target.value)} className={inputCls} />
        </div>
        <div className="flex gap-2">
          <button type="submit" disabled={loading}
            className="text-xs px-3 py-1.5 rounded-lg bg-purple-700/60 hover:bg-purple-600/60 border border-purple-700/50 text-purple-300 font-semibold transition-colors disabled:opacity-50">
            🔍 Search
          </button>
          <button type="button" onClick={() => { setSearchOrigin(''); setSearchDest(''); setSearchDate(''); loadCompanions() }}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            ↺ Clear
          </button>
        </div>
      </form>

      {/* Results */}
      {loading && (
        <div className="flex justify-center py-6"><div className="spinner w-6 h-6" /></div>
      )}
      {searchError && <p className="text-red-400 text-xs">{searchError}</p>}

      {!loading && companions.length === 0 && (
        <div className="text-center py-8 text-gray-500 text-sm">
          <p className="text-2xl mb-1">🌍</p>
          <p>No companion listings found. Be the first to post!</p>
        </div>
      )}

      <div className="space-y-2">
        {companions.map(c => (
          <div key={c.companion_id}
            className="rounded-xl border border-gray-700 bg-gray-800/60 hover:border-gray-600 p-3 space-y-1.5 transition-all">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-white text-sm">
                    🌍 {c.origin_country}
                    {c.origin_city && ` (${c.origin_city})`}
                  </span>
                  <span className="text-gray-500 text-xs">→</span>
                  <span className="font-semibold text-purple-300 text-sm">
                    {c.destination_country}
                    {c.destination_city && ` (${c.destination_city})`}
                  </span>
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-700/60 text-gray-300 border border-gray-600/50">
                    📅 {c.travel_date}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">👤 {c.poster_name}</p>
                {c.notes && <p className="text-xs text-gray-500 italic mt-0.5">"{c.notes}"</p>}
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                {user && user.user_id !== c.user_id && (
                  <button
                    onClick={() => handleMessageCompanion(c.user_id)}
                    disabled={dmLoading[c.user_id]}
                    className="text-xs px-2.5 py-1 rounded-lg bg-purple-800/60 hover:bg-purple-700/60 border border-purple-700/50 text-purple-300 font-semibold transition-colors disabled:opacity-50">
                    {dmLoading[c.user_id] ? '…' : '💬 Message'}
                  </button>
                )}
                {user && user.user_id === c.user_id && (
                  <button
                    onClick={() => handleDelete(c.companion_id)}
                    className="text-xs px-2.5 py-1 rounded-lg bg-red-900/40 hover:bg-red-800/40 border border-red-800/50 text-red-400 transition-colors">
                    🗑 Remove
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
