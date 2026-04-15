import { useState, useEffect, useRef } from 'react'
import { useSearchParams }              from 'react-router-dom'
import { db }                           from '../../firebase/config'
import { useAdmin }                     from '../../context/AdminContext'
import { useAuth }                      from '../../context/AuthContext'
import { Toast }                        from '../../components/Toast'
import { useToast }                     from '../../hooks/useToast'
import * as XLSX                        from 'xlsx'
import JSZip                            from 'jszip'
import { saveAs }                       from 'file-saver'

// ─── Constants ───────────────────────────────────────────────────────────────

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

const DEFAULT_TIME_SLOTS = {
  weekday: ['24HRS','12HRS','10HRS','10HRS ONP','6HRS','3HRS'],
  weekend: ['24HRS','12HRS','10HRS','6HRS','3HRS'],
  holiday: ['24HRS','12HRS','10HRS','6HRS','3HRS'],
}
const DEFAULT_ROOM_TYPES    = ['Econo','Premium','Deluxe','Regency 2']
const DEFAULT_DRIVEIN_TYPES = ['Standard','Deluxe']
const CATEGORIES            = ['weekday','weekend','holiday']

const FREQ_OPTIONS = [
  { value: 'off',      label: '🚫 Off (manual only)' },
  { value: 'daily',    label: '📅 Daily' },
  { value: 'weekly',   label: '📅 Weekly' },
  { value: 'biweekly', label: '📅 Every 2 Weeks' },
  { value: 'monthly',  label: '📅 Monthly' },
]

const FREQ_DAYS = { daily: 1, weekly: 7, biweekly: 14, monthly: 30 }

// ─── Schedule helpers ─────────────────────────────────────────────────────────

function isBackupDue(schedule) {
  if (!schedule?.frequency || schedule.frequency === 'off') return false
  const last = schedule.lastBackupAt ? new Date(schedule.lastBackupAt) : null
  if (!last) return true
  const diffDays = (Date.now() - last.getTime()) / 86400000
  return diffDays >= (FREQ_DAYS[schedule.frequency] ?? 7)
}

function computeNextBackup(freq, lastAt) {
  if (!freq || freq === 'off') return null
  const base = lastAt ? new Date(lastAt) : new Date()
  const days  = FREQ_DAYS[freq] ?? 7
  return new Date(base.getTime() + days * 86400000).toISOString()
}

// ─── General helpers ──────────────────────────────────────────────────────────

function safeName(str) {
  return (str || 'branch')
    .replace(/[^a-z0-9]/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase()
}

function nowStamp() {
  return new Date().toISOString().slice(0, 10)
}

function todayLabel() {
  return new Date().toLocaleDateString('en-US', {
    year:'numeric', month:'short', day:'numeric',
    hour:'2-digit', minute:'2-digit', hour12:true,
  })
}

function formatHour(h) {
  if (h === undefined || h === null) return '—'
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour  = h % 12 || 12
  return `${hour}:00 ${ampm}`
}

function fmtDt(isoStr) {
  if (!isoStr) return '—'
  return new Date(isoStr).toLocaleString('en-US', {
    month:'short', day:'numeric', year:'numeric',
    hour:'2-digit', minute:'2-digit', hour12:true,
  })
}

// ─── Excel Sheet Builders ─────────────────────────────────────────────────────

function buildRateSheet(rates, timeSlots, roomTypes, category, branchName) {
  const slots    = timeSlots[category] || []
  const catLabel = category.charAt(0).toUpperCase() + category.slice(1)

  const aoa = [
    ['Branch:',   branchName],
    ['Category:', `${catLabel} Rates`],
    ['Exported:', todayLabel()],
    [],
    ['Time Slot', ...roomTypes],
  ]

  slots.forEach(slot => {
    const vals = rates[category]?.[slot] || Array(roomTypes.length).fill(0)
    aoa.push([slot, ...vals.map(v => Number(v) || 0)])
  })

  aoa.push([])
  const avgRow = ['Average ₱']
  roomTypes.forEach((_, ri) => {
    const nums = slots
      .map(s => Number(rates[category]?.[s]?.[ri]) || 0)
      .filter(n => n > 0)
    avgRow.push(nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0)
  })
  aoa.push(avgRow)

  const ws    = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch:15 }, ...roomTypes.map(() => ({ wch:13 }))]
  ws['!rows'] = [null, null, null, null, { hpt:16 }]
  return ws
}

