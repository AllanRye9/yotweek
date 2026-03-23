/**
 * Centralized API client for YOT Downloader.
 * All requests go to the same origin (served by FastAPI).
 */

/**
 * Cross-browser (including Safari / iOS Safari) blob download helper.
 *
 * Safari quirks addressed:
 *  - Desktop Safari requires the <a> element to be appended to the DOM before
 *    .click() has any effect.
 *  - iOS Safari ignores the `download` attribute on blob: URLs entirely; we
 *    fall back to window.open() so the file opens in a new tab where the user
 *    can long-press → "Download Linked File".
 *
 * @param {Blob} blob        - The file blob to download.
 * @param {string} filename  - Suggested filename for the download.
 */
export function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
  if (isIOS) {
    // iOS Safari doesn't honour <a download> for blob: URLs.
    // Open in a new tab so the user can save manually.
    window.open(url, '_blank', 'noopener')
    // Keep the object URL alive for 10 s so the tab has time to load.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  } else {
    // All other browsers (including desktop Safari which needs the element in
    // the DOM before the click fires).
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    // Small delay before removal so the browser has time to start the download.
    setTimeout(() => {
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }, 150)
  }
}

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

// ── Bulk download ─────────────────────────────────────────────────────────────

export const downloadZip = (filenames) => {
  const fd = new FormData()
  fd.append('filenames', JSON.stringify(filenames))
  return request('POST', '/download_zip', fd, false)
}

// ── Reviews ───────────────────────────────────────────────────────────────────

export const getReviews       = () => request('GET', '/reviews')
export const canSubmitReview  = () => request('GET', '/reviews/can_submit')
export const submitReview     = (rating, comment, name) =>
  request('POST', '/reviews', { rating, comment, name })

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

export const adminCancelDownload   = (id) => request('POST', `/admin/cancel_download/${id}`)
export const adminDeleteRecord     = (id) => request('DELETE', `/admin/delete_record/${id}`)
export const adminClearVisitors    = ()   => request('DELETE', '/admin/clear_visitors')
export const adminClearAllDownloads = ()  => request('DELETE', '/admin/clear_all_downloads')
export const adminClearAllData      = ()  => request('DELETE', '/admin/clear_all_data')

// ── Admin DB ──────────────────────────────────────────────────────────────────

export const adminDbDownloadUrl = () => `${BASE}/admin/db/download`
export const adminDbUpload      = (file) => {
  const fd = new FormData()
  fd.append('file', file)
  return request('POST', '/admin/db/upload', fd, false)
}

// ── CV Generator ─────────────────────────────────────────────────────────────

/**
 * Generate a PDF CV.
 * @param {Object} fields - CV fields (name, email, phone, location, link, summary,
 *   experience, education, skills, projects, publications)
 * @param {File|null} logoFile - Optional logo image file
 * @param {string} theme - Theme name ('classic', 'modern', 'minimal', 'executive')
 * @returns {Promise<Response>} Raw response (blob) — caller should call res.blob()
 */
export const generateCV = (fields, logoFile = null, theme = 'classic') => {
  const fd = new FormData()
  Object.entries(fields).forEach(([k, v]) => {
    if (v !== undefined && v !== null) fd.append(k, v)
  })
  if (logoFile) fd.append('logo', logoFile, logoFile.name)
  fd.append('theme', theme)
  return request('POST', '/api/cv/generate', fd, false)
}

// ── CV Extraction ─────────────────────────────────────────────────────────────

/**
 * Extract CV fields from an uploaded PDF or DOCX file.
 * @param {File} file - The CV file to extract from
 * @returns {Promise<{fields: Object}>}
 */
export const extractCV = (file) => {
  const fd = new FormData()
  fd.append('file', file, file.name)
  return request('POST', '/api/cv/extract', fd, false)
}

// ── Document Conversion ───────────────────────────────────────────────────────

/**
 * Convert a document/image to a different format.
 * @param {File} file - The source file
 * @param {string} target - Target format ('word', 'excel', 'jpeg', 'png', 'pdf')
 * @returns {Promise<Response>} Raw response (blob) — caller should call res.blob()
 */
export const convertDoc = (file, target) => {
  const fd = new FormData()
  fd.append('file', file, file.name)
  fd.append('target', target)
  return request('POST', '/api/doc/convert', fd, false)
}

// ── Admin Cookies ─────────────────────────────────────────────────────────────

export const getCookieStatus    = () => request('GET', '/admin/cookies/status')
export const uploadCookies      = (file) => {
  const fd = new FormData()
  fd.append('file', file)
  return request('POST', '/admin/cookies/upload', fd, false)
}
export const deleteCookies      = () => request('DELETE', '/admin/cookies')
