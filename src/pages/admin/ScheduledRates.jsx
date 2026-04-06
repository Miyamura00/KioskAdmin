// src/pages/admin/ScheduledRates.jsx
import { useState, useEffect } from 'react'
import { db }       from '../../firebase/config'
import firebase     from '../../firebase/config'
import { useAuth }  from '../../context/AuthContext'
import { useAudit } from '../../hooks/useAudit'
import { useToast } from '../../hooks/useToast'
import { Toast }    from '../../components/Toast'
import { Modal }    from '../../components/Modal'

const CATEGORIES  = ['weekday', 'weekend', 'holiday']
const CAT_COLOR   = { weekday:'#444', weekend:'#1a5276', holiday:'#700909' }
const CAT_LABEL   = { weekday:'Weekday', weekend:'Weekend', holiday:'Holiday' }
const STATUS_STYLE = {
  pending:   { background:'#cce5ff', color:'#004085' },
  applied:   { background:'#d4edda', color:'#155724' },
  cancelled: { background:'#f8d7da', color:'#721c24' },
}

function formatDt(dt) {
  if (!dt) return '—'
  return new Date(dt).toLocaleString('en-US', {
    month:'short', day:'numeric', year:'numeric',
    hour:'2-digit', minute:'2-digit', hour12:true,
  })
}
function isPast(dt) { return dt && new Date(dt) <= new Date() }

// Apply a list of adjustments to a base rate object in order
function applyAdjustments(baseRates, adjustments, activeTSlots, activeRTypes) {
  // Deep-clone base
  const result = {}
  CATEGORIES.forEach(cat => {
    result[cat] = {}
    ;(activeTSlots[cat] || []).forEach(slot => {
      result[cat][slot] = [...(baseRates[cat]?.[slot] || Array(activeRTypes.length).fill(0))]
    })
  })
  // Apply each adjustment in order
  adjustments.forEach(adj => {
    const amt = parseFloat(adj.amount)
    if (isNaN(amt)) return
    CATEGORIES.forEach(cat => {
      ;(activeTSlots[cat] || []).forEach(slot => {
        const slotKey   = `${cat}:${slot}`
        const slotMatch = !adj.slots?.length || adj.slots.includes(slotKey)
        if (!slotMatch) return
        activeRTypes.forEach((_, idx) => {
          const roomMatch = !adj.rooms?.length || adj.rooms.includes(idx)
          if (!roomMatch) return
          const cur = Number(result[cat][slot][idx]) || 0
          if (adj.type === 'increase')      result[cat][slot][idx] = Math.max(0, cur + amt)
          else if (adj.type === 'decrease') result[cat][slot][idx] = Math.max(0, cur - amt)
          else                              result[cat][slot][idx] = Math.max(0, amt)
        })
      })
    })
  })
  return result
}

// Blank adjustment object
function newAdj() {
  return { id: Date.now(), type:'increase', amount:'', slots:[], rooms:[] }
}

