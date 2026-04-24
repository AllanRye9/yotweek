import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useState, useEffect, lazy, Suspense } from 'react'
import { deleteSession, getUserProfile, getMe } from './api'
import { SESSION_ID } from './session'
import { getAdminAuthStatus } from './api'
import Home from './pages/Home'
import RidesPage from './pages/RidesPage'
import UserDashboard from './pages/UserDashboard'
import DriverDashboard from './pages/DriverDashboard'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import ProfilePage from './pages/ProfilePage'
import InboxPage from './pages/InboxPage'
import RideChatPage from './pages/RideChatPage'
import RequestsPage from './pages/RequestsPage'
import NotificationsPage from './pages/NotificationsPage'
import UnifiedMapPage from './pages/others/UnifiedMapPage'
import AdminDashboard from './pages/others/AdminDashboard'
import AdminLogin from './pages/others/AdminLogin'
import AIPage from './pages/AIPage'
import AboutPage from './pages/AboutPage'
import FAQPage from './pages/FAQPage'
import TermsPage from './pages/TermsPage'
import PrivacyPage from './pages/PrivacyPage'
import SOSButton from './components/SOSButton'
import { createContext, useContext } from 'react'

const FeedPage       = lazy(() => import('./pages/FeedPage'))
const GroupTripsPage = lazy(() => import('./pages/GroupTripsPage'))

// ─── Theme Context ────────────────────────────────────────────────────────

// ─── Auth Context ─────────────────────────────────────────────────────────
const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

function AuthProvider({ children }) {
  const [admin, setAdmin] = useState(null)

  const checkAuth = () => {
    getAdminAuthStatus()
      .then(data => setAdmin(data.authenticated ? data : null))
      .catch(() => setAdmin(null))
  }

  useEffect(() => { checkAuth() }, [])

  return (
    <AuthCtx.Provider value={{ admin, setAdmin, checkAuth }}>
      {children}
    </AuthCtx.Provider>
  )
}

export const THEMES = [
  { id: 'dark',   label: '🌑 Dark',   className: 'theme-dark'   },
  { id: 'light',  label: '☀️ Light',  className: 'theme-light'  },
  { id: 'ocean',  label: '🌊 Ocean',  className: 'theme-ocean'  },
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

  return (
    <ThemeCtx.Provider value={{ themeId, setThemeId }}>
      {children}
    </ThemeCtx.Provider>
  )
}

// ─── Route guards ─────────────────────────────────────────────────────────

/** Redirects unauthenticated admin users to /admin/login */
function RequireAdmin({ children }) {
  const { admin } = useAuth()
  if (admin === null) return null // still loading
  if (!admin) return <Navigate to="/admin/login" replace />
  return children
}

/** Redirects unauthenticated app users to /login */
function RequireAppAuth({ children }) {
  const [checking, setChecking] = useState(true)
  const [authed, setAuthed] = useState(false)

  useEffect(() => {
    getUserProfile()
      .then(() => { setAuthed(true); setChecking(false) })
      .catch(() => { setAuthed(false); setChecking(false) })
  }, [])

  if (checking) return null
  if (!authed) return <Navigate to="/login" replace />
  return children
}

// ─── App ───────────────────────────────────────────────────────────

/** Wraps every real page in a fade-slide transition keyed to the pathname. */
function PageWrapper({ children }) {
  const location = useLocation()
  return (
    <div key={location.pathname} className="page-transition">
      {children}
    </div>
  )
}

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  useEffect(() => {
    getMe().then(() => setIsLoggedIn(true)).catch(() => setIsLoggedIn(false))
  }, [])

  useEffect(() => {
    const prevSession = localStorage.getItem('yot_session_id')
    if (prevSession && prevSession !== SESSION_ID) {
      deleteSession(prevSession).catch(() => {})
    }
    localStorage.setItem('yot_session_id', SESSION_ID)
  }, [])

  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <SOSButton isLoggedIn={isLoggedIn} />
          <RoutesWithTransition />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}

function RoutesWithTransition() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<PageWrapper><Home /></PageWrapper>} />
        {/* Auth pages */}
        <Route path="/login" element={<PageWrapper><LoginPage /></PageWrapper>} />
        <Route path="/register" element={<PageWrapper><RegisterPage /></PageWrapper>} />
        <Route path="/reset-password" element={<PageWrapper><ResetPasswordPage /></PageWrapper>} />
        {/* Rides — login required */}
        <Route path="/rides" element={<PageWrapper><RequireAppAuth><RidesPage /></RequireAppAuth></PageWrapper>} />
        <Route path="/rides/:rideId/chat" element={<PageWrapper><RequireAppAuth><RideChatPage /></RequireAppAuth></PageWrapper>} />
        {/* Requests */}
        <Route path="/requests" element={<PageWrapper><RequireAppAuth><RequestsPage /></RequireAppAuth></PageWrapper>} />
        {/* Social Feed */}
        <Route path="/feed" element={<PageWrapper><RequireAppAuth><FeedPage /></RequireAppAuth></PageWrapper>} />
        {/* Group Trips */}
        <Route path="/group-trips" element={<PageWrapper><RequireAppAuth><GroupTripsPage /></RequireAppAuth></PageWrapper>} />
        {/* Dashboards — each page handles its own auth + role checks */}
        <Route path="/user/dashboard" element={<PageWrapper><UserDashboard /></PageWrapper>} />
        <Route path="/driver/dashboard" element={<PageWrapper><DriverDashboard /></PageWrapper>} />
        {/* Legacy /dashboard → /user/dashboard */}
        <Route path="/dashboard" element={<Navigate to="/user/dashboard" replace />} />
        {/* Profile, chat, notifications */}
        <Route path="/profile" element={<PageWrapper><ProfilePage /></PageWrapper>} />
        <Route path="/inbox" element={<PageWrapper><InboxPage /></PageWrapper>} />
        <Route path="/notifications" element={<PageWrapper><NotificationsPage /></PageWrapper>} />
        {/* Map — live driver locations */}
        <Route path="/map" element={<PageWrapper><UnifiedMapPage /></PageWrapper>} />
        {/* Admin panel */}
        <Route path="/const" element={<RequireAdmin><AdminDashboard /></RequireAdmin>} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin/register" element={<AdminLogin register />} />
        {/* Legacy redirects */}
        <Route path="/tourist-sites" element={<Navigate to="/" replace />} />
        <Route path="/properties" element={<Navigate to="/" replace />} />
        <Route path="/properties/:propertyId" element={<Navigate to="/" replace />} />
        <Route path="/agents" element={<Navigate to="/" replace />} />
        <Route path="/property-inbox" element={<Navigate to="/" replace />} />
        <Route path="/companions" element={<Navigate to="/user/dashboard" replace />} />
        <Route path="/admin/dashboard" element={<Navigate to="/const" replace />} />
        {/* AI Assistant */}
        <Route path="/ai" element={<PageWrapper><AIPage /></PageWrapper>} />
        {/* Info pages */}
        <Route path="/about" element={<PageWrapper><AboutPage /></PageWrapper>} />
        <Route path="/faq" element={<PageWrapper><FAQPage /></PageWrapper>} />
        <Route path="/terms" element={<PageWrapper><TermsPage /></PageWrapper>} />
        <Route path="/privacy" element={<PageWrapper><PrivacyPage /></PageWrapper>} />
        {/* Catch-all → Home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}