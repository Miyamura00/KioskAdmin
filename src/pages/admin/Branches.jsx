// src/pages/admin/Branches.jsx
import { useState, useEffect } from 'react'
import { useAuth }   from '../../context/AuthContext'
import { useAdmin }  from '../../context/AdminContext'
import { db }        from '../../firebase/config'
import firebase      from '../../firebase/config'
import { Modal }     from '../../components/Modal'
import { Toast }     from '../../components/Toast'
import { useToast }  from '../../hooks/useToast'
import { useAudit }  from '../../hooks/useAudit'

const DEFAULT_TIME_SLOTS = {
  weekday: ['2HRS','3HRS','6HRS','10HRS','10HRS ONP','12HRS','24HRS'],
  weekend: ['2HRS','3HRS','6HRS','10HRS','12HRS','24HRS'],
  holiday: ['2HRS','3HRS','6HRS','10HRS','12HRS','24HRS'],
}
const DEFAULT_ROOM_TYPES    = ['Econo','Premium','Deluxe','Regency 2']
const DEFAULT_DRIVEIN_TYPES = ['Standard','Deluxe']

function makeBlankRates(roomTypes, timeSlots) {
  const r = {}
  Object.keys(timeSlots).forEach(cat => {
    r[cat] = {}
    timeSlots[cat].forEach(s => { r[cat][s] = Array(roomTypes.length).fill(0) })
  })
  return r
}

/** Validate a single IPv4 address */
function isValidIPv4(ip) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) &&
    ip.split('.').every(n => parseInt(n) >= 0 && parseInt(n) <= 255)
}

/** Fetch the caller's public IP via ipify */
async function fetchMyPublicIP() {
  const res = await fetch('https://api.ipify.org?format=json')
  const { ip } = await res.json()
  return ip
}

