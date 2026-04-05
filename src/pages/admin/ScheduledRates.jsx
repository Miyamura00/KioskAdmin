// src/pages/admin/ScheduledRates.jsx
import { useState, useEffect } from 'react'
import { db }       from '../../firebase/config'
import firebase     from '../../firebase/config'
import { useAuth }  from '../../context/AuthContext'
import { useAudit } from '../../hooks/useAudit'
import { useToast } from '../../hooks/useToast'
import { Toast }    from '../../components/Toast'
import { Modal }    from '../../components/Modal'

function formatDt(dt) {
  if (!dt) return '—'
  const d = new Date(dt)
  return d.toLocaleString('en-US', {
    month:'short', day:'numeric', year:'numeric',
    hour:'2-digit', minute:'2-digit', hour12:true,
  })
}

function isPast(dt) { return dt && new Date(dt) <= new Date() }

const CAT_COLOR = { weekday:'#444', weekend:'#1a5276', holiday:'#700909' }
const CAT_LABEL = { weekday:'Weekday', weekend:'Weekend', holiday:'Holiday' }

const STATUS_STYLE = {
  pending:   { background:'#cce5ff', color:'#004085' },
  applied:   { background:'#d4edda', color:'#155724' },
  cancelled: { background:'#f8d7da', color:'#721c24' },
}

