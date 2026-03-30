import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../App'
import {
  getAdminDownloads, getAdminVisitors, getAdminAnalytics,
  adminCancelDownload, adminDeleteRecord, adminClearVisitors,
  adminClearAllDownloads, adminClearAllData,
  adminLogout, adminDbDownloadUrl, adminDbUpload,
  getCookieStatus, uploadCookies, deleteCookies,
  getAdminRides,
  getAdminDriverApplications, approveDriverApplication,
  getAdminAgentApplications, adminApproveAgentApplication,
  getAdminReviews, deleteAdminReview,
  getAdminProperties, adminDeleteProperty,
  getAdminUsers, adminDeleteUser,
  getAdminBroadcasts, adminCancelBroadcast,
} from '../api'
import AdminStats from '../components/admin/AdminStats'
import AnalyticsCharts from '../components/admin/AnalyticsCharts'
import ActivitySummary from '../components/admin/ActivitySummary'
import DownloadsTable from '../components/admin/DownloadsTable'
import VisitorsTable from '../components/admin/VisitorsTable'
import ThemeSelector from '../components/ThemeSelector'

const SIDEBAR_TABS = [
  { id: 'dashboard',    icon: '📊', label: 'Dashboard'    },
  { id: 'analytics',    icon: '📈', label: 'Analytics'    },
  { id: 'downloads',    icon: '📥', label: 'Downloads'    },
  { id: 'visitors',     icon: '👥', label: 'Visitors'     },
  { id: 'rides',        icon: '🚗', label: 'Rides'        },
  { id: 'drivers',      icon: '🚕', label: 'Driver Apps'  },
  { id: 'agents',       icon: '🏡', label: 'Agent Apps'   },
  { id: 'reviews',      icon: '⭐',  label: 'Reviews'      },
  { id: 'properties',   icon: '🏘',  label: 'Properties'  },
  { id: 'users',        icon: '👤',  label: 'Users'        },
  { id: 'broadcasts',   icon: '📡',  label: 'Broadcasts'  },
  { id: 'database',     icon: '🗄',  label: 'Database'    },
  { id: 'cookies',      icon: '🍪',  label: 'Cookies'     },
]

