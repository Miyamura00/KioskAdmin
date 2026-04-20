// src/pages/Kiosk.jsx
import { useState, useEffect } from 'react'
import { db } from '../firebase/config'
import '../styles/kiosk.css'

const DEFAULT_ROOM_TYPES    = ['Econo', 'Premium', 'Deluxe', 'Regency 2']
const DEFAULT_DRIVEIN_TYPES = ['Standard', 'Deluxe']

function toMinutes(hhmm) {
  if (!hhmm) return null
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function isSlotActive(slot, cat, schedules, now) {
  const sch = schedules?.[cat]?.[slot]
  if (!sch?.from || !sch?.to) return true
  const cur   = now.getHours() * 60 + now.getMinutes()
  const start = toMinutes(sch.from) ?? 0
  const end   = toMinutes(sch.to)   ?? 1439
  if (start <= end) return cur >= start && cur <= end
  return cur >= start || cur <= end
}

function isHoliday(now, holidays = [], branchId) {
  return holidays.some(h => {
    const br = h.branches || ['*']
    if (!br.includes('*') && !br.includes(branchId)) return false
    const start = new Date(h.start + 'T' + (h.startTime || '00:00'))
    const end   = new Date(h.end   + 'T' + (h.endTime   || '23:59'))
    return now >= start && now <= end
  })
}

function isWeekend(now, s = {}) {
  const { weekendStartDay=5, weekendStartHour=6, weekendEndDay=0, weekendEndHour=18 } = s
  const cur = now.getDay() * 24 + now.getHours()
  const st  = weekendStartDay * 24 + weekendStartHour
  const en  = weekendEndDay   * 24 + weekendEndHour
  return st <= en ? cur >= st && cur < en : cur >= st || cur < en
}

function getCategory(now, settings, holidays, branchId) {
  if (isHoliday(now, holidays, branchId)) return 'holiday'
  if (isWeekend(now, settings))           return 'weekend'
  return 'weekday'
}

function displaySlotName(key) { return key.replace(/_\d+$/, '') }
function fmtVal(v) { const n = Number(v); return !n ? '-' : n.toString() }

function RateTable({ label, rates, slots, roomTypes, now, schedules, cat, disabledSlots }) {
  const active = (slots || []).filter(s =>
    isSlotActive(s, cat, schedules, now) &&
    !(disabledSlots && disabledSlots[cat] && disabledSlots[cat][s] === true)
  )
  if (!active.length) return (
    <div style={{ color:'#f3d000', padding:30, textAlign:'center', fontWeight:700 }}>
      No rates configured for this period.
    </div>
  )
  const rts      = roomTypes || DEFAULT_ROOM_TYPES
  const colCount = rts.length + 1
  const rowCount = active.length
  const colScale = Math.max(0.55, 1 - (colCount - 5) * 0.07)
  const rowScale = Math.max(0.70, 1 - (rowCount - 6) * 0.05)
  const scale    = Math.min(colScale, rowScale)
  const thFontSize  = `${(1.8  * scale).toFixed(2)}vw`
  const tdFontSize  = `${(2.0 * scale).toFixed(2)}vw`
  const lblFontSize = `${(2.0  * scale).toFixed(2)}vw`
  const labelPct    = Math.max(14, 22 - (colCount - 5) * 1.5) + '%'

  return (
    <table className="rate-table">
      <thead>
        <tr>
          <th className="col-label" style={{ width: labelPct, fontSize: thFontSize }}>{label}</th>
          {rts.map(rt => <th key={rt} style={{ fontSize: thFontSize }}>{rt.toUpperCase()}</th>)}
        </tr>
      </thead>
      <tbody>
        {active.map(slot => {
          const prices = rates?.[slot] || Array(rts.length).fill(0)
          return (
            <tr key={slot}>
              <td className="cell-label" style={{ fontSize: lblFontSize }}>{displaySlotName(slot)}</td>
              {rts.map((_, i) => (
                <td key={i} className={`cell-rate${!Number(prices[i]) ? ' zero' : ''}`} style={{ fontSize: tdFontSize }}>
                  {fmtVal(prices[i])}
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export function Kiosk() {
  const params   = new URLSearchParams(window.location.search)
  const branchId = params.get('branch') || 'default'

  const [branchData, setBranchData] = useState(null)
  const [globalHols, setGlobalHols] = useState([])
  const [now,        setNow]        = useState(new Date())
  const [loaded,     setLoaded]     = useState(false)
  const [opacity,    setOpacity]    = useState(0)
  const [mode,       setMode]       = useState('walkin')

  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id) }, [])

  useEffect(() => {
    const unsub = db.collection('branches').doc(branchId).onSnapshot(snap => {
      if (snap.exists) {
        setBranchData(snap.data())
        if (!loaded) { setLoaded(true); setTimeout(() => setOpacity(1), 80) }
      }
    }, err => console.error(err))
    return unsub
  }, [branchId])

  useEffect(() => {
    const unsub = db.collection('holidays').onSnapshot(snap => {
      setGlobalHols(snap.docs.map(d => d.data()))
    })
    return unsub
  }, [])

  const settings   = branchData?.settings || {}
  const hasDriveIn = settings.hasDriveIn === true
  const cat        = branchData ? getCategory(now, settings, globalHols, branchId) : 'weekday'
  const schedules  = settings.rateSchedules || {}

  const wiRoomTypes = settings.roomTypes         || DEFAULT_ROOM_TYPES
  const wiTimeSlots = settings.timeSlots?.[cat]  || []
  const wiRates     = branchData?.rates?.[cat]   || {}
  const diRoomTypes = settings.driveInRoomTypes        || DEFAULT_DRIVEIN_TYPES
  const diTimeSlots = settings.driveInTimeSlots?.[cat] || []
  const diRates     = branchData?.driveInRates?.[cat]  || {}

  // displayMode = what is currently SHOWN on screen
  const displayMode = (!hasDriveIn || mode === 'walkin') ? 'walkin' : 'drivein'
  const modeTitle   = displayMode === 'walkin' ? 'WALK-IN ROOM RATES' : 'DRIVE-IN ROOM RATES'
  const hideCatLabel = settings.hideCatLabel === true
  const catLabel    = hideCatLabel
    ? { weekday:'', weekend:'', holiday:'' }
    : { weekday:'WEEKDAY RATE', weekend:'WEEKEND RATE', holiday:'HOLIDAY RATE' }

  const dateStr = now.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' })
  const timeStr = now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:true })

  return (
    <div className="kiosk-root" 
    onClick={document.addEventListener("click", function () {
        if (!document.fullscreenElement) {
          // If not in fullscreen, enter fullscreen mode
          document.documentElement.requestFullscreen().catch((err) => {
            console.log(`Error: ${err.message}`)
          })
        }
        // If already in fullscreen, do nothing
      })}>
      {!loaded && (
        <div className="loading-screen">
          <div className="spinner" />
          <p>FETCHING LATEST RATES…</p>
        </div>
      )}
      <img className="bg-swirl" src="/images/image2.png" alt="" />
      <div style={{ display:'flex', flexDirection:'column', height:'100%', opacity, transition:'opacity 0.5s', position:'relative', zIndex:1 }}>

        <div className="kiosk-header">
          <img className="kiosk-logo" src="/images/image1.png" alt="Hotel Logo" />
          <div className="kiosk-title-wrap">
            <div className="kiosk-title">{modeTitle}</div>
          </div>
          <div className="kiosk-header-right" />
        </div>

        <div className="kiosk-table-wrap">
          <div className="kiosk-border-box">
            {branchData ? (
              <RateTable
                label={catLabel[cat]}
                rates={displayMode === 'walkin' ? wiRates : diRates}
                slots={displayMode === 'walkin' ? wiTimeSlots : diTimeSlots}
                roomTypes={displayMode === 'walkin' ? wiRoomTypes : diRoomTypes}
                now={now} schedules={schedules} cat={cat}
              disabledSlots={settings.disabledSlots?.[displayMode] ?? settings.disabledSlots ?? {}}
              />
            ) : (
              <div style={{ color:'#f3d000', padding:40, textAlign:'center', fontWeight:700 }}>Loading…</div>
            )}
          </div>
        </div>

        <div className="kiosk-footer">
          <div className="kiosk-footer-left">
            <div className="kiosk-datetime">{dateStr} at {timeStr}</div>
            {branchData?.name && <div className="kiosk-branch-name">{branchData.name}</div>}
          </div>
          <div className="kiosk-footer-right">
            {hasDriveIn && (
              <button
                className="btn-drivein"
                onClick={() => setMode(m => m === 'walkin' ? 'drivein' : 'walkin')}
                title={displayMode === 'walkin' ? 'Switch to Drive-In' : 'Switch to Walk-In'}
                style={displayMode === 'drivein' ? { background:'#f3d000', color:'#7a0000', borderColor:'#fff' } : {}}
              >
                {/* Shows current mode — click to switch */}
                <span className="di-icon">{displayMode === 'drivein' ? '🚗' : '🚶'}</span>
                {displayMode === 'drivein'
                  ? <><span className="di-label">DRIVE</span><span className="di-label">IN</span></>
                  : <><span className="di-label">WALK</span><span className="di-label">IN</span></>
                }
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}