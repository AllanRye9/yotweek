import { useState, useEffect, useCallback, useRef } from 'react'
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
  const [helpOpen, setHelpOpen] = useState(false)

  // Draggable help FAB state
  const fabRef = useRef(null)
  const fabDrag = useRef({ active: false, moved: false, startX: 0, startY: 0, origRight: 24, origBottom: 24 })

  useEffect(() => {
    const fab = fabRef.current
    if (!fab) return
    const onPointerDown = (e) => {
      fabDrag.current.active = true
      fabDrag.current.moved = false
      fabDrag.current.startX = e.clientX
      fabDrag.current.startY = e.clientY
      fabDrag.current.origRight  = parseFloat(fab.dataset.right  ?? '24')
      fabDrag.current.origBottom = parseFloat(fab.dataset.bottom ?? '24')
      fab.setPointerCapture(e.pointerId)
      e.preventDefault()
    }
    const onPointerMove = (e) => {
      if (!fabDrag.current.active) return
      const dx = e.clientX - fabDrag.current.startX
      const dy = e.clientY - fabDrag.current.startY
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) fabDrag.current.moved = true
      const right  = Math.max(8, Math.min(fabDrag.current.origRight  - dx, window.innerWidth  - (fab.offsetWidth  || 52) - 8))
      const bottom = Math.max(8, Math.min(fabDrag.current.origBottom + dy, window.innerHeight - (fab.offsetHeight || 52) - 8))
      fab.style.right  = right  + 'px'
      fab.style.bottom = bottom + 'px'
      fab.dataset.right  = right
      fab.dataset.bottom = bottom
    }
    const onPointerUp = () => {
      if (!fabDrag.current.active) return
      fabDrag.current.active = false
      if (!fabDrag.current.moved) setHelpOpen(true)
    }
    fab.addEventListener('pointerdown',  onPointerDown)
    fab.addEventListener('pointermove',  onPointerMove)
    fab.addEventListener('pointerup',    onPointerUp)
    fab.addEventListener('pointercancel', () => { fabDrag.current.active = false })
    return () => {
      fab.removeEventListener('pointerdown',  onPointerDown)
      fab.removeEventListener('pointermove',  onPointerMove)
      fab.removeEventListener('pointerup',    onPointerUp)
    }
  }, [])

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
            Download <span className="gradient-text">Any Video</span> — Free &amp; Fast
          </h1>
          <p className="text-gray-400 text-xs sm:text-sm">
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

      {/* ── Draggable Help FAB ── */}
      <button
        ref={fabRef}
        data-right="24"
        data-bottom="24"
        aria-label="Help — click for a guide to all features"
        title="Help"
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9000,
          width: 52, height: 52, borderRadius: '50%',
          background: 'linear-gradient(135deg,#dc2626,#b91c1c)',
          color: '#fff', border: 'none', cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(220,38,38,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.25rem', userSelect: 'none', touchAction: 'none',
        }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setHelpOpen(true) } }}
      >
        ?
      </button>

      {/* ── Help Modal ── */}
      {helpOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            zIndex: 9100, display: 'flex', alignItems: 'center',
            justifyContent: 'center', padding: 16,
          }}
          onClick={e => { if (e.target === e.currentTarget) setHelpOpen(false) }}
        >
          <div style={{
            background: '#111827', border: '1px solid #1f2937',
            borderRadius: 16, maxWidth: 580, width: '100%',
            maxHeight: '90vh', overflowY: 'auto',
            boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
          }}>
            {/* Modal header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '18px 20px 14px', borderBottom: '1px solid #1f2937',
              position: 'sticky', top: 0, background: '#111827', zIndex: 1,
              borderRadius: '16px 16px 0 0',
            }}>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#f3f4f6', display: 'flex', alignItems: 'center', gap: 8 }}>
                ❓ YOT Downloader — Help Guide
              </h2>
              <button
                onClick={() => setHelpOpen(false)}
                style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '1.1rem', padding: '4px 8px', borderRadius: 6 }}
                aria-label="Close help"
              >✕</button>
            </div>

            {/* Modal body */}
            <div style={{ padding: '16px 20px 20px', fontSize: '0.82rem', color: '#9ca3af', lineHeight: 1.7 }}>
              <HelpSection icon="⬇" title="Single Video Download">
                <ol style={{ paddingLeft: 18, margin: 0 }}>
                  <li>Paste a video URL (YouTube, TikTok, Instagram, Twitter/X, Facebook and 1,000+ sites) into the URL box.</li>
                  <li>Click <strong>Get Info</strong> to fetch the title, duration, and thumbnail.</li>
                  <li>Choose your <strong>Quality</strong> and <strong>Format</strong> then click <strong>Download</strong>.</li>
                  <li>The file is prepared on the server and a download link appears automatically.</li>
                </ol>
              </HelpSection>
              <HelpDivider />
              <HelpSection icon="📋" title="Playlist Download">
                <ol style={{ paddingLeft: 18, margin: 0 }}>
                  <li>Go to the <strong>Playlist</strong> tab and select <strong>Playlist / Channel</strong>.</li>
                  <li>Paste a YouTube playlist or channel URL.</li>
                  <li>Optionally set start/end video indexes, quality and format.</li>
                  <li>Click <strong>Download Playlist</strong> — videos are queued and downloaded concurrently.</li>
                </ol>
              </HelpSection>
              <HelpDivider />
              <HelpSection icon="📄" title="Batch Download">
                <ol style={{ paddingLeft: 18, margin: 0 }}>
                  <li>Go to the <strong>Playlist</strong> tab and select <strong>Batch URLs</strong>.</li>
                  <li>Paste any text containing video URLs — from any source or mixed with other text. URLs are detected and arranged automatically regardless of how they were copied.</li>
                  <li>Up to <strong>50 URLs</strong> per batch are supported.</li>
                  <li>Choose quality and format, then click <strong>Start Batch Download</strong>.</li>
                </ol>
              </HelpSection>
              <HelpDivider />
              <HelpSection icon="✂" title="Edit &amp; Convert">
                <ul style={{ paddingLeft: 18, margin: 0 }}>
                  <li><strong>Convert</strong> — change format or resolution (e.g. mp4 → mp3, 1080p → 480p).</li>
                  <li><strong>Trim</strong> — cut a video to a start/end time range.</li>
                  <li><strong>Merge Audio</strong> — overlay a separate audio file onto a video.</li>
                  <li><strong>Batch Convert</strong> — convert multiple files with the same settings at once.</li>
                </ul>
              </HelpSection>
              <HelpDivider />
              <HelpSection icon="📁" title="File Manager">
                All processed files are listed here. Preview in the built-in player, download, or delete files to free up server space.
              </HelpSection>
              <HelpDivider />
              <HelpSection icon="↕" title="Moving the Help Button">
                Drag the <strong>?</strong> button to any corner of the screen. A short tap/click opens this guide; a longer press-and-drag repositions it.
              </HelpSection>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function HelpSection({ icon, title, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 700, color: '#dc2626', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>{icon}</span> {title}
      </div>
      <div>{children}</div>
    </div>
  )
}

function HelpDivider() {
  return <hr style={{ border: 'none', borderTop: '1px solid #1f2937', margin: '12px 0' }} />
}
