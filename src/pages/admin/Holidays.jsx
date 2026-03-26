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

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

function formatDateTime(date, time) {
  if (!date) return '—'
  const d = new Date(date + 'T00:00:00')
  const ds = d.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' })
  return time ? `${ds} ${time}` : ds
}

export function Holidays() {
  const { activeBranchId, allBranches } = useAdmin()
  const { currentUser, userProfile }    = useAuth()
  const { toast, showToast }            = useToast()
  const { logAction }                   = useAudit(currentUser, userProfile)

  const [systemBranches, setSystemBranches] = useState([])
  const [globalHolidays, setGlobalHolidays] = useState([])
  const [loading, setLoading]               = useState(true)
  const [branchSettings, setBranchSettings] = useState({})
  const [savingSchedule, setSavingSchedule] = useState(false)

  // Modal state
  const [holModal, setHolModal]               = useState(false)
  const [editId, setEditId]                   = useState(null)
  const [holName, setHolName]                 = useState('')
  const [holStart, setHolStart]               = useState('')
  const [holEnd, setHolEnd]                   = useState('')
  const [holStartTime, setHolStartTime]       = useState('00:00')
  const [holEndTime, setHolEndTime]           = useState('23:59')
  const [holBranches, setHolBranches]         = useState([])
  const [allBranchToggle, setAllBranchToggle] = useState(true)
  const [savingHol, setSavingHol]             = useState(false)

  const branchName = allBranches.find(b => b.id === activeBranchId)?.name || activeBranchId

  useEffect(() => { loadAll() }, [])
  useEffect(() => { if (activeBranchId) loadBranchSettings() }, [activeBranchId])

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

  async function loadBranchSettings() {
    try {
      const snap = await db.collection('branches').doc(activeBranchId).get()
      setBranchSettings(snap.data()?.settings || {})
    } catch (err) { console.error(err) }
  }

  // ── Weekend Schedule ─────────────────────────────────────
  async function saveSchedule(e) {
    e.preventDefault()
    if (!activeBranchId) return
    setSavingSchedule(true)
    const form = e.target
    const ns = {
      ...branchSettings,
      weekendStartDay:  parseInt(form.wsd.value),
      weekendStartHour: parseInt(form.wsh.value),
      weekendEndDay:    parseInt(form.wed.value),
      weekendEndHour:   parseInt(form.weh.value),
    }
    try {
      await db.collection('branches').doc(activeBranchId).update({ settings: ns })
      setBranchSettings(ns)
      await logAction('UPDATE_SCHEDULE', `Updated weekend schedule for ${branchName}`, activeBranchId, branchName)
      showToast('Weekend schedule saved!')
    } catch (err) { showToast('Error: ' + err.message, 'error') }
    finally { setSavingSchedule(false) }
  }

  // ── Holiday CRUD ─────────────────────────────────────────
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
    if (holStart > holEnd) { showToast('End date must be on or after start date.', 'warn'); return }
    setSavingHol(true)
    const entry = {
      name:       holName.trim(),
      start:      holStart,
      end:        holEnd,
      startTime:  holStartTime || '00:00',
      endTime:    holEndTime   || '23:59',
      branches:   getEffectiveBranches(),
      updatedAt:  firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy:  currentUser.email,
    }
    try {
      if (editId) {
        await db.collection('holidays').doc(editId).update(entry)
        await logAction('UPDATE_HOLIDAY', `Updated holiday "${holName}"`)
        showToast('Holiday updated!')
      } else {
        await db.collection('holidays').add({
          ...entry,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          createdBy: currentUser.email,
        })
        await logAction('ADD_HOLIDAY', `Added holiday "${holName}" (${holStart} ${holStartTime} – ${holEnd} ${holEndTime})`)
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
  const today = new Date(now); today.setHours(0,0,0,0)

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

      {/* Weekend Schedule */}
      {activeBranchId ? (
        <div className="card">
          <h2 className="card-title" style={{ marginBottom: 6 }}>Weekend Rate Schedule</h2>
          <p style={{ color: '#666', fontSize: '0.83rem', marginBottom: 14 }}>
            Branch: <strong>{branchName}</strong>
          </p>
          <form onSubmit={saveSchedule}>
            <div className="settings-row">
              <div className="form-group">
                <label>Weekend Starts (Day)</label>
                <select name="wsd" defaultValue={branchSettings.weekendStartDay ?? 5}>
                  {DAYS.map((d,i) => <option key={i} value={i}>{d}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>At Hour (0–23)</label>
                <input name="wsh" type="number" min="0" max="23" defaultValue={branchSettings.weekendStartHour ?? 6} />
              </div>
              <div className="form-group">
                <label>Weekend Ends (Day)</label>
                <select name="wed" defaultValue={branchSettings.weekendEndDay ?? 0}>
                  {DAYS.map((d,i) => <option key={i} value={i}>{d}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>At Hour (0–23)</label>
                <input name="weh" type="number" min="0" max="23" defaultValue={branchSettings.weekendEndHour ?? 18} />
              </div>
              <div className="form-group" style={{ alignSelf: 'flex-end' }}>
                <button type="submit" className="btn btn-green" disabled={savingSchedule}>
                  {savingSchedule ? 'Saving…' : '✔ Save Schedule'}
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : (
        <div className="card" style={{ background: '#fffbe6', border: '1px solid #ffe082' }}>
          <p style={{ color: '#856404', fontSize: '0.85rem' }}>
            💡 Select a branch from the top bar to manage its weekend schedule. Global holiday events below affect all or selected branches.
          </p>
        </div>
      )}

      {/* Global Holiday Events */}
      <div className="card">
        <div className="card-header-row">
          <div>
            <h2 className="card-title">Holiday Events</h2>
            <p style={{ color: '#666', fontSize: '0.82rem', marginTop: 3 }}>
              Global — choose which branches are affected. Includes start &amp; end time.
            </p>
          </div>
          <button className="btn btn-primary" onClick={openAdd}>+ Add Holiday</button>
        </div>

        {loading ? <p className="hint">Loading…</p> :
         globalHolidays.length === 0 ? (
          <p className="hint">No holidays scheduled. Click <strong>+ Add Holiday</strong>.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="holiday-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Start Date &amp; Time</th>
                  <th>End Date &amp; Time</th>
                  <th>Affected Branches</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {globalHolidays.map(h => {
                  const status = getStatus(h)
                  const statusStyle = {
                    active:   { background: '#ffc10733', color: '#856404' },
                    upcoming: { background: '#d10c0c22', color: '#d10c0c' },
                    past:     { background: '#88888822', color: '#888'    },
                  }
                  return (
                    <tr key={h.id}>
                      <td><strong>{h.name}</strong></td>
                      <td style={{ fontSize: '0.83rem', whiteSpace: 'nowrap' }}>
                        {formatDateTime(h.start, h.startTime)}
                      </td>
                      <td style={{ fontSize: '0.83rem', whiteSpace: 'nowrap' }}>
                        {formatDateTime(h.end, h.endTime)}
                      </td>
                      <td style={{ fontSize: '0.8rem', maxWidth: 180 }}>{branchLabel(h)}</td>
                      <td>
                        <span className="holiday-badge" style={statusStyle[status]}>
                          {status.charAt(0).toUpperCase() + status.slice(1)}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 5 }}>
                          <button className="btn btn-outline" style={{ padding: '4px 9px', fontSize: '0.76rem' }}
                            onClick={() => openEdit(h)}>Edit</button>
                          <button className="btn btn-danger" style={{ padding: '4px 9px', fontSize: '0.76rem' }}
                            onClick={() => deleteHoliday(h)}>Remove</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Modal */}
      <Modal
        show={holModal}
        onClose={() => setHolModal(false)}
        title={editId ? 'Edit Holiday Event' : 'Add Holiday Event'}
        wide
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
          <input type="text" placeholder="e.g. Christmas Day"
            value={holName} onChange={e => setHolName(e.target.value)} />
        </div>

        {/* Start date + time */}
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

        {/* End date + time */}
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

        <p style={{ fontSize: '0.78rem', color: '#888', marginBottom: 12, marginTop: -6 }}>
          💡 Holiday rates will activate between start date/time and end date/time on the kiosk.
        </p>

        <div className="form-group">
          <label>Affected Branches</label>
          <div className="checkbox-grid" style={{ maxHeight: 200 }}>
            <label style={{ gridColumn: '1/-1', borderBottom: '1px solid #eee', paddingBottom: 6, marginBottom: 4 }}>
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
    </div>
  )
}
