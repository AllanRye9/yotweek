function StatCard({ icon, label, value, sub, color = 'blue' }) {
  const colors = {
    blue:   'bg-blue-900/30 border-blue-800/50 text-blue-400',
    green:  'bg-green-900/30 border-green-800/50 text-green-400',
    red:    'bg-red-900/30 border-red-800/50 text-red-400',
    yellow: 'bg-yellow-900/30 border-yellow-800/50 text-yellow-400',
    purple: 'bg-purple-900/30 border-purple-800/50 text-purple-400',
    gray:   'bg-gray-800/60 border-gray-700 text-gray-400',
  }
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl">{icon}</span>
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white">{value ?? '—'}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  )
}

function pct(n, d) {
  if (!d) return '0%'
  return `${(n / d * 100).toFixed(1)}%`
}

export default function AdminStats({ analytics }) {
  if (!analytics) return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-gray-800 bg-gray-900 p-4 h-24 animate-pulse" />
      ))}
    </div>
  )

  const {
    total_downloads = 0,
    completed_count = 0,
    failed_count = 0,
    cancelled_count = 0,
    daily_downloads = 0,
    download_rate_per_day = 0,
    total_site_visitors = 0,
    daily_site_visitors = 0,
    unique_countries_total = 0,
    success_rate = 0,   // already a percentage (0–100)
    avg_file_size_hr,
    repeat_rate = 0,    // already a percentage (0–100)
    unique_visitors = 0,
  } = analytics

  // Active downloads are not part of analytics; show completed/failed/cancelled
  const active_downloads = total_downloads - completed_count - failed_count - cancelled_count

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
        <StatCard icon="📥" label="Total Downloads"   value={total_downloads.toLocaleString()}   color="blue" />
        <StatCard icon="✓"  label="Completed"         value={completed_count.toLocaleString()} color="green" sub={pct(completed_count, total_downloads)} />
        <StatCard icon="⚡" label="Active / Queued"   value={Math.max(0, active_downloads).toLocaleString()} color="yellow" />
        <StatCard icon="✗"  label="Failed"            value={failed_count.toLocaleString()}  color="red" sub={pct(failed_count, total_downloads)} />
        <StatCard icon="📅" label="Daily Downloads"   value={daily_downloads.toLocaleString()}  color="purple" />
        <StatCard icon="📈" label="Rate / Day"        value={typeof download_rate_per_day === 'number' ? download_rate_per_day.toFixed(1) : download_rate_per_day} color="purple" />
        <StatCard icon="👥" label="Total Visitors"    value={total_site_visitors.toLocaleString()} color="blue" />
        <StatCard icon="🌅" label="Daily Visitors"    value={daily_site_visitors.toLocaleString()} color="blue" />
        <StatCard icon="🌍" label="Countries"         value={unique_countries_total.toLocaleString()} color="green" />
        <StatCard icon="🎯" label="Success Rate"      value={`${Number(success_rate).toFixed(1)}%`} color="green" />
        <StatCard icon="📦" label="Avg File Size"     value={avg_file_size_hr || '—'} color="gray" />
        <StatCard icon="🔁" label="Repeat Visitors"   value={`${Number(repeat_rate).toFixed(1)}%`} color="gray" />
      </div>
    </div>
  )
}