export function ScheduledRates({
  branchId, branchName, mode,
  activeRTypes, activeTSlots, activeRates,
  onScheduledApplied,
}) {
  const { currentUser, userProfile } = useAuth()
  const { logAction }                = useAudit(currentUser, userProfile)
  const { toast, showToast }         = useToast()

  const [scheduled,    setScheduled]    = useState([])
  const [loading,      setLoading]      = useState(false)
  const [applying,     setApplying]     = useState(null)
  const [cancelling,   setCancelling]   = useState(null)

  // Modal state
  const [modal,        setModal]        = useState(false)
  const [label,        setLabel]        = useState('')
  const [applyDate,    setApplyDate]    = useState('')
  const [applyTime,    setApplyTime]    = useState('06:00')
  const [adjType,      setAdjType]      = useState('increase')
  // adjSlots stores "cat:slotKey" strings e.g. "weekday:24HRS", "weekend:12HRS"
  const [adjSlots,     setAdjSlots]     = useState([])
  const [adjRooms,     setAdjRooms]     = useState([])
  const [adjAmount,    setAdjAmount]    = useState('')
  const [previewRates, setPreviewRates] = useState(null)
  const [saving,       setSaving]       = useState(false)

  const CATEGORIES = ['weekday', 'weekend', 'holiday']

  useEffect(() => {
    if (branchId) { fetchScheduled(); autoApplyPending() }
    else setScheduled([])
  }, [branchId, mode])

  async function fetchScheduled() {
    setLoading(true)
    try {
      const snap = await db.collection('branches').doc(branchId)
        .collection('scheduledRates').orderBy('applyAt', 'asc').get()
      setScheduled(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => e.mode === mode))
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  async function autoApplyPending() {
    try {
      const snap = await db.collection('branches').doc(branchId)
        .collection('scheduledRates')
        .where('mode', '==', mode).where('status', '==', 'pending').get()
      for (const doc of snap.docs) {
        const entry = { id: doc.id, ...doc.data() }
        if (isPast(entry.applyAt)) await applyScheduled(entry, true)
      }
    } catch (err) { console.error('Auto-apply error:', err) }
  }

  async function applyScheduled(entry, silent = false) {
    if (!silent && !confirm(`Apply "${entry.label || 'Scheduled rates'}" now?\nThis updates live rates immediately.`)) return
    setApplying(entry.id)
    try {
      const ref = db.collection('branches').doc(branchId)
      const curr     = await ref.get()
      const currData = curr.data() || {}
      const currRates = mode === 'walkin' ? currData.rates : currData.driveInRates
      if (currRates) {
        await ref.collection('rateHistory').add({
          savedAt:      firebase.firestore.FieldValue.serverTimestamp(),
          savedBy:      currentUser?.email || 'system',
          savedByName:  userProfile?.displayName || currentUser?.email || 'Auto-apply',
          mode, rates: currRates,
          note: `Auto-archived before applying: "${entry.label || 'Scheduled change'}"`,
          scheduledLabel: entry.label,
        })
      }
      const update = mode === 'walkin' ? { rates: entry.newRates } : { driveInRates: entry.newRates }
      await ref.update(update)
      await ref.collection('scheduledRates').doc(entry.id).update({
        status: 'applied',
        appliedAt: firebase.firestore.FieldValue.serverTimestamp(),
        appliedBy: currentUser?.email || 'system',
      })
      await logAction('APPLY_SCHEDULED_RATES',
        `Applied scheduled rates "${entry.label}" for ${branchName}`, branchId, branchName)
      if (!silent) showToast(`✅ "${entry.label}" applied!`)
      if (onScheduledApplied) onScheduledApplied(entry.newRates)
      fetchScheduled()
    } catch (err) {
      if (!silent) showToast('Error: ' + err.message, 'error')
    } finally { setApplying(null) }
  }

  async function cancelScheduled(entry) {
    if (!confirm(`Cancel "${entry.label || 'this scheduled change'}"?`)) return
    setCancelling(entry.id)
    try {
      await db.collection('branches').doc(branchId)
        .collection('scheduledRates').doc(entry.id).update({ status: 'cancelled' })
      await logAction('CANCEL_SCHEDULED_RATES',
        `Cancelled scheduled rates "${entry.label}"`, branchId, branchName)
      showToast('Cancelled.', 'warn')
      fetchScheduled()
    } catch (err) { showToast('Error: ' + err.message, 'error') }
    finally { setCancelling(null) }
  }

  // ── Build new rates applying the adjustment ──────────────
  // adjSlots stores "cat:slotKey" — if empty, apply to ALL slots in ALL cats
  // adjRooms stores room type indices — if empty, apply to ALL rooms
  function buildNewRates() {
    const amt = parseFloat(adjAmount)
    if (isNaN(amt)) return null
    const next = {}
    CATEGORIES.forEach(cat => {
      next[cat] = {}
      ;(activeTSlots[cat] || []).forEach(slot => {
        const slotKey   = `${cat}:${slot}`
        const vals      = [...(activeRates[cat]?.[slot] || Array(activeRTypes.length).fill(0))]
        const slotMatch = adjSlots.length === 0 || adjSlots.includes(slotKey)
        activeRTypes.forEach((_, idx) => {
          const roomMatch = adjRooms.length === 0 || adjRooms.includes(idx)
          if (slotMatch && roomMatch) {
            const cur = Number(vals[idx]) || 0
            if (adjType === 'increase') vals[idx] = Math.max(0, cur + amt)
            else if (adjType === 'decrease') vals[idx] = Math.max(0, cur - amt)
            else vals[idx] = Math.max(0, amt)
          }
        })
        next[cat][slot] = vals
      })
    })
    return next
  }

  function handlePreview() {
    if (!adjAmount) { showToast('Enter an amount.', 'warn'); return }
    const nr = buildNewRates()
    if (!nr) { showToast('Invalid amount.', 'error'); return }
    setPreviewRates(nr)
  }

  function openCreate() {
    setLabel(''); setApplyDate(''); setApplyTime('06:00')
    setAdjType('increase'); setAdjSlots([]); setAdjRooms([])
    setAdjAmount(''); setPreviewRates(null)
    setModal(true)
  }

  function toggleSlot(key) {
    setAdjSlots(prev => prev.includes(key) ? prev.filter(s => s !== key) : [...prev, key])
    setPreviewRates(null)
  }

  function toggleRoom(idx) {
    setAdjRooms(prev => prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx])
    setPreviewRates(null)
  }

  // Select / deselect all slots in one category
  function toggleCatAll(cat) {
    const keys = (activeTSlots[cat] || []).map(s => `${cat}:${s}`)
    const allSelected = keys.every(k => adjSlots.includes(k))
    if (allSelected) {
      setAdjSlots(prev => prev.filter(k => !keys.includes(k)))
    } else {
      setAdjSlots(prev => [...new Set([...prev, ...keys])])
    }
    setPreviewRates(null)
  }

  async function saveScheduled() {
    if (!label.trim())  { showToast('Add a label/description.', 'warn'); return }
    if (!applyDate)     { showToast('Set an apply date.', 'warn'); return }
    if (!adjAmount)     { showToast('Enter an amount.', 'warn'); return }
    const newRates = buildNewRates()
    if (!newRates) { showToast('Invalid amount.', 'error'); return }
    const applyAt = new Date(applyDate + 'T' + applyTime).toISOString()
    setSaving(true)
    try {
      await db.collection('branches').doc(branchId).collection('scheduledRates').add({
        label, applyAt, adjType,
        adjSlots, adjRooms, adjAmount: parseFloat(adjAmount),
        newRates, mode, status: 'pending',
        createdAt:     firebase.firestore.FieldValue.serverTimestamp(),
        createdBy:     currentUser.email,
        createdByName: userProfile?.displayName || currentUser.email,
      })
      await logAction('CREATE_SCHEDULED_RATES',
        `Scheduled ${adjType} ₱${adjAmount} on ${applyDate} ${applyTime} — "${label}"`,
        branchId, branchName)
      showToast(`✅ Scheduled for ${formatDt(applyAt)}`)
      setModal(false)
      fetchScheduled()
    } catch (err) { showToast('Error: ' + err.message, 'error') }
    finally { setSaving(false) }
  }

  const pending = scheduled.filter(e => e.status === 'pending')
  const past    = scheduled.filter(e => e.status !== 'pending')

  return (
    <div className="card mt20">
      <Toast toast={toast} />

      <div className="card-header-row">
        <div>
          <h2 className="card-title">⏰ Scheduled Rate Changes</h2>
          <p style={{ color:'#888', fontSize:'0.8rem', marginTop:3 }}>
            Set future increases/decreases — applied automatically when the date/time arrives.
          </p>
        </div>
        <div className="action-group">
          <button className="btn btn-outline" style={{ fontSize:'0.82rem' }} onClick={fetchScheduled}>🔄 Refresh</button>
          <button className="btn btn-primary" onClick={openCreate}>+ Schedule Change</button>
        </div>
      </div>

      {loading ? <p className="hint">Loading…</p> : (
        <>
          {pending.length === 0 ? (
            <p className="hint">No pending scheduled changes. Click <strong>+ Schedule Change</strong> to add one.</p>
          ) : (
            <div style={{ overflowX:'auto', marginBottom:16 }}>
              <table className="holiday-table">
                <thead>
                  <tr><th>Label</th><th>Apply At</th><th>Adjustment</th><th>Status</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {pending.map(entry => {
                    const due = isPast(entry.applyAt)
                    return (
                      <tr key={entry.id}>
                        <td><strong>{entry.label}</strong></td>
                        <td style={{ fontSize:'0.82rem', whiteSpace:'nowrap' }}>
                          {formatDt(entry.applyAt)}
                          {due && (
                            <span style={{ marginLeft:6, background:'#ffc107', color:'#5a3a00',
                              borderRadius:8, padding:'1px 6px', fontSize:'0.68rem', fontWeight:800 }}>
                              DUE
                            </span>
                          )}
                        </td>
                        <td style={{ fontSize:'0.82rem' }}>
                          {entry.adjType === 'increase' ? '➕' : entry.adjType === 'decrease' ? '➖' : '🟰'}
                          {' '}₱{Number(entry.adjAmount).toLocaleString()}
                          {entry.adjSlots?.length ? ` on ${entry.adjSlots.length} slot(s)` : ' on all slots'}
                          {entry.adjRooms?.length ? ` × ${entry.adjRooms.length} room(s)` : ' × all rooms'}
                        </td>
                        <td>
                          <span className="audit-action-pill" style={STATUS_STYLE[entry.status] || {}}>
                            {entry.status}
                          </span>
                        </td>
                        <td>
                          <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                            {due && (
                              <button className="btn btn-green" style={{ fontSize:'0.75rem', padding:'4px 9px' }}
                                disabled={applying === entry.id}
                                onClick={() => applyScheduled(entry)}>
                                {applying === entry.id ? '…' : '▶ Apply Now'}
                              </button>
                            )}
                            <button className="btn btn-danger" style={{ fontSize:'0.75rem', padding:'4px 9px' }}
                              disabled={cancelling === entry.id}
                              onClick={() => cancelScheduled(entry)}>
                              {cancelling === entry.id ? '…' : 'Cancel'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {past.length > 0 && (
            <details style={{ marginTop:8 }}>
              <summary style={{ cursor:'pointer', color:'#888', fontSize:'0.83rem', fontWeight:700 }}>
                Past changes ({past.length})
              </summary>
              <div style={{ overflowX:'auto', marginTop:8 }}>
                <table className="holiday-table">
                  <thead><tr><th>Label</th><th>Scheduled For</th><th>Status</th><th>By</th></tr></thead>
                  <tbody>
                    {past.map(entry => (
                      <tr key={entry.id}>
                        <td><strong>{entry.label}</strong></td>
                        <td style={{ fontSize:'0.8rem' }}>{formatDt(entry.applyAt)}</td>
                        <td>
                          <span className="audit-action-pill" style={STATUS_STYLE[entry.status] || {}}>
                            {entry.status}
                          </span>
                        </td>
                        <td style={{ fontSize:'0.8rem' }}>{entry.createdByName || entry.createdBy}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}

      {/* ── Create Modal ── */}
      <Modal show={modal} onClose={() => setModal(false)} title="Schedule a Rate Change" wide
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => setModal(false)}>Cancel</button>
            <button className="btn btn-outline" onClick={handlePreview}>👁 Preview</button>
            <button className="btn btn-primary" onClick={saveScheduled} disabled={saving}>
              {saving ? 'Saving…' : '✅ Schedule'}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label>Label / Description</label>
          <input type="text" placeholder="e.g. Holy Week Rate Increase"
            value={label} onChange={e => setLabel(e.target.value)} />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Apply Date</label>
            <input type="date" value={applyDate} onChange={e => setApplyDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Apply Time</label>
            <input type="time" value={applyTime} onChange={e => setApplyTime(e.target.value)} />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Change Type</label>
            <select value={adjType} onChange={e => { setAdjType(e.target.value); setPreviewRates(null) }}>
              <option value="increase">➕ Increase by amount</option>
              <option value="decrease">➖ Decrease by amount</option>
              <option value="set">🟰 Set to exact value</option>
            </select>
          </div>
          <div className="form-group">
            <label>Amount (₱)</label>
            <input type="number" min="0" placeholder="e.g. 100"
              value={adjAmount}
              onChange={e => { setAdjAmount(e.target.value); setPreviewRates(null) }} />
          </div>
        </div>

        {/* ── Time Slots — grouped by category with labels ── */}
        <div className="form-group">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
            <label style={{ margin:0 }}>Apply to Time Slots</label>
            <button className="btn btn-ghost" style={{ fontSize:'0.74rem', padding:'2px 8px' }}
              onClick={() => { setAdjSlots([]); setPreviewRates(null) }}>
              Clear All (= all slots)
            </button>
          </div>
          <small style={{ display:'block', marginBottom:8, color:'#888' }}>
            ✅ Checked slots will be affected. Leave all unchecked to apply to every slot.
          </small>

          {/* One section per category */}
          {CATEGORIES.map(cat => {
            const slots = activeTSlots[cat] || []
            if (!slots.length) return null
            const catKeys    = slots.map(s => `${cat}:${s}`)
            const allChecked = catKeys.every(k => adjSlots.includes(k))
            const someChecked= catKeys.some(k  => adjSlots.includes(k))
            return (
              <div key={cat} style={{ marginBottom:10 }}>
                {/* Category header row */}
                <div style={{
                  display:'flex', alignItems:'center', gap:8,
                  background: CAT_COLOR[cat], color:'#fff',
                  padding:'5px 10px', borderRadius:'4px 4px 0 0',
                  fontSize:'0.78rem', fontWeight:800, letterSpacing:0.5,
                }}>
                  <input
                    type="checkbox"
                    checked={allChecked}
                    ref={el => { if (el) el.indeterminate = someChecked && !allChecked }}
                    onChange={() => toggleCatAll(cat)}
                    style={{ width:'auto', cursor:'pointer' }}
                  />
                  <span>{CAT_LABEL[cat].toUpperCase()} RATES</span>
                  <span style={{ marginLeft:'auto', fontWeight:400, fontSize:'0.72rem', opacity:0.8 }}>
                    {catKeys.filter(k => adjSlots.includes(k)).length}/{slots.length} selected
                  </span>
                </div>
                {/* Slot checkboxes */}
                <div style={{
                  border: `1px solid ${CAT_COLOR[cat]}40`,
                  borderTop: 'none', borderRadius:'0 0 4px 4px',
                  padding:'8px 10px',
                  display:'grid', gridTemplateColumns:'1fr 1fr', gap:'4px 16px',
                  background:'#fafafa',
                }}>
                  {slots.map(slot => {
                    const key  = `${cat}:${slot}`
                    const disp = slot.replace(/_\d+$/, '')
                    const dup  = slot !== disp ? ` #${slot.split('_').pop()}` : ''
                    return (
                      <label key={key} style={{
                        display:'flex', alignItems:'center', gap:6,
                        fontSize:'0.83rem', fontWeight:600, cursor:'pointer',
                        color: adjSlots.includes(key) ? '#333' : '#666',
                        padding:'2px 0',
                      }}>
                        <input
                          type="checkbox"
                          checked={adjSlots.includes(key)}
                          onChange={() => toggleSlot(key)}
                          style={{ width:'auto', cursor:'pointer', flexShrink:0 }}
                        />
                        {disp}
                        {dup && <span style={{ color:'#aaa', fontSize:'0.7rem' }}>{dup}</span>}
                      </label>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Room Types */}
        <div className="form-group">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
            <label style={{ margin:0 }}>Apply to Room Types</label>
            <button className="btn btn-ghost" style={{ fontSize:'0.74rem', padding:'2px 8px' }}
              onClick={() => { setAdjRooms([]); setPreviewRates(null) }}>
              Clear All (= all rooms)
            </button>
          </div>
          <small style={{ display:'block', marginBottom:6, color:'#888' }}>
            ✅ Checked rooms will be affected. Leave all unchecked to apply to every room type.
          </small>
          <div className="checkbox-grid">
            {activeRTypes.map((rt, idx) => (
              <label key={idx} style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer',
                color: adjRooms.includes(idx) ? '#333' : '#666', fontWeight: adjRooms.includes(idx) ? 700 : 400 }}>
                <input type="checkbox"
                  checked={adjRooms.includes(idx)}
                  onChange={() => toggleRoom(idx)}
                  style={{ width:'auto', cursor:'pointer' }} />
                {rt}
              </label>
            ))}
          </div>
        </div>

        {/* ── Preview — ordered by activeTSlots arrangement ── */}
        {previewRates && (
          <div style={{ marginTop:10, padding:'12px 14px', background:'#f9f9f9', border:'1px solid #e0e0e0', borderRadius:8 }}>
            <div style={{ fontWeight:800, fontSize:'0.85rem', marginBottom:8, color:'#333' }}>
              👁 Preview — New Rates After Change
              <span style={{ marginLeft:8, fontSize:'0.75rem', fontWeight:400, color:'#888' }}>
                (green = changed, showing in your configured slot order)
              </span>
            </div>
            {CATEGORIES.map(cat => {
              // Use activeTSlots order — top to bottom as configured in Time Slots modal
              const slots = (activeTSlots[cat] || []).filter(s => previewRates[cat]?.[s] !== undefined)
              if (!slots.length) return null
              return (
                <div key={cat} style={{ marginBottom:12 }}>
                  <div style={{
                    background: CAT_COLOR[cat], color:'#fff',
                    padding:'5px 10px', fontWeight:800, fontSize:'0.78rem',
                    letterSpacing:1, borderRadius:'4px 4px 0 0',
                  }}>
                    {cat.toUpperCase()} RATES
                  </div>
                  <div style={{ overflowX:'auto' }}>
                    <table style={{ borderCollapse:'collapse', fontSize:'0.78rem', width:'100%' }}>
                      <thead>
                        <tr>
                          <th style={{ padding:'4px 8px', background:'#f3f32a', border:'1px solid #eee', textAlign:'left' }}>Slot</th>
                          {activeRTypes.map(rt => (
                            <th key={rt} style={{ padding:'4px 8px', background:'#f3f32a', border:'1px solid #eee', textAlign:'center' }}>{rt}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {slots.map(slot => (
                          <tr key={slot}>
                            <td style={{ padding:'4px 8px', border:'1px solid #eee', fontWeight:700, whiteSpace:'nowrap' }}>
                              {slot.replace(/_\d+$/, '')}
                            </td>
                            {(previewRates[cat][slot] || []).map((v, i) => {
                              const old = Number(activeRates[cat]?.[slot]?.[i]) || 0
                              const changed = v !== old
                              return (
                                <td key={i} style={{
                                  padding:'4px 8px', border:'1px solid #eee', textAlign:'center',
                                  background: changed ? '#d4edda' : undefined,
                                  fontWeight: changed ? 800 : 400,
                                  color: changed ? '#155724' : '#333',
                                }}>
                                  {Number(v).toLocaleString() || '-'}
                                  {changed && (
                                    <div style={{ fontSize:'0.62rem', color:'#888', fontWeight:400 }}>
                                      was {old.toLocaleString()}
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
                </div>
              )
            })}
          </div>
        )}
      </Modal>
    </div>
  )
}
