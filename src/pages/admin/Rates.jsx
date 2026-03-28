// src/pages/admin/Rates.jsx
import { useState, useEffect, useRef } from 'react'
import { useAdmin }  from '../../context/AdminContext'
import { useAuth }   from '../../context/AuthContext'
import { db }        from '../../firebase/config'
import firebase      from '../../firebase/config'
import { Modal }     from '../../components/Modal'
import { Toast }     from '../../components/Toast'
import { useToast }  from '../../hooks/useToast'
import { useAudit }  from '../../hooks/useAudit'
import * as XLSX     from 'xlsx'

const CATEGORIES = ['weekday','weekend','holiday']
const CAT_COLORS = { weekday:'#444', weekend:'#1a5276', holiday:'#700909' }
const DEFAULT_TIME_SLOTS = {
  weekday: ['24HRS','12HRS','10HRS','10HRS ONP','6HRS','3HRS'],
  weekend: ['24HRS','12HRS','10HRS','6HRS','3HRS'],
  holiday: ['24HRS','12HRS','10HRS','6HRS','3HRS'],
}
const DEFAULT_ROOM_TYPES    = ['Econo','Premium','Deluxe','Regency 2']
const DEFAULT_DRIVEIN_TYPES  = ['Standard','Deluxe']

export function Rates() {
  const { activeBranchId, allBranches } = useAdmin()
  const { currentUser, userProfile }    = useAuth()
  const { toast, showToast }            = useToast()
  const { logAction }                   = useAudit(currentUser, userProfile)
  const isSuperAdmin = userProfile?.role === 'superadmin'
  const fileRef = useRef(null)

  // mode: 'walkin' | 'drivein'
  const [mode, setMode]           = useState('walkin')
  const [hasDriveIn, setHasDriveIn] = useState(false)

  // walk-in
  const [rates, setRates]         = useState({})
  const [timeSlots, setTimeSlots] = useState(DEFAULT_TIME_SLOTS)
  const [roomTypes, setRoomTypes] = useState(DEFAULT_ROOM_TYPES)

  // drive-in
  const [diRates, setDiRates]         = useState({})
  const [diTimeSlots, setDiTimeSlots] = useState(DEFAULT_TIME_SLOTS)
  const [diRoomTypes, setDiRoomTypes] = useState(DEFAULT_DRIVEIN_TYPES)

  // shared settings
  const [rateSchedules, setRateSchedules] = useState({})
  const [openCats, setOpenCats]           = useState({ weekday:true, weekend:false, holiday:false })
  const [loading, setLoading]             = useState(false)
  const [saving, setSaving]               = useState(false)
  const branchName = allBranches.find(b => b.id === activeBranchId)?.name || activeBranchId

  // slot management modal
  const [slotModal, setSlotModal]     = useState(false)
  const [slotCat, setSlotCat]         = useState('weekday')
  const [newSlotName, setNewSlotName] = useState('')
  const [editSlot, setEditSlot]       = useState(null)
  const [editSlotName, setEditSlotName] = useState('')

  // room type modal
  const [roomModal, setRoomModal]     = useState(false)
  const [newRoomType, setNewRoomType] = useState('')
  const [editRoom, setEditRoom]       = useState(null)
  const [editRoomName, setEditRoomName] = useState('')

  // schedule modal
  const [schedModal, setSchedModal]   = useState(false)
  const [schedSlot, setSchedSlot]     = useState(null)  // { cat, slot }
  const [schedFrom, setSchedFrom]     = useState('')
  const [schedTo, setSchedTo]         = useState('')

  useEffect(() => {
    if (activeBranchId) loadRates()
    else resetState()
  }, [activeBranchId])

  function resetState() {
    setRates({}); setTimeSlots(DEFAULT_TIME_SLOTS); setRoomTypes(DEFAULT_ROOM_TYPES)
    setDiRates({}); setDiTimeSlots(DEFAULT_TIME_SLOTS); setDiRoomTypes(DEFAULT_DRIVEIN_TYPES)
    setRateSchedules({}); setHasDriveIn(false); setMode('walkin')
  }

  async function loadRates() {
    setLoading(true)
    try {
      const snap = await db.collection('branches').doc(activeBranchId).get()
      if (!snap.exists) { showToast('Branch not found.','error'); return }
      const d = snap.data()
      setRates(d.rates || {})
      setDiRates(d.driveInRates || {})
      const s = d.settings || {}
      setTimeSlots(s.timeSlots || DEFAULT_TIME_SLOTS)
      setRoomTypes(s.roomTypes || DEFAULT_ROOM_TYPES)
      setDiTimeSlots(s.driveInTimeSlots || DEFAULT_TIME_SLOTS)
      setDiRoomTypes(s.driveInRoomTypes || DEFAULT_DRIVEIN_TYPES)
      setRateSchedules(s.rateSchedules || {})
      setHasDriveIn(s.hasDriveIn === true)
    } catch (err) { showToast('Error loading: ' + err.message,'error') }
    finally { setLoading(false) }
  }

  // active set based on mode
  const activeRates    = mode === 'walkin' ? rates    : diRates
  const activeSetRates = mode === 'walkin' ? setRates : setDiRates
  const activeTSlots   = mode === 'walkin' ? timeSlots  : diTimeSlots
  const activeSetSlots = mode === 'walkin' ? setTimeSlots : setDiTimeSlots
  const activeRTypes   = mode === 'walkin' ? roomTypes   : diRoomTypes
  const activeSetTypes = mode === 'walkin' ? setRoomTypes : setDiRoomTypes

  function updateRate(cat, slot, idx, val) {
    activeSetRates(prev => {
      const c = { ...(prev[cat] || {}) }
      const a = [...(c[slot] || Array(activeRTypes.length).fill(0))]
      a[idx] = Number(val) || 0
      c[slot] = a
      return { ...prev, [cat]: c }
    })
  }

  async function saveRates() {
    if (!activeBranchId) { showToast('Select a branch first.','warn'); return }
    setSaving(true)
    try {
      const ref = db.collection('branches').doc(activeBranchId)
      const curr = await ref.get()
      const oldData = curr.data() || {}
      const oldRates = mode === 'walkin' ? oldData.rates : oldData.driveInRates
      if (oldRates) {
        await ref.collection('rateHistory').add({
          savedAt:  firebase.firestore.FieldValue.serverTimestamp(),
          savedBy:  currentUser.email,
          savedByName: userProfile?.displayName || currentUser.email,
          mode,
          rates: oldRates,
        })
      }
      const update = mode === 'walkin' ? { rates: activeRates } : { driveInRates: activeRates }
      await ref.update(update)
      await logAction('UPDATE_RATES',
        `Updated ${mode === 'walkin' ? 'Walk-In' : 'Drive-In'} rates`,
        activeBranchId, branchName)
      showToast('Rates saved!')
    } catch (err) { showToast('Error: ' + err.message,'error') }
    finally { setSaving(false) }
  }

  // ── Persist helpers ─────────────────────────────────────
  async function persistSlots(updated) {
    const key = mode === 'walkin' ? 'settings.timeSlots' : 'settings.driveInTimeSlots'
    await db.collection('branches').doc(activeBranchId).update({ [key]: updated })
    activeSetSlots(updated)
  }

  async function persistRoomTypes(updated) {
    const key = mode === 'walkin' ? 'settings.roomTypes' : 'settings.driveInRoomTypes'
    await db.collection('branches').doc(activeBranchId).update({ [key]: updated })
    activeSetTypes(updated)
  }

  // ── Reorder Time Slots ──────────────────────────────────
  async function moveSlot(cat, idx, dir) {
    const slots = [...(activeTSlots[cat] || [])]
    const target = idx + dir
    if (target < 0 || target >= slots.length) return
    // Swap in slot list
    const tmp = slots[idx]; slots[idx] = slots[target]; slots[target] = tmp
    const updated = { ...activeTSlots, [cat]: slots }
    // Swap matching rate rows so prices follow the slot
    activeSetRates(prev => {
      const catRates = { ...(prev[cat] || {}) }
      return { ...prev, [cat]: catRates }  // rates are keyed by name, order doesn't matter
    })
    await persistSlots(updated)
  }

  // ── Reorder Room Types ───────────────────────────────────
  async function moveRoomType(idx, dir) {
    const target = idx + dir
    if (target < 0 || target >= activeRTypes.length) return
    // Swap room type names
    const newTypes = [...activeRTypes]
    const tmp = newTypes[idx]; newTypes[idx] = newTypes[target]; newTypes[target] = tmp
    // Swap the rate VALUE at that column index across ALL cats and slots
    activeSetRates(prev => {
      const next = {}
      CATEGORIES.forEach(cat => {
        next[cat] = {}
        Object.keys(prev[cat] || {}).forEach(slot => {
          const arr = [...(prev[cat][slot] || [])]
          const tmpVal = arr[idx]; arr[idx] = arr[target]; arr[target] = tmpVal
          next[cat][slot] = arr
        })
      })
      return next
    })
    await persistRoomTypes(newTypes)
  }

  // ── Time Slot CRUD ───────────────────────────────────────
  async function addSlot(cat) {
    const name = newSlotName.trim().toUpperCase()
    if (!name) { showToast('Enter a slot name.','warn'); return }
    if ((activeTSlots[cat]||[]).includes(name)) { showToast('Slot already exists.','warn'); return }
    const updated = { ...activeTSlots, [cat]: [...(activeTSlots[cat]||[]), name] }
    activeSetRates(prev => ({
      ...prev, [cat]: { ...(prev[cat]||{}), [name]: Array(activeRTypes.length).fill(0) }
    }))
    await persistSlots(updated)
    await logAction('ADD_SLOT', `Added slot "${name}" to ${cat} (${mode})`, activeBranchId, branchName)
    setNewSlotName('')
    showToast(`"${name}" added!`)
  }

  async function renameSlot() {
    const { cat, name: oldName } = editSlot
    const newName = editSlotName.trim().toUpperCase()
    if (!newName) { showToast('Enter a name.','warn'); return }
    const updated = { ...activeTSlots, [cat]: activeTSlots[cat].map(s => s===oldName ? newName : s) }
    activeSetRates(prev => {
      const c = { ...(prev[cat]||{}) }
      if (c[oldName] !== undefined) { c[newName] = c[oldName]; delete c[oldName] }
      return { ...prev, [cat]: c }
    })
    // rename in schedules too
    setRateSchedules(prev => {
      const ns = { ...(prev[cat]||{}) }
      if (ns[oldName]) { ns[newName] = ns[oldName]; delete ns[oldName] }
      return { ...prev, [cat]: ns }
    })
    await persistSlots(updated)
    await logAction('RENAME_SLOT', `Renamed slot "${oldName}" → "${newName}" in ${cat} (${mode})`, activeBranchId, branchName)
    setEditSlot(null)
    showToast(`Renamed to "${newName}"!`)
  }

  async function deleteSlot(cat, slotName) {
    if (!confirm(`Delete slot "${slotName}" from ${cat}?\nIts rates will be removed.`)) return
    const updated = { ...activeTSlots, [cat]: activeTSlots[cat].filter(s => s!==slotName) }
    activeSetRates(prev => {
      const c = { ...(prev[cat]||{}) }; delete c[slotName]; return { ...prev, [cat]: c }
    })
    await persistSlots(updated)
    await logAction('DELETE_SLOT', `Deleted slot "${slotName}" from ${cat} (${mode})`, activeBranchId, branchName)
    showToast(`"${slotName}" removed.`,'warn')
  }

  // ── Room Type CRUD ───────────────────────────────────────
  async function addRoomType() {
    const name = newRoomType.trim()
    if (!name) { showToast('Enter a room type name.','warn'); return }
    const updated = [...activeRTypes, name]
    activeSetRates(prev => {
      const next = {}
      CATEGORIES.forEach(cat => {
        next[cat] = {}
        Object.keys(prev[cat]||{}).forEach(slot => {
          next[cat][slot] = [...(prev[cat][slot]||[]), 0]
        })
      })
      return next
    })
    await persistRoomTypes(updated)
    setNewRoomType('')
    showToast(`"${name}" added!`)
  }

  async function renameRoomType() {
    const updated = activeRTypes.map((r,i) => i===editRoom ? editRoomName.trim() : r)
    await persistRoomTypes(updated)
    setEditRoom(null)
    showToast('Room type renamed!')
  }

  async function deleteRoomType(idx) {
    if (!confirm(`Delete "${activeRTypes[idx]}"?\nAll its rates will be removed.`)) return
    const updated = activeRTypes.filter((_,i) => i!==idx)
    activeSetRates(prev => {
      const next = {}
      CATEGORIES.forEach(cat => {
        next[cat] = {}
        Object.keys(prev[cat]||{}).forEach(slot => {
          const a = [...(prev[cat][slot]||[])]; a.splice(idx,1); next[cat][slot] = a
        })
      })
      return next
    })
    await persistRoomTypes(updated)
    showToast('Room type removed.','warn')
  }

  // ── Rate Schedule ────────────────────────────────────────
  function openSchedModal(cat, slot) {
    const sch = rateSchedules?.[cat]?.[slot] || {}
    setSchedSlot({ cat, slot })
    setSchedFrom(sch.from || '')
    setSchedTo(sch.to || '')
    setSchedModal(true)
  }

  async function saveSchedule() {
    const { cat, slot } = schedSlot
    const updated = {
      ...rateSchedules,
      [cat]: {
        ...(rateSchedules[cat]||{}),
        [slot]: schedFrom && schedTo ? { from: schedFrom, to: schedTo } : null,
      }
    }
    try {
      await db.collection('branches').doc(activeBranchId).update({ 'settings.rateSchedules': updated })
      setRateSchedules(updated)
      const desc = schedFrom && schedTo
        ? `Set schedule for "${slot}" (${cat}): ${schedFrom}–${schedTo}`
        : `Cleared schedule for "${slot}" (${cat})`
      await logAction('UPDATE_SCHEDULE', desc, activeBranchId, branchName)
      showToast('Schedule saved!')
    } catch (err) { showToast('Error: ' + err.message,'error') }
    setSchedModal(false)
  }

  function clearSchedule() { setSchedFrom(''); setSchedTo('') }

  // ── Excel Import ─────────────────────────────────────────
  function handleExcelImport(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const data = new Uint8Array(e.target.result)
        const wb   = XLSX.read(data, { type:'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const rows  = XLSX.utils.sheet_to_json(sheet, { header:1, defval:'' })
        const parsed = parseExcel(rows)
        if (!parsed) { showToast('Could not parse file. Use the exported format.','error'); return }
        let filled = 0
        CATEGORIES.forEach(cat => {
          if (!parsed[cat]) return
          Object.keys(parsed[cat]).forEach(slot => {
            if ((activeTSlots[cat]||[]).includes(slot)) {
              activeSetRates(prev => {
                const c = { ...(prev[cat]||{}) }
                c[slot] = parsed[cat][slot]
                filled++
                return { ...prev, [cat]: c }
              })
            }
          })
        })
        showToast(`Imported rates. Review and click Save.`)
      } catch (err) { showToast('Import error: ' + err.message,'error') }
    }
    reader.readAsArrayBuffer(file)
  }

  function parseExcel(rows) {
    const result = { weekday:{}, weekend:{}, holiday:{} }
    let currentCat = null
    for (const row of rows) {
      if (!row || !row[0]) continue
      const first = String(row[0]).trim()
      if (first.includes('=== WEEKDAY')) { currentCat = 'weekday'; continue }
      if (first.includes('=== WEEKEND')) { currentCat = 'weekend'; continue }
      if (first.includes('=== HOLIDAY')) { currentCat = 'holiday'; continue }
      if (first.startsWith('===')) { currentCat = null; continue }
      if (!currentCat) continue
      const vals = row.slice(1).map(v => Number(v)||0)
      if (vals.length > 0 && first.length > 0 && !first.toLowerCase().includes('saved')) {
        result[currentCat][first] = vals.slice(0, activeRTypes.length)
      }
    }
    return Object.values(result).some(c => Object.keys(c).length > 0) ? result : null
  }

  // ── Excel Export ─────────────────────────────────────────
  async function exportRates() {
    if (!activeBranchId) { showToast('Select a branch first.','warn'); return }
    try {
      const snap = await db.collection('branches').doc(activeBranchId).get()
      const bData = snap.data()
      const wb = XLSX.utils.book_new()
      const headerRow = ['', ...activeRTypes]
      const rows = [headerRow]
      CATEGORIES.forEach(cat => {
        rows.push([`=== ${cat.toUpperCase()} ===`])
        ;(activeTSlots[cat]||[]).forEach(slot => {
          const vals = (activeRates[cat]?.[slot] || Array(activeRTypes.length).fill(0)).map(Number)
          rows.push([slot, ...vals])
        })
        rows.push([])
      })
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Current Rates')

      const hist = await db.collection('branches').doc(activeBranchId)
        .collection('rateHistory').orderBy('savedAt','desc').limit(50).get()
      hist.docs.forEach((d,i) => {
        const en = d.data()
        const date = en.savedAt?.toDate?.() || new Date()
        const histRows = [
          [`Saved by: ${en.savedByName||en.savedBy}   Date: ${date.toLocaleString()}   Mode: ${en.mode||'walkin'}`], [],
          headerRow,
        ]
        CATEGORIES.forEach(cat => {
          histRows.push([`=== ${cat.toUpperCase()} ===`])
          Object.keys(en.rates?.[cat]||{}).forEach(slot => {
            histRows.push([slot, ...(en.rates[cat][slot]||[]).map(Number)])
          })
          histRows.push([])
        })
        const sheetName = `History ${i+1} - ${date.toISOString().slice(0,10)}`.slice(0,31)
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(histRows), sheetName)
      })

      XLSX.writeFile(wb, `${(bData?.name||activeBranchId).replace(/\s+/g,'-')}_${mode}_rates_${new Date().toISOString().slice(0,10)}.xlsx`)
      showToast('Excel exported!')
    } catch (err) { showToast('Export failed: ' + err.message,'error') }
  }

  // ── Render ───────────────────────────────────────────────
  if (!activeBranchId) return (
    <div className="page"><div className="card"><p className="hint">Select a branch from the top bar.</p></div></div>
  )
  if (loading) return (
    <div className="page"><div className="card"><p className="hint">Loading rates…</p></div></div>
  )

  const scheduleLabel = (cat, slot) => {
    const sch = rateSchedules?.[cat]?.[slot]
    if (!sch?.from) return null
    return `${sch.from}–${sch.to}`
  }

  return (
    <div className="page">
      <Toast toast={toast} />

      <div className="card">
        <div className="card-header-row">
          <h2 className="card-title">Rate Management</h2>
          <div className="action-group">
            {isSuperAdmin && (
              <>
                <button className="btn btn-outline" onClick={() => setSlotModal(true)}>⏱ Time Slots</button>
                <button className="btn btn-outline" onClick={() => setRoomModal(true)}>🛏 Room Types</button>
              </>
            )}
            <button className="btn btn-outline" onClick={() => fileRef.current?.click()}>📥 Import Excel</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display:'none' }}
              onChange={e => { if(e.target.files[0]) handleExcelImport(e.target.files[0]); e.target.value='' }} />
            <button className="btn btn-outline" onClick={exportRates}>📤 Export Excel</button>
            <button className="btn btn-primary" onClick={saveRates} disabled={saving}>
              {saving ? 'Saving…' : '💾 Save Rates'}
            </button>
          </div>
        </div>

        {/* Mode Tabs */}
        {hasDriveIn && (
          <div className="tab-switcher">
            <button className={`tab-btn ${mode==='walkin'?'active':''}`} onClick={() => setMode('walkin')}>
              🚶 Walk-In Rates
            </button>
            <button className={`tab-btn ${mode==='drivein'?'active':''}`} onClick={() => setMode('drivein')}>
              🚗 Drive-In Rates
            </button>
          </div>
        )}

        {CATEGORIES.map(cat => (
          <div key={cat} className="rate-accordion">
            <button
              type="button"
              className={`rate-accordion-header ${openCats[cat]?'open':''}`}
              style={{ background: CAT_COLORS[cat] }}
              onClick={() => setOpenCats(p => ({ ...p, [cat]: !p[cat] }))}
            >
              {cat.toUpperCase()} RATES
              <span className="chevron">▼</span>
            </button>
            <div className={`rate-accordion-body ${openCats[cat]?'open':''}`}>
              <table className="rate-table-edit">
                <thead>
                  <tr>
                    <th style={{ textAlign:'left', paddingLeft:12 }}>Time Slot</th>
                    <th style={{ width:120, background:'#e8f4fd', color:'#1a6fa0', fontSize:'0.75rem' }}>Schedule</th>
                    {activeRTypes.map(rt => <th key={rt}>{rt}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {(activeTSlots[cat]||[]).map(slot => {
                    const vals    = activeRates[cat]?.[slot] || Array(activeRTypes.length).fill(0)
                    const schLbl  = scheduleLabel(cat, slot)
                    return (
                      <tr key={slot}>
                        <td style={{ fontWeight:700, background:'#f9f9f9', paddingLeft:12 }}>{slot}</td>
                        <td style={{ background:'#f0f8ff', textAlign:'center' }}>
                          <button
                            className={`schedule-badge ${schLbl?'set':''}`}
                            onClick={() => openSchedModal(cat, slot)}
                            title="Set display time schedule"
                          >
                            🕐 {schLbl || 'Always'}
                          </button>
                        </td>
                        {activeRTypes.map((_,idx) => (
                          <td key={idx}>
                            <input
                              type="number"
                              value={vals[idx] ?? 0}
                              min="0"
                              onChange={e => updateRate(cat, slot, idx, e.target.value)}
                            />
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                  {!(activeTSlots[cat]||[]).length && (
                    <tr><td colSpan={activeRTypes.length+2} className="hint" style={{ padding:16 }}>
                      No time slots. {isSuperAdmin ? 'Click "Time Slots" to add.' : ''}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {/* ── Time Slots Modal ── */}
      <Modal show={slotModal} onClose={() => { setSlotModal(false); setEditSlot(null) }} title={`Manage Time Slots (${mode==='walkin'?'Walk-In':'Drive-In'})`} wide>
        <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
          {CATEGORIES.map(c => (
            <button key={c} className={`btn ${slotCat===c?'btn-primary':'btn-outline'}`}
              onClick={() => setSlotCat(c)}>{c.toUpperCase()}</button>
          ))}
        </div>
        <table className="holiday-table">
          <thead><tr><th style={{width:32}}></th><th>Slot Name</th><th>Schedule</th><th>Actions</th></tr></thead>
          <tbody>
            {(activeTSlots[slotCat]||[]).map((slot, idx) => {
              const total = (activeTSlots[slotCat]||[]).length
              return (
              <tr key={slot}>
                {/* Arrow buttons */}
                <td style={{ padding:'2px 4px', textAlign:'center' }}>
                  <div style={{ display:'flex', flexDirection:'column', gap:1 }}>
                    <button
                      className="arr-btn"
                      disabled={idx === 0}
                      onClick={() => moveSlot(slotCat, idx, -1)}
                      title="Move up"
                    >▲</button>
                    <button
                      className="arr-btn"
                      disabled={idx === total - 1}
                      onClick={() => moveSlot(slotCat, idx, 1)}
                      title="Move down"
                    >▼</button>
                  </div>
                </td>
                <td>
                  {editSlot?.cat===slotCat && editSlot?.name===slot ? (
                    <input type="text" value={editSlotName}
                      onChange={e => setEditSlotName(e.target.value)}
                      onKeyDown={e => e.key==='Enter' && renameSlot()}
                      style={{ width:160 }} />
                  ) : <strong>{slot}</strong>}
                </td>
                <td style={{ fontSize:'0.8rem', color:'#2980b9' }}>
                  {scheduleLabel(slotCat, slot) || <span style={{ color:'#aaa' }}>Always</span>}
                </td>
                <td>
                  <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                    {editSlot?.cat===slotCat && editSlot?.name===slot ? (
                      <>
                        <button className="btn btn-green" style={{ padding:'4px 9px', fontSize:'0.76rem' }} onClick={renameSlot}>Save</button>
                        <button className="btn btn-ghost" style={{ padding:'4px 9px', fontSize:'0.76rem' }} onClick={() => setEditSlot(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button className="btn btn-outline" style={{ padding:'4px 9px', fontSize:'0.76rem' }}
                          onClick={() => { setEditSlot({cat:slotCat, name:slot}); setEditSlotName(slot) }}>Rename</button>
                        <button className="btn btn-blue" style={{ padding:'4px 9px', fontSize:'0.76rem' }}
                          onClick={() => openSchedModal(slotCat, slot)}>🕐 Schedule</button>
                        <button className="btn btn-danger" style={{ padding:'4px 9px', fontSize:'0.76rem' }}
                          onClick={() => deleteSlot(slotCat, slot)}>Delete</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            )})}
          </tbody>
        </table>
        <div style={{ display:'flex', gap:8, marginTop:14 }}>
          <input type="text" placeholder="New slot name (e.g. 10HRS PROMO)"
            value={newSlotName} onChange={e => setNewSlotName(e.target.value)}
            onKeyDown={e => e.key==='Enter' && addSlot(slotCat)}
            style={{ flex:1 }} />
          <button className="btn btn-primary" onClick={() => addSlot(slotCat)}>+ Add</button>
        </div>
      </Modal>

      {/* ── Room Types Modal ── */}
      <Modal show={roomModal} onClose={() => { setRoomModal(false); setEditRoom(null) }} title={`Manage Room Types (${mode==='walkin'?'Walk-In':'Drive-In'})`}>
        <table className="holiday-table">
          <thead><tr><th style={{width:32}}></th><th>Room Type</th><th>Actions</th></tr></thead>
          <tbody>
            {activeRTypes.map((rt, idx) => (
              <tr key={idx}>
                {/* Arrow buttons */}
                <td style={{ padding:'2px 4px', textAlign:'center' }}>
                  <div style={{ display:'flex', flexDirection:'column', gap:1 }}>
                    <button
                      className="arr-btn"
                      disabled={idx === 0}
                      onClick={() => moveRoomType(idx, -1)}
                      title="Move left / up"
                    >▲</button>
                    <button
                      className="arr-btn"
                      disabled={idx === activeRTypes.length - 1}
                      onClick={() => moveRoomType(idx, 1)}
                      title="Move right / down"
                    >▼</button>
                  </div>
                </td>
                <td>
                  {editRoom===idx ? (
                    <input type="text" value={editRoomName}
                      onChange={e => setEditRoomName(e.target.value)}
                      onKeyDown={e => e.key==='Enter' && renameRoomType()}
                      style={{ width:160 }} />
                  ) : <strong>{rt}</strong>}
                </td>
                <td>
                  <div style={{ display:'flex', gap:5 }}>
                    {editRoom===idx ? (
                      <>
                        <button className="btn btn-green" style={{ padding:'4px 9px', fontSize:'0.76rem' }} onClick={renameRoomType}>Save</button>
                        <button className="btn btn-ghost" style={{ padding:'4px 9px', fontSize:'0.76rem' }} onClick={() => setEditRoom(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button className="btn btn-outline" style={{ padding:'4px 9px', fontSize:'0.76rem' }}
                          onClick={() => { setEditRoom(idx); setEditRoomName(rt) }}>Rename</button>
                        <button className="btn btn-danger" style={{ padding:'4px 9px', fontSize:'0.76rem' }}
                          onClick={() => deleteRoomType(idx)}>Delete</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display:'flex', gap:8, marginTop:14 }}>
          <input type="text" placeholder="New room type (e.g. Suite)"
            value={newRoomType} onChange={e => setNewRoomType(e.target.value)}
            onKeyDown={e => e.key==='Enter' && addRoomType()}
            style={{ flex:1 }} />
          <button className="btn btn-primary" onClick={addRoomType}>+ Add</button>
        </div>
      </Modal>

      {/* ── Schedule Modal ── */}
      <Modal show={schedModal} onClose={() => setSchedModal(false)}
        title={`Display Schedule: ${schedSlot?.slot || ''}`}
        actions={
          <>
            <button className="btn btn-ghost" onClick={clearSchedule}>Clear (Always Show)</button>
            <button className="btn btn-ghost" onClick={() => setSchedModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveSchedule}>Save Schedule</button>
          </>
        }
      >
        <p style={{ color:'#666', fontSize:'0.85rem', marginBottom:14 }}>
          Set a time window when this slot is <strong>visible on the kiosk</strong>. Outside this window it will be hidden. Leave blank to always show.
        </p>
        <div className="form-row">
          <div className="form-group">
            <label>Show From</label>
            <input type="time" value={schedFrom} onChange={e => setSchedFrom(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Hide After (exclusive)</label>
            <input type="time" value={schedTo} onChange={e => setSchedTo(e.target.value)} />
          </div>
        </div>
        <p style={{ color:'#888', fontSize:'0.78rem', marginTop:4 }}>
          💡 For overnight windows (e.g. 20:00 → 06:00), set From to the later time. The system handles midnight wraparound automatically.
        </p>
      </Modal>
    </div>
  )
}
