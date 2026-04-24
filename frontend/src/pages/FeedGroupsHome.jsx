/**
 * FeedGroupsHome — Default landing page combining Feed and Group Travels.
 *
 * Authenticated users land here by default.
 * Unauthenticated users see a login prompt.
 * Dashboard is accessible via the NavBar.
 */

import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { getUserProfile } from '../api'
import NavBar from '../components/NavBar'
import UserAuth from '../components/UserAuth'
import { getDashboardPath } from '../routing'

const FeedPageInner  = lazy(() => import('./FeedPage'))
const GroupTripsInner = lazy(() => import('./GroupTripsPage'))

const TABS = [
  { id: 'feed',        icon: '📰', label: 'Feed'         },
  { id: 'group-trips', icon: '✈️',  label: 'Group Trips'  },
]

export default function FeedGroupsHome() {
  const navigate = useNavigate()
  const [tab,           setTab]           = useState('feed')
  const [user,          setUser]          = useState(null)   // null=loading, false=guest
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [checking,      setChecking]      = useState(true)

  useEffect(() => {
    getUserProfile()
      .then(u => { setUser(u); setChecking(false) })
      .catch(() => { setUser(false); setChecking(false) })
  }, [])

  if (checking) return null

  // Unauthenticated landing
  if (!user) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-page)', display: 'flex', flexDirection: 'column' }}>
        {showAuthModal && (
          <UserAuth
            onSuccess={u => { setUser(u); setShowAuthModal(false) }}
            onClose={() => setShowAuthModal(false)}
          />
        )}

        {/* Simple navbar for guests */}
        <header
          className="sticky top-0 z-50 border-b"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
        >
          <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-3">
            <Link to="/" className="flex items-center gap-2 shrink-0 font-bold text-lg">
              <img src="/yotweek.png" alt="" width={22} height={22} style={{ borderRadius: 4 }} aria-hidden="true" />
              <span className="gradient-text hidden sm:inline">yotweek</span>
            </Link>
            <div className="flex-1" />
            <button
              onClick={() => setShowAuthModal(true)}
              className="text-xs px-3 py-1.5 rounded-lg font-medium bg-amber-500 hover:bg-amber-400 text-black transition-colors"
            >
              Sign In
            </button>
          </div>
        </header>

        <main className="flex-1 flex flex-col items-center justify-center px-4 py-16 text-center">
          <div style={{ fontSize: '3rem', marginBottom: 16 }}>🌍</div>
          <h1 className="text-2xl font-bold mb-3" style={{ color: 'var(--text-primary)' }}>
            Driver Community Feed
          </h1>
          <p className="text-sm mb-6 max-w-md" style={{ color: 'var(--text-muted)' }}>
            Share travel experiences, route insights, and connect with fellow drivers.
            Sign in to join the conversation.
          </p>
          <div className="flex gap-3 flex-wrap justify-center">
            <button
              onClick={() => setShowAuthModal(true)}
              className="px-6 py-2.5 rounded-xl font-semibold text-sm transition-colors"
              style={{ background: 'var(--accent, #f59e0b)', color: 'var(--accent-text, #000)' }}
            >
              Create Free Account
            </button>
            <button
              onClick={() => setShowAuthModal(true)}
              className="px-5 py-2.5 rounded-xl text-sm border transition-colors"
              style={{ border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
            >
              Sign In
            </button>
          </div>

          {/* Feature teaser */}
          <div className="mt-14 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl w-full text-left">
            {[
              { icon: '📰', title: 'Community Feed',      desc: 'Read and share travel logs, photos, events, and polls with the community.' },
              { icon: '✈️',  title: 'Group Trips',         desc: 'Organise group travels, coordinate ideas, and manage trip checklists.' },
              { icon: '🚗', title: 'Ride Sharing',         desc: 'Post rides, find drivers, and connect in real time.' },
              { icon: '📌', title: 'Pinned Highlights',    desc: 'Admins curate the most important content right at the top of the feed.' },
            ].map(f => (
              <div key={f.icon} className="rounded-xl p-4 border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
                <div style={{ fontSize: '1.5rem', marginBottom: 6 }}>{f.icon}</div>
                <div className="font-semibold text-sm mb-1" style={{ color: 'var(--text-primary)' }}>{f.title}</div>
                <div className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </main>
      </div>
    )
  }

  // Authenticated view — Feed + Group Trips
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-page)', display: 'flex', flexDirection: 'column' }}>
      <NavBar
        user={user}
        onLogout={() => { setUser(false); navigate('/') }}
        title={tab === 'feed' ? 'Feed' : 'Group Trips'}
      />

      {/* Tab strip */}
      <div
        className="sticky z-40 border-b"
        style={{ top: 56, background: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
      >
        <div className="max-w-5xl mx-auto px-4 flex gap-1 pt-2 pb-0">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '8px 18px',
                borderRadius: '8px 8px 0 0',
                border: `1px solid ${tab === t.id ? 'var(--border-color)' : 'transparent'}`,
                borderBottom: tab === t.id ? `2px solid var(--accent, #f59e0b)` : '2px solid transparent',
                background: tab === t.id ? 'var(--bg-card)' : 'transparent',
                color: tab === t.id ? 'var(--text-primary)' : 'var(--text-muted)',
                fontSize: '0.88rem',
                fontWeight: tab === t.id ? 700 : 400,
                cursor: 'pointer',
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}

          {/* Dashboard link in tab bar */}
          <div className="flex-1" />
          <Link
            to={getDashboardPath(user)}
            style={{
              alignSelf: 'center',
              marginBottom: 2,
              padding: '5px 14px',
              borderRadius: 8,
              border: '1px solid var(--border-color)',
              color: 'var(--text-secondary)',
              fontSize: '0.8rem',
              textDecoration: 'none',
              transition: 'opacity 0.15s',
            }}
          >
            🏠 Dashboard
          </Link>
        </div>
      </div>

      {/* Tab content — lazy loaded; each page manages its own NavBar internally so we suppress it here
          by rendering the pages inside a wrapper that hides duplicate nav */}
      <div style={{ flex: 1 }}>
        <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>}>
          {tab === 'feed'        && <FeedInline  user={user} />}
          {tab === 'group-trips' && <TripsInline user={user} />}
        </Suspense>
      </div>
    </div>
  )
}

