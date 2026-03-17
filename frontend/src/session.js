/**
 * Per-page-load session ID.
 *
 * This value is generated fresh every time the JavaScript module is evaluated
 * (i.e. on every full page load / browser refresh).  It is intentionally NOT
 * stored in localStorage or sessionStorage so that it resets automatically
 * whenever the user reloads the page.
 *
 * The session ID is sent along with every download request so the backend can
 * associate files with the session that triggered the download.
 */
export const SESSION_ID = crypto.randomUUID()
