// src/pages/admin/Users.jsx
import { useState, useEffect } from 'react'
import { useAuth }   from '../../context/AuthContext'
import { useAdmin }  from '../../context/AdminContext'
import { auth, db }  from '../../firebase/config'
import firebase      from '../../firebase/config'
import { useAudit }  from '../../hooks/useAudit'
import { Modal }     from '../../components/Modal'
import { Toast }     from '../../components/Toast'
import { useToast }  from '../../hooks/useToast'

// Firebase config for secondary app (user creation without signing out admin)
const FIREBASE_CONFIG = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

async function createFirebaseUser(email, password) {
  let secondaryApp = null
  try {
    secondaryApp = firebase.initializeApp(FIREBASE_CONFIG, `secondary_${Date.now()}`)
    const cred = await secondaryApp.auth().createUserWithEmailAndPassword(email, password)
    const uid  = cred.user.uid
    await secondaryApp.auth().signOut()
    return uid
  } finally {
    if (secondaryApp) secondaryApp.delete()
  }
}

const ROLES = [
  { value:'user',       label:'User',       desc:'View & edit rates for assigned branches' },
  { value:'admin',      label:'Admin',      desc:'Edit rates & download history'            },
  { value:'superadmin', label:'Super Admin',desc:'Full access to all features'              },
]

