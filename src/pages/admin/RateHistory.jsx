// src/pages/admin/RateHistory.jsx
import { useState, useEffect } from 'react'
import { db }       from '../../firebase/config'
import firebase     from '../../firebase/config'
import { useAuth }  from '../../context/AuthContext'
import { useAudit } from '../../hooks/useAudit'
import { useToast } from '../../hooks/useToast'
import { Toast }    from '../../components/Toast'
import { Modal }    from '../../components/Modal'

const CAT_COLOR = { weekday:'#444', weekend:'#1a5276', holiday:'#700909' }

function formatTs(ts) {
  if (!ts?.toDate) return '—'
  return ts.toDate().toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true })
}

function formatDtIso(iso) {
  return new Date(iso).toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true })
}

export function RateHistory({ branchId, branchName, mode, activeRTypes, activeTSlots, activeRates, onRollback }) {
  const { currentUser, userProfile }   = useAuth()
  const { logAction }                  = useAudit(currentUser, userProfile)
  const { toast, showToast }           = useToast()

  const [history,          setHistory]          = useState([])
  const [loading,          setLoading]          = useState(false)
  const [previewEntry,     setPreviewEntry]     = useState(null)
  const [rollingBack,      setRollingBack]      = useState(null)
  const [deleting,         setDeleting]         = useState(null)
  const [schedRbModal,     setSchedRbModal]     = useState(false)
  const [schedRbEntry,     setSchedRbEntry]     = useState(null)
  const [schedRbDate,      setSchedRbDate]      = useState('')
  const [schedRbTime,      setSchedRbTime]      = useState('06:00')
  const [schedulingRb,     setSchedulingRb]     = useState(false)

  useEffect(() => {
    if (branchId) fetchHistory()
    else setHistory([])
  }, [branchId, mode])

  async function fetchHistory() {
    setLoading(true)
    try {
      const snap = await db.collection('branches').doc(branchId)
        .collection('rateHistory').orderBy('savedAt','desc').limit(30).get()
      setHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => (e.mode||'walkin') === mode))
    } catch (err) { showToast('Error: ' + err.message, 'error') }
    finally { setLoading(false) }
  }

  async function handleRollback(entry) {
    if (!confirm(`Roll back to rates saved on ${formatTs(entry.savedAt)}?\n\nCurrent rates will be archived first.`)) return
    setRollingBack(entry.id)
    try {
      const ref      = db.collection('branches').doc(branchId)
      const curr     = await ref.get()
      const currData = curr.data() || {}
      const currRates = mode === 'walkin' ? currData.rates : currData.driveInRates
      if (currRates) {
        await ref.collection('rateHistory').add({
          savedAt: firebase.firestore.FieldValue.serverTimestamp(),
          savedBy: currentUser.email, savedByName: userProfile?.displayName || currentUser.email,
          mode, rates: currRates, note: 'Auto-archived before rollback',
        })
      }
      const update = mode === 'walkin' ? { rates: entry.rates } : { driveInRates: entry.rates }
      await ref.update(update)
      await logAction('ROLLBACK_RATES', `Rolled back ${mode} rates to version from ${formatTs(entry.savedAt)}`, branchId, branchName)
      showToast('✅ Rates rolled back!')
      onRollback(entry.rates)
      fetchHistory()
    } catch (err) { showToast('Rollback failed: ' + err.message, 'error') }
    finally { setRollingBack(null) }
  }

  async function handleDelete(entry) {
    if (!confirm(`Delete history entry from ${formatTs(entry.savedAt)}?\n\nThis cannot be undone.`)) return
    setDeleting(entry.id)
    try {
      await db.collection('branches').doc(branchId).collection('rateHistory').doc(entry.id).delete()
      await logAction('DELETE_RATE_HISTORY', `Deleted rate history entry from ${formatTs(entry.savedAt)}`, branchId, branchName)
      showToast('History entry deleted.', 'warn')
      setHistory(prev => prev.filter(e => e.id !== entry.id))
    } catch (err) { showToast('Delete failed: ' + err.message, 'error') }
    finally { setDeleting(null) }
  }

  async function scheduleRollback() {
    if (!schedRbDate) { showToast('Set a rollback date.', 'warn'); return }
    const applyAt = new Date(schedRbDate + 'T' + schedRbTime).toISOString()
    if (new Date(applyAt) <= new Date()) { showToast('Rollback date must be in the future.', 'warn'); return }
    setSchedulingRb(true)
    try {
      await db.collection('branches').doc(branchId).collection('scheduledRates').add({
        label:        `↩ Scheduled Rollback: ${formatTs(schedRbEntry.savedAt)}`,
        applyAt, mode, status: 'pending', adjustments: [],
        newRates:     schedRbEntry.rates, isRollback: true, rollbackFor: schedRbEntry.id,
        createdAt:    firebase.firestore.FieldValue.serverTimestamp(),
        createdBy:    currentUser.email, createdByName: userProfile?.displayName || currentUser.email,
      })
      await logAction('SCHEDULE_ROLLBACK',
        `Scheduled rollback to version from ${formatTs(schedRbEntry.savedAt)} at ${formatDtIso(applyAt)}`,
        branchId, branchName)
      showToast(`✅ Rollback scheduled for ${formatDtIso(applyAt)}!`)
      setSchedRbModal(false)
    } catch (err) { showToast('Error: ' + err.message, 'error') }
    finally { setSchedulingRb(false) }
  }

  // Count rate cells that differ between a history entry and current live rates
  function diffCount(entry) {
    let count = 0
    ;['weekday','weekend','holiday'].forEach(cat => {
      const er = entry.rates?.[cat] || {}
      Object.keys(er).forEach(slot => {
        ;(er[slot] || []).forEach((v, i) => {
          if (Number(v) !== Number(activeRates?.[cat]?.[slot]?.[i] ?? v)) count++
        })
      })
    })
    return count
  }

  return (
    <div className="card mt20">
      <Toast toast={toast} />
      <div className="card-header-row">
        <div>
          <h2 className="card-title">📜 Rate History &amp; Rollback</h2>
          <p style={{ color:'#888', fontSize:'0.8rem', marginTop:3 }}>
            Last 30 saves for {mode==='walkin'?'Walk-In':'Drive-In'} — preview highlights differences vs current rates.
          </p>
        </div>
        <button className="btn btn-outline" style={{ fontSize:'0.82rem' }} onClick={fetchHistory}>🔄 Refresh</button>
      </div>

      {loading ? <p className="hint">Loading…</p> :
       history.length === 0 ? <p className="hint">No history yet — saved automatically each time you click Save Rates.</p> : (
        <div style={{ overflowX:'auto' }}>
          <table className="audit-table">
            <thead>
              <tr>
                <th style={{ width:170 }}>Saved At</th>
                <th>Saved By</th>
                <th>Note</th>
                <th style={{ width:80, textAlign:'center' }}>Changes</th>
                <th style={{ width:240 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry, i) => {
                const diff = diffCount(entry)
                return (
                  <tr key={entry.id}>
                    <td style={{ fontSize:'0.8rem', whiteSpace:'nowrap' }}>
                      {formatTs(entry.savedAt)}
                      {i === 0 && <span style={{ marginLeft:6, background:'#27ae6022', color:'#27ae60', borderRadius:8, padding:'1px 6px', fontSize:'0.68rem', fontWeight:800 }}>Latest</span>}
                    </td>
                    <td style={{ fontSize:'0.82rem', fontWeight:700 }}>{entry.savedByName||entry.savedBy}</td>
                    <td style={{ fontSize:'0.8rem', color:'#888', fontStyle:'italic' }}>
                      {entry.note||(entry.scheduledLabel?`Scheduled: ${entry.scheduledLabel}`:'—')}
                    </td>
                    <td style={{ textAlign:'center' }}>
                      {diff === 0
                        ? <span style={{ color:'#aaa', fontSize:'0.76rem' }}>same</span>
                        : <span style={{ background: diff>10?'#f8d7da':'#fff3cd', color: diff>10?'#721c24':'#856404', borderRadius:10, padding:'2px 8px', fontSize:'0.73rem', fontWeight:800 }}>
                            {diff} diff
                          </span>
                      }
                    </td>
                    <td>
                      <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                        <button className="btn btn-outline" style={{ fontSize:'0.73rem', padding:'3px 8px' }} onClick={() => setPreviewEntry(entry)}>👁 Preview</button>
                        <button className="btn btn-outline" style={{ fontSize:'0.73rem', padding:'3px 8px', color:'#e67e22', borderColor:'#e67e22' }}
                          disabled={rollingBack===entry.id} onClick={() => handleRollback(entry)}>
                          {rollingBack===entry.id ? '…' : '↩ Now'}
                        </button>
                        <button className="btn btn-outline" style={{ fontSize:'0.73rem', padding:'3px 8px', color:'#2980b9', borderColor:'#2980b9' }}
                          onClick={() => { setSchedRbEntry(entry); setSchedRbDate(''); setSchedRbTime('06:00'); setSchedRbModal(true) }}>
                          🕐 Later
                        </button>
                        <button className="btn btn-danger" style={{ fontSize:'0.73rem', padding:'3px 8px' }}
                          disabled={deleting===entry.id} onClick={() => handleDelete(entry)}>
                          {deleting===entry.id ? '…' : '🗑'}
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

      {/* Preview Modal */}
      <Modal show={!!previewEntry} onClose={() => setPreviewEntry(null)}
        title={`Rate Snapshot — ${formatTs(previewEntry?.savedAt)}`} wide>
        {previewEntry && (() => {
          const totalDiff = diffCount(previewEntry)
          return (
            <>
              <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap', fontSize:'0.78rem', alignItems:'center' }}>
                <span style={{ background:'#d4edda', color:'#155724', padding:'2px 9px', borderRadius:8, fontWeight:700 }}>↑ Higher than current</span>
                <span style={{ background:'#f8d7da', color:'#721c24', padding:'2px 9px', borderRadius:8, fontWeight:700 }}>↓ Lower than current</span>
                <span style={{ background:'#fff', border:'1px solid #eee', color:'#888', padding:'2px 9px', borderRadius:8 }}>Same</span>
                {totalDiff > 0 && <span style={{ marginLeft:'auto', color:'#888', fontStyle:'italic' }}>{totalDiff} rate{totalDiff>1?'s':''} differ from current</span>}
              </div>
              <div style={{ overflowX:'auto' }}>
                {['weekday','weekend','holiday'].map(cat => {
                  const catRates = previewEntry.rates?.[cat] || {}
                  const slots    = (activeTSlots[cat]||[]).filter(s => catRates[s] !== undefined)
                  if (!slots.length) return null
                  return (
                    <div key={cat} style={{ marginBottom:16 }}>
                      <div style={{ background: CAT_COLOR[cat], color:'#fff', padding:'7px 12px', fontWeight:800, fontSize:'0.82rem', letterSpacing:1, borderRadius:'4px 4px 0 0' }}>
                        {cat.toUpperCase()} RATES
                      </div>
                      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.81rem' }}>
                        <thead>
                          <tr>
                            <th style={{ background:'#f3f32a', padding:'6px 10px', border:'1px solid #eee', textAlign:'left' }}>Slot</th>
                            {(activeRTypes||[]).map(rt => <th key={rt} style={{ background:'#f3f32a', padding:'6px 8px', border:'1px solid #eee', textAlign:'center' }}>{rt}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {slots.map(slot => (
                            <tr key={slot}>
                              <td style={{ padding:'6px 10px', border:'1px solid #eee', fontWeight:700, whiteSpace:'nowrap' }}>
                                {slot.replace(/_\d+$/,'')}
                              </td>
                              {(catRates[slot]||[]).map((v,i) => {
                                const cur  = Number(activeRates?.[cat]?.[slot]?.[i] ?? v)
                                const hist = Number(v)
                                const diff = hist - cur
                                return (
                                  <td key={i} style={{ padding:'6px 8px', border:'1px solid #eee', textAlign:'center',
                                    background: diff>0?'#d4edda':diff<0?'#f8d7da':undefined,
                                    fontWeight: diff!==0?800:400, color: diff>0?'#155724':diff<0?'#721c24':'#333' }}>
                                    {hist.toLocaleString()||'-'}
                                    {diff!==0 && (
                                      <div style={{ fontSize:'0.64rem', fontWeight:700, marginTop:1 }}>
                                        {diff>0?'↑':'↓'} {Math.abs(diff).toLocaleString()}
                                        <span style={{ fontWeight:400, color:'#888', marginLeft:3 }}>(now {cur.toLocaleString()})</span>
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
                  )
                })}
              </div>
              <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:14 }}>
                <button className="btn btn-ghost" onClick={() => setPreviewEntry(null)}>Close</button>
                <button className="btn btn-outline" style={{ color:'#e67e22', borderColor:'#e67e22' }}
                  onClick={() => { setPreviewEntry(null); handleRollback(previewEntry) }}>
                  ↩ Rollback to This Version
                </button>
              </div>
            </>
          )
        })()}
      </Modal>

      {/* Schedule Rollback Modal */}
      <Modal show={schedRbModal} onClose={() => setSchedRbModal(false)}
        title={`🕐 Schedule Rollback: ${formatTs(schedRbEntry?.savedAt)}`}
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => setSchedRbModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={scheduleRollback} disabled={schedulingRb}>
              {schedulingRb ? 'Scheduling…' : '✅ Schedule Rollback'}
            </button>
          </>
        }
      >
        <p style={{ color:'#666', fontSize:'0.85rem', marginBottom:14 }}>
          Set a future date/time to automatically revert to this version. It will appear in <strong>Scheduled Rate Changes</strong> as a pending item you can cancel any time.
        </p>
        <div className="form-row">
          <div className="form-group"><label>Rollback Date</label><input type="date" value={schedRbDate} onChange={e => setSchedRbDate(e.target.value)} /></div>
          <div className="form-group"><label>Rollback Time</label><input type="time" value={schedRbTime} onChange={e => setSchedRbTime(e.target.value)} /></div>
        </div>
        <div style={{ padding:'10px 14px', background:'#e8f4fd', border:'1px solid #bee3f8', borderRadius:6, fontSize:'0.82rem', color:'#1a6fa0' }}>
          ℹ️ Once scheduled, manage or cancel it from the <strong>Scheduled Rate Changes</strong> section.
        </div>
      </Modal>
    </div>
  )
}