// ─── Inline wrappers that re-use the page logic without the NavBar ─────────────

import { getFeed, createPost, likePost, savePost, sharePost, getTrendingFeed,
         hidePostForMe, adminPinPost, adminHidePost, adminDeletePostGlobal, adminEditPost } from '../api'
import { getGroupTrips, createGroupTrip, joinGroupTrip, leaveGroupTrip,
         getTripIdeas, addTripIdea, voteTripIdea,
         getTripChecklist, addChecklistItem, toggleChecklistItem } from '../api'
import { useAuth } from '../App'

// ─── Shared post types ────────────────────────────────────────────────────────
const POST_TYPES   = ['all', 'travel_log', 'photo', 'event', 'poll']
const TYPE_LABELS  = { all: 'All', travel_log: 'Travel Logs', photo: 'Photos', event: 'Events', poll: 'Polls' }
const TYPE_COLORS  = {
  travel_log: { bg: 'rgba(59,130,246,0.15)',  color: '#60a5fa', border: 'rgba(59,130,246,0.3)'  },
  photo:      { bg: 'rgba(16,185,129,0.15)',  color: '#34d399', border: 'rgba(16,185,129,0.3)'  },
  event:      { bg: 'rgba(245,158,11,0.15)',  color: '#fbbf24', border: 'rgba(245,158,11,0.3)'  },
  poll:       { bg: 'rgba(139,92,246,0.15)',  color: '#a78bfa', border: 'rgba(139,92,246,0.3)'  },
}

function TypeBadge({ type }) {
  const s = TYPE_COLORS[type] || { bg: 'rgba(107,114,128,0.15)', color: 'var(--text-muted)', border: 'var(--border-color)' }
  return (
    <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: s.bg, color: s.color, border: `1px solid ${s.border}`, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {type?.replace('_', ' ') || 'post'}
    </span>
  )
}