// ── Slot Picker sub-component ──────────────────────────────
function SlotPicker({ activeTSlots, value, onChange, label }) {
  function toggleSlot(key) {
    onChange(value.includes(key) ? value.filter(k => k !== key) : [...value, key])
  }
  function toggleCat(cat) {
    const keys = (activeTSlots[cat] || []).map(s => `${cat}:${s}`)
    const allOn = keys.every(k => value.includes(k))
    if (allOn) onChange(value.filter(k => !keys.includes(k)))
    else       onChange([...new Set([...value, ...keys])])
  }
  return (
    <div>
      <div style={{ fontSize:'0.78rem', fontWeight:700, color:'#555', marginBottom:4 }}>
        {label} <span style={{ color:'#aaa', fontWeight:400 }}>(empty = all)</span>
      </div>
      {CATEGORIES.map(cat => {
        const slots = activeTSlots[cat] || []
        if (!slots.length) return null
        const keys = slots.map(s => `${cat}:${s}`)
        const allOn = keys.every(k => value.includes(k))
        const someOn = keys.some(k => value.includes(k))
        return (
          <div key={cat} style={{ marginBottom:6 }}>
            <div style={{
              display:'flex', alignItems:'center', gap:6,
              background: CAT_COLOR[cat], color:'#fff',
              padding:'4px 8px', borderRadius:'4px 4px 0 0',
              fontSize:'0.72rem', fontWeight:800,
            }}>
              <input type="checkbox" checked={allOn}
                ref={el => { if (el) el.indeterminate = someOn && !allOn }}
                onChange={() => toggleCat(cat)}
                style={{ width:'auto', cursor:'pointer' }} />
              {CAT_LABEL[cat].toUpperCase()}
            </div>
            <div style={{
              border:`1px solid ${CAT_COLOR[cat]}40`, borderTop:'none',
              borderRadius:'0 0 4px 4px', padding:'5px 8px',
              display:'grid', gridTemplateColumns:'1fr 1fr', gap:'2px 12px',
              background:'#fafafa',
            }}>
              {slots.map(slot => {
                const key  = `${cat}:${slot}`
                const disp = slot.replace(/_\d+$/, '')
                const dup  = slot !== disp ? ` #${slot.split('_').pop()}` : ''
                return (
                  <label key={key} style={{
                    display:'flex', alignItems:'center', gap:5,
                    fontSize:'0.79rem', fontWeight: value.includes(key) ? 700 : 400,
                    cursor:'pointer', color: value.includes(key) ? '#333' : '#666',
                  }}>
                    <input type="checkbox" checked={value.includes(key)}
                      onChange={() => toggleSlot(key)}
                      style={{ width:'auto', cursor:'pointer', flexShrink:0 }} />
                    {disp}{dup && <span style={{ color:'#bbb', fontSize:'0.68rem' }}>{dup}</span>}
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────
export function ScheduledRates({
  branchId, branchName, mode,
  activeRTypes, activeTSlots, activeRates,
  onScheduledApplied,
}) {
  const { currentUser, userProfile } = useAuth()
  const { logAction }                = useAudit(currentUser, userProfile)
  const { toast, showToast }         = useToast()

  const [scheduled,  setScheduled]  = useState([])
  const [loading,    setLoading]    = useState(false)
  const [applying,   setApplying]   = useState(null)
  const [cancelling, setCancelling] = useState(null)

  // Modal
  const [modal,        setModal]        = useState(false)
  const [label,        setLabel]        = useState('')
  const [applyDate,    setApplyDate]    = useState('')
  const [applyTime,    setApplyTime]    = useState('06:00')
  // Multiple adjustments
  const [adjustments,  setAdjustments]  = useState([newAdj()])
  // Auto-rollback
  const [withRollback,  setWithRollback]  = useState(false)
  const [rollbackDate,  setRollbackDate]  = useState('')
  const [rollbackTime,  setRollbackTime]  = useState('06:00')
  // Preview
  const [previewRates, setPreviewRates] = useState(null)
  const [saving,       setSaving]       = useState(false)

  // Which adjustment row is expanded (for slot/room picker)
  const [expandedAdj, setExpandedAdj] = useState(0)

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
        .where('mode','==', mode).where('status','==','pending').get()
      for (const doc of snap.docs) {
        const e = { id: doc.id, ...doc.data() }
        if (isPast(e.applyAt)) await applyEntry(e, true)
      }
    } catch (err) { console.error('Auto-apply:', err) }
  }

  async function applyEntry(entry, silent = false) {
    if (!silent && !confirm(`Apply "${entry.label}" now?\nThis updates live rates immediately.`)) return
    setApplying(entry.id)
    try {
      const ref = db.collection('branches').doc(branchId)

      // Archive current rates
      const curr      = await ref.get()
      const currData  = curr.data() || {}
      const currRates = mode === 'walkin' ? currData.rates : currData.driveInRates
      if (currRates) {
        await ref.collection('rateHistory').add({
          savedAt: firebase.firestore.FieldValue.serverTimestamp(),
          savedBy: currentUser?.email || 'system',
          savedByName: userProfile?.displayName || currentUser?.email || 'Auto',
          mode, rates: currRates,
          note: `Archived before applying: "${entry.label}"`,
          scheduledLabel: entry.label,
        })
      }

      // Apply
      const update = mode === 'walkin' ? { rates: entry.newRates } : { driveInRates: entry.newRates }
      await ref.update(update)
      await ref.collection('scheduledRates').doc(entry.id).update({
        status: 'applied',
        appliedAt: firebase.firestore.FieldValue.serverTimestamp(),
        appliedBy: currentUser?.email || 'system',
      })

      // Schedule the rollback if requested
      if (entry.rollbackAt && entry.rollbackRates) {
        await ref.collection('scheduledRates').add({
          label:        `↩ Auto-Rollback: ${entry.label}`,
          applyAt:      entry.rollbackAt,
          newRates:     entry.rollbackRates,
          adjustments:  [],
          mode, status: 'pending',
          isRollback:   true,
          rollbackFor:  entry.id,
          createdAt:    firebase.firestore.FieldValue.serverTimestamp(),
          createdBy:    currentUser?.email || 'system',
          createdByName: userProfile?.displayName || 'Auto-Rollback',
        })
      }

      await logAction('APPLY_SCHEDULED_RATES',
        `Applied "${entry.label}" for ${branchName}`, branchId, branchName)
      if (!silent) showToast(`✅ "${entry.label}" applied!`)
      if (onScheduledApplied) onScheduledApplied(entry.newRates)
      fetchScheduled()
    } catch (err) {
      if (!silent) showToast('Error: ' + err.message, 'error')
    } finally { setApplying(null) }
  }

  async function cancelEntry(entry) {
    if (!confirm(`Cancel "${entry.label}"?`)) return
    setCancelling(entry.id)
    try {
      await db.collection('branches').doc(branchId)
        .collection('scheduledRates').doc(entry.id).update({ status: 'cancelled' })
      await logAction('CANCEL_SCHEDULED_RATES', `Cancelled "${entry.label}"`, branchId, branchName)
      showToast('Cancelled.', 'warn')
      fetchScheduled()
    } catch (err) { showToast('Error: ' + err.message, 'error') }
    finally { setCancelling(null) }
  }

  // ── Adjustment helpers ────────────────────────────────────
  function updateAdj(id, field, value) {
    setAdjustments(prev => prev.map(a => a.id === id ? { ...a, [field]: value } : a))
    setPreviewRates(null)
  }

  function addAdjustment() {
    const a = newAdj()
    setAdjustments(prev => [...prev, a])
    setExpandedAdj(a.id)
  }

  function removeAdjustment(id) {
    setAdjustments(prev => {
      const next = prev.filter(a => a.id !== id)
      return next.length ? next : [newAdj()]
    })
    setPreviewRates(null)
  }

  function buildNewRates() {
    // Validate all adjustments have an amount
    for (const adj of adjustments) {
      if (!adj.amount && adj.amount !== 0) return null
      if (isNaN(parseFloat(adj.amount))) return null
    }
    return applyAdjustments(activeRates, adjustments, activeTSlots, activeRTypes)
  }

  function handlePreview() {
    const nr = buildNewRates()
    if (!nr) { showToast('Check all adjustment amounts are filled.', 'warn'); return }
    setPreviewRates(nr)
  }

  function openCreate() {
    setLabel(''); setApplyDate(''); setApplyTime('06:00')
    setAdjustments([newAdj()]); setExpandedAdj(0)
    setWithRollback(false); setRollbackDate(''); setRollbackTime('06:00')
    setPreviewRates(null)
    setModal(true)
  }

  async function saveScheduled() {
    if (!label.trim())  { showToast('Add a label.', 'warn'); return }
    if (!applyDate)     { showToast('Set an apply date.', 'warn'); return }
    for (const adj of adjustments) {
      if (!adj.amount && adj.amount !== 0) { showToast(`Fill in an amount for each adjustment.`, 'warn'); return }
    }
    if (withRollback && !rollbackDate) { showToast('Set a rollback date.', 'warn'); return }

    const newRates = buildNewRates()
    if (!newRates) { showToast('Invalid amount in one of the adjustments.', 'error'); return }
    const applyAt = new Date(applyDate + 'T' + applyTime).toISOString()

    // Rollback rates = the state BEFORE this change (current activeRates)
    let rollbackRates = null
    let rollbackAt    = null
    if (withRollback) {
      rollbackRates = {}
      CATEGORIES.forEach(cat => {
        rollbackRates[cat] = {}
        ;(activeTSlots[cat] || []).forEach(slot => {
          rollbackRates[cat][slot] = [...(activeRates[cat]?.[slot] || Array(activeRTypes.length).fill(0))]
        })
      })
      rollbackAt = new Date(rollbackDate + 'T' + rollbackTime).toISOString()
    }

    setSaving(true)
    try {
      await db.collection('branches').doc(branchId).collection('scheduledRates').add({
        label, applyAt, mode, status: 'pending',
        adjustments: adjustments.map(a => ({
          type: a.type, amount: parseFloat(a.amount),
          slots: a.slots, rooms: a.rooms,
        })),
        newRates,
        ...(withRollback ? { rollbackAt, rollbackRates } : {}),
        createdAt:    firebase.firestore.FieldValue.serverTimestamp(),
        createdBy:    currentUser.email,
        createdByName: userProfile?.displayName || currentUser.email,
      })
      const adjSummary = adjustments.map(a =>
        `${a.type} ₱${a.amount}${a.slots?.length ? ` on ${a.slots.length} slot(s)` : ''}`
      ).join(', ')
      await logAction('CREATE_SCHEDULED_RATES',
        `Scheduled "${label}" on ${applyDate} ${applyTime}: ${adjSummary}`,
        branchId, branchName)
      showToast(`✅ Scheduled for ${formatDt(applyAt)}${withRollback ? ` · Auto-rollback on ${formatDt(rollbackAt)}` : ''}`)
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
            Multi-step changes — each schedule can include multiple adjustments applied together.
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
            <p className="hint">No pending scheduled changes. Click <strong>+ Schedule Change</strong>.</p>
          ) : (
            <div style={{ overflowX:'auto', marginBottom:16 }}>
              <table className="holiday-table">
                <thead>
                  <tr><th>Label</th><th>Apply At</th><th>Adjustments</th><th>Rollback</th><th>Status</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {pending.map(entry => {
                    const due = isPast(entry.applyAt)
                    const adjs = entry.adjustments || []
                    return (
                      <tr key={entry.id} style={entry.isRollback ? { background:'#fffbe6' } : {}}>
                        <td>
                          <strong>{entry.label}</strong>
                          {entry.isRollback && <span style={{ marginLeft:6, color:'#e67e22', fontSize:'0.72rem' }}>↩ Auto-Rollback</span>}
                        </td>
                        <td style={{ fontSize:'0.82rem', whiteSpace:'nowrap' }}>
                          {formatDt(entry.applyAt)}
                          {due && <span style={{ marginLeft:6, background:'#ffc107', color:'#5a3a00', borderRadius:8, padding:'1px 6px', fontSize:'0.68rem', fontWeight:800 }}>DUE</span>}
                        </td>
                        <td style={{ fontSize:'0.79rem' }}>
                          {adjs.length === 0 && '—'}
                          {adjs.map((a, i) => (
                            <div key={i}>
                              {a.type === 'increase' ? '➕' : a.type === 'decrease' ? '➖' : '🟰'}
                              {' '}₱{Number(a.amount).toLocaleString()}
                              {a.slots?.length ? ` · ${a.slots.length} slot(s)` : ' · all slots'}
                              {a.rooms?.length ? ` × ${a.rooms.length} room(s)` : ' × all rooms'}
                            </div>
                          ))}
                        </td>
                        <td style={{ fontSize:'0.79rem', color: entry.rollbackAt ? '#e67e22' : '#aaa' }}>
                          {entry.rollbackAt ? formatDt(entry.rollbackAt) : '—'}
                        </td>
                        <td>
                          <span className="audit-action-pill" style={STATUS_STYLE[entry.status] || {}}>
                            {entry.status}
                          </span>
                        </td>
                        <td>
                          <div style={{ display:'flex', gap:5 }}>
                            {due && (
                              <button className="btn btn-green" style={{ fontSize:'0.75rem', padding:'4px 9px' }}
                                disabled={applying === entry.id} onClick={() => applyEntry(entry)}>
                                {applying === entry.id ? '…' : '▶ Apply'}
                              </button>
                            )}
                            <button className="btn btn-danger" style={{ fontSize:'0.75rem', padding:'4px 9px' }}
                              disabled={cancelling === entry.id} onClick={() => cancelEntry(entry)}>
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
                    {past.map(e => (
                      <tr key={e.id}>
                        <td><strong>{e.label}</strong></td>
                        <td style={{ fontSize:'0.8rem' }}>{formatDt(e.applyAt)}</td>
                        <td><span className="audit-action-pill" style={STATUS_STYLE[e.status]||{}}>{e.status}</span></td>
                        <td style={{ fontSize:'0.8rem' }}>{e.createdByName || e.createdBy}</td>
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
        {/* Basic info */}
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

        {/* ── Multiple Adjustments ── */}
        <div className="form-group">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            <label style={{ margin:0 }}>Rate Adjustments <span style={{ color:'#888', fontWeight:400 }}>({adjustments.length})</span></label>
            <button className="btn btn-outline" style={{ fontSize:'0.76rem', padding:'4px 10px' }} onClick={addAdjustment}>
              + Add Another Adjustment
            </button>
          </div>
          <small style={{ display:'block', marginBottom:10, color:'#888' }}>
            Each adjustment is applied in order on top of the previous one. Useful for different amounts on different slots.
          </small>

          {adjustments.map((adj, adjIdx) => (
            <div key={adj.id} style={{
              border: expandedAdj === adj.id ? '2px solid #d10c0c' : '1px solid #e0e0e0',
              borderRadius:8, marginBottom:10, overflow:'hidden',
            }}>
              {/* Adjustment header */}
              <div style={{
                display:'flex', alignItems:'center', gap:8,
                padding:'8px 12px', background: expandedAdj === adj.id ? '#fff5f5' : '#f9f9f9',
                cursor:'pointer',
              }}
                onClick={() => setExpandedAdj(expandedAdj === adj.id ? null : adj.id)}
              >
                <span style={{ fontWeight:800, fontSize:'0.82rem', color:'#555', minWidth:22 }}>
                  #{adjIdx + 1}
                </span>
                <span style={{ fontSize:'0.82rem', fontWeight:700, flex:1 }}>
                  {adj.type === 'increase' ? '➕' : adj.type === 'decrease' ? '➖' : '🟰'}{' '}
                  {adj.amount ? `₱${Number(adj.amount).toLocaleString()}` : 'Set amount…'}
                  {adj.slots?.length  ? ` · ${adj.slots.length} slot(s)` : ' · all slots'}
                  {adj.rooms?.length  ? ` × ${adj.rooms.length} room(s)` : ' × all rooms'}
                </span>
                <span style={{ fontSize:'0.75rem', color:'#aaa' }}>{expandedAdj === adj.id ? '▲ collapse' : '▼ expand'}</span>
                {adjustments.length > 1 && (
                  <button
                    className="btn btn-danger"
                    style={{ fontSize:'0.72rem', padding:'2px 7px' }}
                    onClick={e => { e.stopPropagation(); removeAdjustment(adj.id) }}
                  >✕</button>
                )}
              </div>

              {/* Adjustment body */}
              {expandedAdj === adj.id && (
                <div style={{ padding:'12px 14px', borderTop:'1px solid #eee' }}>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Change Type</label>
                      <select value={adj.type} onChange={e => updateAdj(adj.id, 'type', e.target.value)}>
                        <option value="increase">➕ Increase by</option>
                        <option value="decrease">➖ Decrease by</option>
                        <option value="set">🟰 Set to exact value</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Amount (₱)</label>
                      <input type="number" min="0" placeholder="e.g. 100"
                        value={adj.amount}
                        onChange={e => updateAdj(adj.id, 'amount', e.target.value)} />
                    </div>
                  </div>

                  <SlotPicker
                    activeTSlots={activeTSlots}
                    value={adj.slots}
                    onChange={v => updateAdj(adj.id, 'slots', v)}
                    label="Time Slots to adjust"
                  />

                  <div style={{ marginTop:10 }}>
                    <div style={{ fontSize:'0.78rem', fontWeight:700, color:'#555', marginBottom:4 }}>
                      Room Types to adjust <span style={{ color:'#aaa', fontWeight:400 }}>(empty = all)</span>
                    </div>
                    <div className="checkbox-grid" style={{ maxHeight:100 }}>
                      {activeRTypes.map((rt, idx) => (
                        <label key={idx} style={{
                          display:'flex', alignItems:'center', gap:5, cursor:'pointer',
                          fontSize:'0.79rem',
                          fontWeight: adj.rooms?.includes(idx) ? 700 : 400,
                          color: adj.rooms?.includes(idx) ? '#333' : '#666',
                        }}>
                          <input type="checkbox"
                            checked={adj.rooms?.includes(idx)}
                            onChange={() => updateAdj(adj.id, 'rooms',
                              adj.rooms?.includes(idx) ? adj.rooms.filter(i => i !== idx) : [...(adj.rooms||[]), idx]
                            )}
                            style={{ width:'auto', cursor:'pointer' }} />
                          {rt}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* ── Auto-Rollback ── */}
        <div style={{ padding:'12px 14px', background:'#f0f8ff', border:'1px solid #bee3f8', borderRadius:8, marginBottom:14 }}>
          <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', marginBottom: withRollback ? 12 : 0 }}>
            <input type="checkbox" checked={withRollback}
              onChange={e => setWithRollback(e.target.checked)}
              style={{ width:'auto', cursor:'pointer' }} />
            <span style={{ fontWeight:800, fontSize:'0.85rem', color:'#1a6fa0' }}>
              ↩ Schedule Auto-Rollback
            </span>
          </label>
          {withRollback && (
            <>
              <p style={{ color:'#555', fontSize:'0.8rem', marginBottom:10 }}>
                After the change is applied, the system will automatically revert to the <strong>current rates</strong> (before this change) at the date/time below.
              </p>
              <div className="form-row">
                <div className="form-group">
                  <label>Rollback Date</label>
                  <input type="date" value={rollbackDate} onChange={e => setRollbackDate(e.target.value)}
                    min={applyDate || undefined} />
                </div>
                <div className="form-group">
                  <label>Rollback Time</label>
                  <input type="time" value={rollbackTime} onChange={e => setRollbackTime(e.target.value)} />
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Preview ── */}
        {previewRates && (
          <div style={{ padding:'12px 14px', background:'#f9f9f9', border:'1px solid #e0e0e0', borderRadius:8 }}>
            <div style={{ fontWeight:800, fontSize:'0.85rem', marginBottom:8 }}>
              👁 Preview — New Rates After All Adjustments
              <span style={{ marginLeft:8, fontSize:'0.74rem', fontWeight:400, color:'#888' }}>
                Green = changed · shown in your slot order
              </span>
            </div>
            {CATEGORIES.map(cat => {
              const slots = (activeTSlots[cat] || []).filter(s => previewRates[cat]?.[s])
              if (!slots.length) return null
              return (
                <div key={cat} style={{ marginBottom:12 }}>
                  <div style={{ background: CAT_COLOR[cat], color:'#fff', padding:'5px 10px',
                    fontWeight:800, fontSize:'0.75rem', letterSpacing:1, borderRadius:'4px 4px 0 0' }}>
                    {cat.toUpperCase()}
                  </div>
                  <div style={{ overflowX:'auto' }}>
                    <table style={{ borderCollapse:'collapse', fontSize:'0.77rem', width:'100%' }}>
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
                              const old     = Number(activeRates[cat]?.[slot]?.[i]) || 0
                              const changed = v !== old
                              const diff    = v - old
                              return (
                                <td key={i} style={{
                                  padding:'4px 8px', border:'1px solid #eee', textAlign:'center',
                                  background: changed ? '#d4edda' : undefined,
                                  fontWeight: changed ? 800 : 400,
                                  color: changed ? '#155724' : '#333',
                                }}>
                                  {Number(v).toLocaleString() || '-'}
                                  {changed && (
                                    <div style={{ fontSize:'0.6rem', color: diff > 0 ? '#27ae60' : '#c0392b', fontWeight:700 }}>
                                      {diff > 0 ? `+${diff.toLocaleString()}` : diff.toLocaleString()}
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
