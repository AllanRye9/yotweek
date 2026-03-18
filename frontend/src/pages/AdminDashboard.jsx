import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../App'
import {
  getAdminDownloads, getAdminVisitors, getAdminAnalytics,
  adminCancelDownload, adminDeleteRecord, adminClearVisitors,
  adminLogout, adminDbDownloadUrl, adminDbUpload,
  getCookieStatus, uploadCookies, deleteCookies,
} from '../api'
import AdminStats from '../components/admin/AdminStats'
import AnalyticsCharts from '../components/admin/AnalyticsCharts'
import DownloadsTable from '../components/admin/DownloadsTable'
import VisitorsTable from '../components/admin/VisitorsTable'

const SIDEBAR_TABS = [
  { id: 'dashboard',  icon: '📊', label: 'Dashboard'  },
  { id: 'analytics',  icon: '📈', label: 'Analytics'  },
  { id: 'downloads',  icon: '📥', label: 'Downloads'  },
  { id: 'visitors',   icon: '👥', label: 'Visitors'   },
  { id: 'database',   icon: '🗄',  label: 'Database'   },
  { id: 'cookies',    icon: '🍪',  label: 'Cookies'    },
]

export default function AdminDashboard() {
  const { setAdmin } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab]                 = useState('dashboard')
  const [analytics, setAnalytics]     = useState(null)
  const [downloads, setDownloads]     = useState([])
  const [visitors, setVisitors]       = useState([])
  const [cookieStatus, setCookieStatus] = useState(null)
  const [loadingAnalytics, setLoadingAnalytics] = useState(false)
  const [loadingDl, setLoadingDl]     = useState(false)
  const [loadingVis, setLoadingVis]   = useState(false)
  const [notice, setNotice]           = useState('')
  const [error, setError]             = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)

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

  // Load data based on active tab
  useEffect(() => {
    if (tab === 'dashboard' || tab === 'analytics') {
      fetchAnalytics()
      fetchDownloads()  // needed for 30-day trend
    }
    if (tab === 'downloads')  fetchDownloads()
    if (tab === 'visitors')   fetchVisitors()
    if (tab === 'cookies')    fetchCookies()
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
          {/* Refresh */}
          <button
            className="btn-ghost btn-sm text-xs"
            onClick={() => {
              if (tab === 'dashboard' || tab === 'analytics') fetchAnalytics()
              if (tab === 'downloads') fetchDownloads()
              if (tab === 'visitors')  fetchVisitors()
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
                : <AdminStats analytics={analytics} />
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
