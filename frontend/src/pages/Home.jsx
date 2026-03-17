import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../App'
import DownloadForm from '../components/DownloadForm'
import PlaylistForm from '../components/PlaylistForm'
import EditingPanel from '../components/EditingPanel'
import ActiveDownloads from '../components/ActiveDownloads'
import FileList from '../components/FileList'
import Reviews from '../components/Reviews'
import ThemeSelector from '../components/ThemeSelector'
import { getStats } from '../api'
import socket from '../socket'

const TABS = [
  { id: 'download', label: '⬇ Download',  icon: '⬇' },
  { id: 'playlist', label: '📋 Playlist',   icon: '📋' },
  { id: 'editing',  label: '✂ Edit / Convert', icon: '✂' },
]

export default function Home() {
  const { admin } = useAuth()
  const [tab, setTab] = useState('download')
  const [stats, setStats] = useState(null)
  const [connected, setConnected] = useState(false)
  const [fileListVersion, setFileListVersion] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)

  // Socket.IO connection indicator
  useEffect(() => {
    const onConnect    = () => setConnected(true)
    const onDisconnect = () => setConnected(false)
    const onFilesUpdated = () => setFileListVersion(v => v + 1)
    socket.on('connect',       onConnect)
    socket.on('disconnect',    onDisconnect)
    socket.on('files_updated', onFilesUpdated)
    setConnected(socket.connected)
    return () => {
      socket.off('connect',       onConnect)
      socket.off('disconnect',    onDisconnect)
      socket.off('files_updated', onFilesUpdated)
    }
  }, [])

  // Poll stats
  useEffect(() => {
    const fetchStats = () => getStats().then(setStats).catch(() => {})
    fetchStats()
    const id = setInterval(fetchStats, 30_000)
    return () => clearInterval(id)
  }, [])

  const refreshFiles = useCallback(() => setFileListVersion(v => v + 1), [])

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* ── Navbar ── */}
      <nav className="sticky top-0 z-50 bg-gray-950/95 backdrop-blur border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 flex items-center h-14 gap-4">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 text-xl font-bold text-white shrink-0">
            <span>📥</span>
            <span className="gradient-text hidden sm:inline">YOT Downloader</span>
            <span className="gradient-text sm:hidden">YOT</span>
          </Link>

          {/* Stats badges */}
          <div className="hidden md:flex items-center gap-3 text-xs ml-4">
            {stats && (
              <>
                <span className="badge-info">{stats.active_downloads ?? 0} active</span>
                <span className="badge-gray">{stats.file_count ?? 0} files</span>
                {stats.total_size_hr && <span className="badge-gray">{stats.total_size_hr}</span>}
              </>
            )}
          </div>

          <div className="flex-1" />

          {/* Connection dot */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-500'}`} />
            <span className="text-gray-500 hidden sm:inline">{connected ? 'Live' : 'Offline'}</span>
          </div>

          {/* Theme selector */}
          <ThemeSelector />

          {/* Admin link */}
          {admin && (
            <Link to="/const" className="btn-secondary btn-sm hidden sm:inline-flex">
              Dashboard
            </Link>
          )}

          {/* Mobile menu */}
          <button
            className="btn-ghost btn-sm sm:hidden"
            onClick={() => setMenuOpen(m => !m)}
            aria-label="Menu"
          >
            {menuOpen ? '✕' : '☰'}
          </button>
        </div>

        {/* Mobile dropdown */}
        {menuOpen && (
          <div className="sm:hidden border-t border-gray-800 bg-gray-900 px-4 py-3 space-y-2">
            {stats && (
              <div className="flex gap-2 flex-wrap pb-2 border-b border-gray-800">
                <span className="badge-info">{stats.active_downloads ?? 0} active</span>
                <span className="badge-gray">{stats.file_count ?? 0} files</span>
              </div>
            )}
            {admin && (
              <Link
                to="/const"
                className="block text-sm text-gray-400 hover:text-white py-1"
                onClick={() => setMenuOpen(false)}
              >
                🛠 Admin Dashboard
              </Link>
            )}
            {!admin && (
              <Link
                to="/admin/login"
                className="block text-sm text-gray-500 hover:text-white py-1"
                onClick={() => setMenuOpen(false)}
              >
                Admin Login
              </Link>
            )}
          </div>
        )}
      </nav>

      {/* ── Hero ── */}
      <div className="bg-gradient-to-b from-gray-900 to-gray-950 border-b border-gray-800 py-8 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">
            Download <span className="gradient-text">Any Video</span> — Free & Fast
          </h1>
          <p className="text-gray-400 text-sm sm:text-base">
            YouTube, TikTok, Instagram, Twitter, Facebook &amp; 1,000+ sites. No sign-up required.
          </p>
        </div>
      </div>

      {/* ── Main Content ── */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-6">
        {/* Tab buttons */}
        <div className="flex gap-2 mb-5 overflow-x-auto pb-1 scrollbar-thin">
          {TABS.map(t => (
            <button
              key={t.id}
              className={tab === t.id ? 'tab-btn-active whitespace-nowrap' : 'tab-btn-inactive whitespace-nowrap'}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab panels */}
        <div className="card">
          {tab === 'download' && <DownloadForm onDownloadStarted={refreshFiles} />}
          {tab === 'playlist' && <PlaylistForm onDownloadStarted={refreshFiles} />}
          {tab === 'editing'  && <EditingPanel onJobDone={refreshFiles} />}
        </div>

        {/* Active Downloads */}
        <div className="mt-6">
          <ActiveDownloads onComplete={refreshFiles} />
        </div>

        {/* File List */}
        <div className="mt-6">
          <FileList version={fileListVersion} />
        </div>

        {/* Reviews */}
        <div className="mt-8">
          <Reviews />
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-gray-800 py-6 px-4 text-center text-xs text-gray-600">
        <p>
          YOT Downloader © {new Date().getFullYear()} — Download responsibly. Respect copyright laws.
        </p>
        <p className="mt-1">
          {!admin && (
            <Link to="/admin/login" className="hover:text-gray-400 transition-colors">Admin</Link>
          )}
        </p>
      </footer>
    </div>
  )
}