function buildTransitionSheet(settings, branchName) {
  const sd = settings.weekendStartDay  ?? 5
  const sh = settings.weekendStartHour ?? 6
  const ed = settings.weekendEndDay    ?? 0
  const eh = settings.weekendEndHour   ?? 18

  const aoa = [
    ['Branch:',   branchName],
    ['Exported:', todayLabel()],
    [],
    ['WEEKEND / WEEKDAY RATE TRANSITION SCHEDULE'],
    [],
    ['Setting',            'Value',      'Notes'],
    ['Weekend Start Day',  DAYS[sd],     'Rates switch → Weekend on this day'],
    ['Weekend Start Time', formatHour(sh), `${DAYS[sd]} ${formatHour(sh)} — Weekend rates take effect`],
    ['Weekend End Day',    DAYS[ed],     'Rates revert → Weekday on this day'],
    ['Weekend End Time',   formatHour(eh), `${DAYS[ed]} ${formatHour(eh)} — Weekday rates resume`],
    [],
    ['Summary:',
      `Weekday rates apply Mon–${DAYS[sd]} until ${formatHour(sh)}, then Weekend rates apply through ${DAYS[ed]} ${formatHour(eh)}.`,
      ''],
    [],
    ['10HRS ONP Note', 'ONP = Overnight Package. Applies to weekday overnight check-ins only.', ''],
  ]

  const ws    = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch:28 }, { wch:36 }, { wch:52 }]
  return ws
}

/**
 * Rate History sheet — 3 most recent snapshots.
 * Assumes rateHistory docs have:
 *   recordedAt (ISO string), rates { weekday, weekend, holiday },
 *   optionally: label, changedBy, type
 */
function buildRateHistorySheet(history, timeSlots, roomTypes, branchName) {
  const aoa = [
    ['Branch:',   branchName],
    ['Exported:', todayLabel()],
    [`Showing ${history.length} most recent rate snapshot(s)`],
    [],
  ]

  history.forEach((entry, idx) => {
    const ts    = entry.recordedAt || entry.createdAt || entry.timestamp || null
    const rates = entry.rates      || entry.newRates  || entry.rateData  || {}

    aoa.push([`── Snapshot ${idx + 1} of ${history.length} ──`])
    aoa.push(['Date Recorded:', fmtDt(ts)])
    if (entry.label)     aoa.push(['Label:',      entry.label])
    if (entry.changedBy) aoa.push(['Changed By:', entry.changedBy])
    if (entry.type)      aoa.push(['Type:',       entry.type])
    aoa.push([])

    let hasAnyRate = false
    CATEGORIES.forEach(cat => {
      const catRates = rates[cat]
      if (!catRates || !Object.keys(catRates).length) return
      hasAnyRate = true

      const slots    = timeSlots[cat] || Object.keys(catRates)
      const catLabel = cat.charAt(0).toUpperCase() + cat.slice(1)

      aoa.push([`${catLabel} Rates`, ...roomTypes])
      slots.forEach(slot => {
        if (!catRates[slot]) return
        aoa.push([slot, ...(catRates[slot] || []).map(v => Number(v) || 0)])
      })
      aoa.push([])
    })

    if (!hasAnyRate) aoa.push(['(No rate data in this snapshot)'])
    aoa.push([])
  })

  const ws    = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch:20 }, ...roomTypes.map(() => ({ wch:13 }))]
  return ws
}