export function Users() {
  const { currentUser, userProfile } = useAuth()
  const { allBranches }              = useAdmin()
  const { toast, showToast }         = useToast()
  const { logAction }                = useAudit(currentUser, userProfile)
  const isSuperAdmin                 = userProfile?.role === 'superadmin'

  const [users,          setUsers]          = useState([])
  const [loading,        setLoading]        = useState(true)
  const [systemBranches, setSystemBranches] = useState([])

  // Add/Edit modal
  const [modal,     setModal]     = useState(false)
  const [editUser,  setEditUser]  = useState(null)
  const [uName,     setUName]     = useState('')
  const [uEmail,    setUEmail]    = useState('')
  const [uPassword, setUPassword] = useState('')
  const [uRole,     setURole]     = useState('user')
  const [uBranches, setUBranches] = useState([])
  const [allAccess, setAllAccess] = useState(false)
  const [saving,    setSaving]    = useState(false)

  // Password reset modal
  const [pwModal,   setPwModal]   = useState(false)
  const [pwUser,    setPwUser]    = useState(null)
  const [savingPw,  setSavingPw]  = useState(false)

  const [deletingId,  setDeletingId]  = useState(null)
  const [togglingId,  setTogglingId]  = useState(null)

  useEffect(() => { loadUsers(); loadSystemBranches() }, [])

  async function loadSystemBranches() {
    const snap = await db.collection('branches').orderBy('name').get()
    setSystemBranches(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  async function loadUsers() {
    setLoading(true)
    try {
      const snap = await db.collection('users').orderBy('displayName').get()
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch (err) { showToast('Error: ' + err.message, 'error') }
    finally { setLoading(false) }
  }

  function openAdd() {
    setEditUser(null)
    setUName(''); setUEmail(''); setUPassword(''); setURole('user')
    setUBranches([]); setAllAccess(false)
    setModal(true)
  }

  function openEdit(user) {
    setEditUser(user)
    setUName(user.displayName || ''); setUEmail(user.email || '')
    setUPassword(''); setURole(user.role || 'user')
    const hasAll = (user.branches || []).includes('*')
    setAllAccess(hasAll)
    setUBranches(hasAll ? [] : (user.branches || []))
    setModal(true)
  }

  function toggleBranch(id) {
    setUBranches(prev => prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id])
  }

  function getSelectedBranches() { return allAccess ? ['*'] : uBranches }

  async function saveUser() {
    if (!uName.trim()) { showToast('Name is required.', 'warn'); return }
    if (!editUser && !uEmail.trim()) { showToast('Email is required.', 'warn'); return }
    if (!editUser && uPassword.length < 6) { showToast('Password must be at least 6 characters.', 'warn'); return }
    setSaving(true)
    try {
      if (editUser) {
        await db.collection('users').doc(editUser.id).update({
          displayName: uName.trim(), role: uRole, branches: getSelectedBranches(),
        })
        await logAction('UPDATE_USER', `Updated user "${uName}" — role: ${uRole}`)
        showToast('User updated!')
      } else {
        showToast('Creating Firebase account…')
        const uid = await createFirebaseUser(uEmail.trim(), uPassword)
        await db.collection('users').doc(uid).set({
          displayName: uName.trim(), email: uEmail.trim(),
          role: uRole, branches: getSelectedBranches(),
          disabled: false,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          createdBy: currentUser.uid,
        })
        await logAction('CREATE_USER', `Created user "${uName}" (${uEmail}) — role: ${uRole}`)
        showToast(`User "${uName}" created!`)
      }
      setModal(false)
      loadUsers()
    } catch (err) {
      const map = {
        'auth/email-already-in-use': 'That email is already registered.',
        'auth/invalid-email':        'Invalid email format.',
        'auth/weak-password':        'Password is too weak (min 6 characters).',
      }
      showToast(map[err.code] || 'Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── Password Reset — uses Firebase sendPasswordResetEmail (FREE) ───────────
  function openChangePw(user) { setPwUser(user); setPwModal(true) }

  async function savePassword() {
    setSavingPw(true)
    try {
      // Firebase built-in password reset — sends secure email link to user
      // Completely free, no Cloud Functions or paid plan required
      await auth.sendPasswordResetEmail(pwUser.email)
      await logAction('RESET_PASSWORD',
        `Sent password reset email to "${pwUser.displayName || pwUser.email}" (${pwUser.email})`)
      showToast(`✅ Password reset email sent to ${pwUser.email}!`)
      setPwModal(false)
    } catch (err) {
      const map = {
        'auth/user-not-found':    'No Firebase Auth account found for this email.',
        'auth/invalid-email':     'Invalid email address.',
        'auth/too-many-requests': 'Too many requests. Try again later.',
      }
      showToast(map[err.code] || 'Error: ' + err.message, 'error')
    } finally {
      setSavingPw(false)
    }
  }

  // ── Disable / Enable ──────────────────────────────────────
  async function toggleDisable(user) {
    const willDisable = !user.disabled
    if (!confirm(`${willDisable ? 'Disable' : 'Enable'} user "${user.displayName || user.email}"?\n\n${willDisable ? 'They will not be able to log in.' : 'They will regain access.'}`)) return
    setTogglingId(user.id)
    try {
      await db.collection('users').doc(user.id).update({ disabled: willDisable })
      await logAction('TOGGLE_USER', `${willDisable ? 'Disabled' : 'Enabled'} user "${user.displayName || user.email}"`)
      showToast(`User ${willDisable ? 'disabled' : 'enabled'}.`, willDisable ? 'warn' : 'success')
      loadUsers()
    } catch (err) { showToast('Error: ' + err.message, 'error') }
    finally { setTogglingId(null) }
  }

  // ── Delete ────────────────────────────────────────────────
  async function deleteUser(user) {
    if (user.id === currentUser.uid) { showToast('Cannot delete your own account.', 'error'); return }
    if (!confirm(`Delete user "${user.displayName || user.email}"?\n\nThis removes their admin access. Delete their Firebase Auth account separately in Firebase Console → Authentication.`)) return
    setDeletingId(user.id)
    try {
      await db.collection('users').doc(user.id).delete()
      await logAction('DELETE_USER', `Deleted user "${user.displayName || user.email}" (${user.email})`)
      showToast('User removed.', 'warn')
      loadUsers()
    } catch (err) { showToast('Error: ' + err.message, 'error') }
    finally { setDeletingId(null) }
  }

  const rolePillClass = { superadmin:'role-superadmin', admin:'role-admin', user:'role-user' }

  return (
    <div className="page">
      <Toast toast={toast} />

      <div style={{ background:'#e8f4fd', border:'1px solid #bee3f8', borderRadius:8, padding:'10px 16px', marginBottom:16, fontSize:'0.82rem', color:'#1a6fa0', display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ fontSize:'1.1rem' }}>ℹ️</span>
        <span>
          User accounts are created directly — no Cloud Functions or paid plan required.
          To permanently <strong>delete a Firebase Auth account</strong>, go to{' '}
          <a href="https://console.firebase.google.com/project/kiosk-edf61/authentication/users"
            target="_blank" rel="noreferrer" style={{ color:'#1a6fa0' }}>
            Firebase Console → Authentication
          </a>.
        </span>
      </div>

      <div className="card">
        <div className="card-header-row">
          <h2 className="card-title">User Management</h2>
          <button className="btn btn-primary" onClick={openAdd}>+ Add User</button>
        </div>

        {loading ? <p className="hint">Loading users…</p> :
         users.length === 0 ? <p className="hint">No users found.</p> : (
          <div className="item-grid">
            {users.map(u => {
              const branchList = (u.branches || []).includes('*') ? 'All branches' :
                (u.branches || []).map(id => systemBranches.find(b => b.id === id)?.name || id).join(', ') || 'None'
              const isSelf     = u.id === currentUser.uid
              const isDisabled = u.disabled === true

              return (
                <div key={u.id} className="item-card"
                  style={isDisabled ? { opacity:0.65, borderColor:'#e74c3c', borderWidth:2 } : {}}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:5 }}>
                    <h3 style={{ fontSize:'0.93rem' }}>{u.displayName || '—'}</h3>
                    <div style={{ display:'flex', gap:4, flexWrap:'wrap', justifyContent:'flex-end' }}>
                      <span className={`role-pill ${rolePillClass[u.role] || 'role-user'}`}>{u.role}</span>
                      {isDisabled && (
                        <span style={{ background:'#e74c3c22', color:'#c0392b', borderRadius:10, padding:'2px 7px', fontSize:'0.68rem', fontWeight:800 }}>DISABLED</span>
                      )}
                    </div>
                  </div>
                  <p>{u.email}</p>
                  <p style={{ marginTop:5, color:'#888', fontSize:'0.76rem' }}>
                    <strong>Branches:</strong> {branchList}
                  </p>
                  {isSelf && <p style={{ marginTop:3, color:'#27ae60', fontSize:'0.73rem', fontWeight:700 }}>● You</p>}
                  <div className="item-actions" style={{ flexWrap:'wrap' }}>
                    <button className="btn btn-outline" style={{ fontSize:'0.76rem' }} onClick={() => openEdit(u)}>Edit</button>
                    {isSuperAdmin && (
                      <>
                        <button className="btn btn-outline" style={{ fontSize:'0.76rem' }} onClick={() => openChangePw(u)}>
                          📧 Reset PW
                        </button>
                        {!isSelf && (
                          <button
                            className={isDisabled ? 'btn btn-green' : 'btn btn-outline'}
                            style={{ fontSize:'0.76rem', ...(isDisabled ? {} : { color:'#e67e22', borderColor:'#e67e22' }) }}
                            disabled={togglingId === u.id}
                            onClick={() => toggleDisable(u)}>
                            {togglingId === u.id ? '…' : isDisabled ? '✔ Enable' : '⊘ Disable'}
                          </button>
                        )}
                      </>
                    )}
                    <button className="btn btn-danger" style={{ fontSize:'0.76rem' }}
                      disabled={isSelf || deletingId === u.id}
                      title={isSelf ? 'Cannot delete your own account' : ''}
                      onClick={() => deleteUser(u)}>
                      {deletingId === u.id ? '…' : 'Delete'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Add / Edit Modal */}
      <Modal show={modal} onClose={() => setModal(false)}
        title={editUser ? `Edit: ${editUser.displayName || editUser.email}` : 'Add New User'}
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => setModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveUser} disabled={saving}>
              {saving ? 'Saving…' : editUser ? 'Update User' : 'Create User'}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label>Full Name</label>
          <input type="text" placeholder="Juan Dela Cruz" value={uName} onChange={e => setUName(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Email</label>
          <input type="email" placeholder="juan@example.com" value={uEmail}
            onChange={e => setUEmail(e.target.value)} disabled={!!editUser} />
          {editUser && <small>Email cannot be changed after creation.</small>}
        </div>
        {!editUser && (
          <div className="form-group">
            <label>Password</label>
            <input type="text" placeholder="Min. 6 characters" value={uPassword} onChange={e => setUPassword(e.target.value)} />
            <small>Temporary password — user should change it on first login via My Settings.</small>
          </div>
        )}
        <div className="form-group">
          <label>Role</label>
          <select value={uRole} onChange={e => setURole(e.target.value)}>
            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label} — {r.desc}</option>)}
          </select>
        </div>
        {uRole !== 'superadmin' && (
          <div className="form-group">
            <label>Branch Access</label>
            <div className="checkbox-grid">
              <label style={{ gridColumn:'1/-1', borderBottom:'1px solid #eee', paddingBottom:6, marginBottom:4 }}>
                <input type="checkbox" checked={allAccess}
                  onChange={e => { setAllAccess(e.target.checked); if (e.target.checked) setUBranches([]) }} />
                &nbsp;<strong>All Branches</strong>
              </label>
              {systemBranches.map(b => (
                <label key={b.id}>
                  <input type="checkbox"
                    checked={allAccess || uBranches.includes(b.id)}
                    disabled={allAccess}
                    onChange={() => toggleBranch(b.id)} />
                  &nbsp;{b.name || b.id}
                </label>
              ))}
            </div>
          </div>
        )}
        {uRole === 'superadmin' && (
          <div style={{ padding:'10px 14px', background:'#fff3cd', borderRadius:6, fontSize:'0.82rem', color:'#856404', border:'1px solid #ffc107' }}>
            ⚠️ Super Admin has full access to all branches and features.
          </div>
        )}
      </Modal>

      {/* Password Reset Modal */}
      <Modal show={pwModal} onClose={() => setPwModal(false)}
        title={`Reset Password: ${pwUser?.displayName || pwUser?.email || ''}`}
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => setPwModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={savePassword} disabled={savingPw}>
              {savingPw ? 'Sending…' : '📧 Send Reset Email'}
            </button>
          </>
        }
      >
        <div style={{ padding:'12px 14px', background:'#f9f9f9', borderRadius:6, marginBottom:12, fontSize:'0.85rem' }}>
          <div><strong>User:</strong> {pwUser?.displayName || '—'}</div>
          <div style={{ marginTop:4 }}><strong>Email:</strong> {pwUser?.email}</div>
        </div>
        <div style={{ padding:'12px 14px', background:'#e8f4fd', border:'1px solid #bee3f8', borderRadius:6, fontSize:'0.83rem', color:'#1a6fa0' }}>
          ℹ️ A password reset <strong>email</strong> will be sent to this user's registered email.
          They will receive a secure link from Firebase to set their new password.<br/><br/>
          This is completely <strong>free</strong> — uses Firebase's built-in reset flow. No Cloud Functions required.
        </div>
      </Modal>
    </div>
  )
}
