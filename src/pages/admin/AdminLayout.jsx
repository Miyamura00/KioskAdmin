// src/pages/admin/AdminLayout.jsx
import { useState, useRef, useEffect, useCallback } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth }  from '../../context/AuthContext'
import { useAdmin } from '../../context/AdminContext'
import { auth }     from '../../firebase/config'
import { useAutoBackup } from '../../hooks/useAutoBackup'
import '../../styles/admin.css'

const NAV_ITEMS = [
  { path: '/admin',          label: 'Dashboard',        icon: '📊' },
  { path: '/admin/rates',    label: 'Rate Management',  icon: '💰' },
  { path: '/admin/holidays', label: 'Holiday Schedule', icon: '📅' },
  { path: '/admin/audit',    label: 'Audit Trail',      icon: '📋' },
  { path: '/admin/backup',   label: 'Data Backup',      icon: '📦' },
]
const SUPER_ITEMS = [
  { path: '/admin/branches', label: 'Branches', icon: '🏢' },
  { path: '/admin/users',    label: 'Users',    icon: '👥' },
]
const BOTTOM_ITEMS = [
  { path: '/admin/settings', label: 'My Settings', icon: '⚙️' },
]
const PAGE_TITLES = {
  '/admin':          'Dashboard',
  '/admin/rates':    'Rate Management',
  '/admin/holidays': 'Holiday Schedule',
  '/admin/branches': 'Branch Management',
  '/admin/users':    'User Management',
  '/admin/audit':    'Audit Trail',
  '/admin/settings': 'My Settings',
  '/admin/backup':   'Data Backup',
}

// ── SVG Icons ──────────────────────────────────────────────
function IconMenu() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="2" y="3.5"  width="14" height="1.75" rx="0.875" fill="currentColor"/>
      <rect x="2" y="8.1"  width="14" height="1.75" rx="0.875" fill="currentColor"/>
      <rect x="2" y="12.7" width="14" height="1.75" rx="0.875" fill="currentColor"/>
    </svg>
  )
}

function IconSignOut() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path d="M5.5 13H3a1 1 0 01-1-1V3a1 1 0 011-1h2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M10 10.5L13 7.5l-3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M13 7.5H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

