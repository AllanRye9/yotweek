import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getFeed, createPost, likePost, savePost, sharePost, getTrendingFeed, getUserProfile } from '../api'
import NavBar from '../components/NavBar'

const POST_TYPES = ['all', 'travel_log', 'photo', 'event', 'poll']
const TYPE_LABELS = { all: 'All', travel_log: 'Travel Logs', photo: 'Photos', event: 'Events', poll: 'Polls' }
const TYPE_COLORS = {
  travel_log: { bg: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: 'rgba(59,130,246,0.3)' },
  photo:      { bg: 'rgba(16,185,129,0.15)', color: '#34d399', border: 'rgba(16,185,129,0.3)' },
  event:      { bg: 'rgba(245,158,11,0.15)', color: '#fbbf24', border: 'rgba(245,158,11,0.3)' },
  poll:       { bg: 'rgba(139,92,246,0.15)', color: '#a78bfa', border: 'rgba(139,92,246,0.3)' },
}

function TypeBadge({ type }) {
  const s = TYPE_COLORS[type] || { bg: 'rgba(107,114,128,0.15)', color: 'var(--text-muted)', border: 'var(--border-color)' }
  return (
    <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: s.bg, color: s.color, border: `1px solid ${s.border}`, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {type?.replace('_', ' ') || 'post'}
    </span>
  )
}

