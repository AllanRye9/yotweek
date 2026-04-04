import { useState, useEffect, useCallback } from 'react'
import { createRideRequest, listRideRequests, cancelRideRequest, acceptRideRequest } from '../api'
import socket from '../socket'

/**
 * RaiseRequest — Supply & Demand ride request feature.
 *
 * Passengers can raise a ride request when no matching ride is found.
 * Drivers can see open requests and accept them (which opens a DM chat).
 */
export default function RaiseRequest({ user, onConvCreated }) {
  const isDriver = user?.role === 'driver'

  // Request list
  const [requests,      setRequests]      = useState([])
  const [loading,       setLoading]       = useState(false)
  const [loadError,     setLoadError]     = useState('')

  // Post form
  const [showForm,      setShowForm]      = useState(false)
  const [formOrigin,    setFormOrigin]    = useState('')
  const [formDest,      setFormDest]      = useState('')
  const [formDate,      setFormDate]      = useState('')
  const [formPassengers, setFormPassengers] = useState(1)
  const [formPriceMin,  setFormPriceMin]  = useState('')
  const [formPriceMax,  setFormPriceMax]  = useState('')
  const [posting,       setPosting]       = useState(false)
  const [postError,     setPostError]     = useState('')
  const [postOk,        setPostOk]        = useState('')

  // Accept state
  const [accepting,     setAccepting]     = useState({})

  const loadRequests = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const data = await listRideRequests('open')
      setRequests(data.requests || [])
    } catch (err) {
      setLoadError(err.message || 'Failed to load requests.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadRequests() }, [loadRequests])

  // Listen for new requests via socket
  useEffect(() => {
    const onNewRequest = (req) => {
      setRequests(prev => {
        if (prev.some(r => r.request_id === req.request_id)) return prev
        return [req, ...prev]
      })
    }
    socket.on('new_ride_request', onNewRequest)
    return () => socket.off('new_ride_request', onNewRequest)
  }, [])

  const handlePost = async (e) => {
    e.preventDefault()
    setPostError('')
    setPostOk('')
    if (!user) { setPostError('Please login first.'); return }
    setPosting(true)
    try {
      await createRideRequest(
        formOrigin.trim(), formDest.trim(), formDate,
        formPassengers,
        formPriceMin ? Number(formPriceMin) : null,
        formPriceMax ? Number(formPriceMax) : null,
      )
      setPostOk('✅ Request posted! Drivers can now see and accept it.')
      setFormOrigin(''); setFormDest(''); setFormDate('')
      setFormPassengers(1); setFormPriceMin(''); setFormPriceMax('')
      setShowForm(false)
      await loadRequests()
    } catch (err) {
      setPostError(err.message || 'Failed to post request.')
    } finally {
      setPosting(false)
    }
  }

  const handleCancel = async (requestId) => {
    if (!window.confirm('Cancel this ride request?')) return
    try {
      await cancelRideRequest(requestId)
      setRequests(prev => prev.filter(r => r.request_id !== requestId))
    } catch (err) {
      alert(err.message || 'Failed to cancel request.')
    }
  }

  const handleAccept = async (requestId) => {
    setAccepting(prev => ({ ...prev, [requestId]: true }))
    try {
      const data = await acceptRideRequest(requestId)
      setRequests(prev => prev.filter(r => r.request_id !== requestId))
      if (data.conv_id) {
        onConvCreated?.(data.conv_id)
      }
    } catch (err) {
      alert(err.message || 'Failed to accept request.')
    } finally {
      setAccepting(prev => ({ ...prev, [requestId]: false }))
    }
  }

  const inputCls = 'rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-xs px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-500 w-full'

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-200 flex items-center gap-2">
            🙋 Ride Requests
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {isDriver
              ? 'Passengers looking for rides — accept to start a chat.'
              : "Can't find a ride? Raise a request for drivers to see."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadRequests} className="text-xs text-amber-400 hover:text-amber-300 transition-colors">↺</button>
          {user && !isDriver && (
            <button
              onClick={() => { setShowForm(v => !v); setPostError(''); setPostOk('') }}
              className={`text-xs px-3 py-1.5 rounded-lg border font-semibold transition-colors ${
                showForm
                  ? 'bg-amber-700 border-amber-600 text-white'
                  : 'border-gray-600 text-gray-400 hover:text-white hover:border-gray-500'
              }`}
            >
              {showForm ? '✕ Cancel' : '+ Raise Request'}
            </button>
          )}
        </div>
      </div>

      {/* Post form (passengers only) */}
      {showForm && !isDriver && (
        <form onSubmit={handlePost} className="rounded-xl border border-amber-700/40 bg-amber-900/10 p-4 space-y-3">
          <p className="text-xs font-semibold text-amber-300">🙋 Raise a Ride Request</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Pickup Location *</label>
              <input type="text" placeholder="e.g. Manchester Airport" value={formOrigin}
                onChange={e => setFormOrigin(e.target.value)} required className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Destination *</label>
              <input type="text" placeholder="e.g. Liverpool City Centre" value={formDest}
                onChange={e => setFormDest(e.target.value)} required className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Desired Date/Time *</label>
              <input type="datetime-local" value={formDate} onChange={e => setFormDate(e.target.value)}
                required className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Passengers</label>
              <input type="number" min={1} max={20} value={formPassengers}
                onChange={e => setFormPassengers(Number(e.target.value))} className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Price Range (optional)</label>
              <div className="flex gap-1">
                <input type="number" min={0} placeholder="Min" value={formPriceMin}
                  onChange={e => setFormPriceMin(e.target.value)}
                  className="w-1/2 rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-xs px-2 py-1.5 focus:outline-none" />
                <input type="number" min={0} placeholder="Max" value={formPriceMax}
                  onChange={e => setFormPriceMax(e.target.value)}
                  className="w-1/2 rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-xs px-2 py-1.5 focus:outline-none" />
              </div>
            </div>
          </div>
          {postError && <p className="text-red-400 text-xs">{postError}</p>}
          {postOk    && <p className="text-green-400 text-xs">{postOk}</p>}
          <button type="submit" disabled={posting}
            className="w-full py-2 rounded-lg bg-amber-700 hover:bg-amber-600 text-white text-sm font-semibold disabled:opacity-50 transition-colors">
            {posting ? 'Posting…' : '🙋 Raise Ride Request'}
          </button>
        </form>
      )}

      {/* Request list */}
      {loading && (
        <div className="flex justify-center py-6"><div className="spinner w-6 h-6" /></div>
      )}
      {loadError && <p className="text-red-400 text-xs">{loadError}</p>}

      {!loading && requests.length === 0 && (
        <div className="text-center py-8 text-gray-500 text-sm">
          <p className="text-2xl mb-1">🙋</p>
          <p>{isDriver ? 'No open ride requests at the moment.' : 'No requests yet.'}</p>
        </div>
      )}

      <div className="space-y-2">
        {requests.map(req => (
          <div key={req.request_id}
            className="rounded-xl border border-gray-700 bg-gray-800/60 hover:border-gray-600 p-3 space-y-1.5 transition-all">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-white text-sm">📍 {req.origin}</span>
                  <span className="text-gray-500 text-xs">→</span>
                  <span className="font-semibold text-amber-300 text-sm">{req.destination}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-700/60 text-gray-300 border border-gray-600/50">
                    🕐 {new Date(req.desired_date).toLocaleString()}
                  </span>
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-900/40 text-amber-300 border border-amber-700/40">
                    👥 {req.passengers} pax
                  </span>
                  {(req.price_min != null || req.price_max != null) && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-900/40 text-green-300 border border-green-700/40">
                      💰 {req.price_min != null ? `$${req.price_min}` : ''}{req.price_min != null && req.price_max != null ? '–' : ''}{req.price_max != null ? `$${req.price_max}` : ''}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">👤 {req.passenger_name}</p>
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                {isDriver && (
                  <button
                    onClick={() => handleAccept(req.request_id)}
                    disabled={accepting[req.request_id]}
                    className="text-xs px-2.5 py-1 rounded-lg bg-green-800/60 hover:bg-green-700/60 border border-green-700/50 text-green-300 font-semibold transition-colors disabled:opacity-50">
                    {accepting[req.request_id] ? '…' : '✅ Accept'}
                  </button>
                )}
                {user && user.user_id === req.user_id && !isDriver && (
                  <button
                    onClick={() => handleCancel(req.request_id)}
                    className="text-xs px-2.5 py-1 rounded-lg bg-red-900/40 hover:bg-red-800/40 border border-red-800/50 text-red-400 transition-colors">
                    🗑 Cancel
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
