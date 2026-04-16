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
import { RateHistory }         from './RateHistory'
import { ScheduledRates }      from './ScheduledRates'
import { useGroqRatesExtract } from '../../hooks/useGroqRatesExtract'

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
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
  const fileRef   = useRef(null)
  const aiFileRef = useRef(null)

  // ── Excel Import scheduling ──────────────────────────────
  const [importModal,     setImportModal]     = useState(false)
  const [importFile,      setImportFile]      = useState(null)
  const [importApplyMode, setImportApplyMode] = useState('now') // 'now' | 'schedule'
  const [importDate,      setImportDate]      = useState('')
  const [importTime,      setImportTime]      = useState('06:00')
  const [importLabel,     setImportLabel]     = useState('')

  // ── AI Image Import (Groq) ───────────────────────────────
  const { extractAndMap, groqStatus } = useGroqRatesExtract()
  const [aiModal,      setAiModal]      = useState(false)
  const [aiCategory,   setAiCategory]   = useState('weekday')
  const [aiTarget,     setAiTarget]     = useState('current')
  const [aiPreview,    setAiPreview]    = useState(null)
  const [aiSchedLabel, setAiSchedLabel] = useState('')
  const [aiSchedDate,  setAiSchedDate]  = useState('')
  const [aiSchedTime,  setAiSchedTime]  = useState('06:00')

  // ── Copy Rates ───────────────────────────────────────────
  const [copyModal,  setCopyModal]  = useState(false)
  const [copySrc,    setCopySrc]    = useState('weekday')
  const [copyDst,    setCopyDst]    = useState('weekend')

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
  const [disabledSlots, setDisabledSlots]   = useState({})
  const [openCats, setOpenCats]           = useState({ weekday:true, weekend:false, holiday:false })
  const [loading, setLoading]             = useState(false)
  const [saving, setSaving]               = useState(false)
  const branchName = allBranches.find(b => b.id === activeBranchId)?.name || activeBranchId

  // Called by RateHistory and ScheduledRates when rates change externally
  function handleExternalRatesUpdate(newRates) {
    if (mode === 'walkin') setRates(newRates)
    else setDiRates(newRates)
  }

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

  // weekend schedule modal
  const [weekendSchedModal, setWeekendSchedModal] = useState(false)
  const [wkndStartDay,    setWkndStartDay]    = useState(5)
  const [wkndStartHour,   setWkndStartHour]   = useState(6)
  const [wkndEndDay,      setWkndEndDay]      = useState(0)
  const [wkndEndHour,     setWkndEndHour]     = useState(18)
  const [savingWkndSched, setSavingWkndSched] = useState(false)

  // bulk adjust
  const [bulkModal, setBulkModal]         = useState(false)
  const [bulkCat, setBulkCat]             = useState('weekday')
  const [bulkSlots, setBulkSlots]         = useState([])    // selected slot keys
  const [bulkRooms, setBulkRooms]         = useState([])    // selected room type indices
  const [bulkAmount, setBulkAmount]       = useState('')
  const [bulkMode, setBulkMode]           = useState('add') // 'add' | 'subtract' | 'set'

  useEffect(() => {
    if (activeBranchId) loadRates()
    else resetState()
  }, [activeBranchId])

  function resetState() {
    setRates({}); setTimeSlots(DEFAULT_TIME_SLOTS); setRoomTypes(DEFAULT_ROOM_TYPES)
    setDiRates({}); setDiTimeSlots(DEFAULT_TIME_SLOTS); setDiRoomTypes(DEFAULT_DRIVEIN_TYPES)
    setRateSchedules({}); setDisabledSlots({}); setHasDriveIn(false); setMode('walkin')
    setWkndStartDay(5); setWkndStartHour(6); setWkndEndDay(0); setWkndEndHour(18)
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
      setDisabledSlots(s.disabledSlots || {})
      setHasDriveIn(s.hasDriveIn === true)
      setWkndStartDay(s.weekendStartDay ?? 5)
      setWkndStartHour(s.weekendStartHour ?? 6)
      setWkndEndDay(s.weekendEndDay ?? 0)
      setWkndEndHour(s.weekendEndHour ?? 18)
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
    const label = newSlotName.trim().toUpperCase()
    if (!label) { showToast('Enter a slot name.','warn'); return }

    // Generate a unique internal key — allows duplicate display names.
    // "24HRS" already exists → try "24HRS_2", "24HRS_3", etc.
    const existing = activeTSlots[cat] || []
    let key = label
    if (existing.includes(key)) {
      let n = 2
      while (existing.includes(`${label}_${n}`)) n++
      key = `${label}_${n}`
    }

    const updated = { ...activeTSlots, [cat]: [...existing, key] }
    activeSetRates(prev => ({
      ...prev, [cat]: { ...(prev[cat]||{}), [key]: Array(activeRTypes.length).fill(0) }
    }))
    await persistSlots(updated)
    await logAction('ADD_SLOT', `Added slot "${label}" to ${cat} (${mode})`, activeBranchId, branchName)
    setNewSlotName('')
    const isDup = key !== label
    showToast(`"${label}" added!${isDup ? ' (duplicate — set a schedule to distinguish)' : ''}`)
  }

  async function renameSlot() {
    const { cat, name: oldKey } = editSlot
    const newLabel = editSlotName.trim().toUpperCase()
    if (!newLabel) { showToast('Enter a name.','warn'); return }

    // Build unique new key from label (preserve position, allow duplicates)
    const others = (activeTSlots[cat] || []).filter(s => s !== oldKey)
    let newKey = newLabel
    if (others.includes(newKey)) {
      let n = 2
      while (others.includes(`${newLabel}_${n}`)) n++
      newKey = `${newLabel}_${n}`
    }

    const updated = { ...activeTSlots, [cat]: activeTSlots[cat].map(s => s === oldKey ? newKey : s) }

    // Move rates to new key
    activeSetRates(prev => {
      const cr = { ...(prev[cat]||{}) }
      if (cr[oldKey] !== undefined) { cr[newKey] = cr[oldKey]; delete cr[oldKey] }
      return { ...prev, [cat]: cr }
    })

    // Move schedule to new key
    setRateSchedules(prev => {
      const ns = { ...(prev[cat]||{}) }
      if (ns[oldKey]) { ns[newKey] = ns[oldKey]; delete ns[oldKey] }
      return { ...prev, [cat]: ns }
    })

    // Move disabledSlots to new key
    setDisabledSlots(prev => {
      const nd = { ...(prev[cat]||{}) }
      if (nd[oldKey] !== undefined) { nd[newKey] = nd[oldKey]; delete nd[oldKey] }
      return { ...prev, [cat]: nd }
    })

    await persistSlots(updated)
    await logAction('RENAME_SLOT', `Renamed slot "${oldKey}" → "${newKey}" in ${cat} (${mode})`, activeBranchId, branchName)
    setEditSlot(null)
    showToast(`Renamed to "${newLabel}"!`)
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

  // ── Weekend Rate Schedule ────────────────────────────────
  async function saveWeekendSched() {
    if (!activeBranchId) { showToast('Select a branch first.', 'warn'); return }
    setSavingWkndSched(true)
    try {
      const snap = await db.collection('branches').doc(activeBranchId).get()
      const currentSettings = snap.data()?.settings || {}
      const updated = {
        ...currentSettings,
        weekendStartDay:  wkndStartDay,
        weekendStartHour: wkndStartHour,
        weekendEndDay:    wkndEndDay,
        weekendEndHour:   wkndEndHour,
      }
      await db.collection('branches').doc(activeBranchId).update({ settings: updated })
      await logAction('UPDATE_SCHEDULE', `Updated weekend rate schedule for ${branchName}`, activeBranchId, branchName)
      showToast('Weekend schedule saved!')
      setWeekendSchedModal(false)
    } catch (err) { showToast('Error: ' + err.message, 'error') }
    finally { setSavingWkndSched(false) }
  }

  // ── Toggle Slot Disabled ────────────────────────────────
  async function toggleSlotDisabled(cat, slot) {
    const key = `${cat}.${slot}`
    const isNowDisabled = !disabledSlots?.[cat]?.[slot]
    const updated = {
      ...disabledSlots,
      [cat]: { ...(disabledSlots[cat] || {}), [slot]: isNowDisabled }
    }
    try {
      await db.collection('branches').doc(activeBranchId).update({ 'settings.disabledSlots': updated })
      setDisabledSlots(updated)
      await logAction(
        'UPDATE_SCHEDULE',
        `${isNowDisabled ? 'Disabled' : 'Enabled'} slot "${slot}" in ${cat} (${mode})`,
        activeBranchId, branchName
      )
      showToast(`"${slot}" ${isNowDisabled ? 'disabled — hidden from kiosk.' : 'enabled.'}`, isNowDisabled ? 'warn' : 'success')
    } catch (err) { showToast('Error: ' + err.message, 'error') }
  }

  // ── Bulk Rate Adjust ────────────────────────────────────
  function applyBulkAdjust() {
    const amt = parseFloat(bulkAmount)
    if (isNaN(amt) || bulkAmount === '') { showToast('Enter a valid amount.', 'warn'); return }
    if (bulkSlots.length === 0)          { showToast('Select at least one time slot.', 'warn'); return }
    if (bulkRooms.length === 0)          { showToast('Select at least one room type.', 'warn'); return }

    activeSetRates(prev => {
      const next = { ...prev }
      bulkSlots.forEach(slot => {
        const catRates = { ...(next[bulkCat] || {}) }
        const vals     = [...(catRates[slot] || Array(activeRTypes.length).fill(0))]
        bulkRooms.forEach(idx => {
          const cur = Number(vals[idx]) || 0
          if (bulkMode === 'add')      vals[idx] = Math.max(0, cur + amt)
          if (bulkMode === 'subtract') vals[idx] = Math.max(0, cur - amt)
          if (bulkMode === 'set')      vals[idx] = Math.max(0, amt)
        })
        catRates[slot] = vals
        next[bulkCat]  = catRates
      })
      return next
    })
    showToast(`Applied ${bulkMode === 'add' ? '+' : bulkMode === 'subtract' ? '-' : '='}${amt} to ${bulkSlots.length} slot(s) × ${bulkRooms.length} room type(s). Click Save Rates to confirm.`)
    setBulkModal(false)
    setBulkAmount('')
  }

  function toggleBulkSlot(key) {
    setBulkSlots(prev => prev.includes(key) ? prev.filter(s => s !== key) : [...prev, key])
  }

  function toggleBulkRoom(idx) {
    setBulkRooms(prev => prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx])
  }

  // ── Excel Import ─────────────────────────────────────────
  function handleExcelImport(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = async e => {
      try {
        const data = new Uint8Array(e.target.result)
        const wb   = XLSX.read(data, { type:'array' })

        // ── Import current rates (first sheet) ──────────────
        const sheet  = wb.Sheets[wb.SheetNames[0]]
        const rows   = XLSX.utils.sheet_to_json(sheet, { header:1, defval:'' })
        const parsed = parseExcel(rows)
        if (parsed) {
          CATEGORIES.forEach(cat => {
            if (!parsed[cat]) return
            Object.keys(parsed[cat]).forEach(slot => {
              if ((activeTSlots[cat]||[]).includes(slot)) {
                activeSetRates(prev => {
                  const c = { ...(prev[cat]||{}) }
                  c[slot] = parsed[cat][slot]
                  return { ...prev, [cat]: c }
                })
              }
            })
          })
          showToast('Rates imported. Review and click Save.')
        }

        // ── Import scheduled changes sheet ──────────────────
        const schedSheet = wb.Sheets['Scheduled Changes']
        if (schedSheet && activeBranchId) {
          const schedRows = XLSX.utils.sheet_to_json(schedSheet, { header:1, defval:'' })
          // Find header row (has 'Label' in first cell)
          const headerIdx = schedRows.findIndex(r => String(r[0]).toLowerCase() === 'label')
          if (headerIdx >= 0) {
            let imported = 0
            for (let i = headerIdx + 1; i < schedRows.length; i++) {
              const row = schedRows[i]
              const lbl  = String(row[0] || '').trim()
              const date = String(row[1] || '').trim()
              const time = String(row[2] || '06:00').trim()
              const type = String(row[3] || 'increase').trim()
              const amt  = parseFloat(row[4]) || 0
              const sts  = String(row[7] || '').trim()
              if (!lbl || !date || !amt || sts === 'applied' || sts === 'cancelled') continue
              const applyAt = new Date(date + 'T' + time).toISOString()
              // Build newRates from current activeRates using the adjustment
              const newRates = {}
              CATEGORIES.forEach(cat => {
                newRates[cat] = {}
                Object.keys(activeRates[cat] || {}).forEach(slot => {
                  const vals = [...(activeRates[cat][slot] || Array(activeRTypes.length).fill(0))]
                  vals.forEach((v, idx) => {
                    const cur = Number(v) || 0
                    if (type === 'increase') vals[idx] = Math.max(0, cur + amt)
                    else if (type === 'decrease') vals[idx] = Math.max(0, cur - amt)
                    else vals[idx] = Math.max(0, amt)
                  })
                  newRates[cat][slot] = vals
                })
              })
              // adjSlots: [] means apply to all slots (correct for Excel import)
              await db.collection('branches').doc(activeBranchId).collection('scheduledRates').add({
                label: lbl, applyAt, adjType: type, adjAmount: amt,
                adjSlots: [], adjRooms: [], newRates, mode, status: 'pending',
                createdAt:    firebase.firestore.FieldValue.serverTimestamp(),
                createdBy:    currentUser.email,
                createdByName: userProfile?.displayName || currentUser.email,
              })
              imported++
            }
            if (imported > 0) {
              await logAction('IMPORT_SCHEDULED_RATES', `Imported ${imported} scheduled rate change(s) from Excel`, activeBranchId, branchName)
              showToast(`Also imported ${imported} scheduled change(s)!`)
            }
          }
        }

      } catch (err) { showToast('Import error: ' + err.message,'error') }
    }
    reader.readAsArrayBuffer(file)
  }

  // ── Confirm Import (immediate or scheduled) ──────────────
  async function confirmImport() {
    if (!importFile) return
    setImportModal(false)

    if (importApplyMode === 'now') {
      handleExcelImport(importFile)
      return
    }

    // Schedule the imported rates as a future absolute change
    if (!importDate) { showToast('Pick a date to schedule the import.', 'warn'); return }
    if (!activeBranchId) { showToast('Select a branch first.', 'warn'); return }

    const reader = new FileReader()
    reader.onload = async e => {
      try {
        const data   = new Uint8Array(e.target.result)
        const wb     = XLSX.read(data, { type:'array' })
        const sheet  = wb.Sheets[wb.SheetNames[0]]
        const rows   = XLSX.utils.sheet_to_json(sheet, { header:1, defval:'' })
        const parsed = parseExcel(rows)

        if (!parsed) { showToast('Could not parse rates from the file.', 'error'); return }

        const newRates = {}
        CATEGORIES.forEach(cat => {
          newRates[cat] = {}
          ;(activeTSlots[cat] || []).forEach(slot => {
            newRates[cat][slot] = parsed[cat]?.[slot] || Array(activeRTypes.length).fill(0)
          })
        })

        const applyAt = new Date(`${importDate}T${importTime || '06:00'}`).toISOString()
        const label   = importLabel.trim() || `Imported from ${importFile.name}`

        await db.collection('branches').doc(activeBranchId)
          .collection('scheduledRates').add({
            label, applyAt, newRates, mode,
            status:           'pending',
            adjType:          null,
            adjAmount:        null,
            adjSlots:         [],
            adjRooms:         [],
            isAbsoluteImport: true,
            createdAt:        firebase.firestore.FieldValue.serverTimestamp(),
            createdBy:        currentUser.email,
            createdByName:    userProfile?.displayName || currentUser.email,
          })

        await logAction(
          'IMPORT_SCHEDULED_RATES',
          `Scheduled imported rates from "${importFile.name}" for ${applyAt}`,
          activeBranchId, branchName
        )
        showToast(`✅ Scheduled for ${new Date(applyAt).toLocaleString('en-US', {
          month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:true,
        })}`)
      } catch (err) {
        showToast('Schedule import error: ' + err.message, 'error')
      }
    }
    reader.readAsArrayBuffer(importFile)
  }

  function parseExcel(rows) {
    const result = { weekday:{}, weekend:{}, holiday:{} }
    let currentCat = null
    // colMap[excelColOffset] = activeRTypes index — built from the header row
    let colMap = null

    for (const row of rows) {
      if (!row) continue
      const first = String(row[0] ?? '').trim()

      // ── Header row detection ─────────────────────────────
      // The exported header looks like: ['', 'Econo', 'Premium', 'Deluxe', ...]
      // first cell is blank; subsequent cells are room type names.
      // We must parse this BEFORE the first === marker so we know column order.
      if (!first && row.length > 1 && currentCat === null && colMap === null) {
        colMap = {}
        for (let i = 1; i < row.length; i++) {
          const colName = String(row[i] || '').trim()
          if (!colName) continue
          // Case-insensitive match against activeRTypes
          const rtIdx = activeRTypes.findIndex(
            rt => rt.trim().toLowerCase() === colName.toLowerCase()
          )
          if (rtIdx !== -1) colMap[i - 1] = rtIdx
        }
        continue
      }

      if (!first) continue  // skip other empty-first-cell rows

      if (first.includes('=== WEEKDAY')) { currentCat = 'weekday'; continue }
      if (first.includes('=== WEEKEND')) { currentCat = 'weekend'; continue }
      if (first.includes('=== HOLIDAY')) { currentCat = 'holiday'; continue }
      if (first.startsWith('===')) { currentCat = null; continue }
      if (!currentCat) continue

      const rawVals = row.slice(1)
      if (rawVals.length > 0 && !first.toLowerCase().includes('saved')) {
        const vals = Array(activeRTypes.length).fill(0)

        if (colMap && Object.keys(colMap).length > 0) {
          // ✅ Header-mapped: each Excel column goes to the correct activeRTypes index
          // regardless of the order they appear in the spreadsheet.
          rawVals.forEach((v, i) => {
            if (colMap[i] !== undefined) vals[colMap[i]] = Number(v) || 0
          })
        } else {
          // Fallback: positional (no header row found or no header matches)
          rawVals.slice(0, activeRTypes.length).forEach((v, i) => {
            vals[i] = Number(v) || 0
          })
        }

        result[currentCat][first] = vals
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

      // Extra sheet: Scheduled Rate Changes template
      const schedSnap = await db.collection('branches').doc(activeBranchId)
        .collection('scheduledRates')
        .where('mode','==',mode)
        .where('status','==','pending')
        .get()
      const schedRows = [
        ['SCHEDULED RATE CHANGES — ' + (bData?.name || activeBranchId)],
        ['Mode: ' + mode],
        [],
        ['Label','Apply Date (YYYY-MM-DD)','Apply Time (HH:MM)','Type (increase/decrease/set)','Amount (₱)','Affected Slots (blank=all)','Affected Rooms (blank=all)','Status'],
        ...schedSnap.docs.map(d => {
          const e = d.data()
          return [
            e.label || '',
            e.applyAt ? e.applyAt.slice(0,10) : '',
            e.applyAt ? e.applyAt.slice(11,16) : '',
            e.adjType || 'increase',
            e.adjAmount || 0,
            (e.adjSlots||[]).join('; '),
            (e.adjRooms||[]).join('; '),
            e.status || 'pending',
          ]
        }),
        [],
        ['--- TO IMPORT A NEW SCHEDULED CHANGE, FILL A ROW ABOVE AND IMPORT THIS FILE ---'],
      ]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(schedRows), 'Scheduled Changes')

      XLSX.writeFile(wb, `${(bData?.name||activeBranchId).replace(/\s+/g,'-')}_${mode}_rates_${new Date().toISOString().slice(0,10)}.xlsx`)
      showToast('Excel exported! Includes "Scheduled Changes" sheet.')
    } catch (err) { showToast('Export failed: ' + err.message,'error') }
  }

  // ── AI Image Import handlers ─────────────────────────────
  async function handleAIUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    e.target.value = ''
    const result = await extractAndMap(file, aiCategory, activeRTypes, activeTSlots)
    if (result) setAiPreview(result)
  }

  async function applyAIRates() {
    if (!aiPreview) return
    const { rates: extracted, summary } = aiPreview
    const cat = summary.category

    if (aiTarget === 'current') {
      activeSetRates(prev => {
        const updated  = { ...prev }
        const catRates = { ...(updated[cat] || {}) }
        Object.entries(extracted[cat]).forEach(([slot, vals]) => {
          const existing = [...(catRates[slot] || Array(activeRTypes.length).fill(0))]
          vals.forEach((v, i) => { if (v !== null) existing[i] = v })
          catRates[slot] = existing
        })
        updated[cat] = catRates
        return updated
      })
      showToast(`✅ ${summary.matchedSlots} slot(s) updated for ${cat}. Click Save Rates to confirm.`)
      setAiModal(false); setAiPreview(null)

    } else {
      if (!aiSchedLabel.trim()) { showToast('Enter a label for the schedule.', 'warn'); return }
      if (!aiSchedDate)         { showToast('Pick an apply date.', 'warn'); return }
      if (!activeBranchId)      { showToast('Select a branch first.', 'warn'); return }
      try {
        // Fetch FRESH rates from Firestore — avoids zero values from stale in-memory state
        const snap       = await db.collection('branches').doc(activeBranchId).get()
        const branchData = snap.data() || {}
        const freshRates = mode === 'walkin' ? (branchData.rates || {}) : (branchData.driveInRates || {})

        const newRates = {}
        CATEGORIES.forEach(c => {
          newRates[c] = {}
          ;(activeTSlots[c] || []).forEach(slot => {
            newRates[c][slot] = [...(freshRates[c]?.[slot] || Array(activeRTypes.length).fill(0))].map(v => Number(v) || 0)
          })
        })
        // Overlay only AI-extracted values for the target category
        Object.entries(extracted[cat]).forEach(([slot, vals]) => {
          if (!newRates[cat][slot]) newRates[cat][slot] = Array(activeRTypes.length).fill(0)
          vals.forEach((v, i) => { if (v !== null && v !== undefined) newRates[cat][slot][i] = Number(v) || 0 })
        })

        const applyAt = new Date(aiSchedDate + 'T' + aiSchedTime).toISOString()
        await db.collection('branches').doc(activeBranchId).collection('scheduledRates').add({
          label: aiSchedLabel, applyAt, mode, newRates, adjustments: [], status: 'pending',
          createdAt:    firebase.firestore.FieldValue.serverTimestamp(),
          createdBy:    currentUser.email,
          createdByName: userProfile?.displayName || currentUser.email,
          source:       'ai-image-upload',
        })
        await logAction('CREATE_SCHEDULED_RATES',
          `AI image upload: Scheduled "${aiSchedLabel}" for ${cat} on ${aiSchedDate}`,
          activeBranchId, branchName)
        showToast(`✅ Scheduled "${aiSchedLabel}" — will auto-apply on ${aiSchedDate} at ${aiSchedTime}`)
        setAiModal(false); setAiPreview(null); setAiSchedLabel(''); setAiSchedDate('')
      } catch (err) { showToast('Error saving schedule: ' + err.message, 'error') }
    }
  }

  // ── Copy Rates handler ───────────────────────────────────
  function applyCopyRates() {
    if (copySrc === copyDst) { showToast('Source and destination are the same.', 'warn'); return }
    if (!confirm(`Copy all ${copySrc.toUpperCase()} rates → ${copyDst.toUpperCase()}?\nThis will overwrite ${copyDst} rates.`)) return
    const srcRates = activeRates[copySrc] || {}
    activeSetRates(prev => ({
      ...prev,
      [copyDst]: Object.fromEntries(
        Object.entries(srcRates).map(([slot, vals]) => [slot, [...vals]])
      )
    }))
    showToast(`✅ Copied ${copySrc} → ${copyDst}. Click Save Rates to confirm.`)
    setCopyModal(false)
  }

  // ── Render ───────────────────────────────────────────────
  if (!activeBranchId) return (
    <div className="page"><div className="card"><p className="hint">Select a branch from the top bar.</p></div></div>
  )
  if (loading) return (
    <div className="page"><div className="card"><p className="hint">Loading rates…</p></div></div>
  )

  // Strip internal duplicate suffix: "24HRS_2" → "24HRS", "24HRS" → "24HRS"
  function displaySlotName(key) {
    return key.replace(/_\d+$/, '')
  }

  const scheduleLabel = (cat, slot) => {
    const sch = rateSchedules?.[cat]?.[slot]
    if (!sch?.from) return null
    return `${sch.from}–${sch.to}`
  }

  return (
    <div className="page">
      <Toast toast={toast} />

      {groqStatus && (
        <div style={{
          display:'flex', alignItems:'center', gap:8, padding:'9px 14px', borderRadius:6,
          fontSize:'0.83rem', marginBottom:10,
          background: groqStatus.type==='loading'?'#dbeafe': groqStatus.type==='success'?'#d4edda':'#f8d7da',
          color:      groqStatus.type==='loading'?'#1e40af': groqStatus.type==='success'?'#155724':'#721c24',
        }}>
          {groqStatus.type==='loading' && (
            <span style={{ width:14,height:14,border:'2px solid #bfdbfe',borderTopColor:'#1e40af',
              borderRadius:'50%',animation:'spin 0.7s linear infinite',display:'inline-block',flexShrink:0 }} />
          )}
          {groqStatus.type==='success' && '✅ '}{groqStatus.type==='error' && '❌ '}
          {groqStatus.message}
        </div>
      )}

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
            <button className="btn btn-outline" onClick={() => setWeekendSchedModal(true)}>🗓 Weekend Schedule</button>
            <button className="btn btn-outline" onClick={() => {
              setBulkCat('weekday')
              setBulkSlots([])
              setBulkRooms([])
              setBulkAmount('')
              setBulkMode('add')
              setBulkModal(true)
            }}>📈 Bulk Adjust</button>
            <button className="btn btn-outline" onClick={() => fileRef.current?.click()}>📥 Import Excel</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display:'none' }}
              onChange={e => {
                const f = e.target.files[0]
                if (!f) return
                e.target.value = ''
                setImportFile(f)
                setImportApplyMode('now')
                setImportDate('')
                setImportTime('06:00')
                setImportLabel('')
                setImportModal(true)
              }} />
            <button className="btn btn-outline"
              onClick={() => { setAiPreview(null); setAiModal(true) }}
              title="Upload a photo of a rates sheet — AI auto-fills the table">
              🤖 AI Import
            </button>
            <button className="btn btn-outline"
              onClick={() => setCopyModal(true)}
              title="Copy rates from one category to another">
              📋 Copy Rates
            </button>
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
                    const vals       = activeRates[cat]?.[slot] || Array(activeRTypes.length).fill(0)
                    const schLbl     = scheduleLabel(cat, slot)
                    const isDisabled = disabledSlots?.[cat]?.[slot] === true
                    return (
                      <tr key={slot} style={isDisabled ? { opacity:0.45, background:'#f8f8f8' } : {}}>
                        <td style={{ fontWeight:700, background: isDisabled ? '#f0f0f0' : '#f9f9f9', paddingLeft:12 }}>
                          <span style={{ textDecoration: isDisabled ? 'line-through' : 'none', color: isDisabled ? '#aaa' : undefined }}>
                            {displaySlotName(slot)}
                          </span>
                          {slot !== displaySlotName(slot) && !isDisabled && (
                            <span style={{ marginLeft:5, fontSize:'0.65rem', color:'#bbb', fontStyle:'italic' }}>#{slot.split('_').pop()}</span>
                          )}
                          {isDisabled && (
                            <span style={{
                              marginLeft:6, fontSize:'0.68rem', fontWeight:800,
                              background:'#e0e0e0', color:'#888', borderRadius:6, padding:'1px 6px'
                            }}>HIDDEN</span>
                          )}
                        </td>
                        <td style={{ background:'#f0f8ff', textAlign:'center' }}>
                          <button
                            className={`schedule-badge ${schLbl?'set':''}`}
                            onClick={() => !isDisabled && openSchedModal(cat, slot)}
                            title={isDisabled ? 'Enable slot first' : 'Set display time schedule'}
                            style={isDisabled ? { opacity:0.4, cursor:'not-allowed' } : {}}
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
                              disabled={isDisabled}
                              onChange={e => updateRate(cat, slot, idx, e.target.value)}
                              style={isDisabled ? { background:'#f0f0f0', color:'#ccc' } : {}}
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
                      style={{ width:160 }}
                      placeholder="Display name" />
                  ) : (
                    <span>
                      <strong>{displaySlotName(slot)}</strong>
                      {slot !== displaySlotName(slot) && (
                        <span style={{ marginLeft:6, fontSize:'0.7rem', color:'#aaa', fontStyle:'italic' }}>copy #{slot.split('_').pop()}</span>
                      )}
                    </span>
                  )}
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
                        <button
                          className={disabledSlots?.[slotCat]?.[slot] ? 'btn btn-green' : 'btn btn-outline'}
                          style={{ padding:'4px 9px', fontSize:'0.76rem',
                            ...(disabledSlots?.[slotCat]?.[slot] ? {} : { color:'#e67e22', borderColor:'#e67e22' }) }}
                          onClick={() => toggleSlotDisabled(slotCat, slot)}
                          title={disabledSlots?.[slotCat]?.[slot] ? 'Enable — show on kiosk' : 'Disable — hide from kiosk'}
                        >
                          {disabledSlots?.[slotCat]?.[slot] ? '✔ Enable' : '⊘ Disable'}
                        </button>
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

      {/* ── Scheduled Rates ── */}
      {activeBranchId && (
        <ScheduledRates
          branchId={activeBranchId}
          branchName={branchName}
          mode={mode}
          activeRTypes={activeRTypes}
          activeTSlots={activeTSlots}
          activeRates={activeRates}
          onScheduledApplied={handleExternalRatesUpdate}
        />
      )}

      {/* ── Rate History + Rollback ── */}
      {activeBranchId && (
        <RateHistory
          branchId={activeBranchId}
          branchName={branchName}
          mode={mode}
          activeRTypes={activeRTypes}
          activeTSlots={activeTSlots}
          activeRates={activeRates}
          onRollback={handleExternalRatesUpdate}
        />
      )}

      {/* ── Bulk Adjust Modal ── */}
      <Modal show={bulkModal} onClose={() => setBulkModal(false)}
        title="📈 Bulk Rate Adjustment" wide
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => setBulkModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={applyBulkAdjust}>Apply Adjustment</button>
          </>
        }
      >
        <p style={{ color:'#666', fontSize:'0.83rem', marginBottom:14 }}>
          Select the category, time slots, and room types you want to adjust — then set the amount.
          Changes are previewed in the table. Click <strong>Save Rates</strong> to save to Firestore.
        </p>

        {/* Category tabs */}
        <div className="form-group">
          <label>Category</label>
          <div style={{ display:'flex', gap:6 }}>
            {CATEGORIES.map(cat => (
              <button key={cat}
                className={`btn ${bulkCat===cat?'btn-primary':'btn-outline'}`}
                style={{ flex:1 }}
                onClick={() => { setBulkCat(cat); setBulkSlots([]) }}>
                {cat.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Time slot checkboxes */}
        <div className="form-group">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
            <label style={{ margin:0 }}>Time Slots</label>
            <div style={{ display:'flex', gap:6 }}>
              <button className="btn btn-ghost" style={{ fontSize:'0.74rem', padding:'2px 8px' }}
                onClick={() => setBulkSlots([...(activeTSlots[bulkCat]||[])])}>All</button>
              <button className="btn btn-ghost" style={{ fontSize:'0.74rem', padding:'2px 8px' }}
                onClick={() => setBulkSlots([])}>None</button>
            </div>
          </div>
          <div className="checkbox-grid" style={{ maxHeight:160 }}>
            {(activeTSlots[bulkCat]||[]).map(slot => {
              const isSlotDisabled = disabledSlots?.[bulkCat]?.[slot] === true
              return (
                <label key={slot} style={{ opacity: isSlotDisabled ? 0.4 : 1 }}>
                  <input type="checkbox"
                    checked={bulkSlots.includes(slot)}
                    disabled={isSlotDisabled}
                    onChange={() => toggleBulkSlot(slot)} />
                  &nbsp;{displaySlotName(slot)}
                  {slot !== displaySlotName(slot) && (
                    <span style={{ color:'#bbb', fontSize:'0.7rem' }}> #{slot.split('_').pop()}</span>
                  )}
                  {isSlotDisabled && <span style={{ color:'#ccc', fontSize:'0.7rem' }}> (hidden)</span>}
                </label>
              )
            })}
            {!(activeTSlots[bulkCat]||[]).length && (
              <span style={{ color:'#aaa', fontSize:'0.82rem', gridColumn:'1/-1' }}>No slots in this category.</span>
            )}
          </div>
        </div>

        {/* Room type checkboxes */}
        <div className="form-group">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
            <label style={{ margin:0 }}>Room Types</label>
            <div style={{ display:'flex', gap:6 }}>
              <button className="btn btn-ghost" style={{ fontSize:'0.74rem', padding:'2px 8px' }}
                onClick={() => setBulkRooms(activeRTypes.map((_,i)=>i))}>All</button>
              <button className="btn btn-ghost" style={{ fontSize:'0.74rem', padding:'2px 8px' }}
                onClick={() => setBulkRooms([])}>None</button>
            </div>
          </div>
          <div className="checkbox-grid">
            {activeRTypes.map((rt, idx) => (
              <label key={idx}>
                <input type="checkbox"
                  checked={bulkRooms.includes(idx)}
                  onChange={() => toggleBulkRoom(idx)} />
                &nbsp;{rt}
              </label>
            ))}
          </div>
        </div>

        {/* Adjust mode + amount */}
        <div className="form-row">
          <div className="form-group">
            <label>Adjustment Type</label>
            <select value={bulkMode} onChange={e => setBulkMode(e.target.value)}>
              <option value="add">➕ Add to current value</option>
              <option value="subtract">➖ Subtract from current value</option>
              <option value="set">🟰 Set to exact value</option>
            </select>
          </div>
          <div className="form-group">
            <label>Amount (₱)</label>
            <input type="number" min="0" placeholder="e.g. 5"
              value={bulkAmount} onChange={e => setBulkAmount(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && applyBulkAdjust()} />
          </div>
        </div>

        {/* Live preview */}
        {bulkSlots.length > 0 && bulkRooms.length > 0 && bulkAmount !== '' && !isNaN(parseFloat(bulkAmount)) && (
          <div style={{ padding:'10px 14px', background:'#e8f4fd', border:'1px solid #bee3f8', borderRadius:6, fontSize:'0.82rem', color:'#1a6fa0' }}>
            Preview: <strong>{bulkSlots.length}</strong> slot{bulkSlots.length > 1 ? 's' : ''} ×{' '}
            <strong>{bulkRooms.length}</strong> room type{bulkRooms.length > 1 ? 's' : ''} will be{' '}
            {bulkMode === 'add'      && `increased by ₱${parseFloat(bulkAmount).toLocaleString()}`}
            {bulkMode === 'subtract' && `decreased by ₱${parseFloat(bulkAmount).toLocaleString()}`}
            {bulkMode === 'set'      && `set to ₱${parseFloat(bulkAmount).toLocaleString()}`}
            . Remember to <strong>Save Rates</strong> after.
          </div>
        )}
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
      {/* ── Copy Rates Modal ── */}
      <Modal show={copyModal} onClose={() => setCopyModal(false)}
        title="📋 Copy Rates Between Categories"
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => setCopyModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={applyCopyRates}
              disabled={copySrc === copyDst}>
              ✅ Copy {copySrc.toUpperCase()} → {copyDst.toUpperCase()}
            </button>
          </>
        }
      >
        <p style={{ color:'#666', fontSize:'0.83rem', marginBottom:16 }}>
          Copy all rates from one category into another. This overwrites the destination — review carefully before saving.
        </p>
        <div className="form-row">
          <div className="form-group">
            <label>Copy FROM</label>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {CATEGORIES.map(cat => (
                <label key={cat} style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer',
                  padding:'8px 12px', border:`2px solid ${copySrc===cat ? CAT_COLORS[cat] : '#e0e0e0'}`,
                  borderRadius:6, background: copySrc===cat ? `${CAT_COLORS[cat]}18` : '#fafafa',
                  fontWeight: copySrc===cat ? 700 : 400 }}>
                  <input type="radio" name="copySrc" checked={copySrc===cat}
                    onChange={() => setCopySrc(cat)} style={{ width:'auto' }} />
                  <span style={{ color: copySrc===cat ? CAT_COLORS[cat] : '#333', textTransform:'capitalize' }}>
                    {cat}
                  </span>
                  <span style={{ marginLeft:'auto', fontSize:'0.74rem', color:'#aaa' }}>
                    {Object.keys(activeRates[cat] || {}).length} slots
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.5rem', padding:'0 8px' }}>
            →
          </div>
          <div className="form-group">
            <label>Copy TO</label>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {CATEGORIES.map(cat => (
                <label key={cat} style={{ display:'flex', alignItems:'center', gap:8, cursor: copySrc===cat ? 'not-allowed' : 'pointer',
                  padding:'8px 12px', border:`2px solid ${copyDst===cat && copySrc!==cat ? CAT_COLORS[cat] : '#e0e0e0'}`,
                  borderRadius:6, background: copyDst===cat && copySrc!==cat ? `${CAT_COLORS[cat]}18` : copySrc===cat ? '#f5f5f5' : '#fafafa',
                  fontWeight: copyDst===cat ? 700 : 400, opacity: copySrc===cat ? 0.4 : 1 }}>
                  <input type="radio" name="copyDst" checked={copyDst===cat}
                    onChange={() => setCopyDst(cat)} disabled={copySrc===cat} style={{ width:'auto' }} />
                  <span style={{ color: copyDst===cat && copySrc!==cat ? CAT_COLORS[cat] : '#333', textTransform:'capitalize' }}>
                    {cat}
                  </span>
                  {copySrc===cat && <span style={{ marginLeft:'auto', fontSize:'0.72rem', color:'#bbb' }}>source</span>}
                </label>
              ))}
            </div>
          </div>
        </div>
        {copySrc !== copyDst && (
          <div style={{ marginTop:12, padding:'10px 14px', background:'#fff8e1', border:'1px solid #ffe082',
            borderRadius:6, fontSize:'0.82rem', color:'#5d4037' }}>
            ⚠️ This will <strong>overwrite all {copyDst} rates</strong> with {copySrc} rates.
            You can still edit values after copying. Remember to click <strong>Save Rates</strong>.
          </div>
        )}
      </Modal>

      {/* ── Weekend Schedule Modal ── */}
      <Modal show={weekendSchedModal} onClose={() => setWeekendSchedModal(false)}
        title="🗓 Weekend Rate Schedule"
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => setWeekendSchedModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveWeekendSched} disabled={savingWkndSched}>
              {savingWkndSched ? 'Saving…' : '✔ Save Schedule'}
            </button>
          </>
        }
      >
        <p style={{ color:'#666', fontSize:'0.83rem', marginBottom:14 }}>
          Define when weekend rates apply for <strong>{branchName}</strong>. The kiosk will automatically switch to weekend rates during this window.
        </p>
        <div className="form-row">
          <div className="form-group">
            <label>Weekend Starts (Day)</label>
            <select value={wkndStartDay} onChange={e => setWkndStartDay(parseInt(e.target.value))}>
              {DAYS.map((d,i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>At Hour (0–23)</label>
            <input type="number" min="0" max="23" value={wkndStartHour}
              onChange={e => setWkndStartHour(parseInt(e.target.value) || 0)} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Weekend Ends (Day)</label>
            <select value={wkndEndDay} onChange={e => setWkndEndDay(parseInt(e.target.value))}>
              {DAYS.map((d,i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>At Hour (0–23)</label>
            <input type="number" min="0" max="23" value={wkndEndHour}
              onChange={e => setWkndEndHour(parseInt(e.target.value) || 0)} />
          </div>
        </div>
        <div style={{ padding:'10px 14px', background:'#e8f4fd', border:'1px solid #bee3f8',
          borderRadius:6, fontSize:'0.82rem', color:'#1a6fa0', marginTop:8 }}>
          💡 Example: Starts <strong>{DAYS[wkndStartDay]} at {String(wkndStartHour).padStart(2,'0')}:00</strong>,
          ends <strong>{DAYS[wkndEndDay]} at {String(wkndEndHour).padStart(2,'0')}:00</strong>.
          The kiosk switches to weekend rates automatically within this window.
        </div>
      </Modal>

      {/* ── Excel Import Modal ── */}
      <Modal show={importModal} onClose={() => setImportModal(false)} title="📥 Import Excel Rates">
        <div style={{ display:'flex', flexDirection:'column', gap:14, minWidth:320 }}>

          {/* File name */}
          <div style={{
            padding:'10px 14px', background:'#f0f9ff',
            border:'1px solid #bae6fd', borderRadius:8,
            fontSize:'0.82rem', color:'#0369a1',
          }}>
            📄 <strong>{importFile?.name}</strong>
          </div>

          {/* Apply mode */}
          <div>
            <div style={{ fontWeight:700, fontSize:'0.8rem', color:'#333', marginBottom:8 }}>
              When should these rates take effect?
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {[
                { val:'now',      icon:'⚡', label:'Apply immediately',  sub:'Rates are loaded into the editor — review and click Save Rates.' },
                { val:'schedule', icon:'🕐', label:'Schedule for later', sub:'Rates are saved as a pending scheduled change with a future date.' },
              ].map(opt => (
                <label key={opt.val} style={{
                  display:'flex', alignItems:'flex-start', gap:10,
                  padding:'10px 14px',
                  border:`2px solid ${importApplyMode === opt.val ? '#2563eb' : '#e0e0e0'}`,
                  borderRadius:8,
                  background: importApplyMode === opt.val ? '#eff6ff' : '#fafafa',
                  cursor:'pointer',
                }}>
                  <input
                    type="radio"
                    name="importApplyMode"
                    value={opt.val}
                    checked={importApplyMode === opt.val}
                    onChange={() => setImportApplyMode(opt.val)}
                    style={{ marginTop:3, width:'auto', padding:0 }}
                  />
                  <div>
                    <div style={{ fontWeight:700, fontSize:'0.83rem' }}>{opt.icon} {opt.label}</div>
                    <div style={{ color:'#666', fontSize:'0.74rem', marginTop:2 }}>{opt.sub}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Schedule fields — only shown when 'schedule' selected */}
          {importApplyMode === 'schedule' && (
            <div style={{
              display:'flex', flexDirection:'column', gap:10,
              padding:'12px 14px', background:'#f8fafc',
              border:'1px solid #e2e8f0', borderRadius:8,
            }}>
              <div>
                <label style={{ fontSize:'0.77rem', fontWeight:600, color:'#555', display:'block', marginBottom:4 }}>
                  Schedule Label
                </label>
                <input
                  type="text"
                  placeholder={`Imported from ${importFile?.name || 'file'}`}
                  value={importLabel}
                  onChange={e => setImportLabel(e.target.value)}
                  style={{ width:'100%', padding:'7px 10px', borderRadius:6, border:'1.5px solid #d1d5db', fontSize:'0.83rem' }}
                />
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <div>
                  <label style={{ fontSize:'0.77rem', fontWeight:600, color:'#555', display:'block', marginBottom:4 }}>
                    Apply Date <span style={{ color:'#e53e3e' }}>*</span>
                  </label>
                  <input
                    type="date"
                    value={importDate}
                    onChange={e => setImportDate(e.target.value)}
                    style={{ width:'100%', padding:'7px 10px', borderRadius:6, border:'1.5px solid #d1d5db', fontSize:'0.83rem' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize:'0.77rem', fontWeight:600, color:'#555', display:'block', marginBottom:4 }}>
                    Apply Time
                  </label>
                  <input
                    type="time"
                    value={importTime}
                    onChange={e => setImportTime(e.target.value)}
                    style={{ width:'100%', padding:'7px 10px', borderRadius:6, border:'1.5px solid #d1d5db', fontSize:'0.83rem' }}
                  />
                </div>
              </div>
              {importDate && (
                <div style={{ fontSize:'0.76rem', color:'#2563eb', background:'#eff6ff', padding:'6px 10px', borderRadius:6 }}>
                  ✅ Will apply on{' '}
                  <strong>{new Date(`${importDate}T${importTime || '06:00'}`).toLocaleString('en-US', {
                    weekday:'short', month:'short', day:'numeric',
                    hour:'2-digit', minute:'2-digit', hour12:true,
                  })}</strong>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:4 }}>
            <button className="btn btn-ghost" onClick={() => setImportModal(false)}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={confirmImport}
              disabled={importApplyMode === 'schedule' && !importDate}
            >
              {importApplyMode === 'now' ? '📥 Import Now' : '🕐 Schedule Import'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── AI Image Import Modal ── */}
      <Modal show={aiModal} onClose={() => { setAiModal(false); setAiPreview(null) }}
        title="🤖 AI Rates Image Import" wide
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => { setAiModal(false); setAiPreview(null) }}>Cancel</button>
            {!aiPreview ? (
              <label className={`btn btn-primary${groqStatus?.type==='loading' ? ' disabled' : ''}`}
                style={{ cursor: groqStatus?.type==='loading' ? 'not-allowed' : 'pointer' }}>
                {groqStatus?.type==='loading' ? '⏳ Scanning…' : '📷 Choose Image'}
                <input ref={aiFileRef} type="file" accept="image/*" style={{ display:'none' }}
                  onChange={handleAIUpload} disabled={groqStatus?.type==='loading'} />
              </label>
            ) : (
              <button className="btn btn-primary" onClick={applyAIRates}>
                {aiTarget==='current' ? '✅ Apply to Rates Now' : '⏰ Save as Scheduled'}
              </button>
            )}
          </>
        }
      >
        <p style={{ color:'#666', fontSize:'0.83rem', marginBottom:14 }}>
          Upload a photo of your printed rates sheet. AI reads the table and auto-fills all slots —
          including custom ones like Weekly and Monthly. Works best with good lighting and a flat angle.
        </p>

        {/* Category */}
        <div className="form-group">
          <label>Category to update</label>
          <div style={{ display:'flex', gap:6 }}>
            {CATEGORIES.map(cat => (
              <button key={cat}
                className={`btn ${aiCategory===cat ? 'btn-primary' : 'btn-outline'}`}
                style={{ flex:1, textTransform:'capitalize',
                  ...(aiCategory===cat ? { background: CAT_COLORS[cat], borderColor: CAT_COLORS[cat] } : {}) }}
                onClick={() => { setAiCategory(cat); setAiPreview(null) }}>
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Target */}
        <div className="form-group">
          <label>Where to apply the rates</label>
          <div style={{ display:'flex', gap:6 }}>
            <button className={`btn ${aiTarget==='current' ? 'btn-primary' : 'btn-outline'}`}
              style={{ flex:1 }} onClick={() => setAiTarget('current')}>
              ✏️ Update Rates Now
            </button>
            <button className={`btn ${aiTarget==='scheduled' ? 'btn-primary' : 'btn-outline'}`}
              style={{ flex:1 }} onClick={() => setAiTarget('scheduled')}>
              ⏰ Save as Scheduled
            </button>
          </div>
          <small style={{ color:'#888', marginTop:4, display:'block' }}>
            {aiTarget==='current'
              ? 'Fills the table immediately — still need to click Save Rates to persist.'
              : 'Stored in Firestore and auto-applies at your chosen date/time. No manual action needed.'}
          </small>
        </div>

        {/* Scheduled fields */}
        {aiTarget==='scheduled' && (
          <>
            <div className="form-group">
              <label>Schedule Label</label>
              <input type="text" placeholder="e.g. Proposed Weekday Rates May 2025"
                value={aiSchedLabel} onChange={e => setAiSchedLabel(e.target.value)} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Apply Date</label>
                <input type="date" value={aiSchedDate} onChange={e => setAiSchedDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Apply Time</label>
                <input type="time" value={aiSchedTime} onChange={e => setAiSchedTime(e.target.value)} />
              </div>
            </div>
            <div style={{ padding:'8px 12px', background:'#e8f5e9', border:'1px solid #c8e6c9',
              borderRadius:6, fontSize:'0.8rem', color:'#2e7d32' }}>
              ⚡ Will <strong>auto-apply</strong> at the scheduled time and delete itself from the queue.
              No manual click needed — check Rate History to confirm it was applied.
            </div>
          </>
        )}

        {/* Drop zone */}
        {!aiPreview && groqStatus?.type !== 'loading' && (
          <label style={{ display:'block', border:'2px dashed #ddd', borderRadius:8,
            padding:'28px 16px', textAlign:'center', background:'#fafafa', cursor:'pointer', marginTop:8 }}>
            <div style={{ fontSize:'2rem', marginBottom:8 }}>📷</div>
            <p style={{ color:'#888', fontSize:'0.83rem', margin:0 }}>
              Click <strong>"Choose Image"</strong> below, or tap here to browse
            </p>
            <p style={{ color:'#aaa', fontSize:'0.76rem', marginTop:4 }}>
              JPG, PNG, HEIC · Any slot name is recognised — 2HRS, 24HRS, Weekly, Monthly, etc.
            </p>
            <input type="file" accept="image/*" style={{ display:'none' }}
              onChange={handleAIUpload} disabled={groqStatus?.type==='loading'} />
          </label>
        )}

        {/* Scanning indicator */}
        {groqStatus?.type === 'loading' && (
          <div style={{ textAlign:'center', padding:'24px 0', color:'#1e40af', fontSize:'0.85rem' }}>
            <div style={{ width:28, height:28, border:'3px solid #bfdbfe', borderTopColor:'#1e40af',
              borderRadius:'50%', animation:'spin 0.7s linear infinite', margin:'0 auto 12px' }} />
            Reading your rates sheet with AI…
          </div>
        )}

        {/* Preview table */}
        {aiPreview && (
          <div style={{ marginTop:8 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
              <strong style={{ fontSize:'0.86rem' }}>
                👁 Preview — {aiPreview.summary.category.toUpperCase()} Rates
              </strong>
              <button className="btn btn-ghost" style={{ fontSize:'0.74rem', padding:'3px 10px' }}
                onClick={() => setAiPreview(null)}>✕ Re-upload</button>
            </div>

            {/* Summary badges */}
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:10 }}>
              <span style={{ background:'#d4edda', color:'#155724', borderRadius:6, padding:'2px 8px', fontSize:'0.74rem', fontWeight:700 }}>
                ✅ {aiPreview.summary.matchedSlots} slots matched
              </span>
              <span style={{ background:'#d4edda', color:'#155724', borderRadius:6, padding:'2px 8px', fontSize:'0.74rem', fontWeight:700 }}>
                ✅ {aiPreview.summary.matchedRooms}/{aiPreview.summary.totalRooms} room types matched
              </span>
              {aiPreview.summary.unmappedRooms?.length > 0 && (
                <span style={{ background:'#fff3cd', color:'#856404', borderRadius:6, padding:'2px 8px', fontSize:'0.74rem', fontWeight:700 }}>
                  ⚠️ Unmatched rooms: {aiPreview.summary.unmappedRooms.join(', ')}
                </span>
              )}
              {aiPreview.summary.unmappedSlots?.length > 0 && (
                <span style={{ background:'#fff3cd', color:'#856404', borderRadius:6, padding:'2px 8px', fontSize:'0.74rem', fontWeight:700 }}>
                  ⚠️ Unmatched slots: {aiPreview.summary.unmappedSlots.join(', ')}
                </span>
              )}
            </div>

            {/* Rate preview table */}
            <div style={{ overflowX:'auto', maxHeight:300, overflowY:'auto' }}>
              <table style={{ borderCollapse:'collapse', fontSize:'0.77rem', width:'100%' }}>
                <thead>
                  <tr>
                    <th style={{ padding:'5px 10px', background:'#444', color:'#fff', border:'1px solid #ddd',
                      textAlign:'left', position:'sticky', top:0, whiteSpace:'nowrap' }}>Slot</th>
                    {activeRTypes.map(rt => (
                      <th key={rt} style={{ padding:'5px 8px', background:'#444', color:'#fff',
                        border:'1px solid #ddd', textAlign:'center', position:'sticky', top:0, whiteSpace:'nowrap' }}>
                        {rt}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(aiPreview.rates[aiPreview.summary.category]).map(([slot, vals]) => (
                    <tr key={slot}>
                      <td style={{ padding:'4px 10px', border:'1px solid #ddd', fontWeight:700, whiteSpace:'nowrap' }}>
                        {slot.replace(/_\d+$/, '')}
                      </td>
                      {vals.map((v, i) => {
                        const old     = Number(activeRates[aiPreview.summary.category]?.[slot]?.[i]) || 0
                        const changed = v !== null && v !== old
                        const diff    = v !== null ? v - old : 0
                        return (
                          <td key={i} style={{
                            padding:'4px 8px', border:'1px solid #ddd', textAlign:'center',
                            background: v===null ? '#f9f9f9' : changed ? '#d4edda' : undefined,
                            color:      v===null ? '#ccc'    : changed ? '#155724' : '#333',
                            fontWeight: changed ? 800 : 400,
                          }}>
                            {v===null ? '—' : `₱${Number(v).toLocaleString()}`}
                            {changed && old > 0 && (
                              <div style={{ fontSize:'0.6rem', color: diff>0?'#27ae60':'#c0392b', fontWeight:700 }}>
                                {diff>0 ? `+${diff.toLocaleString()}` : diff.toLocaleString()}
                              </div>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ color:'#888', fontSize:'0.76rem', marginTop:8 }}>
              Green = changed from current. Review before applying.
            </p>
          </div>
        )}
      </Modal>

    </div>
  )
}