function buildScheduledWorkbook(schedules, timeSlots, roomTypes, branchName, mode) {
  const wb = XLSX.utils.book_new()

  const summaryAoa = [
    ['Branch:',   branchName],
    ['Mode:',     mode === 'drivein' ? 'Drive-In' : 'Walk-In'],
    ['Exported:', todayLabel()],
    [],
    ['#', 'Label', 'Apply Date', 'Apply Time', 'Status', 'Type',
     'Rollback At', 'Adj. Type', 'Adj. Amount', 'Slots Targeted', 'Rooms Targeted'],
  ]

  schedules.forEach((s, i) => {
    const applyDt    = s.applyAt    ? new Date(s.applyAt)    : null
    const rollDt     = s.rollbackAt ? new Date(s.rollbackAt) : null
    const isAbsolute = !!s.newRates

    if (isAbsolute) {
      summaryAoa.push([
        i + 1, s.label || '—',
        applyDt ? applyDt.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }) : '—',
        applyDt ? applyDt.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:true }) : '—',
        (s.status || 'pending').toUpperCase(),
        'Absolute (see detail sheet)',
        rollDt ? fmtDt(s.rollbackAt) : '—',
        '—', '—', '—', '—',
      ])
    } else {
      const adjs = s.adjustments || []
      if (!adjs.length) {
        summaryAoa.push([
          i + 1, s.label || '—',
          applyDt ? applyDt.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }) : '—',
          applyDt ? applyDt.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:true }) : '—',
          (s.status || 'pending').toUpperCase(), 'Adjustment',
          rollDt ? fmtDt(s.rollbackAt) : '—', '—', '—', '—', '—',
        ])
      } else {
        adjs.forEach((adj, ai) => {
          const slotsList = adj.slots?.length
            ? adj.slots.map(k => k.split(':').pop()).join(', ')
            : 'All slots'
          const roomsList = adj.rooms?.length
            ? adj.rooms.map(ri => roomTypes[ri] || `Room ${ri}`).join(', ')
            : 'All rooms'

          summaryAoa.push([
            ai === 0 ? i + 1 : '',
            ai === 0 ? (s.label || '—') : '',
            ai === 0 ? (applyDt ? applyDt.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }) : '—') : '',
            ai === 0 ? (applyDt ? applyDt.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:true }) : '—') : '',
            ai === 0 ? (s.status || 'pending').toUpperCase() : '',
            ai === 0 ? 'Adjustment' : '',
            ai === 0 ? (rollDt ? fmtDt(s.rollbackAt) : '—') : '',
            adj.type   ? adj.type.charAt(0).toUpperCase() + adj.type.slice(1) : '—',
            adj.amount != null ? `₱${adj.amount}` : '—',
            slotsList, roomsList,
          ])
        })
      }
    }
  })

  const summaryWs = XLSX.utils.aoa_to_sheet(summaryAoa)
  summaryWs['!cols'] = [
    { wch:4 },{ wch:32 },{ wch:14 },{ wch:10 },{ wch:12 },
    { wch:24 },{ wch:22 },{ wch:12 },{ wch:12 },{ wch:36 },{ wch:28 },
  ]
  XLSX.utils.book_append_sheet(wb, summaryWs, 'All Schedules')

  schedules.forEach((s, i) => {
    if (!s.newRates) return
    const sheetLabel = `Sched ${(i + 1).toString().padStart(2, '0')}`
    const detailAoa  = [
      ['Label:',       s.label   || '—'],
      ['Apply At:',    fmtDt(s.applyAt)],
      ['Status:',     (s.status  || 'pending').toUpperCase()],
      ['Mode:',        mode === 'drivein' ? 'Drive-In' : 'Walk-In'],
      ['Rollback At:', s.withRollback ? fmtDt(s.rollbackAt) : 'None'],
      [],
    ]

    CATEGORIES.forEach(cat => {
      const catRates = s.newRates[cat]
      if (!catRates || !Object.keys(catRates).length) return
      const slots    = timeSlots[cat] || Object.keys(catRates)
      const catLabel = cat.charAt(0).toUpperCase() + cat.slice(1)

      detailAoa.push([`── ${catLabel.toUpperCase()} RATES ──`])
      detailAoa.push(['Time Slot', ...roomTypes])
      slots.forEach(slot => {
        if (!catRates[slot]) return
        detailAoa.push([slot, ...(catRates[slot] || []).map(v => Number(v) || 0)])
      })
      detailAoa.push([])
    })

    const ws    = XLSX.utils.aoa_to_sheet(detailAoa)
    ws['!cols'] = [{ wch:16 }, ...roomTypes.map(() => ({ wch:13 }))]
    XLSX.utils.book_append_sheet(wb, ws, sheetLabel)
  })

  return wb
}

function buildHolidaysWorkbook(holidays, allBranches) {
  const wb  = XLSX.utils.book_new()
  const aoa = [
    ['HOLIDAY EVENT SCHEDULE'],
    ['Exported:', todayLabel()],
    ['Total Holidays:', holidays.length],
    [],
    ['Holiday Name', 'Start Date', 'End Date', 'Start Time', 'End Time', 'Applied To Branches'],
  ]

  holidays.forEach(h => {
    let branchText
    if (!h.branches || !Array.isArray(h.branches) || h.branches.length === 0) {
      branchText = 'All Branches'
    } else {
      branchText = h.branches.map(id => {
        if (id === '*') return 'All Branches'
        return allBranches.find(b => b.id === id)?.name || id
      }).join(', ')
    }
    aoa.push([
      h.name      || '—',
      h.start     || '—',
      h.end       || h.start || '—',
      h.startTime || '00:00',
      h.endTime   || '23:59',
      branchText,
    ])
  })

  const ws    = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch:32 },{ wch:14 },{ wch:14 },{ wch:12 },{ wch:12 },{ wch:50 }]
  XLSX.utils.book_append_sheet(wb, ws, 'Holidays')
  return wb
}

function wbToBuffer(wb) {
  return XLSX.write(wb, { type:'array', bookType:'xlsx' })
}

// ─── Reusable checkbox card ───────────────────────────────────────────────────

