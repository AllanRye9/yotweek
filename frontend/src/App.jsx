import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect, createContext, useContext } from 'react'
import { getAdminAuthStatus } from './api'
import { deleteSession } from './api'
import { SESSION_ID } from './session'
import Home from './pages/Home'
import RidesPage from './pages/RidesPage'
import UserDashboard from './pages/UserDashboard'
import DriverDashboard from './pages/DriverDashboard'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import AdminLogin from './pages/AdminLogin'
import AdminDashboard from './pages/AdminDashboard'
import TouristSitesPage from './pages/TouristSitesPage'
import UnifiedMapPage from './pages/UnifiedMapPage'
import ProfilePage from './pages/ProfilePage'
import InboxPage from './pages/InboxPage'
import AgentsPage from './pages/AgentsPage'
import RideChatPage from './pages/RideChatPage'
import RequestsPage from './pages/RequestsPage'

// ─── Auth Context ────────────────────────────────────────────────────────
const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

// ─── Theme Context ────────────────────────────────────────────────────────
export const THEMES = [
  { id: 'dark',   label: '🌑 Dark',   className: 'theme-dark'   },
  { id: 'light',  label: '☀️ Light',  className: 'theme-light'  },
  { id: 'ocean',  label: '🌊 Ocean',  className: 'theme-ocean'  },
  { id: 'forest', label: '🌿 Forest', className: 'theme-forest' },
  { id: 'sunset', label: '🌅 Sunset', className: 'theme-sunset' },
  { id: 'purple', label: '💜 Purple', className: 'theme-purple' },
]
const DEFAULT_THEME_ID = THEMES[0].id
const ThemeCtx = createContext(null)
export const useTheme = () => useContext(ThemeCtx)

function ThemeProvider({ children, storageKey = 'yot_theme' }) {
  const [themeId, setThemeId] = useState(
    () => localStorage.getItem(storageKey) || DEFAULT_THEME_ID
  )

  useEffect(() => {
    const html = document.documentElement
    THEMES.forEach(t => html.classList.remove(t.className))
    const theme = THEMES.find(t => t.id === themeId) || THEMES[0]
    html.classList.add(theme.className)
    localStorage.setItem(storageKey, themeId)
  }, [themeId, storageKey])

  // When this is the admin theme provider, restore the main site theme on unmount
  useEffect(() => {
    if (storageKey === 'yot_theme') return
    return () => {
      const mainThemeId = localStorage.getItem('yot_theme') || DEFAULT_THEME_ID
      const mainTheme = THEMES.find(t => t.id === mainThemeId) || THEMES[0]
      const html = document.documentElement
      THEMES.forEach(t => html.classList.remove(t.className))
      html.classList.add(mainTheme.className)
    }
  }, [storageKey])

  return (
    <ThemeCtx.Provider value={{ themeId, setThemeId }}>
      {children}
    </ThemeCtx.Provider>
  )
}

function AuthProvider({ children }) {
  const [admin, setAdmin] = useState(null) // null=loading, false=not logged in, object=logged in
  const checkAuth = async () => {
    try {
      const data = await getAdminAuthStatus()
      setAdmin(data.logged_in ? data : false)
    } catch {
      setAdmin(false)
    }
  }
  useEffect(() => { checkAuth() }, [])

  // On every page load, delete any files left from the PREVIOUS session, then
  // store the current session ID so the next load can clean it up.
  useEffect(() => {
    const prevSession = localStorage.getItem('yot_session_id')
    if (prevSession && prevSession !== SESSION_ID) {
      deleteSession(prevSession).catch(() => {})
    }
    localStorage.setItem('yot_session_id', SESSION_ID)
  }, [])

  return (
    <AuthCtx.Provider value={{ admin, setAdmin, checkAuth }}>
      {children}
    </AuthCtx.Provider>
  )
}

// ─── Protected Route ────────────────────────────────────────────────────────
function ProtectedRoute({ children }) {
  const { admin } = useAuth()
  if (admin === null) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="spinner w-10 h-10" />
      </div>
    )
  }
  if (!admin) return <Navigate to="/admin/login" replace />
  return children
}

// ─── App ───────────────────────────────────────────────────────────
export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Home />} />
            {/* Auth pages */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            {/* Rides */}
            <Route path="/rides" element={<RidesPage />} />
            <Route path="/rides/:rideId/chat" element={<RideChatPage />} />
            {/* Requests */}
            <Route path="/requests" element={<RequestsPage />} />
            {/* Dashboards — each page handles its own auth + role checks */}
            <Route path="/user/dashboard" element={<UserDashboard />} />
            <Route path="/driver/dashboard" element={<DriverDashboard />} />
            {/* Legacy /dashboard → /user/dashboard */}
            <Route path="/dashboard" element={<Navigate to="/user/dashboard" replace />} />
            {/* Other pages */}
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/tourist-sites" element={<TouristSitesPage />} />
            {/* Legacy redirects — real estate / property features removed */}
            <Route path="/properties" element={<Navigate to="/tourist-sites" replace />} />
            <Route path="/properties/:propertyId" element={<Navigate to="/tourist-sites" replace />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/property-inbox" element={<Navigate to="/" replace />} />
            <Route path="/map" element={<UnifiedMapPage />} />
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin/register" element={<AdminLogin register />} />
            <Route path="/const" element={
              <ProtectedRoute>
                <ThemeProvider storageKey="yot_admin_theme">
                  <AdminDashboard />
                </ThemeProvider>
              </ProtectedRoute>
            } />
            <Route path="/admin/dashboard" element={
              <ProtectedRoute>
                <ThemeProvider storageKey="yot_admin_theme">
                  <AdminDashboard />
                </ThemeProvider>
              </ProtectedRoute>
            } />
            {/* Catch-all → Home */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}