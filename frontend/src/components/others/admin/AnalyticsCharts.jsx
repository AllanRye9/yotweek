import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area,
} from 'recharts'
import VisitorMap from './VisitorMap'

const COLORS = ['#ef4444','#3b82f6','#10b981','#f59e0b','#8b5cf6','#06b6d4','#f97316','#ec4899']

function SectionHeading({ icon, title }) {
  return (
    <div className="flex items-center gap-2 mb-4 mt-8 first:mt-0">
      <span className="text-lg">{icon}</span>
      <h2 className="text-base font-semibold text-white">{title}</h2>
      <div className="flex-1 h-px bg-gray-800 ml-2" />
    </div>
  )
}

function ChartCard({ title, children, wide = false }) {
  return (
    <div className={`card ${wide ? 'col-span-full' : ''}`}>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">{title}</h3>
      {children}
    </div>
  )
}

function NoData() {
  return <p className="text-center text-gray-600 text-sm py-6">No data yet</p>
}

const TOOLTIP_STYLE = { background: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }

/* ── Daily Downloads Area Chart ── */
function DailyDownloadsChart({ data }) {
  if (!Array.isArray(data) || !data.length) return <NoData />
  const chartData = data.map((v, i) => ({ day: `${i + 1}`, downloads: v }))
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="dlGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis dataKey="day" tick={{ fill: '#6b7280', fontSize: 10 }} interval={4} />
        <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Area type="monotone" dataKey="downloads" stroke="#ef4444" fill="url(#dlGrad)" strokeWidth={2} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

/* ── Status Breakdown Donut ── */
function StatusPieChart({ analytics }) {
  const data = [
    { name: 'Completed', value: analytics?.completed_count || 0 },
    { name: 'Failed',    value: analytics?.failed_count    || 0 },
    { name: 'Cancelled', value: analytics?.cancelled_count || 0 },
  ].filter(d => d.value > 0)
  if (!data.length) return <NoData />
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={data} cx="50%" cy="50%" innerRadius={55} outerRadius={85} dataKey="value"
          label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
        </Pie>
        <Tooltip contentStyle={TOOLTIP_STYLE} />
      </PieChart>
    </ResponsiveContainer>
  )
}

/* ── Simple bar chart ── */
function SimpleBar({ data, color = '#ef4444', height = 200 }) {
  if (!data?.length) return <NoData />
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 10 }} />
        <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Bar dataKey="value" fill={color} radius={[4,4,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/* ── Multi-color bar chart ── */
function ColorBar({ data, height = 200 }) {
  if (!data?.length) return <NoData />
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 10 }} />
        <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Bar dataKey="value" radius={[4,4,0,0]}>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export default function AnalyticsCharts({ analytics, downloadsTrend }) {
  if (!analytics) return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, s) => (
        <div key={s}>
          <div className="h-6 w-48 bg-gray-800 rounded animate-pulse mb-4" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="card h-64 animate-pulse bg-gray-800" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )

  const {
    peak_hours = [],
    visitor_hours = [],
    os_breakdown = [],
    device_breakdown = [],
    dow_downloads = [],
    review_ratings = [],
    download_countries = [],
    visitor_countries = [],
    format_preferences = [],
  } = analytics

  const peakData         = peak_hours.map((v, i) => ({ name: `${i}h`, value: v }))
  const visitorHoursData = visitor_hours.map((v, i) => ({ name: `${i}h`, value: v }))
  const DOW_NAMES        = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
  const dowData          = dow_downloads.map((v, i) => ({ name: DOW_NAMES[i] || `D${i}`, value: v }))
  const osData           = os_breakdown.map(x => ({ name: x.os, value: x.count }))
  const deviceData       = device_breakdown.map(x => ({ name: x.device, value: x.count }))
  const reviewData       = review_ratings.map((v, i) => ({ name: `${i+1}★`, value: v }))
  const formatData       = format_preferences.slice(0, 10).map(x => ({ name: x.format, value: x.count }))
  const dlCountryData    = download_countries.slice(0, 10).map(x => ({ name: x.country, value: x.count }))
  const visCountryData   = visitor_countries.slice(0, 10).map(x => ({ name: x.country, value: x.count }))

  return (
    <div>
      {/* ── Download Performance ── */}
      <SectionHeading icon="📥" title="Download Performance" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ChartCard title="Daily Downloads — 30 days">
          <DailyDownloadsChart data={downloadsTrend} />
        </ChartCard>
        <ChartCard title="Download Status Breakdown">
          <StatusPieChart analytics={analytics} />
        </ChartCard>
        <ChartCard title="Peak Download Hours">
          <SimpleBar data={peakData} color="#ef4444" />
        </ChartCard>
        <ChartCard title="Day of Week">
          <SimpleBar data={dowData} color="#8b5cf6" />
        </ChartCard>
      </div>

      {/* ── Visitor Insights ── */}
      <SectionHeading icon="👥" title="Visitor Insights" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ChartCard title="Peak Visitor Hours">
          <SimpleBar data={visitorHoursData} color="#3b82f6" />
        </ChartCard>
        <ChartCard title="Devices">
          {deviceData.length ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={deviceData} cx="50%" cy="50%" outerRadius={80} dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
                  {deviceData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          ) : <NoData />}
        </ChartCard>
      </div>

      {/* ── Content & Preferences ── */}
      <SectionHeading icon="🎬" title="Content & Preferences" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ChartCard title="Format Preferences (Top 10)">
          <ColorBar data={formatData} />
        </ChartCard>
        <ChartCard title="Operating Systems">
          <ColorBar data={osData} />
        </ChartCard>
        <ChartCard title="Review Ratings">
          <SimpleBar data={reviewData} color="#f59e0b" />
        </ChartCard>
      </div>

      {/* ── Geographic Distribution ── */}
      <SectionHeading icon="🌍" title="Geographic Distribution" />
      <div className="grid grid-cols-1 gap-4">
        <ChartCard title="Active Users & Visitors — World Map" wide>
          <VisitorMap
            visitorCountries={visitor_countries}
            downloadCountries={download_countries}
          />
        </ChartCard>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <ChartCard title="Downloads by Country (Top 10)">
          <ColorBar data={dlCountryData} height={220} />
        </ChartCard>
        <ChartCard title="Visitors by Country (Top 10)">
          <ColorBar data={visCountryData} height={220} />
        </ChartCard>
      </div>
    </div>
  )
}
