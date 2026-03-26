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
  weekday: ['24HRS','12HRS','10HRS','10HRS ONP','6HRS','3HRS'],
  weekend: ['24HRS','12HRS','10HRS','6HRS','3HRS'],
  holiday: ['24HRS','12HRS','10HRS','6HRS','3HRS'],
}
const DEFAULT_ROOM_TYPES   = ['Econo','Premium','Deluxe','Regency 2']
const DEFAULT_DRIVEIN_TYPES = ['Standard','Deluxe']

function makeBlankRates(roomTypes, timeSlots) {
  const r = {}
  Object.keys(timeSlots).forEach(cat => {
    r[cat] = {}
    timeSlots[cat].forEach(s => { r[cat][s] = Array(roomTypes.length).fill(0) })
  })
  return r
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

  // form
  const [branchName, setBranchName] = useState('')
  const [branchLoc, setBranchLoc]   = useState('')
  const [branchId, setBranchId]     = useState('')
  const [copyFrom, setCopyFrom]     = useState('')
  const [hasDriveIn, setHasDriveIn] = useState(false)
  const [saving, setSaving]         = useState(false)
  const [copied, setCopied]         = useState(null)

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
    setModal(true)
  }

  function openEdit(b) {
    setEditId(b.id)
    setBranchName(b.name || '')
    setBranchLoc(b.location || '')
    setBranchId(b.id)
    setHasDriveIn(b.settings?.hasDriveIn === true)
    setModal(true)
  }

  function handleNameInput(val) {
    setBranchName(val)
    if (!editId) {
      setBranchId(val.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''))
    }
  }

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
        })
        await logAction('UPDATE_BRANCH', `Updated branch "${branchName}" (hasDriveIn: ${hasDriveIn})`, editId, branchName)
        showToast('Branch updated!')
      } else {
        const existing = await db.collection('branches').doc(branchId).get()
        if (existing.exists) { showToast('Branch ID already in use.', 'error'); return }

        let rates      = makeBlankRates(DEFAULT_ROOM_TYPES, DEFAULT_TIME_SLOTS)
        let driveInRates = makeBlankRates(DEFAULT_DRIVEIN_TYPES, DEFAULT_TIME_SLOTS)
        let settings   = {
          weekendStartDay: 5, weekendStartHour: 6,
          weekendEndDay: 0,   weekendEndHour: 18,
          holidays: [],
          timeSlots: DEFAULT_TIME_SLOTS,
          roomTypes: DEFAULT_ROOM_TYPES,
          hasDriveIn,
          driveInRoomTypes:  hasDriveIn ? DEFAULT_DRIVEIN_TYPES : [],
          driveInTimeSlots:  hasDriveIn ? DEFAULT_TIME_SLOTS : {},
          rateSchedules: {},
        }

        if (copyFrom) {
          const src = await db.collection('branches').doc(copyFrom).get()
          if (src.exists) {
            const sd = src.data()
            rates        = sd.rates        || rates
            driveInRates = sd.driveInRates || driveInRates
            settings     = { ...sd.settings, hasDriveIn }
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
      const hist = await db.collection('branches').doc(b.id).collection('rateHistory').get()
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
                  {b.settings?.hasDriveIn && (
                    <span style={{ background:'#e8f4fd', color:'#1a6fa0', borderRadius:8, padding:'2px 7px', fontSize:'0.7rem', fontWeight:800 }}>🚗 DRIVE-IN</span>
                  )}
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
