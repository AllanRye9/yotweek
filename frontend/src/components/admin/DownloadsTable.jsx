import { useState, useMemo } from 'react'

function StatusBadge({ status }) {
  const cls = {
    completed:   'badge-success',
    downloading: 'badge-info',
    queued:      'badge-warning',
    failed:      'badge-error',
    cancelled:   'badge-gray',
  }[status] || 'badge-gray'
  return <span className={cls}>{status}</span>
}

function TypeBadge({ type }) {
  const map = {
    video:          { cls: 'badge-info',    label: '🎬 Video'    },
    playlist:       { cls: 'badge-info',    label: '📋 Playlist' },
    doc_conversion: { cls: 'badge-warning', label: '📁 Document' },
    cv_generation:  { cls: 'badge-warning', label: '📄 CV'       },
    upload:         { cls: 'badge-gray',    label: '📤 Upload'   },
    edit_output:    { cls: 'badge-gray',    label: '✂ Edit'      },
  }
  const { cls, label } = map[type] || { cls: 'badge-gray', label: type || '—' }
  return <span className={cls}>{label}</span>
}

// Classify a record into a broad category for the type filter
function _category(r) {
  const t = r.type || ''
  if (t === 'doc_conversion' || t === 'cv_generation') return 'document'
  if (t === 'playlist') return 'playlist'
  if (t === 'edit_output' || t === 'upload') return 'edit'
  return 'video'
}

