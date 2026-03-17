/**
 * Centralized API client for YOT Downloader.
 * All requests go to the same origin (served by FastAPI).
 */

const BASE = ''  // same origin

async function request(method, path, body = null, isJSON = true) {
  const opts = {
    method,
    credentials: 'include',
    headers: {},
  }
  if (body !== null) {
    if (isJSON) {
      opts.headers['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(body)
    } else {
      // FormData — let browser set Content-Type with boundary
      opts.body = body
    }
  }
  const res = await fetch(BASE + path, opts)
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) {
    const data = await res.json()
    if (!res.ok) throw Object.assign(new Error(data.error || data.detail || 'Request failed'), { status: res.status, data })
    return data
  }
  if (!res.ok) throw Object.assign(new Error('Request failed'), { status: res.status })
  return res
}

function formBody(obj) {
  const fd = new FormData()
  Object.entries(obj).forEach(([k, v]) => { if (v !== undefined && v !== null) fd.append(k, v) })
  return fd
}

// ── Core ──────────────────────────────────────────────────────────────────────

export const getHealth = () => request('GET', '/health')
export const getStats  = () => request('GET', '/stats')

// ── Video ─────────────────────────────────────────────────────────────────────

export const getVideoInfo = (url) =>
  request('POST', '/video_info', formBody({ url }), false)

export const startDownload = (url, format = 'best', ext = 'mp4', sessionId = '') =>
  request('POST', '/start_download', formBody({ url, format, ext, session_id: sessionId }), false)

export const getStatus = (id) => request('GET', `/status/${id}`)

// ── Files ─────────────────────────────────────────────────────────────────────

export const listFiles    = (sessionId = '') => request('GET', `/files${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''}`)
export const deleteFile   = (name) => request('DELETE', `/delete/${encodeURIComponent(name)}`)
export const downloadUrl  = (name) => `${BASE}/downloads/${encodeURIComponent(name)}`
export const streamUrl    = (name) => `${BASE}/stream/${encodeURIComponent(name)}`

// ── Session ───────────────────────────────────────────────────────────────────

export const deleteSession = (sessionId) => request('DELETE', `/session/${encodeURIComponent(sessionId)}`)

// ── Downloads ─────────────────────────────────────────────────────────────────

export const cancelDownload  = (id)  => request('POST', `/cancel/${id}`)
export const cancelAll        = ()   => request('POST', '/cancel_all')
export const getActiveDownloads = () => request('GET', '/active_downloads')

// ── Playlist / Batch ──────────────────────────────────────────────────────────

export const startPlaylist = (url, format = 'best', ext = 'mp4', startIdx = '', endIdx = '', sessionId = '') =>
  request('POST', '/start_playlist_download', formBody({ url, format, ext, start_index: startIdx, end_index: endIdx, session_id: sessionId }), false)

export const startBatch = (urls, format = 'best', ext = 'mp4', sessionId = '') =>
  request('POST', '/start_batch_download', formBody({ urls, format, ext, session_id: sessionId }), false)

export const downloadZip = (filenames) =>
  request('POST', '/download_zip', { filenames })

// ── Editing ───────────────────────────────────────────────────────────────────

export const convertFile = (filename, targetFormat, resolution = '', videoBitrate = '', audioBitrate = '') =>
  request('POST', '/convert_file', formBody({ filename, target_format: targetFormat, resolution, video_bitrate: videoBitrate, audio_bitrate: audioBitrate }), false)

export const batchConvert = (filenames, targetFormat) =>
  request('POST', '/batch_convert', { filenames, target_format: targetFormat })

export const trimVideo = (filename, startTime, endTime) =>
  request('POST', '/trim', formBody({ filename, start_time: startTime, end_time: endTime }), false)

export const cropVideo = (filename, x, y, width, height) =>
  request('POST', '/crop', formBody({ filename, x, y, width, height }), false)

export const addWatermark = (filename, text, position = 'bottomright', size = 24) =>
  request('POST', '/watermark', formBody({ filename, text, position, size }), false)

export const extractClip = (filename, startTime, duration) =>
  request('POST', '/extract_clip', formBody({ filename, start_time: startTime, duration }), false)

export const mergeVideos = (filenames, outputName) =>
  request('POST', '/merge', { filenames, output_name: outputName })

export const getJobStatus = (id) => request('GET', `/job_status/${id}`)

// ── Reviews ───────────────────────────────────────────────────────────────────

export const getReviews    = () => request('GET', '/reviews')
export const submitReview  = (rating, comment, name) =>
  request('POST', '/reviews', formBody({ rating, comment, name }), false)

// ── Admin Auth ────────────────────────────────────────────────────────────────

export const getAdminAuthStatus = () => request('GET', '/admin/auth_status')
export const adminLogin         = (username, password) =>
  request('POST', '/admin/api/login', { username, password })
export const adminLogout        = () => request('POST', '/admin/api/logout', {})
export const adminRegister      = (username, password, confirmPassword) =>
  request('POST', '/admin/api/register', { username, password, confirm_password: confirmPassword })
export const checkAdminExists   = () => request('GET', '/admin/has_admin')

// ── Admin Data ────────────────────────────────────────────────────────────────

export const getAdminDownloads  = () => request('GET', '/admin/downloads')
export const getAdminVisitors   = () => request('GET', '/admin/visitors')
export const getAdminAnalytics  = () => request('GET', '/admin/analytics')

export const adminCancelDownload = (id)  => request('POST', `/admin/cancel_download/${id}`)
export const adminDeleteRecord   = (id)  => request('DELETE', `/admin/delete_record/${id}`)
export const adminClearVisitors  = ()    => request('DELETE', '/admin/clear_visitors')

// ── Admin DB ──────────────────────────────────────────────────────────────────

export const adminDbDownloadUrl = () => `${BASE}/admin/db/download`
export const adminDbUpload      = (file) => {
  const fd = new FormData()
  fd.append('file', file)
  return request('POST', '/admin/db/upload', fd, false)
}

// ── Admin Cookies ─────────────────────────────────────────────────────────────

export const getCookieStatus    = () => request('GET', '/admin/cookies/status')
export const uploadCookies      = (file) => {
  const fd = new FormData()
  fd.append('file', file)
  return request('POST', '/admin/cookies/upload', fd, false)
}
export const deleteCookies      = () => request('DELETE', '/admin/cookies')
