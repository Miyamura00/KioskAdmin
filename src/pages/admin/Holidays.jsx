// src/pages/admin/Holidays.jsx
import { useState, useEffect } from 'react'
import { useAdmin }  from '../../context/AdminContext'
import { useAuth }   from '../../context/AuthContext'
import { db }        from '../../firebase/config'
import firebase      from '../../firebase/config'
import { Modal }     from '../../components/Modal'
import { Toast }     from '../../components/Toast'
import { useToast }  from '../../hooks/useToast'
import { useAudit }  from '../../hooks/useAudit'

function formatDateTime(date, time) {
  if (!date) return '—'
  const d  = new Date(date + 'T00:00:00')
  const ds = d.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' })
  return time ? `${ds} ${time}` : ds
}

export function Holidays() {
  const { activeBranchId } = useAdmin()
  const { currentUser, userProfile }    = useAuth()
  const { toast, showToast }            = useToast()
  const { logAction }                   = useAudit(currentUser, userProfile)

  // Role checks
  const isSuperAdmin = userProfile?.role === 'superadmin'
  const isAdminUp    = ['admin', 'superadmin'].includes(userProfile?.role)

  const [systemBranches, setSystemBranches] = useState([])
  const [globalHolidays, setGlobalHolidays] = useState([])
  const [loading,        setLoading]        = useState(true)
  const [savingHol,      setSavingHol]      = useState(false)

  // Modal state
  const [holModal,        setHolModal]        = useState(false)
  const [editId,          setEditId]          = useState(null)
  const [holName,         setHolName]         = useState('')
  const [holStart,        setHolStart]        = useState('')
  const [holEnd,          setHolEnd]          = useState('')
  const [holStartTime,    setHolStartTime]    = useState('00:00')
  const [holEndTime,      setHolEndTime]      = useState('23:59')
  const [holBranches,     setHolBranches]     = useState([])
  const [allBranchToggle, setAllBranchToggle] = useState(true)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const snap = await db.collection('branches').orderBy('name').get()
      setSystemBranches(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      await loadGlobalHolidays()
    } catch (err) { showToast('Error: ' + err.message, 'error') }
    finally { setLoading(false) }
  }

  async function loadGlobalHolidays() {
    const snap = await db.collection('holidays').orderBy('start').get()
    setGlobalHolidays(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  function openAdd() {
    setEditId(null); setHolName(''); setHolStart(''); setHolEnd('')
    setHolStartTime('00:00'); setHolEndTime('23:59')
    setAllBranchToggle(true); setHolBranches([]); setHolModal(true)
  }

  function openEdit(h) {
    setEditId(h.id); setHolName(h.name); setHolStart(h.start); setHolEnd(h.end)
    setHolStartTime(h.startTime || '00:00'); setHolEndTime(h.endTime || '23:59')
    const isAll = (h.branches || ['*']).includes('*')
    setAllBranchToggle(isAll)
    setHolBranches(isAll ? [] : (h.branches || []))
    setHolModal(true)
  }

  function toggleHolBranch(id) {
    setHolBranches(prev => prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id])
  }

  function getEffectiveBranches() { return allBranchToggle ? ['*'] : holBranches }

  function branchLabel(h) {
    const br = h.branches || ['*']
    if (br.includes('*')) return 'All Branches'
    return br.map(id => systemBranches.find(b => b.id === id)?.name || id).join(', ') || 'None'
  }

  async function saveHoliday() {
    if (!holName || !holStart || !holEnd) { showToast('Fill name and dates.', 'warn'); return }
    if (holStart > holEnd) { showToast('End date must be on or after start.', 'warn'); return }
    setSavingHol(true)
    const entry = {
      name: holName.trim(), start: holStart, end: holEnd,
      startTime: holStartTime || '00:00', endTime: holEndTime || '23:59',
      branches: getEffectiveBranches(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: currentUser.email,
    }
    try {
      if (editId) {
        await db.collection('holidays').doc(editId).update(entry)
        await logAction('UPDATE_HOLIDAY', `Updated holiday "${holName}"`)
        showToast('Holiday updated!')
      } else {
        await db.collection('holidays').add({ ...entry, createdAt: firebase.firestore.FieldValue.serverTimestamp(), createdBy: currentUser.email })
        await logAction('ADD_HOLIDAY', `Added holiday "${holName}" (${holStart} – ${holEnd})`)
        showToast('Holiday added!')
      }
      setHolModal(false)
      loadGlobalHolidays()
    } catch (err) { showToast('Error: ' + err.message, 'error') }
    finally { setSavingHol(false) }
  }

  async function deleteHoliday(h) {
    if (!confirm(`Remove holiday "${h.name}"?`)) return
    await db.collection('holidays').doc(h.id).delete()
    await logAction('DELETE_HOLIDAY', `Deleted holiday "${h.name}"`)
    showToast('Holiday removed.', 'warn')
    loadGlobalHolidays()
  }

  const now   = new Date()

  function getStatus(h) {
    const start = new Date(h.start + 'T' + (h.startTime || '00:00'))
    const end   = new Date(h.end   + 'T' + (h.endTime   || '23:59'))
    if (now >= start && now <= end) return 'active'
    if (end < now) return 'past'
    return 'upcoming'
  }

  return (
    <div className="page">
      <Toast toast={toast} />

      {/* Global Holiday Events */}
      <div className="card">
        <div className="card-header-row">
          <div>
            <h2 className="card-title">Holiday Events</h2>
            <p style={{ color:'#666', fontSize:'0.82rem', marginTop:3 }}>
              Global — choose which branches are affected by each holiday.
            </p>
          </div>
          {/* Only admin+ can add holidays */}
          {isAdminUp && (
            <button className="btn btn-primary" onClick={openAdd}>+ Add Holiday</button>
          )}
        </div>

        {/* Role notice for plain users */}
        {!isAdminUp && (
          <div style={{ background:'#e8f4fd', border:'1px solid #bee3f8', borderRadius:6, padding:'8px 12px', marginBottom:12, fontSize:'0.82rem', color:'#1a6fa0' }}>
            ℹ️ You can view holiday events. Contact an Admin to add, edit, or remove holidays.
          </div>
        )}

        {loading ? <p className="hint">Loading…</p> :
         globalHolidays.length === 0 ? (
          <p className="hint">No holidays scheduled.{isAdminUp ? ' Click + Add Holiday.' : ''}</p>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table className="holiday-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Start Date &amp; Time</th>
                  <th>End Date &amp; Time</th>
                  <th>Affected Branches</th>
                  <th>Status</th>
                  {isAdminUp && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {globalHolidays.map(h => {
                  const status = getStatus(h)
                  const statusStyle = {
                    active:   { background:'#ffc10733', color:'#856404' },
                    upcoming: { background:'#d10c0c22', color:'#d10c0c' },
                    past:     { background:'#88888822', color:'#888'    },
                  }
                  return (
                    <tr key={h.id}>
                      <td><strong>{h.name}</strong></td>
                      <td style={{ fontSize:'0.83rem', whiteSpace:'nowrap' }}>{formatDateTime(h.start, h.startTime)}</td>
                      <td style={{ fontSize:'0.83rem', whiteSpace:'nowrap' }}>{formatDateTime(h.end, h.endTime)}</td>
                      <td style={{ fontSize:'0.8rem', maxWidth:180 }}>{branchLabel(h)}</td>
                      <td>
                        <span className="holiday-badge" style={statusStyle[status]}>
                          {status.charAt(0).toUpperCase() + status.slice(1)}
                        </span>
                      </td>
                      {isAdminUp && (
                        <td>
                          <div style={{ display:'flex', gap:5 }}>
                            <button className="btn btn-outline" style={{ padding:'4px 9px', fontSize:'0.76rem' }}
                              onClick={() => openEdit(h)}>Edit</button>
                            {/* Only superadmin can delete */}
                            {isSuperAdmin && (
                              <button className="btn btn-danger" style={{ padding:'4px 9px', fontSize:'0.76rem' }}
                                onClick={() => deleteHoliday(h)}>Remove</button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Modal — only admin+ */}
      {isAdminUp && (
        <Modal show={holModal} onClose={() => setHolModal(false)}
          title={editId ? 'Edit Holiday Event' : 'Add Holiday Event'} wide
          actions={
            <>
              <button className="btn btn-ghost" onClick={() => setHolModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveHoliday} disabled={savingHol}>
                {savingHol ? 'Saving…' : editId ? 'Update' : 'Add Holiday'}
              </button>
            </>
          }
        >
          <div className="form-group">
            <label>Event Name</label>
            <input type="text" placeholder="e.g. Christmas Day" value={holName} onChange={e => setHolName(e.target.value)} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Start Date</label>
              <input type="date" value={holStart} onChange={e => setHolStart(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Start Time</label>
              <input type="time" value={holStartTime} onChange={e => setHolStartTime(e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>End Date</label>
              <input type="date" value={holEnd} onChange={e => setHolEnd(e.target.value)} />
            </div>
            <div className="form-group">
              <label>End Time</label>
              <input type="time" value={holEndTime} onChange={e => setHolEndTime(e.target.value)} />
            </div>
          </div>
          <p style={{ fontSize:'0.78rem', color:'#888', marginBottom:12, marginTop:-6 }}>
            💡 Holiday rates activate between start and end date/time on the kiosk.
          </p>
          <div className="form-group">
            <label>Affected Branches</label>
            <div className="checkbox-grid" style={{ maxHeight:200 }}>
              <label style={{ gridColumn:'1/-1', borderBottom:'1px solid #eee', paddingBottom:6, marginBottom:4 }}>
                <input type="checkbox" checked={allBranchToggle}
                  onChange={e => { setAllBranchToggle(e.target.checked); if (e.target.checked) setHolBranches([]) }} />
                &nbsp;<strong>All Branches</strong>
              </label>
              {systemBranches.map(b => (
                <label key={b.id}>
                  <input type="checkbox"
                    checked={allBranchToggle || holBranches.includes(b.id)}
                    disabled={allBranchToggle}
                    onChange={() => toggleHolBranch(b.id)} />
                  &nbsp;{b.name || b.id}
                </label>
              ))}
            </div>
            <small>Only checked branches will switch to holiday rates during this event.</small>
          </div>
        </Modal>
      )}
    </div>
  )
}