// ── Hook: window width ─────────────────────────────────────
function useWindowWidth() {
  const [w, setW] = useState(typeof window !== 'undefined' ? window.innerWidth : 1280)
  useEffect(() => {
    const handler = () => setW(window.innerWidth)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return w
}

// ── Searchable branch dropdown ─────────────────────────────
function BranchSearchSelect({ branches, value, onChange }) {
  const [query, setQuery] = useState('')
  const [open,  setOpen]  = useState(false)
  const ref               = useRef(null)

  const selected = branches.find(b => b.id === value)
  const filtered = branches.filter(b =>
    !query || (b.name || b.id).toLowerCase().includes(query.toLowerCase())
  )

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function pick(b) { onChange(b ? b.id : ''); setQuery(''); setOpen(false) }

  return (
    <div ref={ref} className="branch-search-wrap">
      <div
        className={`branch-search-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen(o => !o)}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && setOpen(o => !o)}
      >
        <span className={selected ? 'bs-selected' : 'bs-placeholder'}>
          {selected ? (selected.name || selected.id) : 'Select Branch…'}
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={`bs-chevron${open ? ' open' : ''}`}>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      {open && (
        <div className="branch-search-dropdown">
          <div className="bs-search-wrap">
            <input
              autoFocus
              type="text"
              placeholder="Search branch…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onClick={e => e.stopPropagation()}
              className="bs-input"
            />
          </div>
          <div className="bs-list">
            <div className="bs-item bs-item-reset" onClick={() => pick(null)}>
              — Select Branch —
            </div>
            {filtered.length === 0 && (
              <div className="bs-empty">No branches found.</div>
            )}
            {filtered.map(b => (
              <div
                key={b.id}
                className={`bs-item${b.id === value ? ' selected' : ''}`}
                onClick={() => pick(b)}
              >
                <span className="bs-item-name">{b.name || b.id}</span>
                <span className="bs-item-id">{b.id}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main layout ────────────────────────────────────────────
export function AdminLayout() {
  const { currentUser, userProfile }                       = useAuth()
  const { allBranches, activeBranchId, setActiveBranchId } = useAdmin()
  const navigate   = useNavigate()
  const location   = useLocation()
  const windowW    = useWindowWidth()
  const isMobile   = windowW <= 768

  useAutoBackup()

  // On desktop: true = sidebar completely hidden, false = sidebar fully visible
  const [sidebarHidden, setSidebarHidden] = useState(() =>
    localStorage.getItem('admin_sidebar_hidden') === 'true'
  )
  const [mobileOpen, setMobileOpen] = useState(false)

  const isSuperAdmin = userProfile?.role === 'superadmin'

  const initials = (userProfile?.displayName || currentUser?.email || '?')
    .split(/[\s@]/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2)

  const showBranchSel = ['/admin/rates', '/admin/holidays'].includes(location.pathname)
  const title         = PAGE_TITLES[location.pathname] || 'Admin'
  const navItems      = [...NAV_ITEMS, ...(isSuperAdmin ? SUPER_ITEMS : [])]

  // Close mobile sidebar on route change
  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  // Persist hidden state
  useEffect(() => {
    localStorage.setItem('admin_sidebar_hidden', sidebarHidden)
  }, [sidebarHidden])

  // Prevent body scroll when mobile sidebar is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  function isActive(path) {
    return path === '/admin'
      ? location.pathname === '/admin'
      : location.pathname.startsWith(path)
  }

  const handleToggle = useCallback(() => {
    if (isMobile) {
      setMobileOpen(o => !o)
    } else {
      // Desktop: fully show or fully hide
      setSidebarHidden(h => !h)
    }
  }, [isMobile])

  async function handleSignOut() {
    await auth.signOut()
    navigate('/login')
  }

  // Desktop: sidebar-hidden = completely hide sidebar + expand main to full width
  const layoutClass = [
    'admin-layout',
    !isMobile && sidebarHidden ? 'sidebar-hidden' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={layoutClass}>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="sidebar-overlay active"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar ── */}
      <aside className={`sidebar${mobileOpen ? ' mobile-open' : ''}`} aria-label="Sidebar navigation">

        {/* Logo */}
        <div className="sidebar-logo">
          <div className="logo-icon-wrap">
            <span role="img" aria-label="hotel" style={{ fontSize: '1.15rem', lineHeight: 1 }}>🏨</span>
          </div>
          <div className="logo-full">
            <span className="logo-name">KioskAdmin</span>
            <span className="logo-sub">Admin Console</span>
          </div>
        </div>

        {/* Nav */}
        <nav className="sidebar-nav" aria-label="Main navigation">
          {navItems.map(item => (
            <a
              key={item.path}
              href="#"
              className={`nav-link${isActive(item.path) ? ' active' : ''}`}
              data-label={item.label}
              aria-current={isActive(item.path) ? 'page' : undefined}
              onClick={e => { e.preventDefault(); navigate(item.path) }}
            >
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </a>
          ))}

          <div className="nav-divider" role="separator" />

          {BOTTOM_ITEMS.map(item => (
            <a
              key={item.path}
              href="#"
              className={`nav-link${isActive(item.path) ? ' active' : ''}`}
              data-label={item.label}
              aria-current={isActive(item.path) ? 'page' : undefined}
              onClick={e => { e.preventDefault(); navigate(item.path) }}
            >
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </a>
          ))}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          <div className="user-badge">
            <div className="user-avatar" aria-hidden="true">{initials}</div>
            <div className="user-info">
              <div className="user-name">{userProfile?.displayName || currentUser?.email}</div>
              <div className="user-role">{(userProfile?.role || 'user').toUpperCase()}</div>
            </div>
          </div>
          <button className="btn-signout" onClick={handleSignOut} aria-label="Sign out">
            <IconSignOut />
            <span className="nav-label">Sign Out</span>
          </button>
        </div>
      </aside>

      {/* ── Right side ── */}
      <div className="main-content">

        {/* Topbar */}
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="sidebar-toggle-btn"
              onClick={handleToggle}
              aria-label={isMobile
                ? (mobileOpen ? 'Close menu' : 'Open menu')
                : (sidebarHidden ? 'Show sidebar' : 'Hide sidebar')
              }
            >
              <IconMenu />
            </button>
            <h1 className="page-title">{title}</h1>
          </div>

          <div className="topbar-right">
            {showBranchSel && (
              <BranchSearchSelect
                branches={allBranches}
                value={activeBranchId}
                onChange={setActiveBranchId}
              />
            )}
          </div>
        </header>

        {/* Page content — overflow-x:clip keeps position:fixed portals working */}
        <div className="page-content">
          <Outlet />
        </div>
      </div>

    </div>
  )
}
