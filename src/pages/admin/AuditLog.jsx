// src/pages/admin/AuditLog.jsx
import { useState, useEffect } from 'react'
import { db }        from '../../firebase/config'
import firebase      from '../../firebase/config'
import { useAuth }   from '../../context/AuthContext'
import { useAdmin }  from '../../context/AdminContext'
import { useAudit }  from '../../hooks/useAudit'
import { Toast }     from '../../components/Toast'
import { useToast }  from '../../hooks/useToast'
import * as XLSX     from 'xlsx'

const ACTION_TYPES = [
  { key:'ALL',                   label:'All Actions'        },
  { key:'UPDATE_RATES',          label:'Rates Updated'      },
  { key:'ROLLBACK_RATES',        label:'Rates Rolled Back'  },
  { key:'APPLY_SCHEDULED_RATES', label:'Scheduled Applied'  },
  { key:'UPDATE_SCHEDULE',       label:'Schedule Changed'   },
  { key:'ADD_HOLIDAY',           label:'Holiday Added'      },
  { key:'UPDATE_HOLIDAY',        label:'Holiday Updated'    },
  { key:'DELETE_HOLIDAY',        label:'Holiday Deleted'    },
  { key:'CREATE_BRANCH',         label:'Branch Created'     },
  { key:'UPDATE_BRANCH',         label:'Branch Updated'     },
  { key:'DELETE_BRANCH',         label:'Branch Deleted'     },
  { key:'ADD_SLOT',              label:'Slot Added'         },
  { key:'RENAME_SLOT',           label:'Slot Renamed'       },
  { key:'DELETE_SLOT',           label:'Slot Deleted'       },
  { key:'CREATE_USER',           label:'User Created'       },
  { key:'UPDATE_USER',           label:'User Updated'       },
  { key:'DELETE_USER',           label:'User Deleted'       },
  { key:'RESET_PASSWORD',        label:'Password Reset'     },
  { key:'CLEAR_AUDIT_LOG',       label:'Audit Log Cleared'  },
]

function getPillClass(action) {
  if (!action) return 'audit-pill-other'
  if (action.includes('RATE') || action.includes('ROLLBACK') || action.includes('SCHEDULED')) return 'audit-pill-rates'
  if (action.includes('SCHEDULE')) return 'audit-pill-schedule'
  if (action.includes('HOLIDAY'))  return 'audit-pill-holiday'
  if (action.includes('BRANCH'))   return 'audit-pill-branch'
  if (action.includes('USER') || action.includes('PASSWORD')) return 'audit-pill-user'
  if (action.includes('SLOT') || action.includes('ROOM'))     return 'audit-pill-slot'
  if (action.includes('CLEAR'))    return 'audit-pill-branch'
  return 'audit-pill-other'
}