export default function DownloadsTable({ downloads, loading, onCancel, onDelete }) {
  const [search, setSearch]               = useState('')
  const [sortBy, setSortBy]               = useState('created_at')
  const [sortDir, setSortDir]             = useState('desc')
  const [filter, setFilter]               = useState('all')
  const [typeFilter, setTypeFilter]       = useState('all')
  const [countryFilter, setCountryFilter] = useState('all')
  const [dateFrom, setDateFrom]           = useState('')
  const [dateTo, setDateTo]               = useState('')

  const countries = useMemo(() => {
    const set = new Set((downloads || []).map(r => r.country).filter(Boolean))
    return Array.from(set).sort()
  }, [downloads])

  const filtered = useMemo(() => {
    let rows = [...(downloads || [])]
    if (filter !== 'all') rows = rows.filter(r => r.status === filter)
    if (typeFilter !== 'all') rows = rows.filter(r => _category(r) === typeFilter)
    if (countryFilter !== 'all') rows = rows.filter(r => r.country === countryFilter)
    if (search) {
      const q = search.toLowerCase()
      rows = rows.filter(r =>
        (r.title || '').toLowerCase().includes(q) ||
        (r.url   || '').toLowerCase().includes(q) ||
        (r.ip    || '').includes(q) ||
        (r.country || '').toLowerCase().includes(q)
      )
    }
    if (dateFrom) {
      const from = new Date(dateFrom).getTime()
      rows = rows.filter(r => r.created_at && r.created_at * 1000 >= from)
    }
    if (dateTo) {
      const to = new Date(dateTo).getTime() + 86400000 // inclusive end of day
      rows = rows.filter(r => r.created_at && r.created_at * 1000 <= to)
    }
    rows.sort((a, b) => {
      let va = a[sortBy] ?? '', vb = b[sortBy] ?? ''
      if (typeof va === 'number') return sortDir === 'asc' ? va - vb : vb - va
      return sortDir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
    })
    return rows
  }, [downloads, search, sortBy, sortDir, filter, typeFilter, countryFilter, dateFrom, dateTo])

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('desc') }
  }

  const Th = ({ col, label }) => (
    <th
      className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-3 py-3 cursor-pointer hover:text-white whitespace-nowrap select-none"
      onClick={() => toggleSort(col)}
    >
      {label} {sortBy === col ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </th>
  )

  if (loading) return <div className="flex justify-center py-20"><span className="spinner w-10 h-10" /></div>

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4 flex-wrap">
        <input
          className="input flex-1 text-sm min-w-[160px]"
          placeholder="Search title, URL, IP, country…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          className="input sm:w-44 text-sm"
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
        >
          <option value="all">All types</option>
          <option value="video">🎬 Video / Audio</option>
          <option value="playlist">📋 Playlist</option>
          <option value="document">📁 Documents &amp; CV</option>
          <option value="edit">✂ Edits / Uploads</option>
        </select>
        <select
          className="input sm:w-44 text-sm"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="completed">Completed</option>
          <option value="downloading">Downloading</option>
          <option value="queued">Queued</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          className="input sm:w-44 text-sm"
          value={countryFilter}
          onChange={e => setCountryFilter(e.target.value)}
        >
          <option value="all">All countries</option>
          {countries.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input
          type="date"
          className="input text-sm"
          title="From date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
        />
        <input
          type="date"
          className="input text-sm"
          title="To date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
        />
      </div>
      <p className="text-xs text-gray-600 mb-3">{filtered.length} records</p>

      {/* Table (desktop) */}
      <div className="hidden md:block overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 border-b border-gray-800">
            <tr>
              <Th col="title"      label="Title" />
              <Th col="type"       label="Type" />
              <Th col="status"     label="Status" />
              <Th col="file_size_hr" label="Size" />
              <Th col="created_at" label="Date" />
              <Th col="country"    label="Country" />
              <Th col="ip"         label="IP" />
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {filtered.map(row => (
              <tr key={row.id} className="hover:bg-gray-800/40 transition-colors">
                <td className="px-3 py-3 max-w-xs">
                  <p className="font-medium text-white truncate" title={row.title}>{row.title || '—'}</p>
                  {row.url && row.url !== 'doc_conversion' && row.url !== 'cv_generation' && (
                    <a href={row.url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-gray-500 hover:text-blue-400 truncate block max-w-xs">
                      {row.url}
                    </a>
                  )}
                </td>
                <td className="px-3 py-3"><TypeBadge type={row.type} /></td>
                <td className="px-3 py-3"><StatusBadge status={row.status} /></td>
                <td className="px-3 py-3 text-gray-400">{row.file_size_hr || '—'}</td>
                <td className="px-3 py-3 text-gray-500 whitespace-nowrap">
                  {row.created_at ? new Date(row.created_at * 1000).toLocaleString() : '—'}
                </td>
                <td className="px-3 py-3 text-gray-400">{row.country || '—'}</td>
                <td className="px-3 py-3 text-gray-600 font-mono text-xs">{row.ip || '—'}</td>
                <td className="px-3 py-3">
                  <div className="flex gap-1.5">
                    {(row.status === 'queued' || row.status === 'downloading') && (
                      <button className="btn-ghost btn-sm text-xs" onClick={() => onCancel(row.id)}>✕ Cancel</button>
                    )}
                    <button className="btn-danger btn-sm text-xs" onClick={() => onDelete(row.id)}>🗑</button>
                  </div>
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr><td colSpan={8} className="text-center py-10 text-gray-600">No records found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Cards (mobile) */}
      <div className="md:hidden space-y-3">
        {filtered.map(row => (
          <div key={row.id} className="card">
            <div className="flex items-start justify-between gap-2 mb-2">
              <p className="font-medium text-white text-sm leading-snug flex-1">{row.title || row.url || row.id}</p>
              <div className="flex flex-col gap-1 items-end">
                <TypeBadge type={row.type} />
                <StatusBadge status={row.status} />
              </div>
            </div>
            <div className="text-xs text-gray-500 space-y-0.5 mb-3">
              {row.file_size_hr && <p>📦 {row.file_size_hr}</p>}
              {row.country      && <p>🌍 {row.country}</p>}
              {row.ip           && <p>🔌 {row.ip}</p>}
              {row.created_at   && <p>📅 {new Date(row.created_at * 1000).toLocaleString()}</p>}
            </div>
            <div className="flex gap-2">
              {(row.status === 'queued' || row.status === 'downloading') && (
                <button className="btn-ghost btn-sm text-xs flex-1" onClick={() => onCancel(row.id)}>Cancel</button>
              )}
              <button className="btn-danger btn-sm text-xs" onClick={() => onDelete(row.id)}>🗑 Delete</button>
            </div>
          </div>
        ))}
        {!filtered.length && (
          <p className="text-center py-10 text-gray-600">No records found</p>
        )}
      </div>
    </div>
  )
}