function PostCard({ post, onLike, onSave, onShare, onHide, isAdmin, onAdminAction }) {
  const [liked,  setLiked]  = useState(post.liked_by_me  || false)
  const [saved,  setSaved]  = useState(post.saved_by_me  || false)
  const [likes,  setLikes]  = useState(post.likes_count  || 0)
  const [saves,  setSaves]  = useState(post.saves_count  || 0)
  const [shares, setShares] = useState(post.shares_count || 0)
  const [busy,   setBusy]   = useState(false)
  const [hidden, setHidden] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editContent, setEditContent] = useState(post.content)
  const [pinned, setPinned] = useState(!!post.pinned)

  const handleLike = async () => { if (busy) return; setBusy(true); try { await onLike(post.post_id); setLiked(v=>!v); setLikes(v=>liked?v-1:v+1) } catch {} finally { setBusy(false) } }
  const handleSave = async () => { if (busy) return; setBusy(true); try { await onSave(post.post_id); setSaved(v=>!v); setSaves(v=>saved?v-1:v+1) } catch {} finally { setBusy(false) } }
  const handleShare = async () => { if (busy) return; setBusy(true); try { await onShare(post.post_id); setShares(v=>v+1) } catch {} finally { setBusy(false) } }
  const handleHide = async () => { if (busy) return; setBusy(true); try { await onHide(post.post_id); setHidden(true) } catch {} finally { setBusy(false) } }

  const handleAdminPin = async () => { try { const r = await adminPinPost(post.post_id); setPinned(r.pinned); onAdminAction?.() } catch {} }
  const handleAdminHide = async () => { try { await adminHidePost(post.post_id); onAdminAction?.() } catch {} }
  const handleAdminDelete = async () => { if (!confirm('Permanently delete this post for all users?')) return; try { await adminDeletePostGlobal(post.post_id); setHidden(true); onAdminAction?.() } catch {} }
  const handleAdminEdit = async () => { if (!editContent.trim()) return; try { await adminEditPost(post.post_id, { content: editContent.trim() }); setEditMode(false); onAdminAction?.() } catch {} }

  if (hidden) return null
  const fmtDate = s => { try { return new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return s } }

  return (
    <article style={{ background: 'var(--bg-card)', border: `1px solid ${pinned ? 'rgba(245,158,11,0.5)' : 'var(--border-color)'}`, borderRadius: 16, padding: '16px 20px', marginBottom: 12, position: 'relative' }}>
      {pinned && <div style={{ position: 'absolute', top: 10, right: 12, fontSize: '0.68rem', fontWeight: 700, color: '#fbbf24', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 9999, padding: '1px 8px' }}>📌 Pinned</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#b45309', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#fef3c7', fontSize: '0.9rem', flexShrink: 0, overflow: 'hidden' }}>
          {post.author_avatar ? <img src={post.author_avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (post.author_name||'U')[0].toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>{post.author_name||'Unknown'}</p>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>{fmtDate(post.created_at)}</p>
        </div>
        <TypeBadge type={post.post_type} />
        <button onClick={handleHide} disabled={busy} title="Hide from my feed" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem', padding: '2px 6px', borderRadius: 6, lineHeight: 1 }}>✕</button>
      </div>
      {post.title && <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>{post.title}</h3>}
      {editMode ? (
        <div style={{ marginBottom: 12 }}>
          <textarea value={editContent} onChange={e=>setEditContent(e.target.value)} rows={4} style={{ width: '100%', background: 'var(--bg-input,var(--bg-surface))', border: '1px solid var(--border-color)', borderRadius: 8, padding: '8px 12px', color: 'var(--text-primary)', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box', resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button onClick={handleAdminEdit} style={{ padding: '5px 14px', borderRadius: 7, border: 'none', background: 'var(--accent,#f59e0b)', color: '#000', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer' }}>Save</button>
            <button onClick={()=>setEditMode(false)} style={{ padding: '5px 14px', borderRadius: 7, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.8rem', cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      ) : (
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: 12 }}>{post.content}</p>
      )}
      {post.image_url && <img src={post.image_url} alt="" style={{ width: '100%', borderRadius: 10, marginBottom: 12, maxHeight: 320, objectFit: 'cover' }} />}
      <div style={{ display: 'flex', gap: 4, borderTop: '1px solid var(--border-color)', paddingTop: 10, flexWrap: 'wrap' }}>
        {[
          { icon: liked?'❤️':'🤍', label: likes,  action: handleLike,  active: liked,  color: '#f87171' },
          { icon: saved?'🔖':'📎', label: saves,  action: handleSave,  active: saved,  color: '#fbbf24' },
          { icon: '↗️',             label: shares, action: handleShare, active: false,  color: '#60a5fa' },
        ].map((btn,i) => (
          <button key={i} onClick={btn.action} disabled={busy}
            style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 10px', borderRadius:8, border:'1px solid var(--border-color)', background: btn.active?`${btn.color}18`:'transparent', color: btn.active?btn.color:'var(--text-muted)', fontSize:'0.82rem', cursor:'pointer', fontWeight: btn.active?600:400, transition:'all 0.15s' }}>
            <span>{btn.icon}</span><span>{btn.label}</span>
          </button>
        ))}
        {isAdmin && (
          <div style={{ marginLeft:'auto', display:'flex', gap:4 }}>
            <button onClick={handleAdminPin}    title={pinned?'Unpin':'Pin'}         style={{ padding:'5px 9px', borderRadius:7, border:'1px solid rgba(245,158,11,0.4)',  background: pinned?'rgba(245,158,11,0.15)':'transparent', color:'#fbbf24',              fontSize:'0.78rem', cursor:'pointer' }}>📌</button>
            <button onClick={()=>setEditMode(true)} title="Edit"                     style={{ padding:'5px 9px', borderRadius:7, border:'1px solid rgba(96,165,250,0.4)',  background:'rgba(96,165,250,0.1)',                         color:'#60a5fa',              fontSize:'0.78rem', cursor:'pointer' }}>✏️</button>
            <button onClick={handleAdminHide}   title="Toggle global hide"           style={{ padding:'5px 9px', borderRadius:7, border:'1px solid rgba(107,114,128,0.4)', background:'transparent',                                  color:'var(--text-muted)',    fontSize:'0.78rem', cursor:'pointer' }}>🚫</button>
            <button onClick={handleAdminDelete} title="Delete globally"              style={{ padding:'5px 9px', borderRadius:7, border:'1px solid rgba(248,113,113,0.4)', background:'rgba(248,113,113,0.1)',                         color:'#f87171',              fontSize:'0.78rem', cursor:'pointer' }}>🗑</button>
          </div>
        )}
      </div>
    </article>
  )
}

function CreatePostForm({ onCreated }) {
  const [content, setContent] = useState('')
  const [type,    setType]    = useState('travel_log')
  const [title,   setTitle]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!content.trim()) return
    setLoading(true); setError('')
    try {
      const post = await createPost({ content: content.trim(), title: title.trim() || undefined, post_type: type })
      setContent(''); setTitle('')
      onCreated?.(post)
    } catch (err) { setError(err.message || 'Failed to post.') } finally { setLoading(false) }
  }

  const fs = { width: '100%', background: 'var(--bg-input,var(--bg-surface))', border: '1px solid var(--border-color)', borderRadius: 8, padding: '9px 12px', color: 'var(--text-primary)', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }

  return (
    <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 16, padding: '16px 20px', marginBottom: 16 }}>
      <h2 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>✍️ Share Something</h2>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {POST_TYPES.slice(1).map(t => (
            <button key={t} type="button" onClick={() => setType(t)} style={{ padding: '4px 12px', borderRadius: 9999, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', border: `1px solid ${type===t?(TYPE_COLORS[t]?.border||'var(--border-color)'):'var(--border-color)'}`, background: type===t?(TYPE_COLORS[t]?.bg||'transparent'):'transparent', color: type===t?(TYPE_COLORS[t]?.color||'var(--text-primary)'):'var(--text-muted)', transition: 'all 0.15s' }}>
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        <input type="text" placeholder="Title (optional)" value={title} onChange={e=>setTitle(e.target.value)} maxLength={120} style={fs} />
        <textarea placeholder="What's on your travel mind?" value={content} onChange={e=>setContent(e.target.value)} rows={3} required maxLength={2000} style={{ ...fs, resize: 'vertical', minHeight: 80 }} />
        {error && <p style={{ fontSize: '0.8rem', color: '#f87171' }}>{error}</p>}
        <button type="submit" disabled={loading||!content.trim()} style={{ alignSelf: 'flex-end', padding: '8px 22px', borderRadius: 8, border: 'none', background: content.trim()?'var(--accent,#f59e0b)':'var(--border-color)', color: content.trim()?'var(--accent-text,#000)':'var(--text-muted)', fontSize: '0.88rem', fontWeight: 600, cursor: content.trim()?'pointer':'default' }}>
          {loading ? 'Posting…' : 'Post'}
        </button>
      </form>
    </section>
  )
}

function TrendingSidebar({ trending }) {
  if (!trending?.length) return null
  return (
    <aside style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 16, padding: '16px 20px', marginBottom: 16 }}>
      <h2 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>🔥 Trending</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {trending.slice(0, 5).map((item, i) => (
          <div key={item.post_id||i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-muted)', minWidth: 20 }}>{i+1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title||item.content?.slice(0,50)||'Post'}</p>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>❤️ {item.likes_count||0}</p>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}

function FeedInline({ user }) {
  const { admin } = useAuth()
  const [posts,    setPosts]    = useState([])
  const [trending, setTrending] = useState([])
  const [filter,   setFilter]   = useState('all')
  const [page,     setPage]     = useState(1)
  const [hasMore,  setHasMore]  = useState(true)
  const [loading,  setLoading]  = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error,    setError]    = useState('')

  useEffect(() => {
    getTrendingFeed().then(d => setTrending(d.posts || d || [])).catch(() => {})
  }, [])

  const loadPosts = useCallback(async (pg, ft, replace = false) => {
    if (replace) setLoading(true); else setLoadingMore(true)
    setError('')
    try {
      const params = { page: pg, per_page: 10 }
      if (ft !== 'all') params.post_type = ft
      const data = await getFeed(params)
      const list = data.posts || data || []
      setPosts(prev => replace ? list : [...prev, ...list])
      setHasMore(list.length >= 10)
    } catch (err) { setError(err.message || 'Failed to load feed.')
    } finally { if (replace) setLoading(false); else setLoadingMore(false) }
  }, [])

  useEffect(() => { setPage(1); loadPosts(1, filter, true) }, [filter]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleHidePost = async (postId) => { await hidePostForMe(postId); setPosts(prev => prev.filter(p => p.post_id !== postId)) }

  return (
    <main style={{ flex: 1, maxWidth: 1100, width: '100%', margin: '0 auto', padding: '16px 16px 40px', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {POST_TYPES.map(t => (
          <button key={t} onClick={() => setFilter(t)} style={{ padding: '6px 14px', borderRadius: 9999, fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', border: `1px solid ${filter===t?'var(--accent,#f59e0b)':'var(--border-color)'}`, background: filter===t?'var(--accent,#f59e0b)':'transparent', color: filter===t?'var(--accent-text,#000)':'var(--text-secondary)', transition: 'all 0.15s' }}>
            {TYPE_LABELS[t]}
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 280px', gap: 20, alignItems: 'start' }}>
        <div>
          <CreatePostForm onCreated={post => setPosts(prev => [post, ...prev])} />
          {loading && <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>Loading…</div>}
          {!loading && error && <div style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 12, padding: '12px 16px', color: '#f87171', fontSize: '0.85rem', marginBottom: 12 }}>{error}</div>}
          {!loading && !error && posts.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
              <p style={{ fontSize: '2rem', marginBottom: 8 }}>🌍</p>
              <p>No posts yet. Be the first to share!</p>
            </div>
          )}
          {posts.map(post => (
            <PostCard key={post.post_id} post={post} onLike={likePost} onSave={savePost} onShare={sharePost} onHide={handleHidePost} isAdmin={!!admin} onAdminAction={() => loadPosts(1, filter, true)} />
          ))}
          {hasMore && !loading && posts.length > 0 && (
            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <button onClick={() => { const n = page+1; setPage(n); loadPosts(n, filter, false) }} disabled={loadingMore} style={{ padding: '9px 28px', borderRadius: 10, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: '0.88rem', fontWeight: 600, cursor: loadingMore?'default':'pointer' }}>
                {loadingMore ? 'Loading…' : 'Load More'}
              </button>
            </div>
          )}
        </div>
        <div style={{ position: 'sticky', top: 100 }}>
          <TrendingSidebar trending={trending} />
        </div>
      </div>
    </main>
  )
}

// ─── Group Trips inline ────────────────────────────────────────────────────────

function IdeasPanel({ tripId }) {
  const [ideas,   setIdeas]   = useState([])
  const [text,    setText]    = useState('')
  const [loading, setLoading] = useState(true)
  const [adding,  setAdding]  = useState(false)

  useEffect(() => { getTripIdeas(tripId).then(d => setIdeas(d.ideas||d||[])).catch(()=>setIdeas([])).finally(()=>setLoading(false)) }, [tripId])
  const handleAdd = async (e) => { e.preventDefault(); if (!text.trim()) return; setAdding(true); try { const idea = await addTripIdea(tripId,{title:text.trim()}); setIdeas(prev=>[...prev,idea]); setText('') } catch {} finally { setAdding(false) } }
  const handleVote = async (ideaId,val) => { try { const u = await voteTripIdea(tripId,ideaId,{vote:val}); setIdeas(prev=>prev.map(i=>i.idea_id===ideaId?{...i,...(u.idea||u)}:i)) } catch {} }
  const fs = { flex:1, background:'var(--bg-input,var(--bg-surface))', border:'1px solid var(--border-color)', borderRadius:8, padding:'7px 10px', color:'var(--text-primary)', fontSize:'0.85rem', outline:'none' }
  return (
    <div style={{ marginTop:14 }}>
      <h4 style={{ fontSize:'0.75rem', fontWeight:700, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>💡 Ideas</h4>
      {loading && <p style={{ fontSize:'0.82rem', color:'var(--text-muted)' }}>Loading…</p>}
      {!loading && ideas.length===0 && <p style={{ fontSize:'0.82rem', color:'var(--text-muted)' }}>No ideas yet. Add one!</p>}
      <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:10 }}>
        {ideas.map(idea => (
          <div key={idea.idea_id} style={{ display:'flex', alignItems:'center', gap:8, background:'var(--bg-surface)', borderRadius:8, padding:'8px 12px', border:'1px solid var(--border-color)' }}>
            <span style={{ flex:1, fontSize:'0.85rem', color:'var(--text-primary)' }}>{idea.title}</span>
            <div style={{ display:'flex', gap:4, alignItems:'center' }}>
              <button onClick={()=>handleVote(idea.idea_id,1)}  style={{ padding:'2px 8px', borderRadius:6, border:'1px solid rgba(16,185,129,0.3)',  background:'rgba(16,185,129,0.1)',  color:'#34d399', cursor:'pointer', fontSize:'0.8rem' }}>▲ {idea.votes_up||0}</button>
              <button onClick={()=>handleVote(idea.idea_id,-1)} style={{ padding:'2px 8px', borderRadius:6, border:'1px solid rgba(248,113,113,0.3)', background:'rgba(248,113,113,0.1)', color:'#f87171', cursor:'pointer', fontSize:'0.8rem' }}>▼ {idea.votes_down||0}</button>
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={handleAdd} style={{ display:'flex', gap:8 }}>
        <input type="text" placeholder="Add an idea…" value={text} onChange={e=>setText(e.target.value)} maxLength={200} style={fs} />
        <button type="submit" disabled={adding||!text.trim()} style={{ padding:'7px 14px', borderRadius:8, border:'none', background:'var(--accent,#f59e0b)', color:'var(--accent-text,#000)', fontWeight:600, fontSize:'0.82rem', cursor:text.trim()?'pointer':'default', opacity:text.trim()?1:0.5 }}>{adding?'…':'Add'}</button>
      </form>
    </div>
  )
}

function ChecklistPanel({ tripId }) {
  const [items,   setItems]   = useState([])
  const [text,    setText]    = useState('')
  const [loading, setLoading] = useState(true)
  const [adding,  setAdding]  = useState(false)
  useEffect(() => { getTripChecklist(tripId).then(d=>setItems(d.checklist||d||[])).catch(()=>setItems([])).finally(()=>setLoading(false)) }, [tripId])
  const handleAdd = async (e) => { e.preventDefault(); if(!text.trim()) return; setAdding(true); try { const item = await addChecklistItem(tripId,{text:text.trim()}); setItems(prev=>[...prev,item]); setText('') } catch {} finally { setAdding(false) } }
  const handleToggle = async (itemId) => { try { const u = await toggleChecklistItem(tripId,itemId); setItems(prev=>prev.map(i=>i.item_id===itemId?{...i,...(u.item||u)}:i)) } catch {} }
  const fs = { flex:1, background:'var(--bg-input,var(--bg-surface))', border:'1px solid var(--border-color)', borderRadius:8, padding:'7px 10px', color:'var(--text-primary)', fontSize:'0.85rem', outline:'none' }
  return (
    <div style={{ marginTop:14 }}>
      <h4 style={{ fontSize:'0.75rem', fontWeight:700, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>✅ Checklist</h4>
      {loading && <p style={{ fontSize:'0.82rem', color:'var(--text-muted)' }}>Loading…</p>}
      {!loading && items.length===0 && <p style={{ fontSize:'0.82rem', color:'var(--text-muted)' }}>No items yet.</p>}
      <div style={{ display:'flex', flexDirection:'column', gap:5, marginBottom:10 }}>
        {items.map(item => (
          <label key={item.item_id} style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', background:'var(--bg-surface)', borderRadius:8, padding:'7px 12px', border:'1px solid var(--border-color)' }}>
            <input type="checkbox" checked={!!item.done} onChange={()=>handleToggle(item.item_id)} style={{ accentColor:'var(--accent,#f59e0b)', width:15, height:15 }} />
            <span style={{ fontSize:'0.85rem', color:item.done?'var(--text-muted)':'var(--text-primary)', textDecoration:item.done?'line-through':'none' }}>{item.text}</span>
          </label>
        ))}
      </div>
      <form onSubmit={handleAdd} style={{ display:'flex', gap:8 }}>
        <input type="text" placeholder="Add item…" value={text} onChange={e=>setText(e.target.value)} maxLength={200} style={fs} />
        <button type="submit" disabled={adding||!text.trim()} style={{ padding:'7px 14px', borderRadius:8, border:'none', background:'var(--accent,#f59e0b)', color:'var(--accent-text,#000)', fontWeight:600, fontSize:'0.82rem', cursor:text.trim()?'pointer':'default', opacity:text.trim()?1:0.5 }}>{adding?'…':'Add'}</button>
      </form>
    </div>
  )
}

function TripCard({ trip, currentUserId, onJoin, onLeave }) {
  const [expanded, setExpanded] = useState(false)
  const [busy,     setBusy]     = useState(false)
  const isMember = (trip.members||[]).some(m=>(m.user_id||m)===currentUserId)
  const fmtDate = s => { try { return new Date(s).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) } catch { return s } }
  const handleJoinLeave = async () => { setBusy(true); try { if(isMember){await onLeave(trip.trip_id)}else{await onJoin(trip.trip_id)} } catch {} finally { setBusy(false) } }
  return (
    <article style={{ background:'var(--bg-card)', border:'1px solid var(--border-color)', borderRadius:16, padding:'16px 20px', marginBottom:12 }}>
      <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:4 }}>
            <h3 style={{ fontSize:'1rem', fontWeight:700, color:'var(--text-primary)', margin:0 }}>{trip.title}</h3>
            {trip.destination && <span style={{ fontSize:'0.75rem', color:'var(--text-muted)', display:'flex', alignItems:'center', gap:3 }}>📍 {trip.destination}</span>}
          </div>
          {trip.description && <p style={{ fontSize:'0.85rem', color:'var(--text-secondary)', margin:'4px 0 8px', lineHeight:1.45 }}>{trip.description}</p>}
          <div style={{ display:'flex', gap:12, flexWrap:'wrap', fontSize:'0.75rem', color:'var(--text-muted)' }}>
            {trip.start_date && <span>📅 {fmtDate(trip.start_date)}{trip.end_date?` → ${fmtDate(trip.end_date)}`:''}</span>}
            <span>👥 {(trip.members||[]).length}{trip.max_members?`/${trip.max_members}`:''} members</span>
            <span style={{ fontSize:'0.7rem', padding:'1px 8px', borderRadius:9999, background:trip.status==='open'?'rgba(16,185,129,0.15)':'rgba(107,114,128,0.15)', color:trip.status==='open'?'#34d399':'var(--text-muted)', border:`1px solid ${trip.status==='open'?'rgba(16,185,129,0.3)':'var(--border-color)'}` }}>{trip.status||'open'}</span>
          </div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:6, flexShrink:0 }}>
          <button onClick={handleJoinLeave} disabled={busy} style={{ padding:'6px 14px', borderRadius:8, border:`1px solid ${isMember?'rgba(248,113,113,0.4)':'rgba(16,185,129,0.4)'}`, background:isMember?'rgba(248,113,113,0.1)':'rgba(16,185,129,0.1)', color:isMember?'#f87171':'#34d399', fontSize:'0.82rem', fontWeight:600, cursor:busy?'default':'pointer' }}>{isMember?'Leave':'Join'}</button>
          <button onClick={()=>setExpanded(v=>!v)} style={{ padding:'6px 14px', borderRadius:8, border:'1px solid var(--border-color)', background:'transparent', color:'var(--text-secondary)', fontSize:'0.82rem', cursor:'pointer' }}>{expanded?'▲ Less':'▼ More'}</button>
        </div>
      </div>
      {expanded && (
        <div style={{ borderTop:'1px solid var(--border-color)', marginTop:14, paddingTop:14 }}>
          <div style={{ marginBottom:14 }}>
            <h4 style={{ fontSize:'0.75rem', fontWeight:700, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>👥 Members</h4>
            {(trip.members||[]).length===0 ? <p style={{ fontSize:'0.82rem', color:'var(--text-muted)' }}>No members yet.</p> : (
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {(trip.members||[]).map((m,i) => <span key={i} style={{ fontSize:'0.8rem', padding:'3px 10px', borderRadius:9999, background:'var(--bg-surface)', border:'1px solid var(--border-color)', color:'var(--text-secondary)' }}>{m.name||m.user_id?.slice(0,8)||m}</span>)}
              </div>
            )}
          </div>
          <IdeasPanel tripId={trip.trip_id} />
          <ChecklistPanel tripId={trip.trip_id} />
        </div>
      )}
    </article>
  )
}

function CreateTripForm({ onCreated, onCancel }) {
  const [fields, setFields] = useState({ title:'', description:'', destination:'', start_date:'', end_date:'', max_members:'' })
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const setF = (k,v) => setFields(prev=>({...prev,[k]:v}))
  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true); setError('')
    try {
      const data = { title:fields.title.trim(), description:fields.description.trim()||undefined, destination:fields.destination.trim()||undefined, start_date:fields.start_date||undefined, end_date:fields.end_date||undefined, max_members:fields.max_members?parseInt(fields.max_members,10):undefined }
      const trip = await createGroupTrip(data)
      onCreated?.(trip)
    } catch (err) { setError(err.message||'Failed to create trip.') } finally { setLoading(false) }
  }
  const fs = { width:'100%', background:'var(--bg-input,var(--bg-surface))', border:'1px solid var(--border-color)', borderRadius:8, padding:'9px 12px', color:'var(--text-primary)', fontSize:'0.9rem', outline:'none', boxSizing:'border-box' }
  return (
    <div style={{ background:'var(--bg-card)', border:'1px solid var(--border-color)', borderRadius:16, padding:'20px 24px', marginBottom:16 }}>
      <h2 style={{ fontSize:'0.78rem', fontWeight:700, color:'var(--text-secondary)', marginBottom:14, textTransform:'uppercase', letterSpacing:'0.06em' }}>🗺️ New Group Trip</h2>
      <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', gap:10 }}>
        <input type="text" placeholder="Trip title *" value={fields.title} onChange={e=>setF('title',e.target.value)} required maxLength={120} style={fs} />
        <input type="text" placeholder="Destination" value={fields.destination} onChange={e=>setF('destination',e.target.value)} maxLength={120} style={fs} />
        <textarea placeholder="Description (optional)" value={fields.description} onChange={e=>setF('description',e.target.value)} rows={2} maxLength={500} style={{ ...fs, resize:'vertical', minHeight:60 }} />
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <div><label style={{ fontSize:'0.75rem', color:'var(--text-muted)', display:'block', marginBottom:3 }}>Start Date</label><input type="date" value={fields.start_date} onChange={e=>setF('start_date',e.target.value)} style={fs} /></div>
          <div><label style={{ fontSize:'0.75rem', color:'var(--text-muted)', display:'block', marginBottom:3 }}>End Date</label><input type="date" value={fields.end_date} onChange={e=>setF('end_date',e.target.value)} style={fs} /></div>
        </div>
        <input type="number" placeholder="Max members (optional)" value={fields.max_members} onChange={e=>setF('max_members',e.target.value)} min={2} max={100} style={fs} />
        {error && <p style={{ fontSize:'0.8rem', color:'#f87171' }}>{error}</p>}
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button type="button" onClick={onCancel} style={{ padding:'8px 18px', borderRadius:8, border:'1px solid var(--border-color)', background:'transparent', color:'var(--text-secondary)', fontSize:'0.88rem', cursor:'pointer' }}>Cancel</button>
          <button type="submit" disabled={loading||!fields.title.trim()} style={{ padding:'8px 22px', borderRadius:8, border:'none', background:fields.title.trim()?'var(--accent,#f59e0b)':'var(--border-color)', color:fields.title.trim()?'var(--accent-text,#000)':'var(--text-muted)', fontSize:'0.88rem', fontWeight:600, cursor:fields.title.trim()?'pointer':'default' }}>{loading?'Creating…':'Create Trip'}</button>
        </div>
      </form>
    </div>
  )
}

function TripsInline({ user }) {
  const [trips,      setTrips]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const loadTrips = useCallback(async () => {
    setLoading(true); setError('')
    try { const data = await getGroupTrips(); setTrips(data.trips||data||[]) }
    catch (err) { setError(err.message||'Failed to load trips.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadTrips() }, [loadTrips])

  const handleJoin  = async (tripId) => { await joinGroupTrip(tripId);  loadTrips() }
  const handleLeave = async (tripId) => { await leaveGroupTrip(tripId); loadTrips() }

  return (
    <main style={{ flex:1, maxWidth:860, width:'100%', margin:'0 auto', padding:'16px 16px 40px', boxSizing:'border-box' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
        <h1 style={{ fontSize:'1.3rem', fontWeight:700, color:'var(--text-primary)', margin:0 }}>🗺️ Group Trips</h1>
        {!showCreate && (
          <button onClick={()=>setShowCreate(true)} style={{ padding:'8px 18px', borderRadius:10, border:'none', background:'var(--accent,#f59e0b)', color:'var(--accent-text,#000)', fontWeight:600, fontSize:'0.88rem', cursor:'pointer' }}>+ New Trip</button>
        )}
      </div>
      {showCreate && <CreateTripForm onCreated={trip=>{setTrips(prev=>[trip,...prev]);setShowCreate(false)}} onCancel={()=>setShowCreate(false)} />}
      {loading && <div style={{ textAlign:'center', padding:'40px 0', color:'var(--text-muted)' }}>Loading…</div>}
      {!loading && error && <div style={{ background:'rgba(248,113,113,0.1)', border:'1px solid rgba(248,113,113,0.3)', borderRadius:12, padding:'12px 16px', color:'#f87171', fontSize:'0.85rem', marginBottom:12 }}>{error}</div>}
      {!loading && !error && trips.length===0 && (
        <div style={{ textAlign:'center', padding:'60px 0', color:'var(--text-muted)' }}>
          <p style={{ fontSize:'2.5rem', marginBottom:12 }}>✈️</p>
          <p style={{ fontSize:'1rem', marginBottom:6 }}>No group trips yet.</p>
          <p style={{ fontSize:'0.85rem' }}>Create one and invite fellow travellers!</p>
        </div>
      )}
      {trips.map(trip => (
        <TripCard key={trip.trip_id} trip={trip} currentUserId={user?.user_id} onJoin={handleJoin} onLeave={handleLeave} />
      ))}
    </main>
  )
}
