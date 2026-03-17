import { useState, useRef, useEffect } from 'react'
import { useTheme, THEMES } from '../App'

/**
 * A compact dropdown for choosing the app colour theme.
 * Renders as a small palette icon button in the navbar.
 */
export default function ThemeSelector() {
  const { themeId, setThemeId } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // Close when clicking outside
  useEffect(() => {
    const onClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const current = THEMES.find(t => t.id === themeId) || THEMES[0]

  return (
    <div className="relative" ref={ref}>
      <button
        className="btn-ghost btn-sm flex items-center gap-1.5"
        onClick={() => setOpen(o => !o)}
        title="Change theme"
        aria-label="Change theme"
      >
        <span>🎨</span>
        <span className="hidden sm:inline text-xs">{current.label}</span>
      </button>

      {open && (
        <div className="theme-dropdown">
          {THEMES.map(theme => (
            <button
              key={theme.id}
              className={`theme-option${theme.id === themeId ? ' theme-option-active' : ''}`}
              onClick={() => { setThemeId(theme.id); setOpen(false) }}
            >
              {theme.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
