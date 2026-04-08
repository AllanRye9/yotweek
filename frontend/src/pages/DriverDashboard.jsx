import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getUserProfile, userLogout, getDriverDashboard } from '../api'
import NavBar from '../components/NavBar'
import RideShare from '../components/RideShare'
import RideChat from '../components/RideChat'
import DMInbox from '../components/DMInbox'
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
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-page)', color: 'var(--text-primary)' }}>
      {/* Shared NavBar */}
      <NavBar user={driver} onLogout={handleLogout} />

      {/* Tab bar */}
      <nav className="border-b flex px-4 gap-1 overflow-x-auto"
           style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}>
        {[['overview', '📊 Overview'], ['rides', '🚘 My Rides'], ['inbox', '📬 Inbox'], ['chat', '💬 Ride Chat']].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap transition-colors border-b-2 ${
              tab === id
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent hover:opacity-80'
            }`}
            style={tab !== id ? { color: 'var(--text-secondary)' } : {}}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="flex-1 p-4 max-w-5xl mx-auto w-full">
        {/* Overview */}
        {tab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { icon: '🚘', value: stats.total_rides ?? '—', label: 'Total Rides Posted' },
                { icon: '✅', value: stats.open_rides ?? '—', label: 'Open Rides' },
                { icon: '👥', value: stats.total_passengers ?? '—', label: 'Confirmed Passengers' },
              ].map(({ icon, value, label }) => (
                <div key={label} className="rounded-xl p-4 text-center"
                     style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                  <div className="text-2xl mb-1">{icon}</div>
                  <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{value}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Recent posted rides */}
            {dashData?.posted_rides?.length > 0 && (
              <div className="rounded-xl p-4"
                   style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                <h2 className="font-semibold text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>Recent Rides</h2>
                <div className="space-y-2">
                  {dashData.posted_rides.slice(0, 5).map(ride => (
                    <div
                      key={ride.ride_id}
                      className="flex items-center justify-between rounded-lg px-3 py-2 cursor-pointer transition-colors hover:opacity-80"
                      style={{ background: 'var(--bg-surface)' }}
                      onClick={() => { setSelectedRide(ride); setTab('chat') }}
                    >
                      <div>
                        <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{ride.origin} → {ride.destination}</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{ride.departure} · {ride.seats} seats</p>
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

            <div className="rounded-xl p-4"
                 style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <h2 className="font-semibold text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>Quick Actions</h2>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setTab('rides')}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black text-xs font-medium rounded-lg transition-colors"
                >
                  + Post New Ride
                </button>
                <button
                  onClick={() => setTab('chat')}
                  className="px-3 py-1.5 text-xs rounded-lg transition-colors hover:opacity-80"
                  style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
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

        {/* DM Inbox */}
        {tab === 'inbox' && (
          <DMInbox currentUser={driver} />
        )}

        {/* Ride Chat */}
        {tab === 'chat' && (
          <div className="space-y-3">
            {selectedRide ? (
              <>
                <button
                  onClick={() => setSelectedRide(null)}
                  className="text-xs hover:opacity-70 transition-opacity"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  ← Back to ride list
                </button>
                <RideChat ride={selectedRide} user={driver} onClose={() => setSelectedRide(null)} />
              </>
            ) : (
              <div className="rounded-xl p-6 text-center text-sm"
                   style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                Select a ride to view its chat thread.
                <button
                  onClick={() => setTab('rides')}
                  className="block mx-auto mt-3 text-xs text-amber-500 hover:text-amber-400"
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