function CheckCard({ checked, onChange, icon, title, desc }) {
  return (
    <label style={{
      display:'flex', alignItems:'flex-start', gap:10,
      padding:'12px 15px',
      border:`2px solid ${checked ? '#2563eb' : '#e0e0e0'}`,
      borderRadius:10,
      background: checked ? '#eff6ff' : '#fafafa',
      cursor:'pointer',
    }}>
      <input type="checkbox" style={{ width:'auto', padding:0, marginTop:3 }}
        checked={checked} onChange={e => onChange(e.target.checked)} />
      <div>
        <div style={{ fontWeight:700, fontSize:'0.84rem' }}>{icon} {title}</div>
        <div style={{ color:'#666', fontSize:'0.74rem', marginTop:3, lineHeight:1.5 }}>{desc}</div>
      </div>
    </label>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DataBackup() {
  const { allBranches }              = useAdmin()
  const { currentUser, userProfile } = useAuth()
  const { toast, showToast }         = useToast()
  const [searchParams]               = useSearchParams()
  const autoRunFired                 = useRef(false)

  const isSuperAdmin     = userProfile?.role === 'superadmin'
  const assignedBranches = userProfile?.branches || []
  const hasAllAccess     = assignedBranches.includes('*') || isSuperAdmin

  const visibleBranches = isSuperAdmin
    ? allBranches
    : allBranches.filter(b => hasAllAccess || assignedBranches.includes(b.id))

  // ── UI state ────────────────────────────────────────────────────────────────
  const [selectedIds,   setSelectedIds]   = useState([])
  const [inclRates,     setInclRates]     = useState(true)
  const [inclRateHist,  setInclRateHist]  = useState(true)
  const [inclScheduled, setInclScheduled] = useState(true)
  const [inclHolidays,  setInclHolidays]  = useState(true)
  const [inclDriveIn,   setInclDriveIn]   = useState(true)
  const [running,       setRunning]        = useState(false)
  const [progress,      setProgress]       = useState('')
  const [log,           setLog]            = useState([])

  // ── Auto-backup schedule state ───────────────────────────────────────────────
  const [backupSched,  setBackupSched]  = useState(null)
  const [schedFreq,    setSchedFreq]    = useState('off')
  const [schedLoaded,  setSchedLoaded]  = useState(false)
  const [savingSched,  setSavingSched]  = useState(false)

  // ── Load user's schedule on mount ────────────────────────────────────────────
  useEffect(() => {
    if (!currentUser) return
    db.collection('users').doc(currentUser.uid).get()
      .then(doc => {
        const s = doc.data()?.backupSchedule || null
        setBackupSched(s)
        setSchedFreq(s?.frequency || 'off')
      })
      .catch(err => console.warn('[DataBackup] schedule load:', err))
      .finally(() => setSchedLoaded(true))
  }, [currentUser?.uid])

  // ── Auto-run when navigated here with ?autorun=1 ──────────────────────────────
  useEffect(() => {
    if (!schedLoaded) return
    if (searchParams.get('autorun') === '1' && !autoRunFired.current) {
      autoRunFired.current = true
      runExport({ auto: true })
    }
  }, [schedLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const targetBranches = selectedIds.length
    ? visibleBranches.filter(b => selectedIds.includes(b.id))
    : visibleBranches

  function appendLog(msg) { setLog(prev => [...prev, msg]) }

  function toggleId(id) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const allSelected = selectedIds.length === 0 || selectedIds.length === visibleBranches.length

  function handleSelectAll() {
    setSelectedIds(allSelected ? [] : visibleBranches.map(b => b.id))
  }

  const fileCount =
    targetBranches.length * (inclRates ? 1 : 0) +
    targetBranches.length * (inclScheduled ? (inclDriveIn ? 1.5 : 1) : 0) +
    (inclHolidays ? 1 : 0)

  // ── Save auto-backup schedule to Firestore ────────────────────────────────────
  async function saveSchedule() {
    if (!currentUser) return
    setSavingSched(true)
    try {
      const nextAt  = computeNextBackup(schedFreq, backupSched?.lastBackupAt)
      const updated = {
        frequency:    schedFreq,
        updatedAt:    new Date().toISOString(),
        nextBackupAt: nextAt,
        lastBackupAt: backupSched?.lastBackupAt || null,
      }
      await db.collection('users').doc(currentUser.uid)
        .set({ backupSchedule: updated }, { merge: true })
      setBackupSched(updated)
      showToast('✅ Auto-backup schedule saved!')
    } catch (e) {
      showToast('Failed to save schedule.', 'error')
      console.error('[DataBackup] saveSchedule:', e)
    } finally {
      setSavingSched(false)
    }
  }

  // ── Stamp lastBackupAt after a successful export ──────────────────────────────
  async function stampLastBackup() {
    if (!currentUser || !backupSched?.frequency || backupSched.frequency === 'off') return
    try {
      const now     = new Date().toISOString()
      const nextAt  = computeNextBackup(backupSched.frequency, now)
      const updated = { ...backupSched, lastBackupAt: now, nextBackupAt: nextAt }
      await db.collection('users').doc(currentUser.uid)
        .set({ backupSchedule: updated }, { merge: true })
      setBackupSched(updated)
    } catch (e) {
      console.warn('[DataBackup] stampLastBackup:', e)
    }
  }

  // ── Main export handler ───────────────────────────────────────────────────────
  async function runExport({ auto = false } = {}) {
    if (!inclRates && !inclScheduled && !inclHolidays) {
      showToast('Select at least one export type.', 'warn'); return
    }
    if (!targetBranches.length) {
      showToast('No branches to export.', 'warn'); return
    }

    setRunning(true)
    setLog([])
    if (auto) appendLog('🤖 Auto-backup triggered on login\n')

    try {
      const zip    = new JSZip()
      const stamp  = nowStamp()
      const folder = zip.folder(`kiosk_backup_${stamp}`)

      // ── 1. GLOBAL HOLIDAYS ──────────────────────────────────────────────────
      if (inclHolidays) {
        setProgress('Fetching holidays…')
        appendLog('📅 Fetching global holiday events…')
        const snap     = await db.collection('holidays').orderBy('start').get()
        const holidays = snap.docs.map(d => ({ id: d.id, ...d.data() }))

        if (holidays.length === 0) {
          appendLog('   ℹ️ No holidays found — skipped')
        } else {
          appendLog(`   Found ${holidays.length} holiday event(s)`)
          folder.file('holidays.xlsx', wbToBuffer(buildHolidaysWorkbook(holidays, allBranches)))
          appendLog('   ✅ holidays.xlsx added')
        }
      }

      // ── 2. PER-BRANCH DATA ──────────────────────────────────────────────────
      for (const branch of targetBranches) {
        const bName = branch.name || branch.id
        const bFile = safeName(bName)
        appendLog(`\n🏢 ${bName}`)

        setProgress(`Loading ${bName}…`)
        const snap = await db.collection('branches').doc(branch.id).get()
        if (!snap.exists) { appendLog('   ⚠ Branch not found — skipped'); continue }

        const data = snap.data()
        const s    = data.settings || {}

        const timeSlots   = s.timeSlots       || DEFAULT_TIME_SLOTS
        const roomTypes   = s.roomTypes        || DEFAULT_ROOM_TYPES
        const hasDriveIn  = s.hasDriveIn       === true
        const diTimeSlots = s.driveInTimeSlots || DEFAULT_TIME_SLOTS
        const diRoomTypes = s.driveInRoomTypes || DEFAULT_DRIVEIN_TYPES

        // ── 2a. CURRENT RATES + optional RATE HISTORY ────────────────────────
        if (inclRates) {
          setProgress(`Building rates: ${bName}…`)
          appendLog('   💰 Building current rates…')

          const rates   = data.rates        || {}
          const diRates = data.driveInRates || {}
          const wb      = XLSX.utils.book_new()

          CATEGORIES.forEach(cat => {
            const ws    = buildRateSheet(rates, timeSlots, roomTypes, cat, bName)
            const label = cat.charAt(0).toUpperCase() + cat.slice(1)
            XLSX.utils.book_append_sheet(wb, ws, label)
          })

          XLSX.utils.book_append_sheet(wb, buildTransitionSheet(s, bName), 'Weekend Transition')

          if (hasDriveIn && inclDriveIn) {
            CATEGORIES.forEach(cat => {
              const ws    = buildRateSheet(diRates, diTimeSlots, diRoomTypes, cat, `${bName} (Drive-In)`)
              const label = `DI ${cat.charAt(0).toUpperCase() + cat.slice(1)}`
              XLSX.utils.book_append_sheet(wb, ws, label)
            })
            appendLog('      🚗 Drive-In sheets included')
          }

          // Rate History — 3 most recent snapshots
          if (inclRateHist) {
            setProgress(`Fetching rate history: ${bName}…`)
            try {
              const histSnap = await db
                .collection('branches').doc(branch.id)
                .collection('rateHistory')
                .orderBy('recordedAt', 'desc')
                .limit(3)
                .get()

              if (histSnap.empty) {
                appendLog('      ℹ️ No rate history — sheet skipped')
              } else {
                const history = histSnap.docs.map(d => ({ id: d.id, ...d.data() }))
                XLSX.utils.book_append_sheet(
                  wb,
                  buildRateHistorySheet(history, timeSlots, roomTypes, bName),
                  'Rate History'
                )
                appendLog(`      📈 ${history.length} rate history snapshot(s) included`)
              }
            } catch (histErr) {
              appendLog(`      ⚠️ Rate history unavailable: ${histErr.message}`)
            }
          }

          folder.file(`${bFile}_rates.xlsx`, wbToBuffer(wb))
          appendLog(`   ✅ ${bFile}_rates.xlsx`)
        }

        // ── 2b. SCHEDULED RATES (skipped if no data) ─────────────────────────
        if (inclScheduled) {
          setProgress(`Fetching schedules: ${bName}…`)
          const modesNeeded = ['walkin']
          if (hasDriveIn && inclDriveIn) modesNeeded.push('drivein')

          for (const mode of modesNeeded) {
            const modeLabel = mode === 'drivein' ? 'Drive-In' : 'Walk-In'
            appendLog(`   ⏰ Fetching scheduled rates (${modeLabel})…`)

            // No orderBy = no composite index needed; sorted client-side
            const schedSnap = await db
              .collection('branches').doc(branch.id)
              .collection('scheduledRates')
              .where('mode', '==', mode)
              .get()

            const schedules = schedSnap.docs
              .map(d => ({ id: d.id, ...d.data() }))
              .sort((a, b) => {
                const tA = a.applyAt ? new Date(a.applyAt).getTime() : 0
                const tB = b.applyAt ? new Date(b.applyAt).getTime() : 0
                return tA - tB
              })

            // ✅ Skip if empty — no file generated
            if (schedules.length === 0) {
              appendLog(`   ℹ️ No scheduled rates (${modeLabel}) — skipped`)
              continue
            }

            const activeRT = mode === 'drivein' ? diRoomTypes : roomTypes
            const activeTS = mode === 'drivein' ? diTimeSlots : timeSlots
            const suffix   = mode === 'drivein' ? '_drivein' : ''
            const filename = `${bFile}_scheduled${suffix}.xlsx`

            folder.file(filename, wbToBuffer(buildScheduledWorkbook(schedules, activeTS, activeRT, bName, mode)))

            const pending = schedules.filter(s => s.status === 'pending').length
            appendLog(`   ✅ ${filename} — ${schedules.length} entries (${pending} pending)`)
          }
        }
      }

      // ── 3. GENERATE & DOWNLOAD ZIP ─────────────────────────────────────────
      setProgress('Generating ZIP…')
      appendLog('\n📦 Compressing and preparing ZIP…')

      const blob     = await zip.generateAsync({ type:'blob', compression:'DEFLATE', compressionOptions:{ level:6 } })
      const filename = `kiosk_backup_${stamp}.zip`
      saveAs(blob, filename)

      appendLog(`\n✅ Download started: ${filename}`)
      appendLog(`   Branches: ${targetBranches.length}`)
      appendLog(`   Exported: ${[
        inclRates     && 'Current Rates',
        inclRateHist  && 'Rate History',
        inclScheduled && 'Scheduled Rates',
        inclHolidays  && 'Holidays',
      ].filter(Boolean).join(', ')}`)

      showToast('✅ Backup downloaded!')
      await stampLastBackup()

    } catch (err) {
      appendLog(`\n❌ ERROR: ${err.message}`)
      showToast('Export failed: ' + err.message, 'error')
      console.error('[DataBackup]', err)
    } finally {
      setRunning(false)
      setProgress('')
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="page">
      <Toast toast={toast} />

      {/* ── Main config card ── */}
      <div className="card">
        <div className="card-header-row">
          <div>
            <h2 className="card-title">📦 Data Backup</h2>
            <p style={{ color:'#888', fontSize:'0.8rem', marginTop:3 }}>
              Export rates, rate history, scheduled changes, and holidays to Excel —
              downloaded as a single ZIP. Files are only generated when data exists.
            </p>
          </div>
        </div>

        {/* ── Branch selector ── */}
        <section style={{ marginBottom:20 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
            <span style={{ fontWeight:700, fontSize:'0.83rem', color:'#333' }}>🏢 Branches to include</span>
            <button className="btn btn-ghost" style={{ fontSize:'0.75rem', padding:'3px 9px' }}
              onClick={handleSelectAll}>
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          {visibleBranches.length === 0 ? (
            <p className="hint">No branches accessible.</p>
          ) : (
            <div style={{ display:'flex', flexWrap:'wrap', gap:7 }}>
              {visibleBranches.map(b => {
                const isSel = selectedIds.length === 0 || selectedIds.includes(b.id)
                return (
                  <label key={b.id} style={{
                    display:'flex', alignItems:'center', gap:7,
                    padding:'7px 13px',
                    border:`2px solid ${isSel ? '#2563eb' : '#e0e0e0'}`,
                    borderRadius:8,
                    background: isSel ? '#eff6ff' : '#fafafa',
                    cursor:'pointer', fontSize:'0.82rem',
                    fontWeight: isSel ? 700 : 400,
                    userSelect:'none',
                    transition:'border-color 0.15s, background 0.15s',
                  }}>
                    <input type="checkbox" style={{ width:'auto', padding:0 }}
                      checked={isSel} onChange={() => toggleId(b.id)} />
                    {b.name || b.id}
                    {b.settings?.hasDriveIn && (
                      <span style={{
                        fontSize:'0.68rem', background:'#e8f4fd', color:'#1a6fa0',
                        padding:'1px 5px', borderRadius:4, fontWeight:800,
                      }}>🚗 DI</span>
                    )}
                  </label>
                )
              })}
            </div>
          )}
          {selectedIds.length === 0 && visibleBranches.length > 0 && (
            <p style={{ color:'#888', fontSize:'0.76rem', marginTop:5 }}>
              ✓ All {visibleBranches.length} branches will be exported.
            </p>
          )}
        </section>

        {/* ── What to include ── */}
        <section style={{ marginBottom:22 }}>
          <div style={{ fontWeight:700, fontSize:'0.83rem', color:'#333', marginBottom:9 }}>📋 What to export</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:10 }}>
            <CheckCard checked={inclRates}     onChange={setInclRates}
              icon="💰" title="Current Rates"
              desc="Weekday, Weekend & Holiday tables including 10HRS ONP plus the Weekend Transition schedule." />
            <CheckCard checked={inclRateHist}  onChange={setInclRateHist}
              icon="📈" title="Rate History (Top 3)"
              desc="3 most recent rate snapshots per branch with recorded dates. Sheet is skipped if no history exists." />
            <CheckCard checked={inclScheduled} onChange={setInclScheduled}
              icon="⏰" title="Scheduled Rates"
              desc="Pending and past rate schedules. Automatically skipped per branch if no data found." />
            <CheckCard checked={inclHolidays}  onChange={setInclHolidays}
              icon="📅" title="Holiday Events"
              desc="Global holiday calendar with dates, times, and assigned branches. Skipped if none." />
            <CheckCard checked={inclDriveIn}   onChange={setInclDriveIn}
              icon="🚗" title="Drive-In Data"
              desc="Include Drive-In rate sheets and schedules for branches that have it enabled." />
          </div>
        </section>

        {/* ── ZIP preview ── */}
        <div style={{
          padding:'12px 16px', background:'#f8f9fa', border:'1px solid #e0e0e0',
          borderRadius:8, fontSize:'0.81rem', color:'#444', marginBottom:18,
        }}>
          <div style={{ fontWeight:700, marginBottom:6 }}>📦 ZIP contents preview</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'3px 24px', fontSize:'0.78rem' }}>
            {inclRates && (
              <div>💰 <code>{'{branch}_rates.xlsx'}</code>
                <span style={{ color:'#888' }}> × {targetBranches.length}</span>
                <div style={{ color:'#888', paddingLeft:16, fontSize:'0.72rem' }}>
                  Sheets: Weekday, Weekend, Holiday, Weekend Transition
                  {inclRateHist ? ', Rate History (if data exists)' : ''}
                  {inclDriveIn  ? ', DI Weekday, DI Weekend, DI Holiday' : ''}
                </div>
              </div>
            )}
            {inclScheduled && (
              <div>⏰ <code>{'{branch}_scheduled.xlsx'}</code>
                <span style={{ color:'#888' }}> × up to {targetBranches.length}</span>
                <div style={{ color:'#888', paddingLeft:16, fontSize:'0.72rem' }}>
                  Skipped if branch has no scheduled rates.
                  {inclDriveIn ? ' Drive-In version also generated if data exists.' : ''}
                </div>
              </div>
            )}
            {inclHolidays && (
              <div>📅 <code>holidays.xlsx</code>
                <span style={{ color:'#888' }}> × 1 (if data exists)</span>
              </div>
            )}
          </div>
          <div style={{ marginTop:8, color:'#888', fontSize:'0.76rem' }}>
            Up to <strong>~{Math.ceil(fileCount)}</strong> Excel file(s) across{' '}
            <strong>{targetBranches.length}</strong> branch(es), zipped into{' '}
            <strong>kiosk_backup_{nowStamp()}.zip</strong>
          </div>
        </div>

        {/* ── Action button ── */}
        <button
          className="btn btn-primary"
          style={{ fontSize:'0.9rem', padding:'11px 28px', minWidth:240 }}
          onClick={() => runExport()}
          disabled={running}
        >
          {running ? `⏳ ${progress || 'Working…'}` : '⬇️ Generate & Download ZIP Backup'}
        </button>
      </div>

      {/* ── Auto-Backup Schedule card ── */}
      <div className="card" style={{ marginTop:14 }}>
        <h3 style={{ fontSize:'0.92rem', fontWeight:700, marginBottom:4 }}>🔁 Auto-Backup Schedule</h3>
        <p style={{ color:'#888', fontSize:'0.78rem', marginBottom:14 }}>
          This is your personal setting — each user manages their own schedule independently.
          On login, if the backup date has passed, the export starts automatically.
        </p>

        <div style={{ display:'flex', alignItems:'flex-end', gap:12, flexWrap:'wrap', marginBottom:14 }}>
          <div>
            <div style={{ fontSize:'0.75rem', fontWeight:600, color:'#555', marginBottom:4 }}>Frequency</div>
            <select
              value={schedFreq}
              onChange={e => setSchedFreq(e.target.value)}
              style={{
                padding:'7px 12px', borderRadius:7, border:'1.5px solid #d1d5db',
                fontSize:'0.83rem', background:'#fff', cursor:'pointer',
              }}
            >
              {FREQ_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <button
            className="btn btn-primary"
            style={{ fontSize:'0.82rem', padding:'8px 18px' }}
            onClick={saveSchedule}
            disabled={savingSched}
          >
            {savingSched ? '💾 Saving…' : '💾 Save Schedule'}
          </button>
        </div>

        {/* Schedule status pills */}
        {backupSched && backupSched.frequency !== 'off' && (
          <div style={{
            display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(170px, 1fr))',
            gap:10, fontSize:'0.78rem',
          }}>
            {[
              {
                label: 'Frequency',
                value: FREQ_OPTIONS.find(o => o.value === backupSched.frequency)?.label.replace(/^📅 /, '') || backupSched.frequency,
              },
              { label: 'Last Backup',  value: backupSched.lastBackupAt ? fmtDt(backupSched.lastBackupAt) : 'Never' },
              { label: 'Next Backup',  value: backupSched.nextBackupAt ? fmtDt(backupSched.nextBackupAt) : '—' },
              {
                label: 'Status',
                value: isBackupDue(backupSched) ? '⚠️ Overdue' : '✅ Scheduled',
                color: isBackupDue(backupSched) ? '#b45309' : '#166534',
                bg:    isBackupDue(backupSched) ? '#fef3c7' : '#dcfce7',
              },
            ].map(item => (
              <div key={item.label} style={{
                padding:'8px 12px', borderRadius:8,
                background: item.bg || '#f3f4f6',
                border:'1px solid #e5e7eb',
              }}>
                <div style={{ color:'#6b7280', fontSize:'0.7rem', marginBottom:2 }}>{item.label}</div>
                <div style={{ fontWeight:700, color: item.color || '#111', fontSize:'0.8rem' }}>{item.value}</div>
              </div>
            ))}
          </div>
        )}

        {schedFreq === 'off' && (
          <p style={{ color:'#9ca3af', fontSize:'0.77rem', marginTop:4 }}>
            Auto-backup is off. Choose a frequency above and save to enable it.
          </p>
        )}
      </div>

      {/* ── Export log ── */}
      {log.length > 0 && (
        <div className="card" style={{ marginTop:14 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
            <h3 style={{ fontSize:'0.88rem', fontWeight:700 }}>Export Log</h3>
            {!running && (
              <button className="btn btn-ghost" style={{ fontSize:'0.75rem' }}
                onClick={() => setLog([])}>Clear</button>
            )}
          </div>
          <div style={{
            fontFamily:'monospace', fontSize:'0.79rem',
            background:'#0f172a', color:'#86efac',
            padding:'14px 18px', borderRadius:8,
            maxHeight:320, overflowY:'auto',
            lineHeight:1.8, whiteSpace:'pre-wrap',
          }}>
            {running && (
              <span style={{ color:'#fbbf24' }}>
                {'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'[Math.floor(Date.now() / 120) % 10]} {progress}{'\n'}
              </span>
            )}
            {log.join('\n')}
          </div>
        </div>
      )}

      {/* ── Install note ── */}
      <div style={{
        marginTop:14, padding:'10px 15px',
        background:'#fff3cd', border:'1px solid #ffe082',
        borderRadius:8, fontSize:'0.8rem', color:'#856404',
      }}>
        <strong>⚠ Prerequisites:</strong> This page requires two npm packages. Run:{' '}
        <code style={{ background:'#00000010', padding:'1px 6px', borderRadius:4 }}>
          npm install jszip file-saver
        </code>{' '}
        — <code>xlsx</code> is already in the project.
      </div>
    </div>
  )
}
