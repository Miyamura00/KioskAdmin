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

/** Fetch the device's public IP via ipify */
async function getPublicIP() {
  try {
    const res = await fetch('https://api.ipify.org?format=json')
    const { ip } = await res.json()
    return ip || null
  } catch {
    return null
  }
}

/**
 * Gather local/LAN IPs via WebRTC candidate leak.
 * Works even behind NAT — returns e.g. ['192.168.1.5'].
 */
function getLocalIPs() {
  return new Promise(resolve => {
    const ips = new Set()
    let pc
    try {
      pc = new RTCPeerConnection({ iceServers: [] })
      pc.createDataChannel('')
      pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .catch(() => resolve([]))
      pc.onicecandidate = e => {
        if (!e || !e.candidate) {
          pc.close()
          resolve([...ips])
          return
        }
        const match = /([0-9]{1,3}\.){3}[0-9]{1,3}/.exec(e.candidate.candidate)
        if (match) ips.add(match[0])
      }
    } catch {
      resolve([])
      return
    }
    // Fallback timeout — resolve after 2 s regardless
    setTimeout(() => { try { pc?.close() } catch {} resolve([...ips]) }, 2000)
  })
}

/** Returns all IPs detected on this device (public + local). */
async function detectAllIPs() {
  const [publicIP, localIPs] = await Promise.all([getPublicIP(), getLocalIPs()])
  const all = new Set(localIPs)
  if (publicIP) all.add(publicIP)
  return [...all]
}

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

/** Shown when this device's IP is not in the branch whitelist */
function AccessDenied({ detectedIPs }) {
  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'linear-gradient(135deg, #1a0000 0%, #3d0000 50%, #1a0000 100%)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, gap: 24, padding: 40,
    }}>
      {/* Animated warning ring */}
      <div style={{
        width: 120, height: 120, borderRadius: '50%',
        border: '4px solid #f3d000',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 56,
        animation: 'pulse-ring 2s ease-in-out infinite',
        boxShadow: '0 0 30px rgba(243,208,0,0.3)',
      }}>
        🔒
      </div>

      <div style={{ textAlign: 'center', maxWidth: 520 }}>
        <div style={{
          color: '#f3d000', fontSize: '2.2rem', fontWeight: 900,
          letterSpacing: '0.12em', marginBottom: 10,
          textShadow: '0 0 20px rgba(243,208,0,0.5)',
        }}>
          ACCESS RESTRICTED
        </div>
        <div style={{
          color: 'rgba(255,255,255,0.7)', fontSize: '1rem',
          lineHeight: 1.6, marginBottom: 28,
        }}>
          This kiosk is not authorized for your current network location.
          Please contact your system administrator.
        </div>

        {detectedIPs.length > 0 && (
          <div style={{
            background: 'rgba(243,208,0,0.07)',
            border: '1px solid rgba(243,208,0,0.25)',
            borderRadius: 10, padding: '12px 20px',
            display: 'inline-block',
          }}>
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.7rem', marginBottom: 6, letterSpacing: '0.1em' }}>
              DETECTED IP{detectedIPs.length > 1 ? 'S' : ''}
            </div>
            {detectedIPs.map(ip => (
              <div key={ip} style={{ color: '#f3d000', fontFamily: 'monospace', fontSize: '1rem', fontWeight: 700 }}>
                {ip}
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse-ring {
          0%, 100% { transform: scale(1); box-shadow: 0 0 30px rgba(243,208,0,0.3); }
          50%       { transform: scale(1.07); box-shadow: 0 0 50px rgba(243,208,0,0.55); }
        }
      `}</style>
    </div>
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

  // IP access control
  const [detectedIPs,  setDetectedIPs]  = useState([])
  const [accessChecked, setAccessChecked] = useState(false)
  const [isBlocked,    setIsBlocked]    = useState(false)

  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id) }, [])

  // Detect IPs once on mount
  useEffect(() => {
    detectAllIPs().then(ips => {
      setDetectedIPs(ips)
      setAccessChecked(true)
    })
  }, [])

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

  // Check IP against whitelist whenever branch data or detected IPs change
  useEffect(() => {
    if (!accessChecked || !branchData) return
    const allowedIPs = branchData.settings?.allowedIPs || []
    // Empty whitelist = no restriction
    if (allowedIPs.length === 0) { setIsBlocked(false); return }
    const blocked = !detectedIPs.some(ip => allowedIPs.includes(ip))
    setIsBlocked(blocked)
  }, [accessChecked, branchData, detectedIPs])

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

  const displayMode = (!hasDriveIn || mode === 'walkin') ? 'walkin' : 'drivein'
  const modeTitle   = displayMode === 'walkin' ? 'WALK-IN ROOM RATES' : 'DRIVE-IN ROOM RATES'
  const hideCatLabel = settings.hideCatLabel === true
  const catLabel    = hideCatLabel
    ? { weekday:'', weekend:'', holiday:'' }
    : { weekday:'WEEKDAY RATE', weekend:'WEEKEND RATE', holiday:'HOLIDAY RATE' }

  const dateStr = now.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' })
  const timeStr = now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:true })

  // Show blocked screen (rendered on top of everything)
  if (isBlocked) return <AccessDenied detectedIPs={detectedIPs} />

  return (
    <div className="kiosk-root" 
    onClick={document.addEventListener("click", function () {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch((err) => {
            console.log(`Error: ${err.message}`)
          })
        }
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