import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getUserProfile, getRide } from '../api'
import NavBar from '../components/NavBar'
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
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-page)' }}>
        <NavBar user={user || false} backPath={backPath} title="Ride Chat" />
        <div className="flex-1 flex items-center justify-center p-4 text-center">
          <div className="rounded-xl p-8 max-w-sm w-full space-y-4"
               style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <div className="text-4xl">{error.includes('not found') ? '🔍' : '🚫'}</div>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{error}</p>
            <Link to={backPath} className="block text-amber-500 hover:text-amber-400 text-sm">
              ← Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-page)' }}>
      {/* Shared NavBar with ride title */}
      <NavBar
        user={user || false}
        backPath={backPath}
        title={ride ? `${ride.origin} → ${ride.destination}` : `Ride ${rideId}`}
      />

      <main className="flex-1 p-4 max-w-3xl mx-auto w-full">
        {ride && user && (
          <RideChat ride={ride} user={user} onClose={() => navigate(backPath)} />
        )}
      </main>
    </div>
  )
}
