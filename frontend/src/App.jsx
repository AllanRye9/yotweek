import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect, createContext, useContext } from 'react'
import { getAdminAuthStatus } from './api'
import { deleteSession } from './api'
import { SESSION_ID } from './session'
import Home from './pages/Home'
import UserDashboard from './pages/UserDashboard'
import AdminLogin from './pages/AdminLogin'
import AdminDashboard from './pages/AdminDashboard'

// ─── Auth Context ─────────────────────────────────────────────────────────────
const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

// ─── Theme Context ────────────────────────────────────────────────────────────
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

// ─── Protected Route ──────────────────────────────────────────────────────────
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

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/dashboard" element={<UserDashboard />} />
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
