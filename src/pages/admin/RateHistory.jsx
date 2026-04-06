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
  return ts.toDate().toLocaleString('en-US', {
    month:'short', day:'numeric', year:'numeric',
    hour:'2-digit', minute:'2-digit', hour12:true,
  })
}

export function RateHistory({
  branchId, branchName, mode,
  activeRTypes, activeTSlots,
  activeRates,   // current live rates — used to highlight differences
  onRollback,
}) {
  const { currentUser, userProfile } = useAuth()
  const { logAction }                = useAudit(currentUser, userProfile)
  const { toast, showToast }         = useToast()

  const [history,      setHistory]      = useState([])
  const [loading,      setLoading]      = useState(false)
  const [previewEntry, setPreviewEntry] = useState(null)
  const [rollingBack,  setRollingBack]  = useState(null)
  const [deleting,     setDeleting]     = useState(null)

  useEffect(() => {
    if (branchId) fetchHistory()
    else setHistory([])
  }, [branchId, mode])

  async function fetchHistory() {
    setLoading(true)
    try {
      const snap = await db.collection('branches').doc(branchId)
        .collection('rateHistory')
        .orderBy('savedAt', 'desc')
        .limit(30)
        .get()
      setHistory(snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(e => (e.mode || 'walkin') === mode)
      )
    } catch (err) {
      showToast('Error loading history: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleRollback(entry) {
    if (!confirm(
      `Roll back to rates saved on ${formatTs(entry.savedAt)}?\n\nCurrent rates will be archived first.`
    )) return
    setRollingBack(entry.id)
    try {
      const ref      = db.collection('branches').doc(branchId)
      const curr     = await ref.get()
      const currData = curr.data() || {}
      const currRates = mode === 'walkin' ? currData.rates : currData.driveInRates
      if (currRates) {
        await ref.collection('rateHistory').add({
          savedAt:     firebase.firestore.FieldValue.serverTimestamp(),
          savedBy:     currentUser.email,
          savedByName: userProfile?.displayName || currentUser.email,
          mode, rates: currRates, note: 'Auto-archived before rollback',
        })
      }
      const update = mode === 'walkin' ? { rates: entry.rates } : { driveInRates: entry.rates }
      await ref.update(update)
      await logAction('ROLLBACK_RATES',
        `Rolled back ${mode} rates to version from ${formatTs(entry.savedAt)}`,
        branchId, branchName)
      showToast('✅ Rates rolled back!')
      onRollback(entry.rates)
      fetchHistory()
    } catch (err) {
      showToast('Rollback failed: ' + err.message, 'error')
    } finally { setRollingBack(null) }
  }

  async function handleDelete(entry) {
    if (!confirm(
      `Delete history entry from ${formatTs(entry.savedAt)}?\n\nThis cannot be undone.`
    )) return
    setDeleting(entry.id)
    try {
      await db.collection('branches').doc(branchId)
        .collection('rateHistory').doc(entry.id).delete()
      await logAction('DELETE_RATE_HISTORY',
        `Deleted rate history entry from ${formatTs(entry.savedAt)}`, branchId, branchName)
      showToast('History entry deleted.', 'warn')
      setHistory(prev => prev.filter(e => e.id !== entry.id))
    } catch (err) {
      showToast('Delete failed: ' + err.message, 'error')
    } finally { setDeleting(null) }
  }

  // Count how many rates differ between a history entry and current live rates
  function diffCount(entry) {
    let count = 0
    ;['weekday','weekend','holiday'].forEach(cat => {
      const entryRates = entry.rates?.[cat] || {}
      Object.keys(entryRates).forEach(slot => {
        ;(entryRates[slot] || []).forEach((v, i) => {
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
            Last 30 saves for {mode === 'walkin' ? 'Walk-In' : 'Drive-In'} — preview shows differences vs current rates highlighted.
          </p>
        </div>
        <button className="btn btn-outline" style={{ fontSize:'0.82rem' }} onClick={fetchHistory}>
          🔄 Refresh
        </button>
      </div>

      {loading ? (
        <p className="hint">Loading history…</p>
      ) : history.length === 0 ? (
        <p className="hint">No history yet — saved automatically every time you click Save Rates.</p>
      ) : (
        <div style={{ overflowX:'auto' }}>
          <table className="audit-table">
            <thead>
              <tr>
                <th style={{ width:170 }}>Saved At</th>
                <th>Saved By</th>
                <th>Note</th>
                <th style={{ width:80, textAlign:'center' }}>Changes</th>
                <th style={{ width:215 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry, i) => {
                const diff = diffCount(entry)
                return (
                  <tr key={entry.id}>
                    <td style={{ fontSize:'0.8rem', whiteSpace:'nowrap' }}>
                      {formatTs(entry.savedAt)}
                      {i === 0 && (
                        <span style={{ marginLeft:6, background:'#27ae6022', color:'#27ae60',
                          borderRadius:8, padding:'1px 6px', fontSize:'0.68rem', fontWeight:800 }}>
                          Latest
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize:'0.82rem', fontWeight:700 }}>
                      {entry.savedByName || entry.savedBy}
                    </td>
                    <td style={{ fontSize:'0.8rem', color:'#888', fontStyle:'italic' }}>
                      {entry.note || (entry.scheduledLabel ? `Scheduled: ${entry.scheduledLabel}` : '—')}
                    </td>
                    <td style={{ textAlign:'center' }}>
                      {diff === 0 ? (
                        <span style={{ color:'#aaa', fontSize:'0.76rem' }}>same</span>
                      ) : (
                        <span style={{
                          background: diff > 10 ? '#f8d7da' : '#fff3cd',
                          color:      diff > 10 ? '#721c24' : '#856404',
                          borderRadius:10, padding:'2px 8px',
                          fontSize:'0.73rem', fontWeight:800,
                        }}>
                          {diff} diff
                        </span>
                      )}
                    </td>
                    <td>
                      <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                        <button className="btn btn-outline"
                          style={{ fontSize:'0.74rem', padding:'4px 9px' }}
                          onClick={() => setPreviewEntry(entry)}>
                          👁 Preview
                        </button>
                        <button className="btn btn-outline"
                          style={{ fontSize:'0.74rem', padding:'4px 9px', color:'#e67e22', borderColor:'#e67e22' }}
                          disabled={rollingBack === entry.id}
                          onClick={() => handleRollback(entry)}>
                          {rollingBack === entry.id ? '…' : '↩ Rollback'}
                        </button>
                        <button className="btn btn-danger"
                          style={{ fontSize:'0.74rem', padding:'4px 9px' }}
                          disabled={deleting === entry.id}
                          onClick={() => handleDelete(entry)}>
                          {deleting === entry.id ? '…' : '🗑'}
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

      {/* ── Preview Modal ── */}
      <Modal
        show={!!previewEntry}
        onClose={() => setPreviewEntry(null)}
        title={`Rate Snapshot — ${formatTs(previewEntry?.savedAt)}`}
        wide
      >
        {previewEntry && (() => {
          const totalDiff = diffCount(previewEntry)
          return (
            <>
              {/* Legend */}
              <div style={{ display:'flex', gap:12, marginBottom:14, flexWrap:'wrap', fontSize:'0.78rem' }}>
                <span style={{ background:'#d4edda', color:'#155724', padding:'2px 10px', borderRadius:8, fontWeight:700 }}>
                  ↑ Higher than current
                </span>
                <span style={{ background:'#f8d7da', color:'#721c24', padding:'2px 10px', borderRadius:8, fontWeight:700 }}>
                  ↓ Lower than current
                </span>
                <span style={{ background:'#fff', border:'1px solid #eee', color:'#333', padding:'2px 10px', borderRadius:8 }}>
                  Same as current
                </span>
                {totalDiff > 0 && (
                  <span style={{ marginLeft:'auto', color:'#888', fontStyle:'italic' }}>
                    {totalDiff} rate{totalDiff > 1 ? 's' : ''} differ from current
                  </span>
                )}
              </div>

              <div style={{ overflowX:'auto' }}>
                {['weekday','weekend','holiday'].map(cat => {
                  // Use activeTSlots order (configured top-to-bottom)
                  const catRates = previewEntry.rates?.[cat] || {}
                  const slots = (activeTSlots[cat] || []).filter(s => catRates[s] !== undefined)
                  if (!slots.length) return null
                  return (
                    <div key={cat} style={{ marginBottom:16 }}>
                      <div style={{
                        background: CAT_COLOR[cat], color:'#fff',
                        padding:'7px 12px', fontWeight:800, fontSize:'0.82rem',
                        letterSpacing:1, borderRadius:'4px 4px 0 0',
                      }}>
                        {cat.toUpperCase()} RATES
                      </div>
                      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.81rem' }}>
                        <thead>
                          <tr>
                            <th style={{ background:'#f3f32a', padding:'6px 10px', border:'1px solid #eee', textAlign:'left' }}>
                              Slot
                            </th>
                            {(activeRTypes || []).map(rt => (
                              <th key={rt} style={{ background:'#f3f32a', padding:'6px 8px', border:'1px solid #eee', textAlign:'center' }}>
                                {rt}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {slots.map(slot => (
                            <tr key={slot}>
                              <td style={{ padding:'6px 10px', border:'1px solid #eee', fontWeight:700, whiteSpace:'nowrap' }}>
                                {slot.replace(/_\d+$/, '')}
                              </td>
                              {(catRates[slot] || []).map((v, i) => {
                                const cur  = Number(activeRates?.[cat]?.[slot]?.[i] ?? v)
                                const hist = Number(v)
                                const diff = hist - cur
                                const higher = diff > 0
                                const lower  = diff < 0
                                return (
                                  <td key={i} style={{
                                    padding:'6px 8px', border:'1px solid #eee', textAlign:'center',
                                    background: higher ? '#d4edda' : lower ? '#f8d7da' : undefined,
                                    fontWeight: diff !== 0 ? 800 : 400,
                                    color:      higher ? '#155724' : lower ? '#721c24' : '#333',
                                  }}>
                                    {hist.toLocaleString() || '-'}
                                    {diff !== 0 && (
                                      <div style={{ fontSize:'0.64rem', fontWeight:700, marginTop:1 }}>
                                        {higher ? '↑' : '↓'} {Math.abs(diff).toLocaleString()}
                                        <span style={{ fontWeight:400, color:'#888', marginLeft:3 }}>
                                          (now {cur.toLocaleString()})
                                        </span>
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
                <button className="btn btn-outline"
                  style={{ color:'#e67e22', borderColor:'#e67e22' }}
                  onClick={() => { setPreviewEntry(null); handleRollback(previewEntry) }}>
                  ↩ Rollback to This Version
                </button>
              </div>
            </>
          )
        })()}
      </Modal>
    </div>
  )
}