function friendlyAction(action) {
  return (action || '').replace(/_/g,' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

function formatTs(ts) {
  if (!ts?.toDate) return '—'
  return ts.toDate().toLocaleString('en-US', {
    year:'numeric', month:'short', day:'numeric',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:true,
  })
}

const PAGE_SIZE = 50

export function AuditLog() {
  const { currentUser, userProfile } = useAuth()
  const { allBranches }              = useAdmin()
  const { logAction }                = useAudit(currentUser, userProfile)
  const { toast, showToast }         = useToast()

  const isSuperAdmin     = userProfile?.role === 'superadmin'
  const assignedBranches = userProfile?.branches || []
  const hasAllAccess     = assignedBranches.includes('*') || isSuperAdmin

  const [allLogs,      setAllLogs]      = useState([])
  const [loading,      setLoading]      = useState(true)
  const [filter,       setFilter]       = useState('ALL')
  const [branchFilter, setBranchFilter] = useState('')
  const [userFilter,   setUserFilter]   = useState('')
  const [clearing,     setClearing]     = useState(false)
  const [page,         setPage]         = useState(1)

  useEffect(() => { fetchLogs() }, [])

  async function fetchLogs() {
    setLoading(true)
    try {
      const snap = await db.collection('auditLogs')
        .orderBy('timestamp', 'desc').limit(1000).get()
      let all = snap.docs.map(d => ({ id: d.id, ...d.data() }))

      // Non-superadmin: only see logs for their assigned branches
      if (!isSuperAdmin) {
        all = all.filter(log => {
          if (!log.branchId) return false
          if (hasAllAccess)  return true
          return assignedBranches.includes(log.branchId)
        })
      }

      setAllLogs(all)
      setPage(1)
    } catch (err) {
      showToast('Error loading logs: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  // Branch selector only shows branches the user can access
  const visibleBranches = isSuperAdmin
    ? allBranches
    : allBranches.filter(b => hasAllAccess || assignedBranches.includes(b.id))

  const filtered = allLogs.filter(log => {
    if (filter !== 'ALL' && log.action !== filter) return false
    if (branchFilter && log.branchId !== branchFilter) return false
    if (userFilter &&
        !log.userEmail?.toLowerCase().includes(userFilter.toLowerCase()) &&
        !log.userName?.toLowerCase().includes(userFilter.toLowerCase())) return false
    return true
  })

  const paginated = filtered.slice(0, page * PAGE_SIZE)
  const hasMore   = paginated.length < filtered.length

  function exportToExcel(logsToExport, filename) {
    const rows = [
      ['Date & Time','Action','Details','Branch','User','Email'],
      ...logsToExport.map(log => [
        formatTs(log.timestamp),
        friendlyAction(log.action),
        log.details    || '',
        log.branchName || log.branchId || '',
        log.userName   || '',
        log.userEmail  || '',
      ])
    ]
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{wch:22},{wch:22},{wch:42},{wch:18},{wch:18},{wch:26}]
    XLSX.utils.book_append_sheet(wb, ws, 'Audit Log')
    XLSX.writeFile(wb, filename)
  }

  function handleExport() {
    if (!filtered.length) { showToast('No logs to export.', 'warn'); return }
    exportToExcel(filtered, `audit-log-${new Date().toISOString().slice(0,10)}.xlsx`)
    showToast('Exported!')
  }

  async function handleClearLogs() {
    if (!confirm('⚠️ CLEAR ALL AUDIT LOGS\n\nThis will permanently delete ALL entries.\n\nClick OK to download a backup first, then clear.\nClick Cancel to abort.')) return
    setClearing(true)
    try {
      const backupSnap = await db.collection('auditLogs').orderBy('timestamp','desc').limit(5000).get()
      const backupLogs = backupSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      if (!backupLogs.length) { showToast('No logs to clear.', 'warn'); return }
      exportToExcel(backupLogs, `audit-log-backup-${new Date().toISOString().slice(0,10)}.xlsx`)
      await new Promise(r => setTimeout(r, 800))
      for (let i = 0; i < backupSnap.docs.length; i += 400) {
        const batch = db.batch()
        backupSnap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref))
        await batch.commit()
      }
      await logAction('CLEAR_AUDIT_LOG', `Cleared ${backupLogs.length} audit log entries. Backup downloaded.`)
      showToast(`✅ Cleared ${backupLogs.length} entries. Backup saved.`)
      fetchLogs()
    } catch (err) {
      showToast('Error: ' + err.message, 'error')
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="page">
      <Toast toast={toast} />

      {!isSuperAdmin && (
        <div style={{ background:'#e8f4fd', border:'1px solid #bee3f8', borderRadius:8, padding:'9px 14px', marginBottom:14, fontSize:'0.82rem', color:'#1a6fa0' }}>
          ℹ️ You are viewing audit logs for your assigned branches only.
        </div>
      )}

      <div className="card">
        <div className="card-header-row">
          <div>
            <h2 className="card-title">Audit Trail</h2>
            <p style={{ color:'#888', fontSize:'0.8rem', marginTop:3 }}>
              {loading ? 'Loading…' : `${filtered.length} entries`}
              {(filter !== 'ALL' || branchFilter || userFilter) ? ' (filtered)' : ''}
            </p>
          </div>
          <div className="action-group">
            <button className="btn btn-outline" style={{ fontSize:'0.8rem' }} onClick={fetchLogs} disabled={loading}>🔄 Refresh</button>
            <button className="btn btn-blue"    style={{ fontSize:'0.8rem' }} onClick={handleExport}>📥 Export Excel</button>
            {isSuperAdmin && (
              <button className="btn btn-danger" style={{ fontSize:'0.8rem' }} onClick={handleClearLogs} disabled={clearing}>
                {clearing ? 'Clearing…' : '🗑 Clear Data'}
              </button>
            )}
          </div>
        </div>

        <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap', alignItems:'center' }}>
          <select value={filter} onChange={e => { setFilter(e.target.value); setPage(1) }}
            style={{ padding:'7px 10px', borderRadius:7, border:'2px solid #e0e0e0', fontSize:'0.83rem', fontFamily:'inherit' }}>
            {ACTION_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>

          <select value={branchFilter} onChange={e => { setBranchFilter(e.target.value); setPage(1) }}
            style={{ padding:'7px 10px', borderRadius:7, border:'2px solid #e0e0e0', fontSize:'0.83rem', fontFamily:'inherit' }}>
            <option value="">All Branches</option>
            {visibleBranches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>

          {isSuperAdmin && (
            <input type="text" placeholder="Search user…" value={userFilter}
              onChange={e => { setUserFilter(e.target.value); setPage(1) }}
              style={{ padding:'7px 10px', borderRadius:7, border:'2px solid #e0e0e0', fontSize:'0.83rem', width:160 }} />
          )}

          {(filter !== 'ALL' || branchFilter || userFilter) && (
            <button className="btn btn-ghost" style={{ fontSize:'0.82rem' }}
              onClick={() => { setFilter('ALL'); setBranchFilter(''); setUserFilter(''); setPage(1) }}>
              ✕ Clear Filters
            </button>
          )}
        </div>

        {loading ? <p className="hint">Loading…</p> :
         filtered.length === 0 ? <p className="hint">No audit log entries found.</p> : (
          <>
            <div style={{ overflowX:'auto', overflowY:'auto', maxHeight:520, border:'1px solid #e0e0e0', borderRadius:8 }}>
              <table className="audit-table" style={{ minWidth: isSuperAdmin ? 820 : 620 }}>
                <thead style={{ position:'sticky', top:0, zIndex:2 }}>
                  <tr>
                    <th style={{ width:170, background:'#f0f0f0' }}>Date &amp; Time</th>
                    <th style={{ width:160, background:'#f0f0f0' }}>Action</th>
                    <th style={{ background:'#f0f0f0' }}>Details</th>
                    <th style={{ width:120, background:'#f0f0f0' }}>Branch</th>
                    {isSuperAdmin && <th style={{ width:155, background:'#f0f0f0' }}>By</th>}
                  </tr>
                </thead>
                <tbody>
                  {paginated.map(log => (
                    <tr key={log.id}>
                      <td style={{ fontSize:'0.78rem', color:'#666', whiteSpace:'nowrap' }}>{formatTs(log.timestamp)}</td>
                      <td>
                        <span className={`audit-action-pill ${getPillClass(log.action)}`}>
                          {friendlyAction(log.action)}
                        </span>
                      </td>
                      <td style={{ fontSize:'0.83rem' }}>{log.details || '—'}</td>
                      <td style={{ fontSize:'0.79rem', color:'#555' }}>
                        {log.branchName || (log.branchId ? <code style={{ fontSize:'0.72rem' }}>{log.branchId}</code> : <span style={{ color:'#bbb' }}>—</span>)}
                      </td>
                      {isSuperAdmin && (
                        <td style={{ fontSize:'0.79rem' }}>
                          <div style={{ fontWeight:700 }}>{log.userName}</div>
                          <div style={{ color:'#888', fontSize:'0.72rem' }}>{log.userEmail}</div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {hasMore && (
              <div style={{ textAlign:'center', marginTop:12 }}>
                <button className="btn btn-outline" onClick={() => setPage(p => p+1)}>
                  Load More ({filtered.length - paginated.length} remaining)
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {isSuperAdmin && (
        <div style={{ padding:'10px 14px', background:'#fff3cd', border:'1px solid #ffe082', borderRadius:8, fontSize:'0.82rem', color:'#856404' }}>
          ℹ️ <strong>Clear Data</strong> downloads a full backup first, then deletes all entries and logs who cleared it.
        </div>
      )}
    </div>
  )
}
