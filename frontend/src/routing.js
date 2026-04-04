/**
 * Routing helpers for role-based navigation.
 */

/**
 * Returns the correct dashboard path for a given user object.
 * Admin users (if returned from the platform user auth) are redirected
 * to the admin dashboard; drivers go to the driver dashboard; everyone
 * else goes to the user dashboard.
 *
 * @param {object|null} user - User object with at least a `role` field.
 * @returns {string} The dashboard path.
 */
export function getDashboardPath(user) {
  if (!user) return '/login'
  if (user.role === 'driver') return '/driver/dashboard'
  if (user.role === 'admin')  return '/admin/dashboard'
  return '/user/dashboard'
}