function WipeAllModal({ onBackup, onConfirm, onClose }) {
  const [backupDone, setBackupDone] = useState(false)
  const [confirmed, setConfirmed]   = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-gray-900 border border-red-900/60 rounded-2xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-start gap-3 mb-4">
          <span className="text-3xl">🚨</span>
          <div>
            <h2 className="text-lg font-bold text-white">Clear All Admin Data</h2>
            <p className="text-sm text-gray-400 mt-1">
              This will permanently delete <span className="text-red-400 font-semibold">all</span>{' '}
              downloads, visitors, and analytics data from both memory and the database.
              Active downloads will be cancelled.
              This action <span className="text-red-400 font-semibold">cannot be undone</span>.
            </p>
          </div>
        </div>

        <div className="bg-gray-800 rounded-xl p-4 mb-4 space-y-3">
          <p className="text-sm font-medium text-gray-200">Step 1 — Back up your data first (recommended)</p>
          <button
            className="btn-secondary w-full text-sm"
            onClick={() => { onBackup(); setBackupDone(true) }}
          >
            ⬇ Download Backup Now
          </button>
          {backupDone && (
            <p className="text-xs text-green-400 flex items-center gap-1">
              ✓ Backup download started — check your downloads folder.
            </p>
          )}
        </div>

        <label className="flex items-start gap-2 mb-5 cursor-pointer select-none">
          <input
            type="checkbox"
            className="mt-0.5 accent-red-500"
            checked={confirmed}
            onChange={e => setConfirmed(e.target.checked)}
          />
          <span className="text-sm text-gray-300">
            I understand this will permanently erase all admin data and cannot be reversed.
          </span>
        </label>

        <div className="flex gap-3">
          <button className="flex-1 btn-ghost text-sm" onClick={onClose}>Cancel</button>
          <button
            className={`flex-1 text-sm rounded-lg px-4 py-2 font-medium transition-colors ${
              confirmed ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
            disabled={!confirmed}
            onClick={() => confirmed && onConfirm()}
          >
            🗑 Erase All Data
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AdminDashboard() {
  const { setAdmin } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab]                 = useState('dashboard')
  const [analytics, setAnalytics]     = useState(null)
  const [downloads, setDownloads]     = useState([])
  const [visitors, setVisitors]       = useState([])
  const [ridesData, setRidesData]     = useState(null)
  const [driverApps, setDriverApps]   = useState([])
  const [loadingDriverApps, setLoadingDriverApps] = useState(false)
  const [agentApps, setAgentApps]     = useState([])
  const [loadingAgentApps, setLoadingAgentApps] = useState(false)
  const [adminReviews, setAdminReviews] = useState([])
  const [loadingReviews, setLoadingReviews] = useState(false)
  const [adminProperties, setAdminProperties] = useState([])
  const [loadingProperties, setLoadingProperties] = useState(false)
  const [adminUsers, setAdminUsers]   = useState([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [adminBroadcasts, setAdminBroadcasts] = useState([])
  const [loadingBroadcasts, setLoadingBroadcasts] = useState(false)
  const [cookieStatus, setCookieStatus] = useState(null)
  const [loadingAnalytics, setLoadingAnalytics] = useState(false)
  const [loadingDl, setLoadingDl]     = useState(false)
  const [loadingVis, setLoadingVis]   = useState(false)
  const [loadingRides, setLoadingRides] = useState(false)
  const [notice, setNotice]           = useState('')
  const [error, setError]             = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showWipeModal, setShowWipeModal] = useState(false)

  // Compute 30-day download trend from download records
  const downloadsTrend = useMemo(() => {
    if (!downloads.length) return null
    const now = Date.now() / 1000
    const buckets = Array(30).fill(0)
    downloads.forEach(d => {
      const ts = d.created_at
      if (!ts) return
      const daysAgo = Math.floor((now - ts) / 86400)
      if (daysAgo >= 0 && daysAgo < 30) buckets[29 - daysAgo]++
    })
    return buckets
  }, [downloads])

  const pendingDriverCount = driverApps.filter(a => a.status === 'pending').length
  const pendingAgentCount  = agentApps.filter(a => a.status === 'pending').length

  const fetchAnalytics = useCallback(async () => {
    setLoadingAnalytics(true)
    try { setAnalytics(await getAdminAnalytics()) } catch {}
    finally { setLoadingAnalytics(false) }
  }, [])

  const fetchDownloads = useCallback(async () => {
    setLoadingDl(true)
    try { setDownloads(await getAdminDownloads()) } catch {}
    finally { setLoadingDl(false) }
  }, [])

  const fetchVisitors = useCallback(async () => {
    setLoadingVis(true)
    try { setVisitors(await getAdminVisitors()) } catch {}
    finally { setLoadingVis(false) }
  }, [])

  const fetchCookies = useCallback(() => {
    getCookieStatus().then(setCookieStatus).catch(() => {})
  }, [])

  const fetchRides = useCallback(async () => {
    setLoadingRides(true)
    try { setRidesData(await getAdminRides()) } catch {}
    finally { setLoadingRides(false) }
  }, [])

  const fetchDriverApps = useCallback(async () => {
    setLoadingDriverApps(true)
    try { setDriverApps((await getAdminDriverApplications()).applications || []) } catch {}
    finally { setLoadingDriverApps(false) }
  }, [])

  const fetchAgentApps = useCallback(async () => {
    setLoadingAgentApps(true)
    try { setAgentApps((await getAdminAgentApplications()).applications || []) } catch {}
    finally { setLoadingAgentApps(false) }
  }, [])

  const fetchAdminReviews = useCallback(async () => {
    setLoadingReviews(true)
    try { setAdminReviews((await getAdminReviews()).reviews || []) } catch {}
    finally { setLoadingReviews(false) }
  }, [])

  const fetchAdminProperties = useCallback(async () => {
    setLoadingProperties(true)
    try { setAdminProperties((await getAdminProperties()).properties || []) } catch {}
    finally { setLoadingProperties(false) }
  }, [])

  const fetchAdminUsers = useCallback(async () => {
    setLoadingUsers(true)
    try { setAdminUsers((await getAdminUsers()).users || []) } catch {}
    finally { setLoadingUsers(false) }
  }, [])

  const fetchAdminBroadcasts = useCallback(async () => {
    setLoadingBroadcasts(true)
    try { setAdminBroadcasts((await getAdminBroadcasts()).broadcasts || []) } catch {}
    finally { setLoadingBroadcasts(false) }
  }, [])

  // Load data based on active tab
  useEffect(() => {
    if (tab === 'dashboard' || tab === 'analytics') {
      fetchAnalytics()
      fetchDownloads()  // needed for 30-day trend
    }
    if (tab === 'dashboard') {
      fetchDriverApps()
      fetchAgentApps()
    }
    if (tab === 'downloads')  fetchDownloads()
    if (tab === 'visitors')   fetchVisitors()
    if (tab === 'cookies')    fetchCookies()
    if (tab === 'rides')      fetchRides()
    if (tab === 'drivers')    fetchDriverApps()
    if (tab === 'agents')     fetchAgentApps()
    if (tab === 'reviews')    fetchAdminReviews()
    if (tab === 'properties') fetchAdminProperties()
    if (tab === 'users')      fetchAdminUsers()
    if (tab === 'broadcasts') fetchAdminBroadcasts()
  }, [tab])

  const handleLogout = async () => {
    await adminLogout().catch(() => {})
    setAdmin(false)
    navigate('/admin/login', { replace: true })
  }

  const handleCancelDl = async (id) => {
    try { await adminCancelDownload(id); await fetchDownloads() } catch (e) { setError(e.message) }
  }
  const handleDeleteDl = async (id) => {
    if (!confirm('Delete this record?')) return
    try { await adminDeleteRecord(id); await fetchDownloads() } catch (e) { setError(e.message) }
  }
  const handleClearAllDl = async () => {
    try {
      await adminClearAllDownloads()
      setDownloads([])
      setNotice('All download records cleared')
    } catch (e) { setError(e.message) }
  }
  const handleClearVisitors = async () => {
    if (!confirm('Clear all visitor records?')) return
    try { await adminClearVisitors(); setVisitors([]); setNotice('Visitors cleared') } catch (e) { setError(e.message) }
  }

  // DB
  const handleDbDownload = () => { window.open(adminDbDownloadUrl(), '_blank') }
  const handleDbUpload   = async (e) => {
    const file = e.target.files?.[0]; if (!file) return
    try { await adminDbUpload(file); setNotice('Database merged successfully') } catch (err) { setError(err.message || 'Upload failed') }
    e.target.value = ''
  }
  const handleClearAllData = async () => {
    try {
      await adminClearAllData()
      setDownloads([])
      setVisitors([])
      setAnalytics(null)
      setShowWipeModal(false)
      setNotice('All admin data has been cleared.')
    } catch (e) { setError(e.message) }
  }

  // Cookies
  const handleCookieUpload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return
    try { await uploadCookies(file); setNotice('Cookies uploaded'); fetchCookies() } catch (err) { setError(err.message) }
    e.target.value = ''
  }
  const handleCookieDelete = async () => {
    if (!confirm('Delete cookies file?')) return
    try { await deleteCookies(); setNotice('Cookies deleted'); fetchCookies() } catch (err) { setError(err.message) }
  }

  const tabChange = (t) => { setTab(t); setSidebarOpen(false); setNotice(''); setError('') }

  return (
    <div className="h-screen bg-gray-950 flex overflow-hidden">
      {/* ── Wipe All Data Modal ── */}
      {showWipeModal && (
        <WipeAllModal
          onBackup={handleDbDownload}
          onConfirm={handleClearAllData}
          onClose={() => setShowWipeModal(false)}
        />
      )}

      {/* ── Sidebar overlay (mobile) ── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ── */}
      <aside className={`
        fixed top-0 left-0 h-full w-64 z-50 bg-gray-900 border-r border-gray-800
        flex flex-col transition-transform duration-300
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 lg:static lg:z-auto
      `}>
        {/* Logo */}
        <div className="p-4 border-b border-gray-800">
          <Link to="/" className="flex items-center gap-2 text-lg font-bold">
            <span>📥</span>
            <span className="gradient-text">YOT Admin</span>
          </Link>
          <p className="text-xs text-gray-600 mt-0.5">Analytics Dashboard</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {SIDEBAR_TABS.map(t => (
            <button
              key={t.id}
              className={`w-full text-left ${tab === t.id ? 'sidebar-link-active' : 'sidebar-link'}`}
              onClick={() => tabChange(t.id)}
            >
              <span className="text-base">{t.icon}</span>
              {t.label}
              {t.id === 'downloads' && downloads.length > 0 && (
                <span className="ml-auto badge-gray">{downloads.length}</span>
              )}
              {t.id === 'visitors' && visitors.length > 0 && (
                <span className="ml-auto badge-gray">{visitors.length}</span>
              )}
              {t.id === 'drivers' && pendingDriverCount > 0 && (
                <span className="ml-auto badge-gray">{pendingDriverCount}</span>
              )}
              {t.id === 'agents' && pendingAgentCount > 0 && (
                <span className="ml-auto badge-gray">{pendingAgentCount}</span>
              )}
            </button>
          ))}
        </nav>

        {/* Bottom */}
        <div className="p-3 border-t border-gray-800">
          <Link to="/" className="sidebar-link w-full block text-center mb-1">← Back to Site</Link>
          <button className="sidebar-link w-full text-red-500 hover:text-red-400" onClick={handleLogout}>
            🚪 Logout
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-30 bg-gray-950/95 backdrop-blur border-b border-gray-800 px-4 h-14 flex items-center gap-3">
          <button
            className="btn-ghost btn-sm lg:hidden"
            onClick={() => setSidebarOpen(s => !s)}
          >☰</button>
          <h1 className="text-base font-semibold text-white capitalize">
            {SIDEBAR_TABS.find(t => t.id === tab)?.label || tab}
          </h1>
          <div className="flex-1" />
          <ThemeSelector />
          {/* Refresh */}
          <button
            className="btn-ghost btn-sm text-xs"
            onClick={() => {
              if (tab === 'dashboard' || tab === 'analytics') fetchAnalytics()
              if (tab === 'dashboard') { fetchDriverApps(); fetchAgentApps() }
              if (tab === 'downloads') fetchDownloads()
              if (tab === 'visitors')  fetchVisitors()
              if (tab === 'rides')     fetchRides()
              if (tab === 'drivers')   fetchDriverApps()
              if (tab === 'agents')    fetchAgentApps()
              if (tab === 'reviews')   fetchAdminReviews()
              if (tab === 'properties') fetchAdminProperties()
              if (tab === 'users')      fetchAdminUsers()
              if (tab === 'broadcasts') fetchAdminBroadcasts()
            }}
          >↻ Refresh</button>
        </header>

        {/* Content */}
        <main className="flex-1 min-h-0 p-4 lg:p-6 overflow-y-auto overflow-x-hidden" style={{WebkitOverflowScrolling: 'touch'}}>
          {notice && (
            <div className="mb-4 text-sm text-green-400 bg-green-900/20 border border-green-800/50 rounded-lg px-3 py-2">
              {notice}
              <button className="float-right" onClick={() => setNotice('')}>✕</button>
            </div>
          )}
          {error && (
            <div className="mb-4 text-sm text-red-400 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
              {error}
              <button className="float-right" onClick={() => setError('')}>✕</button>
            </div>
          )}

          {/* Dashboard tab */}
          {tab === 'dashboard' && (
            <div>
              {loadingAnalytics && !analytics
                ? <div className="flex justify-center py-20"><span className="spinner w-10 h-10" /></div>
                : <>
                    <AdminStats analytics={analytics} />

                    {/* Pending Applications summary */}
                    <div className="mb-6">
                      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                        Pending Applications
                      </h2>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* Driver Applications */}
                        <div className="rounded-xl border border-amber-700/40 bg-amber-900/10 p-4 flex items-center justify-between">
                          <div>
                            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">🚕 Driver Applications</p>
                            <p className="text-2xl font-bold text-amber-300">
                              {pendingDriverCount}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {driverApps.length} total · {driverApps.filter(a => a.status === 'approved').length} approved
                            </p>
                          </div>
                          <button
                            className="text-xs px-3 py-1.5 rounded-lg bg-amber-800/40 hover:bg-amber-700/50 text-amber-300 border border-amber-700/40 transition-colors"
                            onClick={() => setTab('drivers')}
                          >
                            Manage →
                          </button>
                        </div>

                        {/* Agent Applications */}
                        <div className="rounded-xl border border-purple-700/40 bg-purple-900/10 p-4 flex items-center justify-between">
                          <div>
                            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">🏡 Agent Applications</p>
                            <p className="text-2xl font-bold text-purple-300">
                              {pendingAgentCount}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {agentApps.length} total · {agentApps.filter(a => a.status === 'approved').length} approved
                            </p>
                          </div>
                          <button
                            className="text-xs px-3 py-1.5 rounded-lg bg-purple-800/40 hover:bg-purple-700/50 text-purple-300 border border-purple-700/40 transition-colors"
                            onClick={() => setTab('agents')}
                          >
                            Manage →
                          </button>
                        </div>
                      </div>
                    </div>

                    <ActivitySummary downloads={downloads} analytics={analytics} />
                  </>
              }
            </div>
          )}

          {/* Analytics tab */}
          {tab === 'analytics' && (
            <div>
              {loadingAnalytics && !analytics
                ? <div className="flex justify-center py-20"><span className="spinner w-10 h-10" /></div>
                : <AnalyticsCharts analytics={analytics} downloadsTrend={downloadsTrend} />
              }
            </div>
          )}

          {/* Downloads tab */}
          {tab === 'downloads' && (
            <DownloadsTable
              downloads={downloads}
              loading={loadingDl}
              onCancel={handleCancelDl}
              onDelete={handleDeleteDl}
              onClearAll={handleClearAllDl}
              onBackupDb={handleDbDownload}
            />
          )}

          {/* Visitors tab */}
          {tab === 'visitors' && (
            <VisitorsTable
              visitors={visitors}
              loading={loadingVis}
              onClear={handleClearVisitors}
            />
          )}

          {/* Rides tab */}
          {tab === 'rides' && (
            <div className="space-y-6">
              {loadingRides && (
                <div className="flex justify-center py-12">
                  <div className="spinner w-8 h-8" />
                </div>
              )}
              {!loadingRides && ridesData && (
                <>
                  {/* Stats row */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rounded-xl border border-blue-800/50 bg-blue-900/20 p-4">
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Total Rides</p>
                      <p className="text-2xl font-bold text-white">{ridesData.stats.total}</p>
                    </div>
                    <div className="rounded-xl border border-green-800/50 bg-green-900/20 p-4">
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                        <span className="ride-status-tag ride-tag-open" style={{fontSize:'0.6rem'}}>Open</span>
                      </p>
                      <p className="text-2xl font-bold text-white">{ridesData.stats.open}</p>
                    </div>
                    <div className="rounded-xl border border-amber-700/50 bg-amber-900/20 p-4">
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                        <span className="ride-status-tag ride-tag-taken" style={{fontSize:'0.6rem'}}>Taken</span>
                      </p>
                      <p className="text-2xl font-bold text-white">{ridesData.stats.taken}</p>
                    </div>
                    <div className="rounded-xl border border-red-800/40 bg-red-900/10 p-4">
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                        <span className="ride-status-tag ride-tag-cancelled" style={{fontSize:'0.6rem'}}>Cancelled</span>
                      </p>
                      <p className="text-2xl font-bold text-white">{ridesData.stats.cancelled}</p>
                    </div>
                  </div>

                  {/* Rides table */}
                  <div className="card overflow-x-auto">
                    <h3 className="font-semibold text-white mb-3">🗺️ All Rides</h3>
                    {ridesData.rides.length === 0 ? (
                      <p className="text-sm text-gray-500 py-4 text-center">No rides yet.</p>
                    ) : (
                      <table className="w-full text-xs text-left text-gray-300 border-collapse">
                        <thead>
                          <tr className="text-gray-500 border-b border-gray-700">
                            <th className="py-2 pr-3">Status</th>
                            <th className="py-2 pr-3">Origin → Dest</th>
                            <th className="py-2 pr-3">Driver</th>
                            <th className="py-2 pr-3">Departure</th>
                            <th className="py-2 pr-3">Seats</th>
                            <th className="py-2">Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ridesData.rides.map(r => (
                            <tr key={r.ride_id} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                              <td className="py-2 pr-3">
                                <span className={`ride-status-tag ${
                                  r.status === 'open' ? 'ride-tag-open'
                                  : r.status === 'taken' ? 'ride-tag-taken'
                                  : 'ride-tag-cancelled'
                                }`}>
                                  {r.status}
                                </span>
                              </td>
                              <td className="py-2 pr-3 max-w-[160px] truncate">
                                {r.origin} → {r.destination}
                              </td>
                              <td className="py-2 pr-3">{r.driver_name}</td>
                              <td className="py-2 pr-3 whitespace-nowrap">
                                {new Date(r.departure).toLocaleString()}
                              </td>
                              <td className="py-2 pr-3 text-center">{r.seats}</td>
                              <td className="py-2 max-w-[140px] truncate text-gray-500">{r.notes || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Driver Applications tab */}
          {tab === 'drivers' && (
            <div className="space-y-4">
              {loadingDriverApps ? (
                <div className="flex justify-center py-12"><div className="spinner w-8 h-8" /></div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="rounded-xl border border-blue-800/40 bg-blue-900/20 p-4">
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Total</p>
                      <p className="text-2xl font-bold text-white">{driverApps.length}</p>
                    </div>
                    <div className="rounded-xl border border-amber-700/40 bg-amber-900/20 p-4">
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Pending</p>
                      <p className="text-2xl font-bold text-amber-300">{pendingDriverCount}</p>
                    </div>
                    <div className="rounded-xl border border-green-800/40 bg-green-900/20 p-4">
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Approved</p>
                      <p className="text-2xl font-bold text-green-300">{driverApps.filter(a => a.status === 'approved').length}</p>
                    </div>
                  </div>

                  <div className="card overflow-x-auto">
                    <h3 className="font-semibold text-white mb-3">🚕 Driver Applications</h3>
                    {driverApps.length === 0 ? (
                      <p className="text-sm text-gray-500 py-4 text-center">No driver applications yet.</p>
                    ) : (
                      <table className="w-full text-xs text-left text-gray-300 border-collapse">
                        <thead>
                          <tr className="text-gray-500 border-b border-gray-700">
                            <th className="py-2 pr-3">Status</th>
                            <th className="py-2 pr-3">Name</th>
                            <th className="py-2 pr-3">Vehicle</th>
                            <th className="py-2 pr-3">Plate</th>
                            <th className="py-2 pr-3">Applied</th>
                            <th className="py-2">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {driverApps.map(a => (
                            <tr key={a.app_id} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                              <td className="py-2 pr-3">
                                <span className={`ride-status-tag ${
                                  a.status === 'approved' ? 'ride-tag-taken'
                                  : a.status === 'rejected' ? 'ride-tag-cancelled'
                                  : 'ride-tag-open'
                                }`}>
                                  {a.status}
                                </span>
                              </td>
                              <td className="py-2 pr-3 font-medium">{a.user_name || a.user_id?.slice(0, 8)}</td>
                              <td className="py-2 pr-3">
                                {a.vehicle_year} {a.vehicle_color} {a.vehicle_make} {a.vehicle_model}
                              </td>
                              <td className="py-2 pr-3 font-mono">{a.license_plate}</td>
                              <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">
                                {new Date(a.created_at).toLocaleDateString()}
                              </td>
                              <td className="py-2">
                                {a.status === 'pending' && (
                                  <div className="flex gap-1.5">
                                    <button
                                      className="text-xs px-2 py-1 rounded bg-green-800/60 hover:bg-green-700 text-green-300 border border-green-700/50 transition-colors"
                                      onClick={async () => {
                                        try {
                                          await approveDriverApplication(a.app_id, true)
                                          fetchDriverApps()
                                          setNotice(`✅ ${a.user_name || 'Driver'} approved.`)
                                          setTimeout(() => setNotice(''), 3000)
                                        } catch (e) { setError(e.message) }
                                      }}
                                    >
                                      ✅ Approve
                                    </button>
                                    <button
                                      className="text-xs px-2 py-1 rounded bg-red-900/40 hover:bg-red-800 text-red-300 border border-red-700/50 transition-colors"
                                      onClick={async () => {
                                        try {
                                          await approveDriverApplication(a.app_id, false)
                                          fetchDriverApps()
                                          setNotice(`❌ ${a.user_name || 'Driver'} rejected.`)
                                          setTimeout(() => setNotice(''), 3000)
                                        } catch (e) { setError(e.message) }
                                      }}
                                    >
                                      ✗ Reject
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Agent Applications tab */}
          {tab === 'agents' && (
            <div className="space-y-4">
              {loadingAgentApps ? (
                <div className="flex justify-center py-12"><div className="spinner w-8 h-8" /></div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="rounded-xl border border-blue-800/40 bg-blue-900/20 p-4">
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Total</p>
                      <p className="text-2xl font-bold text-white">{agentApps.length}</p>
                    </div>
                    <div className="rounded-xl border border-amber-700/40 bg-amber-900/20 p-4">
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Pending</p>
                      <p className="text-2xl font-bold text-amber-300">{pendingAgentCount}</p>
                    </div>
                    <div className="rounded-xl border border-green-800/40 bg-green-900/20 p-4">
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Approved</p>
                      <p className="text-2xl font-bold text-green-300">{agentApps.filter(a => a.status === 'approved').length}</p>
                    </div>
                  </div>

                  <div className="card overflow-x-auto">
                    <h3 className="font-semibold text-white mb-3">🏡 Agent Applications</h3>
                    {agentApps.length === 0 ? (
                      <p className="text-sm text-gray-500 py-4 text-center">No agent applications yet.</p>
                    ) : (
                      <table className="w-full text-xs text-left text-gray-300 border-collapse">
                        <thead>
                          <tr className="text-gray-500 border-b border-gray-700">
                            <th className="py-2 pr-3">Status</th>
                            <th className="py-2 pr-3">Name</th>
                            <th className="py-2 pr-3">Agency</th>
                            <th className="py-2 pr-3">License #</th>
                            <th className="py-2 pr-3">Email</th>
                            <th className="py-2 pr-3">Applied</th>
                            <th className="py-2">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {agentApps.map(a => (
                            <tr key={a.app_id} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                              <td className="py-2 pr-3">
                                <span className={`ride-status-tag ${
                                  a.status === 'approved' ? 'ride-tag-taken'
                                  : a.status === 'rejected' ? 'ride-tag-cancelled'
                                  : 'ride-tag-open'
                                }`}>
                                  {a.status}
                                </span>
                              </td>
                              <td className="py-2 pr-3 font-medium">{a.full_name}</td>
                              <td className="py-2 pr-3">{a.agency_name || '—'}</td>
                              <td className="py-2 pr-3 font-mono">{a.license_number}</td>
                              <td className="py-2 pr-3 text-gray-400">{a.email}</td>
                              <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">
                                {new Date(a.created_at).toLocaleDateString()}
                              </td>
                              <td className="py-2">
                                {a.status === 'pending' && (
                                  <div className="flex gap-1.5">
                                    <button
                                      className="text-xs px-2 py-1 rounded bg-green-800/60 hover:bg-green-700 text-green-300 border border-green-700/50 transition-colors"
                                      onClick={async () => {
                                        try {
                                          await adminApproveAgentApplication(a.app_id, true)
                                          fetchAgentApps()
                                          setNotice(`✅ ${a.full_name} approved as agent.`)
                                          setTimeout(() => setNotice(''), 3000)
                                        } catch (e) { setError(e.message) }
                                      }}
                                    >
                                      ✅ Approve
                                    </button>
                                    <button
                                      className="text-xs px-2 py-1 rounded bg-red-900/40 hover:bg-red-800 text-red-300 border border-red-700/50 transition-colors"
                                      onClick={async () => {
                                        try {
                                          await adminApproveAgentApplication(a.app_id, false)
                                          fetchAgentApps()
                                          setNotice(`❌ ${a.full_name} rejected.`)
                                          setTimeout(() => setNotice(''), 3000)
                                        } catch (e) { setError(e.message) }
                                      }}
                                    >
                                      ✗ Reject
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Reviews tab */}
          {tab === 'reviews' && (
            <div className="space-y-4">
              {loadingReviews ? (
                <div className="flex justify-center py-12"><div className="spinner w-8 h-8" /></div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="rounded-xl border border-blue-800/40 bg-blue-900/20 p-4">
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Total</p>
                      <p className="text-2xl font-bold text-white">{adminReviews.length}</p>
                    </div>
                    <div className="rounded-xl border border-yellow-700/40 bg-yellow-900/20 p-4">
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Avg Rating</p>
                      <p className="text-2xl font-bold text-yellow-300">
                        {adminReviews.length > 0
                          ? (adminReviews.reduce((s, r) => s + (r.rating || 0), 0) / adminReviews.length).toFixed(1)
                          : '—'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-green-800/40 bg-green-900/20 p-4">
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">5-Star</p>
                      <p className="text-2xl font-bold text-green-300">{adminReviews.filter(r => r.rating === 5).length}</p>
                    </div>
                  </div>

                  <div className="card overflow-x-auto">
                    <h3 className="font-semibold text-white mb-3">⭐ User Reviews</h3>
                    {adminReviews.length === 0 ? (
                      <p className="text-sm text-gray-500 py-4 text-center">No reviews yet.</p>
                    ) : (
                      <table className="w-full text-xs text-left text-gray-300 border-collapse">
                        <thead>
                          <tr className="text-gray-500 border-b border-gray-700">
                            <th className="py-2 pr-3">Rating</th>
                            <th className="py-2 pr-3">Name</th>
                            <th className="py-2 pr-3">Comment</th>
                            <th className="py-2 pr-3">IP</th>
                            <th className="py-2 pr-3">Date</th>
                            <th className="py-2">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adminReviews.map(r => (
                            <tr key={r.id} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                              <td className="py-2 pr-3">
                                <span className="text-yellow-400">{'★'.repeat(r.rating || 0)}</span>
                                <span className="text-gray-600">{'★'.repeat(5 - (r.rating || 0))}</span>
                              </td>
                              <td className="py-2 pr-3 font-medium">{r.name || 'Anonymous'}</td>
                              <td className="py-2 pr-3 max-w-[200px] truncate text-gray-400">{r.comment || '—'}</td>
                              <td className="py-2 pr-3 text-gray-500 font-mono">{r.ip || '—'}</td>
                              <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">
                                {r.timestamp ? new Date(r.timestamp * 1000).toLocaleDateString() : '—'}
                              </td>
                              <td className="py-2">
                                <button
                                  className="text-xs px-2 py-1 rounded bg-red-900/40 hover:bg-red-800 text-red-300 border border-red-700/50 transition-colors"
                                  onClick={async () => {
                                    try {
                                      await deleteAdminReview(r.id)
                                      setAdminReviews(prev => prev.filter(x => x.id !== r.id))
                                      setNotice('Review removed.')
                                      setTimeout(() => setNotice(''), 3000)
                                    } catch (e) { setError(e.message) }
                                  }}
                                >
                                  🗑 Remove
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Database tab */}
          {tab === 'database' && (
            <div className="max-w-md space-y-4">
              <div className="card">
                <h3 className="font-semibold text-white mb-3">📥 Download Backup</h3>
                <p className="text-sm text-gray-400 mb-3">
                  Download a full backup of the database (downloads + visitors + reviews).
                </p>
                <button className="btn-primary w-full" onClick={handleDbDownload}>
                  ⬇ Download Database
                </button>
              </div>
              <div className="card">
                <h3 className="font-semibold text-white mb-3">📤 Upload & Merge Backup</h3>
                <p className="text-sm text-gray-400 mb-3">
                  Upload a previously downloaded backup file. Records will be merged (no duplicates).
                </p>
                <label className="btn-secondary w-full cursor-pointer">
                  📁 Choose Backup File
                  <input type="file" className="sr-only" accept=".db,.sqlite,.json" onChange={handleDbUpload} />
                </label>
              </div>
              <div className="card border-red-900/50">
                <h3 className="font-semibold text-red-400 mb-3">⚠️ Danger Zone</h3>
                <p className="text-sm text-gray-400 mb-3">
                  Permanently delete <strong className="text-white">all</strong> downloads, visitors, and
                  analytics data from memory and the database. This cannot be undone.
                  You will be prompted to back up first.
                </p>
                <button className="btn-danger w-full" onClick={() => setShowWipeModal(true)}>
                  🗑 Clear All Admin Data
                </button>
              </div>
            </div>
          )}

            </div>
          )}

          {/* Properties tab */}
          {tab === 'properties' && (
            <div className="space-y-4">
              {loadingProperties ? (
                <p className="text-sm text-gray-400 py-6 text-center">Loading properties…</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                    <div className="card text-center">
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Total</p>
                      <p className="text-2xl font-bold text-white">{adminProperties.length}</p>
                    </div>
                    <div className="card text-center">
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Active</p>
                      <p className="text-2xl font-bold text-green-300">{adminProperties.filter(p => p.status === 'active').length}</p>
                    </div>
                    <div className="card text-center">
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Sold</p>
                      <p className="text-2xl font-bold text-blue-300">{adminProperties.filter(p => p.status === 'sold').length}</p>
                    </div>
                    <div className="card text-center">
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Rented</p>
                      <p className="text-2xl font-bold text-gray-400">{adminProperties.filter(p => p.status === 'rented').length}</p>
                    </div>
                  </div>
                  <div className="card overflow-x-auto">
                    <h3 className="font-semibold text-white mb-3">🏘 All Properties</h3>
                    {adminProperties.length === 0 ? (
                      <p className="text-sm text-gray-500 py-4 text-center">No properties yet.</p>
                    ) : (
                      <table className="w-full text-xs text-left text-gray-300 border-collapse">
                        <thead>
                          <tr className="border-b border-gray-700 text-gray-500">
                            <th className="py-2 pr-3">Title</th>
                            <th className="py-2 pr-3">Status</th>
                            <th className="py-2 pr-3">Price</th>
                            <th className="py-2 pr-3">Owner</th>
                            <th className="py-2 pr-3">Created</th>
                            <th className="py-2"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {adminProperties.map(p => (
                            <tr key={p.property_id} className="border-b border-gray-800 hover:bg-gray-800/40">
                              <td className="py-2 pr-3 max-w-[180px] truncate">{p.title}</td>
                              <td className="py-2 pr-3">
                                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                  p.status === 'active' ? 'bg-green-900/60 text-green-300' :
                                  p.status === 'sold' ? 'bg-blue-900/60 text-blue-300' :
                                  'bg-gray-700 text-gray-400'
                                }`}>{p.status}</span>
                              </td>
                              <td className="py-2 pr-3">{p.price != null ? `$${p.price}` : '—'}</td>
                              <td className="py-2 pr-3 max-w-[120px] truncate">{p.owner_name || p.owner_user_id}</td>
                              <td className="py-2 pr-3 text-gray-500">{p.created_at ? p.created_at.slice(0, 10) : '—'}</td>
                              <td className="py-2 text-right">
                                <button
                                  className="text-red-400 hover:text-red-300 transition-colors text-xs px-2"
                                  onClick={async () => {
                                    if (!confirm('Delete this property?')) return
                                    try {
                                      await adminDeleteProperty(p.property_id)
                                      setAdminProperties(prev => prev.filter(x => x.property_id !== p.property_id))
                                      setNotice('Property deleted.')
                                    } catch (err) { setError(err.message || 'Failed to delete property') }
                                  }}
                                >🗑 Delete</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Users tab */}
          {tab === 'users' && (
            <div className="space-y-4">
              {loadingUsers ? (
                <p className="text-sm text-gray-400 py-6 text-center">Loading users…</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                    <div className="card text-center">
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Total Users</p>
                      <p className="text-2xl font-bold text-white">{adminUsers.length}</p>
                    </div>
                    <div className="card text-center">
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Drivers</p>
                      <p className="text-2xl font-bold text-yellow-300">{adminUsers.filter(u => u.role === 'driver').length}</p>
                    </div>
                    <div className="card text-center">
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Agents</p>
                      <p className="text-2xl font-bold text-purple-300">{adminUsers.filter(u => u.can_post_properties).length}</p>
                    </div>
                  </div>
                  <div className="card overflow-x-auto">
                    <h3 className="font-semibold text-white mb-3">👤 All Users</h3>
                    {adminUsers.length === 0 ? (
                      <p className="text-sm text-gray-500 py-4 text-center">No users yet.</p>
                    ) : (
                      <table className="w-full text-xs text-left text-gray-300 border-collapse">
                        <thead>
                          <tr className="border-b border-gray-700 text-gray-500">
                            <th className="py-2 pr-3">Name</th>
                            <th className="py-2 pr-3">Email</th>
                            <th className="py-2 pr-3">Role</th>
                            <th className="py-2 pr-3">Agent</th>
                            <th className="py-2 pr-3">Joined</th>
                            <th className="py-2"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {adminUsers.map(u => (
                            <tr key={u.user_id} className="border-b border-gray-800 hover:bg-gray-800/40">
                              <td className="py-2 pr-3 font-medium">{u.name}</td>
                              <td className="py-2 pr-3 text-gray-400">{u.email}</td>
                              <td className="py-2 pr-3">
                                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                  u.role === 'driver' ? 'bg-yellow-900/60 text-yellow-300' : 'bg-gray-700 text-gray-300'
                                }`}>{u.role}</span>
                              </td>
                              <td className="py-2 pr-3">{u.can_post_properties ? '✅' : '—'}</td>
                              <td className="py-2 pr-3 text-gray-500">{u.created_at ? u.created_at.slice(0, 10) : '—'}</td>
                              <td className="py-2 text-right">
                                <button
                                  className="text-red-400 hover:text-red-300 transition-colors text-xs px-2"
                                  onClick={async () => {
                                    if (!confirm(`Delete user "${u.name}"? This cannot be undone.`)) return
                                    try {
                                      await adminDeleteUser(u.user_id)
                                      setAdminUsers(prev => prev.filter(x => x.user_id !== u.user_id))
                                      setNotice('User deleted.')
                                    } catch (err) { setError(err.message || 'Failed to delete user') }
                                  }}
                                >🗑 Delete</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Broadcasts tab */}
          {tab === 'broadcasts' && (
            <div className="space-y-4">
              {loadingBroadcasts ? (
                <p className="text-sm text-gray-400 py-6 text-center">Loading broadcasts…</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                    <div className="card text-center">
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Total</p>
                      <p className="text-2xl font-bold text-white">{adminBroadcasts.length}</p>
                    </div>
                    <div className="card text-center">
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Active</p>
                      <p className="text-2xl font-bold text-green-300">{adminBroadcasts.filter(b => b.status === 'active').length}</p>
                    </div>
                    <div className="card text-center">
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Expired/Filled</p>
                      <p className="text-2xl font-bold text-gray-400">{adminBroadcasts.filter(b => b.status !== 'active').length}</p>
                    </div>
                  </div>
                  <div className="card overflow-x-auto">
                    <h3 className="font-semibold text-white mb-3">📡 All Broadcasts</h3>
                    {adminBroadcasts.length === 0 ? (
                      <p className="text-sm text-gray-500 py-4 text-center">No broadcasts yet.</p>
                    ) : (
                      <table className="w-full text-xs text-left text-gray-300 border-collapse">
                        <thead>
                          <tr className="border-b border-gray-700 text-gray-500">
                            <th className="py-2 pr-3">From → To</th>
                            <th className="py-2 pr-3">Poster</th>
                            <th className="py-2 pr-3">Seats</th>
                            <th className="py-2 pr-3">Fare</th>
                            <th className="py-2 pr-3">Status</th>
                            <th className="py-2 pr-3">Created</th>
                            <th className="py-2"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {adminBroadcasts.map(b => (
                            <tr key={b.broadcast_id} className="border-b border-gray-800 hover:bg-gray-800/40">
                              <td className="py-2 pr-3 max-w-[200px]">
                                <span className="truncate block">{b.start_destination} → {b.end_destination}</span>
                              </td>
                              <td className="py-2 pr-3">{b.poster_name}</td>
                              <td className="py-2 pr-3">{b.seats}</td>
                              <td className="py-2 pr-3">{b.fare != null ? `$${b.fare}` : '—'}</td>
                              <td className="py-2 pr-3">
                                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                  b.status === 'active' ? 'bg-green-900/60 text-green-300' :
                                  b.status === 'filled' ? 'bg-blue-900/60 text-blue-300' :
                                  'bg-gray-700 text-gray-400'
                                }`}>{b.status}</span>
                              </td>
                              <td className="py-2 pr-3 text-gray-500">{b.created_at ? b.created_at.slice(0, 10) : '—'}</td>
                              <td className="py-2 text-right">
                                {b.status === 'active' && (
                                  <button
                                    className="text-red-400 hover:text-red-300 transition-colors text-xs px-2"
                                    onClick={async () => {
                                      if (!confirm('Cancel this broadcast?')) return
                                      try {
                                        await adminCancelBroadcast(b.broadcast_id)
                                        setAdminBroadcasts(prev => prev.map(x => x.broadcast_id === b.broadcast_id ? { ...x, status: 'expired' } : x))
                                        setNotice('Broadcast cancelled.')
                                      } catch (err) { setError(err.message || 'Failed to cancel broadcast') }
                                    }}
                                  >✖ Cancel</button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Cookies tab */}
          {tab === 'cookies' && (
            <div className="max-w-md space-y-4">
              {/* Status */}
              <div className="card">
                <h3 className="font-semibold text-white mb-3">🍪 Cookie Status</h3>
                {cookieStatus ? (
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${cookieStatus.exists ? 'bg-green-400' : 'bg-red-500'}`} />
                      <span className="text-gray-300">{cookieStatus.exists ? 'Cookies file present' : 'No cookies file'}</span>
                    </div>
                    {cookieStatus.size_hr  && <p className="text-gray-500">Size: {cookieStatus.size_hr}</p>}
                    {cookieStatus.modified && <p className="text-gray-500">Modified: {cookieStatus.modified}</p>}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">Loading…</p>
                )}
              </div>
              <div className="card">
                <h3 className="font-semibold text-white mb-3">📤 Upload Cookies</h3>
                <p className="text-sm text-gray-400 mb-3">
                  Upload a Netscape-format cookies.txt (from browser extension) to allow downloading age-restricted or member-only content.
                </p>
                <label className="btn-secondary w-full cursor-pointer">
                  📁 Choose cookies.txt
                  <input type="file" className="sr-only" accept=".txt" onChange={handleCookieUpload} />
                </label>
              </div>
              {cookieStatus?.exists && (
                <div className="card">
                  <h3 className="font-semibold text-white mb-3">🗑 Delete Cookies</h3>
                  <button className="btn-danger w-full" onClick={handleCookieDelete}>
                    Delete cookies.txt
                  </button>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
