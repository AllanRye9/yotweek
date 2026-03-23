import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../App'
import DownloadForm from '../components/DownloadForm'
import ActiveDownloads from '../components/ActiveDownloads'
import FileList from '../components/FileList'
import Reviews from '../components/Reviews'
import ThemeSelector from '../components/ThemeSelector'
import CVGenerator from '../components/CVGenerator'
import DocConverter from '../components/DocConverter'
import { getStats } from '../api'
import socket from '../socket'

/** Animate a numeric counter from its previous value to a new target.
 * @param {number|null} target - The target number to animate toward.
 * @param {number} duration - Animation duration in milliseconds (default 1800).
 * @returns {number} The current animated display value.
 */
function useAnimatedCounter(target, duration = 1800) {
  const [display, setDisplay] = useState(0)
  const prevRef = useRef(0)
  const rafRef  = useRef(null)

  useEffect(() => {
    if (target == null) return
    const start = prevRef.current
    const diff  = target - start
    if (diff === 0) return
    const t0 = performance.now()
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const tick = (now) => {
      const p    = Math.min((now - t0) / duration, 1)
      const ease = 1 - Math.pow(1 - p, 3) // cubic ease-out
      setDisplay(Math.round(start + diff * ease))
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        prevRef.current = target
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [target, duration])

  return display
}

/** Displays a labelled stat that animates from 0 (or its prior value) to `value`.
 * @param {Object} props
 * @param {number} props.value - The numeric value to display.
 * @param {string} props.label - The caption shown below the number.
 * @param {string} props.icon  - Emoji icon shown before the number.
 */
function AnimatedCounter({ value, label, icon }) {
  const count = useAnimatedCounter(value ?? 0)
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-2xl sm:text-3xl font-bold text-white tabular-nums">
        {icon} {count.toLocaleString()}
      </span>
      <span className="text-xs text-gray-400 uppercase tracking-wide">{label}</span>
    </div>
  )
}

const TABS = [
  { id: 'download', label: '⬇ Download',     icon: '⬇' },
  { id: 'cv',       label: '📄 CV Generator', icon: '📄' },
  { id: 'convert',  label: '🔄 Doc Converter', icon: '🔄' },
]

export default function Home() {
  const { admin } = useAuth()
  const [tab, setTab] = useState('download')
  const [stats, setStats] = useState(null)
  const [connected, setConnected] = useState(false)
  const [fileListVersion, setFileListVersion] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  // ── Feature-card spotlight animation ──────────────────────────────────────
  // Cycles the rainbow border glow through the 3 feature cards one per second.
  // After every complete cycle (3 advances) a random card gets a coin-flip.
  const [activeGlowIndex, setActiveGlowIndex] = useState(0)
  const [flipIndex, setFlipIndex]             = useState(-1)
  const glowCycleCount = useRef(0)
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveGlowIndex(prev => {
        const next = (prev + 1) % 3
        glowCycleCount.current += 1
        // After each full cycle through all 3 cards, randomly flip one card.
        if (glowCycleCount.current % 3 === 0) {
          const idx = Math.floor(Math.random() * 3)
          setFlipIndex(idx)
          setTimeout(() => setFlipIndex(-1), 800)
        }
        return next
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // Ref to ActiveDownloads so we can call subscribeToDownload on it
  const activeDownloadsRef = useRef(null)

  // Intersection Observer for scroll-reveal animations
  const featuresRef = useRef(null)
  useEffect(() => {
    const el = featuresRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.querySelectorAll('.feature-card-animate').forEach(card => {
              card.classList.add('in-view')
            })
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.15 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

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

  // Called by DownloadForm/PlaylistForm when a download is queued.
  // Subscribes to the socket.io room for the download and shows the popup.
  const handleDownloadStarted = useCallback(({ download_id, title } = {}) => {
    if (download_id) {
      activeDownloadsRef.current?.subscribeToDownload(download_id, title)
    }
    refreshFiles()
  }, [refreshFiles])

  // Ref attached to the file list section so we can scroll to it after a download completes
  const fileListRef = useRef(null)
  // Debounce timer for the scroll-to-file-list action so concurrent completions don't
  // trigger multiple redundant scroll operations.
  const scrollTimerRef = useRef(null)

  const handleDownloadDone = useCallback(() => {
    refreshFiles()
    // Debounce: if several downloads finish close together, only scroll once.
    // The 600 ms delay lets the file list re-render before we scroll to it.
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => {
      fileListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 600)
  }, [refreshFiles])

  const handleFeatureCardClick = useCallback((action) => {
    action()
    document.querySelector('main')?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* ── Navbar ── */}
      <nav className="sticky top-0 z-50 bg-gray-950/95 backdrop-blur border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 flex items-center h-14 gap-4">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 text-xl font-bold text-white shrink-0">
            <img src="/yotweek.png" alt="" width={22} height={22} style={{ borderRadius: 4 }} aria-hidden="true" />
            <span className="gradient-text hidden sm:inline">yotweek</span>
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
            <Link to="/const" className="btn-secondary btn-sm hidden sm:inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
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
                className="flex items-center gap-2 text-sm text-gray-400 hover:text-white py-1"
                onClick={() => setMenuOpen(false)}
              >
                <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                🛠 Admin Dashboard
              </Link>
            )}
            {!admin && (
              <Link
                to="/admin/login"
                className="flex items-center gap-2 text-sm text-gray-500 hover:text-white py-1"
                onClick={() => setMenuOpen(false)}
              >
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold bg-green-900/40 text-green-400 border border-green-700/40">Admin</span>
                Login
              </Link>
            )}
          </div>
        )}
      </nav>

      {/* ── Hero ── */}
      <div className="bg-gradient-to-b from-gray-900 to-gray-950 border-b border-gray-800 py-[19px] sm:py-[27px] px-4">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2 hero-animate-title">
            Download <span className="gradient-text">Any Video</span> — Free &amp; Fast
          </h1>
          <p className="text-gray-400 text-xs sm:text-sm hero-animate-sub">
            YouTube, TikTok, Instagram, Twitter, Facebook &amp; 1,000+ sites &bull; Document Converter (Word, Excel, PowerPoint, PDF &amp; more) &bull; CV Maker &amp; Generator &bull; No sign-up required.
          </p>

          {/* Animated global stats counters */}
          {stats && (
            <div className="mt-5 flex justify-center gap-10 sm:gap-16 hero-animate-stats">
              <AnimatedCounter
                value={stats.total_downloads}
                label="Total Downloads"
                icon="⬇"
              />
              <div className="w-px bg-gray-700 self-stretch" />
              <AnimatedCounter
                value={stats.total_visitors}
                label="Total Visitors"
                icon="👥"
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Animated Features Showcase ── */}
      <div ref={featuresRef} className="border-b border-gray-800 bg-gray-900/40 py-5 px-4 overflow-hidden">
        <div className="max-w-5xl mx-auto">
          <p className="text-center text-xs text-gray-500 uppercase tracking-widest mb-4 font-semibold">What you can do</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              {
                icon: '🎬',
                title: 'Video Downloads',
                desc: 'Download from YouTube, TikTok, Instagram, Twitter & 1,000+ sites in any quality or format.',
                action: () => setTab('download'),
                label: 'Try it →',
              },
              {
                icon: '📄',
                title: 'CV Generator',
                desc: 'Build a professional CV with 8 beautiful themes, live preview, and one-click PDF export.',
                action: () => setTab('cv'),
                label: 'Make a CV →',
              },
              {
                icon: '🔄',
                title: 'Doc Converter',
                desc: 'Convert PDF, Word, Excel, PowerPoint, JPEG and PNG files to any format — instantly.',
                action: () => setTab('convert'),
                label: 'Convert a file →',
              },
            ].map((f, i) => (
              <button
                key={i}
                className={[
                  'feature-card-animate text-left bg-gray-900 border border-gray-800 rounded-xl p-4',
                  'hover:border-gray-600 hover:bg-gray-800/70 transition-all duration-200',
                  'group focus:outline-none focus:ring-2 focus:ring-red-500/50',
                  activeGlowIndex === i ? 'card-glow-active' : '',
                  flipIndex === i ? 'card-flip-active' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => handleFeatureCardClick(f.action)}
              >
                <div className="text-3xl mb-3 feature-icon-float" style={{ animationDelay: `${i * 0.4}s` }}>{f.icon}</div>
                <h3 className="text-sm font-semibold text-white mb-1">{f.title}</h3>
                <p className="text-xs text-gray-400 leading-relaxed mb-3">{f.desc}</p>
                <span className="text-xs font-semibold text-red-400 group-hover:text-red-300 transition-colors">{f.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Main Content ── */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 pt-[15px] sm:pt-[19px] pb-20 sm:pb-8">
        {/* Tab buttons */}
        <div className="flex gap-2 mb-[15px] overflow-x-auto pb-1 scrollbar-thin">
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
          {tab === 'download' && <DownloadForm onDownloadStarted={handleDownloadStarted} />}
          {tab === 'cv'       && <CVGenerator />}
          {tab === 'convert'  && <DocConverter />}
        </div>

        {/* Active Downloads — only relevant when download tab is active */}
        {tab === 'download' && (
          <div className="mt-[19px]">
            <ActiveDownloads ref={activeDownloadsRef} onComplete={refreshFiles} onDownloadDone={handleDownloadDone} />
          </div>
        )}

        {/* File List */}
        <div className="mt-[19px]" ref={fileListRef}>
          <FileList version={fileListVersion} />
        </div>

        {/* Reviews */}
        <div className="mt-[27px]">
          <Reviews />
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-gray-800 py-6 px-4 pb-safe text-center text-xs text-gray-600">
        <p>
          yotweek © {new Date().getFullYear()} — Download responsibly. Respect copyright laws.
        </p>
        <p className="mt-1">
          <a href="mailto:support@yotweek.com" className="hover:text-gray-400 transition-colors">
            support@yotweek.com
          </a>
          {!admin && (
            <>
              {' · '}
              <Link to="/admin/login" className="inline-flex items-center gap-1 hover:opacity-80 transition-opacity">
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold bg-green-900/40 text-green-400 border border-green-700/40">Admin</span>
              </Link>
            </>
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
          position: 'fixed',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
          right: 24,
          zIndex: 9000,
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
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
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
                ❓ yotweek — Help Guide
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
              <HelpSection icon="📄" title="CV Generator">
                <ol style={{ paddingLeft: 18, margin: 0 }}>
                  <li>Switch to the <strong>CV Generator</strong> tab.</li>
                  <li>Step through the wizard — Personal Info, Summary, Experience, Education, Skills, Extras, and Theme.</li>
                  <li>Watch the <strong>live preview</strong> update on the right as you type.</li>
                  <li>Choose from 8 professional themes, optionally add a logo, then click <strong>Generate PDF CV</strong>.</li>
                  <li>Use <strong>← Previous</strong> to go back and edit any earlier step.</li>
                </ol>
              </HelpSection>
              <HelpDivider />
              <HelpSection icon="🔄" title="Doc Converter">
                <ol style={{ paddingLeft: 18, margin: 0 }}>
                  <li>Switch to the <strong>Doc Converter</strong> tab.</li>
                  <li>Upload a PDF, Word (.docx), Excel (.xlsx), JPEG, or PNG file.</li>
                  <li>Choose the target format (e.g. PDF → Word, JPEG → PDF).</li>
                  <li>Click <strong>Convert &amp; Download</strong> to receive the converted file.</li>
                </ol>
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
