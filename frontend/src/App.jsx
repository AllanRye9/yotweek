import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { deleteSession } from './api'
import { SESSION_ID } from './session'
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
import { createContext, useContext } from 'react'

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

  return (
    <ThemeCtx.Provider value={{ themeId, setThemeId }}>
      {children}
    </ThemeCtx.Provider>
  )
}

// ─── App ───────────────────────────────────────────────────────────
export default function App() {
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
          {/* Profile, chat, notifications */}
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          {/* Legacy redirects */}
          <Route path="/tourist-sites" element={<Navigate to="/" replace />} />
          <Route path="/properties" element={<Navigate to="/" replace />} />
          <Route path="/properties/:propertyId" element={<Navigate to="/" replace />} />
          <Route path="/agents" element={<Navigate to="/" replace />} />
          <Route path="/property-inbox" element={<Navigate to="/" replace />} />
          <Route path="/map" element={<Navigate to="/rides" replace />} />
          <Route path="/companions" element={<Navigate to="/rides" replace />} />
          <Route path="/admin/login" element={<Navigate to="/" replace />} />
          <Route path="/admin/register" element={<Navigate to="/" replace />} />
          <Route path="/admin/dashboard" element={<Navigate to="/" replace />} />
          <Route path="/const" element={<Navigate to="/" replace />} />
          {/* Catch-all → Home */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ThemeProvider>
    </BrowserRouter>
  )
}