export function Branches() {
  const { currentUser, userProfile } = useAuth()
  const { refreshBranches }          = useAdmin()
  const { toast, showToast }         = useToast()
  const { logAction }                = useAudit(currentUser, userProfile)

  const [branches, setBranches] = useState([])
  const [loading, setLoading]   = useState(true)
  const [modal, setModal]       = useState(false)
  const [editId, setEditId]     = useState(null)

  // form fields
  const [branchName, setBranchName] = useState('')
  const [branchLoc, setBranchLoc]   = useState('')
  const [branchId, setBranchId]     = useState('')
  const [copyFrom, setCopyFrom]     = useState('')
  const [hasDriveIn, setHasDriveIn] = useState(false)
  const [saving, setSaving]         = useState(false)
  const [copied, setCopied]         = useState(null)

  // IP whitelist state
  const [allowedIPs, setAllowedIPs]   = useState([])
  const [ipInput, setIpInput]         = useState('')
  const [ipError, setIpError]         = useState('')
  const [fetchingIP, setFetchingIP]   = useState(false)

  useEffect(() => { loadBranches() }, [])

  async function loadBranches() {
    setLoading(true)
    try {
      const snap = await db.collection('branches').orderBy('name').get()
      setBranches(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch (err) { showToast('Error: ' + err.message, 'error') }
    finally { setLoading(false) }
  }

  function openAdd() {
    setEditId(null)
    setBranchName(''); setBranchLoc(''); setBranchId(''); setCopyFrom(''); setHasDriveIn(false)
    setAllowedIPs([]); setIpInput(''); setIpError('')
    setModal(true)
  }

  function openEdit(b) {
    setEditId(b.id)
    setBranchName(b.name || '')
    setBranchLoc(b.location || '')
    setBranchId(b.id)
    setHasDriveIn(b.settings?.hasDriveIn === true)
    setAllowedIPs(b.settings?.allowedIPs || [])
    setIpInput(''); setIpError('')
    setModal(true)
  }

  function handleNameInput(val) {
    setBranchName(val)
    if (!editId) {
      setBranchId(val.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''))
    }
  }

  // ── IP helpers ────────────────────────────────────────────────────────────

  function addIP() {
    const ip = ipInput.trim()
    if (!ip) return
    if (!isValidIPv4(ip)) { setIpError('Enter a valid IPv4 address (e.g. 192.168.1.10)'); return }
    if (allowedIPs.includes(ip)) { setIpError('This IP is already in the list.'); return }
    setAllowedIPs(prev => [...prev, ip])
    setIpInput(''); setIpError('')
  }

  function removeIP(ip) {
    setAllowedIPs(prev => prev.filter(i => i !== ip))
  }

  async function useMyIP() {
    setFetchingIP(true)
    setIpError('')
    try {
      const ip = await fetchMyPublicIP()
      setIpInput(ip)
    } catch {
      setIpError('Could not detect your IP. Please enter it manually.')
    } finally {
      setFetchingIP(false)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  async function saveBranch() {
    if (!branchName.trim()) { showToast('Branch name is required.', 'warn'); return }
    if (!editId && !branchId.trim()) { showToast('Branch ID is required.', 'warn'); return }
    if (!editId && !/^[a-z0-9-]+$/.test(branchId)) {
      showToast('Branch ID: lowercase letters, numbers, hyphens only.', 'warn'); return
    }
    setSaving(true)
    try {
      if (editId) {
        await db.collection('branches').doc(editId).update({
          name: branchName.trim(),
          location: branchLoc.trim(),
          'settings.hasDriveIn': hasDriveIn,
          'settings.allowedIPs': allowedIPs,
        })
        await logAction(
          'UPDATE_BRANCH',
          `Updated branch "${branchName}" (hasDriveIn: ${hasDriveIn}, allowedIPs: ${allowedIPs.length})`,
          editId, branchName
        )
        showToast('Branch updated!')
      } else {
        const existing = await db.collection('branches').doc(branchId).get()
        if (existing.exists) { showToast('Branch ID already in use.', 'error'); return }

        let rates        = makeBlankRates(DEFAULT_ROOM_TYPES, DEFAULT_TIME_SLOTS)
        let driveInRates = makeBlankRates(DEFAULT_DRIVEIN_TYPES, DEFAULT_TIME_SLOTS)
        let settings     = {
          weekendStartDay: 5, weekendStartHour: 6,
          weekendEndDay: 0,   weekendEndHour: 18,
          holidays: [],
          timeSlots: DEFAULT_TIME_SLOTS,
          roomTypes: DEFAULT_ROOM_TYPES,
          hasDriveIn,
          driveInRoomTypes:  hasDriveIn ? DEFAULT_DRIVEIN_TYPES : [],
          driveInTimeSlots:  hasDriveIn ? DEFAULT_TIME_SLOTS : {},
          rateSchedules: {},
          allowedIPs,
        }

        if (copyFrom) {
          const src = await db.collection('branches').doc(copyFrom).get()
          if (src.exists) {
            const sd     = src.data()
            rates        = sd.rates        || rates
            driveInRates = sd.driveInRates || driveInRates
            settings     = { ...sd.settings, hasDriveIn, allowedIPs }
          }
        }

        await db.collection('branches').doc(branchId).set({
          name: branchName.trim(),
          location: branchLoc.trim(),
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          createdBy: currentUser.uid,
          settings,
          rates,
          driveInRates,
        })
        await logAction('CREATE_BRANCH', `Created branch "${branchName}" (ID: ${branchId})`, branchId, branchName.trim())
        showToast(`Branch "${branchName}" created!`)
      }
      setModal(false)
      await loadBranches()
      refreshBranches()
    } catch (err) { showToast('Error: ' + err.message, 'error') }
    finally { setSaving(false) }
  }

  async function deleteBranch(b) {
    if (!confirm(`Delete branch "${b.name}"?\n\nAll rates, history and settings will be permanently removed.`)) return
    try {
      const hist  = await db.collection('branches').doc(b.id).collection('rateHistory').get()
      const batch = db.batch()
      hist.docs.forEach(d => batch.delete(d.ref))
      batch.delete(db.collection('branches').doc(b.id))
      await batch.commit()
      await logAction('DELETE_BRANCH', `Deleted branch "${b.name}"`, b.id, b.name)
      showToast(`Branch "${b.name}" deleted.`, 'warn')
      await loadBranches()
      refreshBranches()
    } catch (err) { showToast('Error: ' + err.message, 'error') }
  }

  function getKioskUrl(id) { return `${window.location.origin}/kiosk?branch=${id}` }

  function copyLink(id) {
    navigator.clipboard.writeText(getKioskUrl(id))
    setCopied(id); setTimeout(() => setCopied(null), 2000)
    showToast('Kiosk link copied!')
  }

  return (
    <div className="page">
      <Toast toast={toast} />
      <div className="card">
        <div className="card-header-row">
          <h2 className="card-title">Branch Management</h2>
          <button className="btn btn-primary" onClick={openAdd}>+ Add Branch</button>
        </div>

        {loading ? <p className="hint">Loading…</p> :
         branches.length === 0 ? <p className="hint">No branches yet.</p> : (
          <div className="item-grid">
            {branches.map(b => (
              <div key={b.id} className="item-card">
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                  <h3>🏢 {b.name || b.id}</h3>
                  <div style={{ display:'flex', gap:5, flexWrap:'wrap', justifyContent:'flex-end' }}>
                    {b.settings?.hasDriveIn && (
                      <span style={{ background:'#e8f4fd', color:'#1a6fa0', borderRadius:8, padding:'2px 7px', fontSize:'0.7rem', fontWeight:800 }}>🚗 DRIVE-IN</span>
                    )}
                    {/* IP lock badge */}
                    {(b.settings?.allowedIPs?.length > 0) && (
                      <span style={{ background:'#fef3e2', color:'#b45309', borderRadius:8, padding:'2px 7px', fontSize:'0.7rem', fontWeight:800 }}>
                        🔒 {b.settings.allowedIPs.length} IP{b.settings.allowedIPs.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>
                <p>{b.location || 'No location set'}</p>
                <p style={{ marginTop:5, color:'#888', fontSize:'0.76rem' }}>ID: <code>{b.id}</code></p>
                <p style={{ color:'#888', fontSize:'0.76rem' }}>
                  Room types: {b.settings?.roomTypes?.length || DEFAULT_ROOM_TYPES.length}
                  {b.settings?.hasDriveIn && ` · Drive-in types: ${b.settings?.driveInRoomTypes?.length || DEFAULT_DRIVEIN_TYPES.length}`}
                </p>
                <div style={{
                  margin:'8px 0', padding:'6px 9px',
                  background:'#f0f8ff', border:'1px solid #bee3f8',
                  borderRadius:6, fontSize:'0.72rem', color:'#2980b9',
                  wordBreak:'break-all'
                }}>
                  🔗 {getKioskUrl(b.id)}
                </div>
                <div className="item-actions">
                  <a href={getKioskUrl(b.id)} target="_blank" rel="noreferrer"
                    className="btn btn-outline" style={{ fontSize:'0.78rem' }}>🖥 Open</a>
                  <button className="btn btn-outline" style={{ fontSize:'0.78rem' }}
                    onClick={() => copyLink(b.id)}>
                    {copied === b.id ? '✔ Copied' : '📋 Copy Link'}
                  </button>
                  <button className="btn btn-outline" style={{ fontSize:'0.78rem' }} onClick={() => openEdit(b)}>Edit</button>
                  <button className="btn btn-danger"  style={{ fontSize:'0.78rem' }} onClick={() => deleteBranch(b)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        show={modal}
        onClose={() => setModal(false)}
        title={editId ? 'Edit Branch' : 'Add New Branch'}
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => setModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveBranch} disabled={saving}>
              {saving ? 'Saving…' : editId ? 'Update' : 'Create Branch'}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label>Branch Name</label>
          <input type="text" placeholder="e.g. Sta. Mesa Branch"
            value={branchName} onChange={e => handleNameInput(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Location / Address</label>
          <input type="text" placeholder="e.g. Manila"
            value={branchLoc} onChange={e => setBranchLoc(e.target.value)} />
        </div>
        {!editId && (
          <div className="form-group">
            <label>Branch ID (URL-safe slug)</label>
            <input type="text" placeholder="e.g. sta-mesa"
              value={branchId} onChange={e => setBranchId(e.target.value.toLowerCase())} />
            <small>Kiosk URL: /kiosk?branch=<strong>{branchId || 'your-id'}</strong></small>
          </div>
        )}
        <div className="form-group">
          <label style={{ display:'flex', alignItems:'center', gap:8, textTransform:'none', fontSize:'0.88rem' }}>
            <input type="checkbox" style={{ width:'auto', padding:0 }}
              checked={hasDriveIn} onChange={e => setHasDriveIn(e.target.checked)} />
            This branch has a <strong>Drive-In</strong> section
          </label>
          <small>Enables separate Drive-In room types and rates, plus a Drive-In toggle button on the kiosk.</small>
        </div>

        {/* ── IP Whitelist Section ─────────────────────────────────────────── */}
        <div className="form-group">
          <label style={{ display:'flex', alignItems:'center', gap:6 }}>
            🔒 Kiosk IP Whitelist
            <span style={{
              background: allowedIPs.length > 0 ? '#fef3e2' : '#f0f0f0',
              color:      allowedIPs.length > 0 ? '#b45309' : '#888',
              borderRadius: 10, padding:'1px 8px', fontSize:'0.68rem', fontWeight:700,
            }}>
              {allowedIPs.length === 0 ? 'OPEN ACCESS' : `${allowedIPs.length} IP${allowedIPs.length > 1 ? 's' : ''}`}
            </span>
          </label>
          <small style={{ display:'block', marginBottom:8 }}>
            Only devices whose IP is in this list can view the kiosk.
            Leave empty to allow access from any IP.
          </small>

          {/* Existing IPs list */}
          {allowedIPs.length > 0 && (
            <div style={{
              border:'1px solid #e2e8f0', borderRadius:8,
              overflow:'hidden', marginBottom:8,
            }}>
              {allowedIPs.map((ip, idx) => (
                <div key={ip} style={{
                  display:'flex', alignItems:'center', justifyContent:'space-between',
                  padding:'7px 12px',
                  background: idx % 2 === 0 ? '#fafbfc' : '#fff',
                  borderBottom: idx < allowedIPs.length - 1 ? '1px solid #e2e8f0' : 'none',
                }}>
                  <span style={{ fontFamily:'monospace', fontSize:'0.88rem', color:'#2d3748', fontWeight:600 }}>
                    {ip}
                  </span>
                  <button
                    onClick={() => removeIP(ip)}
                    style={{
                      background:'none', border:'none', cursor:'pointer',
                      color:'#e53e3e', fontWeight:700, fontSize:'0.8rem',
                      padding:'2px 6px', borderRadius:4,
                    }}
                    title="Remove IP"
                  >
                    ✕ Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add IP input row */}
          <div style={{ display:'flex', gap:6 }}>
            <input
              type="text"
              placeholder="e.g. 192.168.1.10"
              value={ipInput}
              onChange={e => { setIpInput(e.target.value); setIpError('') }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addIP() } }}
              style={{ flex:1, fontFamily:'monospace' }}
            />
            <button
              className="btn btn-outline"
              style={{ whiteSpace:'nowrap', fontSize:'0.82rem' }}
              onClick={addIP}
              type="button"
            >
              + Add IP
            </button>
            <button
              className="btn btn-outline"
              style={{ whiteSpace:'nowrap', fontSize:'0.82rem' }}
              onClick={useMyIP}
              disabled={fetchingIP}
              title="Detect and fill in your current public IP"
              type="button"
            >
              {fetchingIP ? '…' : '📡 My IP'}
            </button>
          </div>
          {ipError && (
            <small style={{ color:'#e53e3e', marginTop:4, display:'block' }}>{ipError}</small>
          )}
          <small style={{ marginTop:4, display:'block', color:'#a0aec0' }}>
            💡 Tip: For devices behind a router, use <strong>📡 My IP</strong> to get the public IP,
            or enter the local IP (e.g. 192.168.x.x) if you're on the same LAN.
          </small>
        </div>
        {/* ──────────────────────────────────────────────────────────────────── */}

        {!editId && (
          <div className="form-group">
            <label>Copy rates from branch (optional)</label>
            <select value={copyFrom} onChange={e => setCopyFrom(e.target.value)}>
              <option value="">— Start with blank rates —</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name || b.id}</option>)}
            </select>
          </div>
        )}
      </Modal>
    </div>
  )
}