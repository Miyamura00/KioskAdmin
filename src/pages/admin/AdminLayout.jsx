// src/pages/admin/AdminLayout.jsx
import { useState, useRef, useEffect } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth }  from '../../context/AuthContext'
import { useAdmin } from '../../context/AdminContext'
import { auth }     from '../../firebase/config'
import '../../styles/admin.css'

const NAV_ITEMS = [
  { path:'/admin',           label:'Dashboard',        icon:'📊' },
  { path:'/admin/rates',     label:'Rate Management',  icon:'💰' },
  { path:'/admin/holidays',  label:'Holiday Schedule', icon:'📅' },
  { path:'/admin/audit',     label:'Audit Trail',      icon:'📋' },
]
const SUPER_ITEMS = [
  { path:'/admin/branches',  label:'Branches', icon:'🏢' },
  { path:'/admin/users',     label:'Users',    icon:'👥' },
]
const BOTTOM_ITEMS = [
  { path:'/admin/settings',  label:'My Settings', icon:'⚙️' },
]
const PAGE_TITLES = {
  '/admin':          'Dashboard',
  '/admin/rates':    'Rate Management',
  '/admin/holidays': 'Holiday Schedule',
  '/admin/branches': 'Branch Management',
  '/admin/users':    'User Management',
  '/admin/audit':    'Audit Trail',
  '/admin/settings': 'My Settings',
}

// ── Searchable branch dropdown ────────────────────────────
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
    <div ref={ref} style={{ position:'relative', minWidth:220 }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'8px 12px', border:'2px solid #e0e0e0', borderRadius:8,
          background:'#fff', cursor:'pointer', fontSize:'0.88rem', fontWeight:600,
          transition:'border-color 0.2s', userSelect:'none',
          ...(open ? { borderColor:'#d10c0c' } : {}),
        }}
      >
        <span style={{ color: selected ? '#333' : '#aaa', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {selected ? (selected.name || selected.id) : 'Select Branch…'}
        </span>
        <span style={{ marginLeft:8, color:'#888', fontSize:'0.7rem', flexShrink:0 }}>
          {open ? '▲' : '▼'}
        </span>
      </div>

      {open && (
        <div style={{
          position:'absolute', top:'calc(100% + 4px)', left:0, right:0,
          background:'#fff', border:'2px solid #d10c0c', borderRadius:8,
          boxShadow:'0 8px 24px rgba(0,0,0,0.15)', zIndex:300, overflow:'hidden',
        }}>
          <div style={{ padding:'8px 10px', borderBottom:'1px solid #eee' }}>
            <input
              autoFocus
              type="text"
              placeholder="Search branch…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onClick={e => e.stopPropagation()}
              style={{ width:'100%', padding:'6px 10px', border:'1px solid #e0e0e0', borderRadius:6, fontSize:'0.85rem', outline:'none' }}
            />
          </div>
          <div style={{ maxHeight:200, overflowY:'auto' }}>
            <div onClick={() => pick(null)}
              style={{ padding:'9px 14px', cursor:'pointer', fontSize:'0.85rem', color:'#aaa', borderBottom:'1px solid #f5f5f5' }}
              onMouseEnter={e => e.currentTarget.style.background='#f9f9f9'}
              onMouseLeave={e => e.currentTarget.style.background='transparent'}>
              — Select Branch —
            </div>
            {filtered.length === 0 && (
              <div style={{ padding:'10px 14px', color:'#bbb', fontSize:'0.83rem' }}>No branches found.</div>
            )}
            {filtered.map(b => (
              <div key={b.id} onClick={() => pick(b)}
                style={{
                  padding:'9px 14px', cursor:'pointer', fontSize:'0.85rem',
                  fontWeight: b.id === value ? 700 : 400,
                  background: b.id === value ? '#fff5f5' : 'transparent',
                  color: b.id === value ? '#d10c0c' : '#333',
                  borderBottom:'1px solid #f5f5f5',
                }}
                onMouseEnter={e => { if (b.id !== value) e.currentTarget.style.background='#f9f9f9' }}
                onMouseLeave={e => { if (b.id !== value) e.currentTarget.style.background='transparent' }}>
                {b.name || b.id}
                <span style={{ color:'#ccc', fontSize:'0.72rem', marginLeft:6 }}>{b.id}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main layout ───────────────────────────────────────────
export function AdminLayout() {
  const { currentUser, userProfile }                       = useAuth()
  const { allBranches, activeBranchId, setActiveBranchId } = useAdmin()
  const navigate   = useNavigate()
  const location   = useLocation()
  const isSuperAdmin = userProfile?.role === 'superadmin'

  const initials = (userProfile?.displayName || currentUser?.email || '?')
    .split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)

  const showBranchSel = ['/admin/rates', '/admin/holidays'].includes(location.pathname)
  const title         = PAGE_TITLES[location.pathname] || 'Admin'
  const navItems      = [...NAV_ITEMS, ...(isSuperAdmin ? SUPER_ITEMS : [])]

  function isActive(path) {
    return path === '/admin'
      ? location.pathname === '/admin'
      : location.pathname.startsWith(path)
  }

  async function handleSignOut() {
    await auth.signOut()
    navigate('/login')
  }

  return (
    <div style={{ display:'flex', height:'100vh', overflow:'hidden' }}>

      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="logo-icon">🏨</span>
          <span className="logo-text">KioskAdmin</span>
        </div>

        <nav className="sidebar-nav">
          {navItems.map(item => (
            <a key={item.path} href="#"
              className={`nav-link ${isActive(item.path) ? 'active' : ''}`}
              onClick={e => { e.preventDefault(); navigate(item.path) }}>
              <span className="nav-icon">{item.icon}</span> {item.label}
            </a>
          ))}

          {/* Divider before Settings */}
          <div style={{ borderTop:'1px solid rgba(255,255,255,0.08)', margin:'8px 0' }} />

          {BOTTOM_ITEMS.map(item => (
            <a key={item.path} href="#"
              className={`nav-link ${isActive(item.path) ? 'active' : ''}`}
              onClick={e => { e.preventDefault(); navigate(item.path) }}>
              <span className="nav-icon">{item.icon}</span> {item.label}
            </a>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-badge">
            <div className="user-avatar">{initials}</div>
            <div>
              <div className="user-name">{userProfile?.displayName || currentUser?.email}</div>
              <div className="user-role">{(userProfile?.role || 'user').toUpperCase()}</div>
            </div>
          </div>
          <button className="btn-signout" onClick={handleSignOut}>Sign Out</button>
        </div>
      </aside>

      {/* Right side */}
      <div style={{
        marginLeft: 'var(--sidebar-w)', flex:1,
        display:'flex', flexDirection:'column',
        height:'100vh', overflow:'hidden', minWidth:0,
      }}>
        {/* Topbar */}
        <div className="topbar" style={{ flexShrink:0 }}>
          <h1 className="page-title">{title}</h1>
          <div className="topbar-right">
            {showBranchSel && (
              <BranchSearchSelect
                branches={allBranches}
                value={activeBranchId}
                onChange={setActiveBranchId}
              />
            )}
          </div>
        </div>

        {/* Scrollable content */}
        <div style={{ flex:1, overflowY:'auto', overflowX:'hidden' }}>
          <Outlet />
        </div>
      </div>

    </div>
  )
}
