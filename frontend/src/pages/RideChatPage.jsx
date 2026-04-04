import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getUserProfile, getRide } from '../api'
import RideChat from '../components/RideChat'
import { getDashboardPath } from '../routing'

export default function RideChatPage() {
  const { rideId } = useParams()
  const navigate   = useNavigate()

  const [user, setUser]   = useState(null)
  const [ride, setRide]   = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Load current user first
    getUserProfile()
      .then(u => {
        setUser(u)
        // Then load ride details
        return getRide(rideId)
      })
      .then(data => {
        if (!data.ride) {
          setError('Ride not found.')
        } else {
          setRide(data.ride)
        }
      })
      .catch(err => {
        if (err.status === 401 || (err.message && err.message.includes('Login'))) {
          navigate('/login', { replace: true })
        } else if (err.status === 404) {
          setError('Ride not found.')
        } else if (err.status === 403) {
          setError('Access denied. You are not a participant in this ride.')
        } else {
          setError('Failed to load ride.')
        }
      })
      .finally(() => setLoading(false))
  }, [rideId, navigate])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="spinner w-10 h-10" />
      </div>
    )
  }

  const backPath = user ? getDashboardPath(user) : '/login'

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4 text-center">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 max-w-sm w-full space-y-4">
          <div className="text-4xl">{error.includes('not found') ? '🔍' : '🚫'}</div>
          <p className="text-gray-300 text-sm">{error}</p>
          <Link to={backPath} className="block text-blue-400 hover:text-blue-300 text-sm">
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center gap-3">
        <Link to={backPath} className="text-gray-400 hover:text-gray-200 text-sm">
          ← Dashboard
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-white text-sm truncate">
            {ride ? `${ride.origin} → ${ride.destination}` : `Ride ${rideId}`}
          </h1>
          {ride && (
            <p className="text-xs text-gray-500">{ride.departure} · {ride.seats} seat(s)</p>
          )}
        </div>
        <Link to="/rides" className="text-xs text-blue-400 hover:text-blue-300">
          All Rides
        </Link>
      </header>

      <main className="flex-1 p-4 max-w-3xl mx-auto w-full">
        {ride && user && (
          <RideChat ride={ride} user={user} onClose={() => navigate(backPath)} />
        )}
      </main>
    </div>
  )
}
