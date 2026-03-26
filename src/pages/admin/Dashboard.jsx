// src/pages/admin/Dashboard.jsx
import { useState, useEffect } from 'react'
import { useNavigate }  from 'react-router-dom'
import { useAuth }      from '../../context/AuthContext'
import { useAdmin }     from '../../context/AdminContext'
import { db }           from '../../firebase/config'

export function Dashboard() {
  const { userProfile }              = useAuth()
  const { allBranches }              = useAdmin()
  const navigate                     = useNavigate()
  const isSuperAdmin                 = userProfile?.role === 'superadmin'
  const [holidays, setHolidays]      = useState([])
  const [loadingHols, setLoadingHols] = useState(true)

  useEffect(() => {
    const unsub = db.collection('holidays')
      .onSnapshot(snap => {
        setHolidays(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        setLoadingHols(false)
      }, () => setLoadingHols(false))
    return unsub
  }, [])

  const now = new Date()

  function holStart(h) { return new Date(h.start + 'T' + (h.startTime || '00:00')) }
  function holEnd(h)   { return new Date(h.end   + 'T' + (h.endTime   || '23:59')) }

  function isActive(h)   { return now >= holStart(h) && now <= holEnd(h) }
  // Upcoming = starts in the future (NOT currently active)
  function isUpcoming(h) { return holStart(h) > now }

  const activeHolidays   = holidays.filter(isActive)
  const upcomingHolidays = holidays.filter(isUpcoming)  // strictly future only

  function branchHolCount(branchId) {
    // Count holidays that are upcoming OR active for this branch
    return holidays.filter(h => {
      const br = h.branches || ['*']
      const affects = br.includes('*') || br.includes(branchId)
      return affects && holEnd(h) >= now  // not yet ended
    }).length
  }

  function fmtDateTime(date, time) {
    if (!date) return '—'
    const d = new Date(date + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
      + (time && time !== '00:00' && time !== '23:59' ? ' ' + time : '')
  }

  function branchLabel(h) {
    const br = h.branches || ['*']
    if (br.includes('*')) return 'All Branches'
    return br.map(id => allBranches.find(b => b.id === id)?.name || id).join(', ')
  }

  const quickLinks = [
    { label:'💰 Manage Rates',    path:'/admin/rates'    },
    { label:'📅 Manage Holidays', path:'/admin/holidays' },
    { label:'📋 Audit Trail',     path:'/admin/audit'    },
    ...(isSuperAdmin ? [
      { label:'🏢 Branches', path:'/admin/branches' },
      { label:'👥 Users',    path:'/admin/users'    },
    ] : []),
  ]

  return (
    <div className="page">

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Branches</div>
          <div className="stat-value">{allBranches.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Your Role</div>
          <div className="stat-value" style={{ fontSize:'1.1rem', paddingTop:6 }}>
            {(userProfile?.role || '—').toUpperCase()}
          </div>
        </div>
        <div className="stat-card" style={{ borderLeftColor:'#e67e22' }}>
          <div className="stat-label">Active Holidays Now</div>
          <div className="stat-value" style={{ color: activeHolidays.length ? '#e67e22' : undefined }}>
            {loadingHols ? '…' : activeHolidays.length}
          </div>
        </div>
        <div className="stat-card">
          {/* Upcoming = future only, does NOT include currently active */}
          <div className="stat-label">Upcoming Holidays</div>
          <div className="stat-value">{loadingHols ? '…' : upcomingHolidays.length}</div>
        </div>
      </div>

      {/* Active Holiday Banner */}
      {activeHolidays.length > 0 && (
        <div style={{
          background:'#fff3cd', border:'1px solid #ffc107',
          borderRadius:10, padding:'14px 18px', marginBottom:18,
        }}>
          <div style={{ fontWeight:800, color:'#856404', marginBottom:8, fontSize:'0.95rem' }}>
            🎉 Active Holiday Events Right Now
          </div>
          {activeHolidays.map(h => (
            <div key={h.id} style={{
              display:'flex', alignItems:'center', gap:10,
              padding:'6px 0', borderTop:'1px solid #ffe082',
            }}>
              <span style={{ fontSize:'1.1rem' }}>📅</span>
              <div>
                <strong style={{ color:'#5a3a00' }}>{h.name}</strong>
                <span style={{ color:'#856404', fontSize:'0.82rem', marginLeft:8 }}>
                  {fmtDateTime(h.start, h.startTime)} – {fmtDateTime(h.end, h.endTime)}
                </span>
                <span style={{
                  marginLeft:8, background:'#856404', color:'#fff',
                  borderRadius:8, padding:'1px 8px', fontSize:'0.72rem', fontWeight:700,
                }}>{branchLabel(h)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Quick Access */}
      <div className="card">
        <h2 className="card-title">Quick Access</h2>
        <p style={{ color:'#666', marginTop:6, fontSize:'0.88rem' }}>
          Select a section from the sidebar to manage your kiosk settings.
        </p>
        <div className="quick-links">
          {quickLinks.map(l => (
            <button key={l.path} className="btn btn-outline" onClick={() => navigate(l.path)}>
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {/* Branch Overview */}
      {allBranches.length > 0 && (
        <div className="card mt20">
          <h2 className="card-title">Branch Overview</h2>
          <div className="item-grid" style={{ marginTop:14 }}>
            {allBranches.map(b => {
              const kioskUrl   = `${window.location.origin}/kiosk?branch=${b.id}`
              const holCount   = branchHolCount(b.id)
              const activNow   = activeHolidays.some(h => {
                const br = h.branches || ['*']
                return br.includes('*') || br.includes(b.id)
              })
              return (
                <div key={b.id} className="item-card"
                  style={activNow ? { borderColor:'#ffc107', borderWidth:2 } : {}}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                    <h3>🏢 {b.name || b.id}</h3>
                    {activNow && (
                      <span style={{
                        background:'#ffc107', color:'#5a3a00', borderRadius:8,
                        padding:'2px 8px', fontSize:'0.7rem', fontWeight:800,
                      }}>HOLIDAY</span>
                    )}
                  </div>
                  <p>{b.location || 'No location set'}</p>
                  <p style={{ marginTop:5, color:'#888', fontSize:'0.76rem' }}>
                    Upcoming holidays:{' '}
                    <strong style={{ color: holCount ? '#e67e22' : undefined }}>{holCount}</strong>
                    {b.settings?.hasDriveIn && (
                      <span style={{ marginLeft:8, color:'#2980b9' }}>🚗 Drive-In</span>
                    )}
                  </p>
                  <div className="item-actions">
                    <a href={kioskUrl} target="_blank" rel="noreferrer"
                      className="btn btn-outline" style={{ fontSize:'0.78rem' }}>
                      🖥 Open Kiosk
                    </a>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Upcoming Holiday Events (future only) */}
      {upcomingHolidays.length > 0 && (
        <div className="card mt20">
          <h2 className="card-title">Upcoming Holiday Events</h2>
          <p style={{ color:'#888', fontSize:'0.8rem', marginTop:4, marginBottom:10 }}>
            These holidays have not started yet.
          </p>
          <table className="holiday-table">
            <thead>
              <tr><th>Event</th><th>Start</th><th>End</th><th>Branches</th></tr>
            </thead>
            <tbody>
              {upcomingHolidays.slice(0, 10).map(h => (
                <tr key={h.id}>
                  <td><strong>{h.name}</strong></td>
                  <td style={{ fontSize:'0.84rem' }}>{fmtDateTime(h.start, h.startTime)}</td>
                  <td style={{ fontSize:'0.84rem' }}>{fmtDateTime(h.end, h.endTime)}</td>
                  <td style={{ fontSize:'0.8rem' }}>{branchLabel(h)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
