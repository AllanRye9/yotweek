import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getUserProfile, userLogout, getDriverDashboard } from '../api'
import RideShare from '../components/RideShare'
import RideChat from '../components/RideChat'
import { getDashboardPath } from '../routing'

export default function DriverDashboard() {
  const navigate = useNavigate()

  const [driver, setDriver]         = useState(null)
  const [loading, setLoading]       = useState(true)
  const [dashData, setDashData]     = useState(null)
  const [tab, setTab]               = useState('overview')
  const [selectedRide, setSelectedRide] = useState(null)

  useEffect(() => {
    getUserProfile()
      .then(u => {
        if (u.role !== 'driver') {
          // Wrong role — redirect to the correct dashboard
          navigate(getDashboardPath(u), { replace: true })
          return
        }
        setDriver(u)
        return getDriverDashboard()
          .then(d => setDashData(d))
          .catch(() => {})
      })
      .catch(() => {
        navigate('/login', { replace: true })
      })
      .finally(() => setLoading(false))
  }, [navigate])

  const handleLogout = async () => {
    await userLogout()
    navigate('/login', { replace: true })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="spinner w-10 h-10" />
      </div>
    )
  }

  if (!driver) return null

  const stats = dashData?.stats || {}

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🚗</span>
          <div>
            <h1 className="font-bold text-white text-sm leading-tight">Driver Dashboard</h1>
            <p className="text-xs text-gray-400">{driver.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/rides" className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded">
            Browse Rides
          </Link>
          <button
            onClick={handleLogout}
            className="text-xs text-gray-400 hover:text-red-400 px-2 py-1 rounded transition-colors"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Tab bar */}
      <nav className="bg-gray-900 border-b border-gray-800 flex px-4 gap-1 overflow-x-auto">
        {[['overview', '📊 Overview'], ['rides', '🚘 My Rides'], ['chat', '💬 Messages']].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap transition-colors border-b-2 ${
              tab === id
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="flex-1 p-4 max-w-5xl mx-auto w-full">
        {/* Overview */}
        {tab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {[
                { icon: '🚘', value: stats.total_rides ?? '—', label: 'Total Rides Posted' },
                { icon: '✅', value: stats.open_rides ?? '—', label: 'Open Rides' },
                { icon: '👥', value: stats.total_passengers ?? '—', label: 'Confirmed Passengers' },
              ].map(({ icon, value, label }) => (
                <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
                  <div className="text-2xl mb-1">{icon}</div>
                  <div className="text-xl font-bold text-white">{value}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{label}</div>
                </div>
              ))}
            </div>

            {/* Recent posted rides */}
            {dashData?.posted_rides?.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <h2 className="font-semibold text-sm text-gray-300 mb-3">Recent Rides</h2>
                <div className="space-y-2">
                  {dashData.posted_rides.slice(0, 5).map(ride => (
                    <div
                      key={ride.ride_id}
                      className="flex items-center justify-between bg-gray-800/50 rounded-lg px-3 py-2 cursor-pointer hover:bg-gray-800 transition-colors"
                      onClick={() => { setSelectedRide(ride); setTab('chat') }}
                    >
                      <div>
                        <p className="text-xs font-medium text-gray-200">{ride.origin} → {ride.destination}</p>
                        <p className="text-xs text-gray-500">{ride.departure} · {ride.seats} seats</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        ride.status === 'open' ? 'bg-green-900/50 text-green-400' : 'bg-gray-700 text-gray-400'
                      }`}>
                        {ride.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <h2 className="font-semibold text-sm text-gray-300 mb-3">Quick Actions</h2>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setTab('rides')}
                  className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded-lg transition-colors"
                >
                  + Post New Ride
                </button>
                <button
                  onClick={() => setTab('chat')}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded-lg transition-colors"
                >
                  View Messages
                </button>
              </div>
            </div>
          </div>
        )}

        {/* My Rides (post + list) */}
        {tab === 'rides' && (
          <RideShare user={driver} onOpenChat={(ride) => { setSelectedRide(ride); setTab('chat') }} />
        )}

        {/* Chat */}
        {tab === 'chat' && (
          <div className="space-y-3">
            {selectedRide ? (
              <>
                <button
                  onClick={() => setSelectedRide(null)}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  ← Back to ride list
                </button>
                <RideChat ride={selectedRide} user={driver} onClose={() => setSelectedRide(null)} />
              </>
            ) : (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center text-gray-500 text-sm">
                Select a ride to view its chat thread.
                <button
                  onClick={() => setTab('rides')}
                  className="block mx-auto mt-3 text-xs text-blue-400 hover:text-blue-300"
                >
                  Go to My Rides →
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