function PostCard({ post, onLike, onSave, onShare }) {
  const [liked,  setLiked]  = useState(post.liked_by_me  || false)
  const [saved,  setSaved]  = useState(post.saved_by_me  || false)
  const [likes,  setLikes]  = useState(post.likes_count  || 0)
  const [saves,  setSaves]  = useState(post.saves_count  || 0)
  const [shares, setShares] = useState(post.shares_count || 0)
  const [busy,   setBusy]   = useState(false)

  const handleLike = async () => {
    if (busy) return
    setBusy(true)
    try {
      await onLike(post.post_id)
      setLiked(v => !v)
      setLikes(v => liked ? v - 1 : v + 1)
    } catch {} finally { setBusy(false) }
  }

  const handleSave = async () => {
    if (busy) return
    setBusy(true)
    try {
      await onSave(post.post_id)
      setSaved(v => !v)
      setSaves(v => saved ? v - 1 : v + 1)
    } catch {} finally { setBusy(false) }
  }

  const handleShare = async () => {
    if (busy) return
    setBusy(true)
    try {
      await onShare(post.post_id)
      setShares(v => v + 1)
    } catch {} finally { setBusy(false) }
  }

  const fmtDate = (s) => {
    try { return new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
    catch { return s }
  }

  return (
    <article style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 16, padding: '16px 20px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#b45309', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#fef3c7', fontSize: '0.9rem', flexShrink: 0, overflow: 'hidden' }}>
          {post.author_avatar ? (
            <img src={post.author_avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            (post.author_name || 'U')[0].toUpperCase()
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>{post.author_name || 'Unknown'}</p>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>{fmtDate(post.created_at)}</p>
        </div>
        <TypeBadge type={post.post_type} />
      </div>

      {post.title && (
        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>{post.title}</h3>
      )}
      <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: 12 }}>{post.content}</p>

      {post.image_url && (
        <img src={post.image_url} alt="" style={{ width: '100%', borderRadius: 10, marginBottom: 12, maxHeight: 320, objectFit: 'cover' }} />
      )}

      <div style={{ display: 'flex', gap: 4, borderTop: '1px solid var(--border-color)', paddingTop: 10 }}>
        {[
          { icon: liked ? '❤️' : '🤍', label: likes,  action: handleLike,  active: liked,  color: '#f87171' },
          { icon: saved ? '🔖' : '📎', label: saves,  action: handleSave,  active: saved,  color: '#fbbf24' },
          { icon: '↗️',                label: shares, action: handleShare, active: false,  color: '#60a5fa' },
        ].map((btn, i) => (
          <button
            key={i}
            onClick={btn.action}
            disabled={busy}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 8,
              border: '1px solid var(--border-color)', background: btn.active ? `${btn.color}18` : 'transparent',
              color: btn.active ? btn.color : 'var(--text-muted)', fontSize: '0.82rem', cursor: 'pointer',
              fontWeight: btn.active ? 600 : 400, transition: 'all 0.15s',
            }}
          >
            <span>{btn.icon}</span>
            <span>{btn.label}</span>
          </button>
        ))}
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
    setLoading(true)
    setError('')
    try {
      const post = await createPost({ content: content.trim(), title: title.trim() || undefined, post_type: type })
      setContent('')
      setTitle('')
      onCreated?.(post)
    } catch (err) {
      setError(err.message || 'Failed to post.')
    } finally {
      setLoading(false)
    }
  }

  const fs = { width: '100%', background: 'var(--bg-input, var(--bg-surface))', border: '1px solid var(--border-color)', borderRadius: 8, padding: '9px 12px', color: 'var(--text-primary)', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }

  return (
    <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 16, padding: '16px 20px', marginBottom: 16 }}>
      <h2 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>✍️ Share Something</h2>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {POST_TYPES.slice(1).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              style={{
                padding: '4px 12px', borderRadius: 9999, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${type === t ? (TYPE_COLORS[t]?.border || 'var(--border-color)') : 'var(--border-color)'}`,
                background: type === t ? (TYPE_COLORS[t]?.bg || 'transparent') : 'transparent',
                color: type === t ? (TYPE_COLORS[t]?.color || 'var(--text-primary)') : 'var(--text-muted)',
                transition: 'all 0.15s',
              }}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Title (optional)"
          value={title}
          onChange={e => setTitle(e.target.value)}
          maxLength={120}
          style={fs}
        />
        <textarea
          placeholder="What's on your travel mind?"
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={3}
          required
          maxLength={2000}
          style={{ ...fs, resize: 'vertical', minHeight: 80 }}
        />
        {error && <p style={{ fontSize: '0.8rem', color: '#f87171' }}>{error}</p>}
        <button
          type="submit"
          disabled={loading || !content.trim()}
          style={{ alignSelf: 'flex-end', padding: '8px 22px', borderRadius: 8, border: 'none', background: content.trim() ? 'var(--accent, #f59e0b)' : 'var(--border-color)', color: content.trim() ? 'var(--accent-text, #000)' : 'var(--text-muted)', fontSize: '0.88rem', fontWeight: 600, cursor: content.trim() ? 'pointer' : 'default' }}
        >
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
          <div key={item.post_id || i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-muted)', minWidth: 20 }}>{i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.title || item.content?.slice(0, 50) || 'Post'}
              </p>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>❤️ {item.likes_count || 0}</p>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}

export default function FeedPage() {
  const navigate = useNavigate()
  const [user,     setUser]     = useState(null)
  const [posts,    setPosts]    = useState([])
  const [trending, setTrending] = useState([])
  const [filter,   setFilter]   = useState('all')
  const [page,     setPage]     = useState(1)
  const [hasMore,  setHasMore]  = useState(true)
  const [loading,  setLoading]  = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error,    setError]    = useState('')

  useEffect(() => {
    getUserProfile().then(setUser).catch(() => {})
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
    } catch (err) {
      setError(err.message || 'Failed to load feed.')
    } finally {
      if (replace) setLoading(false); else setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    setPage(1)
    loadPosts(1, filter, true)
  }, [filter]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLoadMore = () => {
    const nextPage = page + 1
    setPage(nextPage)
    loadPosts(nextPage, filter, false)
  }

  const handleNewPost = (post) => {
    setPosts(prev => [post, ...prev])
  }

  const handleLogout = async () => { navigate('/') }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-page)', display: 'flex', flexDirection: 'column' }}>
      <NavBar user={user} onLogout={handleLogout} title="Feed" />
      <main style={{ flex: 1, maxWidth: 1100, width: '100%', margin: '0 auto', padding: '16px 16px 40px', boxSizing: 'border-box' }}>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          {POST_TYPES.map(t => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              style={{
                padding: '6px 14px', borderRadius: 9999, fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${filter === t ? 'var(--accent, #f59e0b)' : 'var(--border-color)'}`,
                background: filter === t ? 'var(--accent, #f59e0b)' : 'transparent',
                color: filter === t ? 'var(--accent-text, #000)' : 'var(--text-secondary)',
                transition: 'all 0.15s',
              }}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 280px', gap: 20, alignItems: 'start' }}>
            {/* Main feed column */}
            <div>
              <CreatePostForm onCreated={handleNewPost} />

              {loading && (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>Loading…</div>
              )}
              {!loading && error && (
                <div style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 12, padding: '12px 16px', color: '#f87171', fontSize: '0.85rem', marginBottom: 12 }}>{error}</div>
              )}
              {!loading && !error && posts.length === 0 && (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                  <p style={{ fontSize: '2rem', marginBottom: 8 }}>🌍</p>
                  <p>No posts yet. Be the first to share!</p>
                </div>
              )}

              {posts.map(post => (
                <PostCard
                  key={post.post_id}
                  post={post}
                  onLike={likePost}
                  onSave={savePost}
                  onShare={sharePost}
                />
              ))}

              {hasMore && !loading && posts.length > 0 && (
                <div style={{ textAlign: 'center', marginTop: 8 }}>
                  <button
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    style={{ padding: '9px 28px', borderRadius: 10, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: '0.88rem', fontWeight: 600, cursor: loadingMore ? 'default' : 'pointer' }}
                  >
                    {loadingMore ? 'Loading…' : 'Load More'}
                  </button>
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div style={{ position: 'sticky', top: 72 }}>
              <TrendingSidebar trending={trending} />
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
