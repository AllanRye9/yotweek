/**
 * Centralized API client for YotWeek ride-sharing platform.
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
export const getPlatformStats = () => request('GET', '/api/platform_stats')

// ── Admin Auth ────────────────────────────────────────────────────────────────

export const getAdminAuthStatus = () => request('GET', '/admin/auth_status')
export const adminLogin         = (username, password) =>
  request('POST', '/admin/api/login', { username, password })
export const adminLogout        = () => request('POST', '/admin/api/logout', {})
export const adminRegister      = (username, password, confirmPassword) =>
  request('POST', '/admin/api/register', { username, password, confirm_password: confirmPassword })
export const checkAdminExists   = () => request('GET', '/admin/has_admin')

// ── Admin DB ──────────────────────────────────────────────────────────────────

export const adminDbDownloadUrl = () => `${BASE}/admin/db/download`
export const adminDbUpload      = (file) => {
  const fd = new FormData()
  fd.append('db_file', file)
  return request('POST', '/admin/db/upload', fd, false)
}

// ── User Auth ─────────────────────────────────────────────────────────────────

export const userRegister = (name, email, password, role = 'passenger', phone = '') =>
  request('POST', '/api/auth/register', { name, email, password, role, phone })

export const userLogin = (email, password, remember_me = false) =>
  request('POST', '/api/auth/login', { email, password, remember_me })

export const userLogout = () => request('POST', '/api/auth/logout', {})

export const getUserProfile = () => request('GET', '/api/auth/me')

export const updateUserLocation = (lat, lng, location_name = '') =>
  request('POST', '/api/auth/location', { lat, lng, location_name })

export const updateProfileDetails = (name, bio, phone = '', home_city = '', preferred_language = '') =>
  request('PUT', '/api/auth/profile/details', { name, bio, phone, location_name: home_city, preferred_language })

export const changePassword = (current_password, new_password) =>
  request('POST', '/api/auth/change_password', { current_password, new_password })

export const uploadAvatar = (file) => {
  const fd = new FormData()
  fd.append('file', file, file.name)
  return request('POST', '/api/auth/profile/avatar', fd, false)
}

export const deleteAvatar = () =>
  request('DELETE', '/api/auth/profile/avatar')

export const forgotPassword = (email) =>
  request('POST', '/api/auth/forgot_password', { email })

export const resetPassword = (token, new_password) =>
  request('POST', '/api/auth/reset_password', { token, new_password })

export const requestMagicLink = (email) =>
  request('POST', '/api/auth/magic_link', { email })

export const verifyMagicLink = (token) =>
  request('GET', `/api/auth/magic_link?token=${encodeURIComponent(token)}`)

export const verifyEmail = (token) =>
  request('GET', `/api/auth/verify_email?token=${encodeURIComponent(token)}`)

// ── Notifications ─────────────────────────────────────────────────────────────

export const getNotifications = () => request('GET', '/api/notifications')

export const markNotificationRead = (notifId) =>
  request('POST', `/api/notifications/${encodeURIComponent(notifId)}/read`, {})

export const markAllNotificationsRead = () =>
  request('POST', '/api/notifications/read_all', {})

export const clearAllNotifications = () =>
  request('DELETE', '/api/notifications/clear_all')

// ── Driver ────────────────────────────────────────────────────────────────────

export const driverApply = (vehicle_make, vehicle_model, vehicle_year, vehicle_color, license_plate, plate_number = '') =>
  request('POST', '/api/auth/driver_apply', { vehicle_make, vehicle_model, vehicle_year, vehicle_color, license_plate, plate_number })

export const getDriverApplication = () => request('GET', '/api/auth/driver_application')

export const getAdminDriverApplications = () => request('GET', '/api/admin/driver_applications')

export const approveDriverApplication = (appId, approved) =>
  request('POST', `/api/admin/driver_applications/${encodeURIComponent(appId)}/approve`, { approved })

export const getDriverDashboard = () => request('GET', '/api/driver/dashboard')

export const updateDriverLocation = (lat, lng, empty = true, seats = 0, location_alert = false) =>
  request('POST', '/api/driver/location', { lat, lng, empty, seats, location_alert })

export const getNearbyDrivers = (lat, lng, radius_km = 10) =>
  request('GET', `/api/driver/nearby?lat=${lat}&lng=${lng}&radius_km=${radius_km}`)

export const getAllDriverLocations = () => request('GET', '/api/driver/locations')

// ── Ride History ──────────────────────────────────────────────────────────────

export const getRideHistory = () => request('GET', '/api/rides/history')

export const getTrackedRides = () => request('GET', '/api/rides/tracking')

// ── Ride Booking ──────────────────────────────────────────────────────────────

export const postRide = (origin, destination, departure, seats, notes = '', origin_lat = null, origin_lng = null, dest_lat = null, dest_lng = null, fare = null, ride_type = '', vehicle_color = '', vehicle_type = '', plate_number = '', vehicle_model_custom = '') =>
  request('POST', '/api/rides', { origin, destination, departure, seats, notes, origin_lat, origin_lng, dest_lat, dest_lng, fare, ride_type, vehicle_color, vehicle_type, plate_number, vehicle_model_custom })

export const calculateFare = (origin_lat, origin_lng, dest_lat, dest_lng) =>
  request('GET', `/api/rides/fare?origin_lat=${origin_lat}&origin_lng=${origin_lng}&dest_lat=${dest_lat}&dest_lng=${dest_lng}`)

export const calculateSharedFare = (total_fare, total_seats, booked_seats) =>
  request('GET', `/api/rides/shared_fare?total_fare=${total_fare}&total_seats=${total_seats}&booked_seats=${booked_seats}`)

export const geocodeAddress = (address) =>
  request('GET', `/api/geocode?address=${encodeURIComponent(address)}`)

export const estimateFare = (start, destination, seats = 1) =>
  request('GET', `/api/fare_estimate?start=${encodeURIComponent(start)}&destination=${encodeURIComponent(destination)}&seats=${seats}`)

export const listRides = (status = null) =>
  request('GET', `/api/rides/list${status ? `?status=${encodeURIComponent(status)}` : ''}`)

export const getRide = (rideId) =>
  request('GET', `/api/rides/${encodeURIComponent(rideId)}`)

export const cancelRide = (rideId) => request('DELETE', `/api/rides/${encodeURIComponent(rideId)}`)

export const takeRide = (rideId) => request('POST', `/api/rides/${encodeURIComponent(rideId)}/take`)

export const repostRide = (rideId) => request('POST', `/api/rides/${encodeURIComponent(rideId)}/repost`)

export const repostSeat = (rideId) => request('POST', `/api/rides/${encodeURIComponent(rideId)}/repost_seat`)

export const driverConfirmBooking = (rideId, confirmationId) =>
  request('POST', `/api/rides/${encodeURIComponent(rideId)}/driver_confirm_booking/${encodeURIComponent(confirmationId)}`)

export const alertRideClients = (rideId) => request('POST', `/api/rides/${encodeURIComponent(rideId)}/alert`)

export const confirmJourney = (rideId, real_name, contact, lat = null, lng = null) =>
  request('POST', `/api/rides/${encodeURIComponent(rideId)}/confirm_journey`, { real_name, contact, lat, lng })

export const getConfirmedUsers = (rideId) =>
  request('GET', `/api/rides/${encodeURIComponent(rideId)}/confirmed_users`)

export const getConfirmedLocations = (rideId) =>
  request('GET', `/api/rides/${encodeURIComponent(rideId)}/confirmed_locations`)

export const proximityNotify = (rideId, distance_km, unit = 'km') =>
  request('POST', `/api/rides/${encodeURIComponent(rideId)}/proximity_notify`, { distance_km, unit })

export const getAdminRides = () => request('GET', '/api/admin/rides')
export const adminDeleteRide = (rideId) => request('DELETE', `/api/admin/rides/${encodeURIComponent(rideId)}`)

// ── Ride Requests ─────────────────────────────────────────────────────────────

export const createRideRequest = (origin, destination, desired_date, passengers = 1, price_min = null, price_max = null, notes = '') =>
  request('POST', '/api/ride_requests', { origin, destination, desired_date, passengers, price_min, price_max, notes })

export const listRideRequests = (status = 'open') =>
  request('GET', `/api/ride_requests?status=${encodeURIComponent(status)}`)

export const getRideRequests = (status = 'open') => listRideRequests(status)

export const acceptRideRequest = (requestId) =>
  request('POST', `/api/ride_requests/${encodeURIComponent(requestId)}/accept`)

export const cancelRideRequest = (requestId) =>
  request('DELETE', `/api/ride_requests/${encodeURIComponent(requestId)}`)

// ── Travel Companions ─────────────────────────────────────────────────────────

export const createTravelCompanion = (origin_country, destination_country, travel_date, preferences = '') =>
  request('POST', '/api/travel_companions', { origin_country, destination_country, travel_date, preferences })

export const listTravelCompanions = (origin_country = null, destination_country = null, travel_date = null) => {
  const qs = new URLSearchParams()
  if (origin_country)      qs.set('origin_country',      origin_country)
  if (destination_country) qs.set('destination_country', destination_country)
  if (travel_date)         qs.set('travel_date',         travel_date)
  const query = qs.toString()
  return request('GET', `/api/travel_companions${query ? '?' + query : ''}`)
}

export const deleteTravelCompanion = (companionId) =>
  request('DELETE', `/api/travel_companions/${encodeURIComponent(companionId)}`)

// ── Ride Chat ─────────────────────────────────────────────────────────────────

export const getRideChatMessages = (rideId) =>
  request('GET', `/api/rides/${encodeURIComponent(rideId)}/chat`)

export const getRideChatInbox = () => request('GET', '/api/rides/chat/inbox')

export const deleteRideChatMessage = (rideId, msgId) =>
  request('DELETE', `/api/rides/${encodeURIComponent(rideId)}/chat/${encodeURIComponent(msgId)}`)

// ── Driver Reviews ────────────────────────────────────────────────────────────

export const getDriverReviews = (driverUserId) =>
  request('GET', `/api/drivers/${encodeURIComponent(driverUserId)}/reviews`)

export const submitDriverReview = (driverUserId, rating, comment = '') =>
  request('POST', `/api/drivers/${encodeURIComponent(driverUserId)}/reviews`, { rating, comment })

// ── AI Assistant ──────────────────────────────────────────────────────────────

export const aiChat = (message, context = 'rides') =>
  request('POST', '/api/ai/chat', { message, context })

// ── Unified Map ───────────────────────────────────────────────────────────────

export const getUnifiedMapNearby = (lat, lng, radius_km = 25, mode = 'drivers') =>
  request('GET', `/api/unified_map/nearby?lat=${lat}&lng=${lng}&radius_km=${radius_km}&mode=${encodeURIComponent(mode)}`)

// ── E2E Encryption – public key ───────────────────────────────────────────────

export const storePublicKey = (public_key) =>
  request('PUT', '/api/auth/public_key', { public_key })

export const getUserPublicKey = (userId) =>
  request('GET', `/api/users/${encodeURIComponent(userId)}/public_key`)

export const getUserPublicProfile = (userId) =>
  request('GET', `/api/users/${encodeURIComponent(userId)}/profile`)

// ── Users ─────────────────────────────────────────────────────────────────────

export const listUsers = () => request('GET', '/api/users/list')

export const searchUsers = (q) =>
  request('GET', `/api/users/search?q=${encodeURIComponent(q)}`)

// ── Admin — Users ─────────────────────────────────────────────────────────────

export const getAdminUsers = () => request('GET', '/api/admin/users')

export const adminDeleteUser = (userId) =>
  request('DELETE', `/api/admin/users/${encodeURIComponent(userId)}`)

// ── Admin — Broadcasts ────────────────────────────────────────────────────────

export const getAdminBroadcasts = () => request('GET', '/api/admin/broadcasts')

export const adminCancelBroadcast = (broadcastId) =>
  request('DELETE', `/api/admin/broadcasts/${encodeURIComponent(broadcastId)}`)

// ── Receipts ──────────────────────────────────────────────────────────────────

export const getReceipts = () => request('GET', '/api/receipts')

// ── Direct Messaging ──────────────────────────────────────────────────────────

export const dmListConversations = (search = null) =>
  request('GET', `/api/dm/conversations${search ? '?search=' + encodeURIComponent(search) : ''}`)

export const dmGetContacts = () => request('GET', '/api/dm/contacts')

export const dmStartConversation = (other_user_id) =>
  request('POST', '/api/dm/conversations', { other_user_id })

export const dmGetMessages = (convId) =>
  request('GET', `/api/dm/conversations/${encodeURIComponent(convId)}/messages`)

export const dmSendMessage = (conv_id, content, reply_to_id = null) =>
  request('POST', '/api/dm/messages', { conv_id, content, reply_to_id })

export const dmMarkRead = (convId) =>
  request('POST', `/api/dm/conversations/${encodeURIComponent(convId)}/read`, {})

export const dmDeleteConversation = (convId) =>
  request('DELETE', `/api/dm/conversations/${encodeURIComponent(convId)}`)

export const dmDeleteMessage = (msgId) =>
  request('DELETE', `/api/dm/messages/${encodeURIComponent(msgId)}`)

// ── Aliased DM helpers (used by InboxPage) ────────────────────────────────────

export const getDmConversations = (search = '') =>
  request('GET', `/api/dm/conversations${search ? '?search=' + encodeURIComponent(search) : ''}`)

export const getDmContacts = () => request('GET', '/api/dm/contacts')

export const getDmMessages = (userId) =>
  request('GET', `/api/dm/${encodeURIComponent(userId)}/messages`)

export const sendDmMessage = (userId, content) =>
  request('POST', `/api/dm/${encodeURIComponent(userId)}/messages`, { content })

export const markNotificationsRead = () =>
  request('POST', '/api/notifications/read_all', {})

// ── Downloader helpers ───────────────────────────────────────────────────────

export const getVideoInfo = (url) =>
  request('POST', '/video_info', formBody({ url }), false)

export const startDownload = (url, format = 'best', ext = 'mp4', session_id = '') =>
  request('POST', '/start_download', formBody({ url, format, ext, session_id }), false)

export const cancelDownload = (downloadId) =>
  request('POST', `/cancel/${encodeURIComponent(downloadId)}`)

export const cancelAll = () => request('POST', '/cancel_all')

export const getActiveDownloads = () => request('GET', '/active_downloads')

export const listFiles = (session_id = '') =>
  request('GET', `/files${session_id ? `?session_id=${encodeURIComponent(session_id)}` : ''}`)
    .then((data) => data.files || [])

export const deleteFile = (filename) =>
  request('DELETE', `/delete/${encodeURIComponent(filename)}`)

export const deleteSession = (sessionId) =>
  request('DELETE', `/session/${encodeURIComponent(sessionId)}`)

export const streamUrl = (filename) => `${BASE}/stream/${encodeURIComponent(filename)}`

export const downloadUrl = (filename) => `${BASE}/downloads/${encodeURIComponent(filename)}`

export const downloadZip = (filenames = [], session_id = '') =>
  request('POST', '/download_zip', formBody({ filenames: JSON.stringify(filenames), session_id }), false)

export function triggerBlobDownload(blob, filename = 'download') {
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}

// ── Reviews ──────────────────────────────────────────────────────────────────

export const getReviews = () => request('GET', '/reviews').then((data) => data.reviews || [])

export const canSubmitReview = () => request('GET', '/reviews/can_submit')

export const submitReview = (rating, comment = '', name = '') =>
  request('POST', '/reviews', { rating, comment, name })

// ── CV / Docs / ATS ──────────────────────────────────────────────────────────

export const generateCV = (fields, logoFile = null, theme = 'classic', layout = 'single') => {
  const fd = new FormData()
  Object.entries(fields || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v).trim() !== '') fd.append(k, v)
  })
  fd.append('theme', theme)
  fd.append('layout', layout)
  if (logoFile) fd.append('logo', logoFile)
  return request('POST', '/api/cv/generate', fd, false)
}

export const generateCVTxt = (fields, layout = 'single') => {
  const fd = new FormData()
  Object.entries(fields || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v).trim() !== '') fd.append(k, v)
  })
  fd.append('layout', layout)
  return request('POST', '/api/cv/generate_txt', fd, false)
}

export const extractCV = (file) => {
  const fd = new FormData()
  fd.append('file', file, file.name)
  return request('POST', '/api/cv/extract', fd, false)
}

export const aiCvSuggest = (field, text = '', name = '', job_title = '', extra = {}) =>
  request('POST', '/api/cv/suggest', { field, text, name, job_title, ...extra })

export const convertDoc = (file, target) => {
  const fd = new FormData()
  fd.append('file', file, file.name)
  fd.append('target', target)
  return request('POST', '/api/doc/convert', fd, false)
}

export const scanATS = (cv_text, job_description, file = null) => {
  if (file) {
    const fd = new FormData()
    fd.append('file', file, file.name)
    fd.append('job_description', job_description || '')
    if (cv_text) fd.append('cv_text', cv_text)
    return request('POST', '/api/ats/scan', fd, false)
  }
  return request('POST', '/api/ats/scan', { cv_text, job_description })
}

// ── Property / Agent helpers ────────────────────────────────────────────────

export const submitAgentApplication = (payload) =>
  request('POST', '/api/agents/apply', payload)

export const getAgentApplicationStatus = () =>
  request('GET', '/api/agents/application_status')

export const listProperties = () =>
  request('GET', '/api/properties').then((data) => data.properties || data)

export const getProperty = (propertyId) =>
  request('GET', `/api/properties/${encodeURIComponent(propertyId)}`)

export const createProperty = (payload) =>
  request('POST', '/api/properties', payload)

export const updateProperty = (propertyId, payload) =>
  request('PUT', `/api/properties/${encodeURIComponent(propertyId)}`, payload)

export const deleteProperty = (propertyId) =>
  request('DELETE', `/api/properties/${encodeURIComponent(propertyId)}`)

export const getNearbyAgents = (lat, lng, radius_km = 25) =>
  request('GET', `/api/agents/nearby?lat=${lat}&lng=${lng}&radius_km=${radius_km}`)

export const startPropertyConversation = (property_id, agent_id) =>
  request('POST', '/api/property_conversations/start', { property_id, agent_id })

export const listPropertyConversations = () =>
  request('GET', '/api/property_conversations')

export const getPropertyMessages = (conv_id) =>
  request('GET', `/api/property_conversations/${encodeURIComponent(conv_id)}/messages`)

export const sendPropertyMessage = (conv_id, content) =>
  request('POST', `/api/property_conversations/${encodeURIComponent(conv_id)}/messages`, { content })

export const markPropertyConversationRead = (conv_id) =>
  request('POST', `/api/property_conversations/${encodeURIComponent(conv_id)}/read`, {})

// ── Playlist / batch ─────────────────────────────────────────────────────────

export const startPlaylist = (url, format = 'best', ext = 'mp4', start = '', end = '', session_id = '') =>
  request('POST', '/start_playlist', formBody({ url, format, ext, start, end, session_id }), false)

export const startBatch = (urls, format = 'best', ext = 'mp4', session_id = '') =>
  request('POST', '/start_batch', formBody({ urls, format, ext, session_id }), false)

// ── Optional admin legacy helpers ────────────────────────────────────────────

export const getAdminDownloads = () => request('GET', '/admin/api/downloads')
export const getAdminVisitors = () => request('GET', '/admin/api/visitors')
export const getAdminAnalytics = () => request('GET', '/admin/api/analytics')
export const adminCancelDownload = (id) => request('POST', `/admin/api/downloads/${encodeURIComponent(id)}/cancel`, {})
export const adminDeleteRecord = (id) => request('DELETE', `/admin/api/downloads/${encodeURIComponent(id)}`)
export const adminClearVisitors = () => request('DELETE', '/admin/api/visitors')
export const adminClearAllDownloads = () => request('DELETE', '/admin/api/downloads')
export const adminClearAllData = () => request('DELETE', '/admin/api/clear_all')
export const getCookieStatus = () => request('GET', '/admin/api/cookies')
export const uploadCookies = (file) => {
  const fd = new FormData()
  fd.append('file', file, file.name)
  return request('POST', '/admin/api/cookies', fd, false)
}
export const deleteCookies = () => request('DELETE', '/admin/api/cookies')
export const getAdminAgentApplications = () => request('GET', '/api/admin/agent_applications')
export const adminApproveAgentApplication = (appId, approved = true) =>
  request('POST', `/api/admin/agent_applications/${encodeURIComponent(appId)}/approve`, { approved })
export const getAdminReviews = () => request('GET', '/api/admin/reviews')
export const deleteAdminReview = (reviewId) => request('DELETE', `/api/admin/reviews/${encodeURIComponent(reviewId)}`)
export const getAdminProperties = () => request('GET', '/api/admin/properties')
export const adminDeleteProperty = (propertyId) => request('DELETE', `/api/admin/properties/${encodeURIComponent(propertyId)}`)
