// src/pages/admin/RateHistory.jsx
import { useState, useEffect } from 'react'
import { db }       from '../../firebase/config'
import firebase     from '../../firebase/config'
import { useAuth }  from '../../context/AuthContext'
import { useAudit } from '../../hooks/useAudit'
import { useToast } from '../../hooks/useToast'
import { Toast }    from '../../components/Toast'
import { Modal }    from '../../components/Modal'

function formatTs(ts) {
  if (!ts?.toDate) return '—'
  return ts.toDate().toLocaleString('en-US', {
    month:'short', day:'numeric', year:'numeric',
    hour:'2-digit', minute:'2-digit', hour12:true,
  })
}

export function RateHistory({ branchId, branchName, mode, activeRTypes, activeTSlots, onRollback }) {
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
      const ref = db.collection('branches').doc(branchId)

      // Archive current rates before rolling back
      const curr      = await ref.get()
      const currData  = curr.data() || {}
      const currRates = mode === 'walkin' ? currData.rates : currData.driveInRates
      if (currRates) {
        await ref.collection('rateHistory').add({
          savedAt:      firebase.firestore.FieldValue.serverTimestamp(),
          savedBy:      currentUser.email,
          savedByName:  userProfile?.displayName || currentUser.email,
          mode,
          rates: currRates,
          note:  'Auto-archived before rollback',
        })
      }

      // Apply rolled-back rates
      const update = mode === 'walkin'
        ? { rates: entry.rates }
        : { driveInRates: entry.rates }
      await ref.update(update)

      await logAction('ROLLBACK_RATES',
        `Rolled back ${mode} rates to version from ${formatTs(entry.savedAt)}`,
        branchId, branchName)

      showToast('✅ Rates rolled back successfully!')
      onRollback(entry.rates)
      fetchHistory()
    } catch (err) {
      showToast('Rollback failed: ' + err.message, 'error')
    } finally {
      setRollingBack(null)
    }
  }

  async function handleDelete(entry) {
    if (!confirm(
      `Delete this history entry from ${formatTs(entry.savedAt)}?\n\nThis cannot be undone. The entry will be permanently removed.`
    )) return

    setDeleting(entry.id)
    try {
      await db.collection('branches').doc(branchId)
        .collection('rateHistory').doc(entry.id).delete()
      await logAction('DELETE_RATE_HISTORY',
        `Deleted rate history entry from ${formatTs(entry.savedAt)}`,
        branchId, branchName)
      showToast('History entry deleted.', 'warn')
      setHistory(prev => prev.filter(e => e.id !== entry.id))
    } catch (err) {
      showToast('Delete failed: ' + err.message, 'error')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="card mt20">
      <Toast toast={toast} />

      <div className="card-header-row">
        <div>
          <h2 className="card-title">📜 Rate History &amp; Rollback</h2>
          <p style={{ color:'#888', fontSize:'0.8rem', marginTop:3 }}>
            Last 30 saves for {mode === 'walkin' ? 'Walk-In' : 'Drive-In'} — preview, rollback, or delete any version.
          </p>
        </div>
        <button className="btn btn-outline" style={{ fontSize:'0.82rem' }}
          onClick={fetchHistory}>🔄 Refresh</button>
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
                <th style={{ width:210 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry, i) => (
                <tr key={entry.id}>
                  <td style={{ fontSize:'0.8rem', whiteSpace:'nowrap' }}>
                    {formatTs(entry.savedAt)}
                    {i === 0 && (
                      <span style={{
                        marginLeft:6, background:'#27ae6022', color:'#27ae60',
                        borderRadius:8, padding:'1px 6px', fontSize:'0.68rem', fontWeight:800,
                      }}>Latest</span>
                    )}
                  </td>
                  <td style={{ fontSize:'0.82rem' }}>
                    <div style={{ fontWeight:700 }}>{entry.savedByName || entry.savedBy}</div>
                  </td>
                  <td style={{ fontSize:'0.8rem', color:'#888', fontStyle:'italic' }}>
                    {entry.note || (entry.scheduledLabel ? `Scheduled: ${entry.scheduledLabel}` : '—')}
                  </td>
                  <td>
                    <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                      <button className="btn btn-outline"
                        style={{ fontSize:'0.74rem', padding:'4px 9px' }}
                        onClick={() => setPreviewEntry(entry)}>
                        👁 Preview
                      </button>
                      <button
                        className="btn btn-outline"
                        style={{ fontSize:'0.74rem', padding:'4px 9px', color:'#e67e22', borderColor:'#e67e22' }}
                        disabled={rollingBack === entry.id}
                        onClick={() => handleRollback(entry)}>
                        {rollingBack === entry.id ? '…' : '↩ Rollback'}
                      </button>
                      <button
                        className="btn btn-danger"
                        style={{ fontSize:'0.74rem', padding:'4px 9px' }}
                        disabled={deleting === entry.id}
                        onClick={() => handleDelete(entry)}>
                        {deleting === entry.id ? '…' : '🗑'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Preview Modal */}
      <Modal
        show={!!previewEntry}
        onClose={() => setPreviewEntry(null)}
        title={`Rate Snapshot — ${formatTs(previewEntry?.savedAt)}`}
        wide
      >
        {previewEntry && (
          <div style={{ overflowX:'auto' }}>
            {['weekday','weekend','holiday'].map(cat => {
              const catRates = previewEntry.rates?.[cat] || {}
              // Use activeTSlots order so rows appear in configured top-to-bottom order
              const slots = (activeTSlots[cat] || []).filter(s => catRates[s] !== undefined)
              if (!slots.length) return null
              return (
                <div key={cat} style={{ marginBottom:16 }}>
                  <div style={{
                    background: cat==='weekday'?'#444':cat==='weekend'?'#1a5276':'#700909',
                    color:'#fff', padding:'7px 12px', fontWeight:800, fontSize:'0.85rem',
                    letterSpacing:1, borderRadius:'4px 4px 0 0',
                  }}>
                    {cat.toUpperCase()} RATES
                  </div>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
                    <thead>
                      <tr>
                        <th style={{ background:'#f3f32a', padding:'6px 10px', border:'1px solid #eee', textAlign:'left' }}>Slot</th>
                        {(activeRTypes || []).map(rt => (
                          <th key={rt} style={{ background:'#f3f32a', padding:'6px 8px', border:'1px solid #eee', textAlign:'center' }}>{rt}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {slots.map(slot => (
                        <tr key={slot}>
                          <td style={{ padding:'5px 10px', border:'1px solid #eee', fontWeight:700 }}>
                            {slot.replace(/_\d+$/, '')}
                          </td>
                          {(catRates[slot] || []).map((v, i) => (
                            <td key={i} style={{ padding:'5px 8px', border:'1px solid #eee', textAlign:'center', color:'#d10c0c', fontWeight:700 }}>
                              {Number(v).toLocaleString() || '-'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })}
          </div>
        )}
        <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:14 }}>
          <button className="btn btn-ghost" onClick={() => setPreviewEntry(null)}>Close</button>
          <button
            className="btn btn-outline"
            style={{ color:'#e67e22', borderColor:'#e67e22' }}
            onClick={() => { setPreviewEntry(null); handleRollback(previewEntry) }}>
            ↩ Rollback to This Version
          </button>
        </div>
      </Modal>
    </div>
  )
}
