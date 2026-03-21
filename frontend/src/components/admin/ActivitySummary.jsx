import { useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

const STATUS_ICON = {
  completed:   { icon: '✓', color: 'text-green-400',  bg: 'bg-green-900/30'  },
  downloading: { icon: '⚡', color: 'text-blue-400',   bg: 'bg-blue-900/30'   },
  queued:      { icon: '⏰', color: 'text-yellow-400', bg: 'bg-yellow-900/30' },
  failed:      { icon: '✗', color: 'text-red-400',    bg: 'bg-red-900/30'    },
  cancelled:   { icon: '✕', color: 'text-gray-400',   bg: 'bg-gray-800/60'   },
}

function timeAgo(ts) {
  if (!ts) return ''
  const diff = Math.floor(Date.now() / 1000 - ts)
  if (diff < 60)   return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

/* Mini 7-day trend area chart */
function TrendMini({ downloads }) {
  const data = useMemo(() => {
    const now = Date.now() / 1000
    const buckets = Array(7).fill(0)
    ;(downloads || []).forEach(d => {
      const ts = d.created_at
      if (!ts) return
      const daysAgo = Math.floor((now - ts) / 86400)
      if (daysAgo >= 0 && daysAgo < 7) buckets[6 - daysAgo]++
    })
    const labels = ['6d','5d','4d','3d','2d','1d','Today']
    return buckets.map((v, i) => ({ day: labels[i], count: v }))
  }, [downloads])

  const hasData = data.some(d => d.count > 0)
  if (!hasData) return (
    <p className="text-xs text-gray-600 py-4 text-center">No downloads in the last 7 days</p>
  )

  return (
    <ResponsiveContainer width="100%" height={90}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: -30, bottom: 0 }}>
        <defs>
          <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
        <XAxis dataKey="day" tick={{ fill: '#6b7280', fontSize: 10 }} />
        <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} allowDecimals={false} />
        <Tooltip
          contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
          formatter={v => [v, 'Downloads']}
        />
        <Area type="monotone" dataKey="count" stroke="#ef4444" fill="url(#trendGrad)" strokeWidth={2} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export default function ActivitySummary({ downloads, analytics }) {
  const recent = useMemo(() =>
    [...(downloads || [])]
      .filter(d => d.created_at)
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, 8),
  [downloads])

  const activeCount  = useMemo(() => (downloads || []).filter(d => d.status === 'downloading').length, [downloads])
  const queuedCount  = useMemo(() => (downloads || []).filter(d => d.status === 'queued').length,      [downloads])

  const todayStart = useMemo(() => {
    const d = new Date(); d.setHours(0,0,0,0); return d.getTime() / 1000
  }, [])
  const todayCount = useMemo(() =>
    (downloads || []).filter(d => d.created_at >= todayStart).length,
  [downloads, todayStart])

  const successRate = analytics?.success_rate ?? null

  return (
    <div className="space-y-6 mt-6">
      {/* Section heading */}
      <div className="flex items-center gap-2">
        <span className="text-lg">📋</span>
        <h2 className="text-base font-semibold text-white">Activity Summary</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 7-day trend */}
        <div className="card lg:col-span-2">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">Downloads – Last 7 Days</p>
          <TrendMini downloads={downloads} />
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-lg font-bold text-white">{todayCount}</p>
              <p className="text-xs text-gray-500">Today</p>
            </div>
            <div>
              <p className="text-lg font-bold text-yellow-400">{queuedCount}</p>
              <p className="text-xs text-gray-500">Queued</p>
            </div>
            <div>
              <p className="text-lg font-bold text-blue-400">{activeCount}</p>
              <p className="text-xs text-gray-500">Active</p>
            </div>
          </div>
        </div>

        {/* Quick stats text */}
        <div className="card space-y-3">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">At a Glance</p>
          <div className="space-y-2.5 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Total downloads</span>
              <span className="font-semibold text-white">{(analytics?.total_downloads ?? (downloads || []).length).toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Success rate</span>
              <span className={`font-semibold ${
                successRate === null ? 'text-gray-400' :
                successRate >= 80 ? 'text-green-400' :
                successRate >= 50 ? 'text-yellow-400' : 'text-red-400'
              }`}>
                {successRate !== null ? `${Number(successRate).toFixed(1)}%` : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Total visitors</span>
              <span className="font-semibold text-white">{(analytics?.total_site_visitors ?? 0).toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Unique countries</span>
              <span className="font-semibold text-white">{(analytics?.unique_countries_total ?? 0).toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Repeat visitors</span>
              <span className="font-semibold text-white">
                {analytics?.repeat_rate != null ? `${Number(analytics.repeat_rate).toFixed(1)}%` : '—'}
              </span>
            </div>
            {analytics?.avg_file_size_hr && (
              <div className="flex justify-between">
                <span className="text-gray-400">Avg file size</span>
                <span className="font-semibold text-white">{analytics.avg_file_size_hr}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent activity feed */}
      {recent.length > 0 && (
        <div className="card">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">Recent Activity</p>
          <ul className="divide-y divide-gray-800">
            {recent.map(d => {
              const { icon, color, bg } = STATUS_ICON[d.status] || STATUS_ICON.cancelled
              return (
                <li key={d.id} className="flex items-center gap-3 py-2.5">
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${bg} ${color}`}>
                    {icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{d.title || d.url || d.id}</p>
                    <p className="text-xs text-gray-500">
                      {d.status}
                      {d.country ? ` · ${d.country}` : ''}
                      {d.file_size_hr ? ` · ${d.file_size_hr}` : ''}
                    </p>
                  </div>
                  <span className="text-xs text-gray-600 shrink-0">{timeAgo(d.created_at)}</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
