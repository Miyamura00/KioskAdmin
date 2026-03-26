// src/pages/admin/Settings.jsx
// Each logged-in user can change their own password here.
// Uses Firebase auth.currentUser.updatePassword() — 100% FREE, no Cloud Functions.
import { useState } from 'react'
import { useAuth }  from '../../context/AuthContext'
import { auth }     from '../../firebase/config'
import firebase     from '../../firebase/config'
import { Toast }    from '../../components/Toast'
import { useToast } from '../../hooks/useToast'

// Generate a random password: letters + numbers + symbols
function generatePassword(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*'
  let pw = ''
  for (let i = 0; i < length; i++) {
    pw += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return pw
}

export function Settings() {
  const { currentUser, userProfile } = useAuth()
  const { toast, showToast }         = useToast()

  const [currentPw,  setCurrentPw]  = useState('')
  const [newPw,      setNewPw]       = useState('')
  const [confirmPw,  setConfirmPw]   = useState('')
  const [showCurr,   setShowCurr]   = useState(false)
  const [showNew,    setShowNew]     = useState(false)
  const [showConf,   setShowConf]   = useState(false)
  const [saving,     setSaving]     = useState(false)

  // Password strength checker
  function strength(pw) {
    if (!pw) return { label: '', color: '#eee', pct: 0 }
    let score = 0
    if (pw.length >= 8)           score++
    if (pw.length >= 12)          score++
    if (/[A-Z]/.test(pw))         score++
    if (/[0-9]/.test(pw))         score++
    if (/[^A-Za-z0-9]/.test(pw))  score++
    const map = [
      { label: 'Very Weak', color: '#e74c3c', pct: 10 },
      { label: 'Weak',      color: '#e67e22', pct: 25 },
      { label: 'Fair',      color: '#f1c40f', pct: 50 },
      { label: 'Good',      color: '#2ecc71', pct: 75 },
      { label: 'Strong',    color: '#27ae60', pct: 100 },
    ]
    return map[Math.min(score, 4)]
  }

  const str = strength(newPw)

  async function handleChangePassword(e) {
    e.preventDefault()
    if (!currentPw)           { showToast('Enter your current password.', 'warn');  return }
    if (newPw.length < 6)     { showToast('New password must be at least 6 characters.', 'warn'); return }
    if (newPw !== confirmPw)  { showToast('Passwords do not match.', 'error'); return }
    if (newPw === currentPw)  { showToast('New password must be different from current.', 'warn'); return }

    setSaving(true)
    try {
      // Re-authenticate first (required by Firebase for security-sensitive ops)
      const credential = firebase.auth.EmailAuthProvider.credential(currentUser.email, currentPw)
      await currentUser.reauthenticateWithCredential(credential)

      // Now change the password — completely FREE
      await currentUser.updatePassword(newPw)

      showToast('✅ Password changed successfully!')
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
    } catch (err) {
      const map = {
        'auth/wrong-password':          '❌ Current password is incorrect.',
        'auth/weak-password':           '❌ New password is too weak.',
        'auth/requires-recent-login':   '❌ Session expired. Please sign out and sign in again, then try.',
        'auth/too-many-requests':       '⚠️ Too many attempts. Try again later.',
      }
      showToast(map[err.code] || 'Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  function applyGenerated() {
    const pw = generatePassword(12)
    setNewPw(pw)
    setConfirmPw(pw)
    setShowNew(true)
    setShowConf(true)
  }

  return (
    <div className="page">
      <Toast toast={toast} />

      <div className="card" style={{ maxWidth: 520 }}>
        <h2 className="card-title" style={{ marginBottom: 4 }}>Account Settings</h2>
        <p style={{ color:'#888', fontSize:'0.83rem', marginBottom:20 }}>
          Logged in as <strong>{userProfile?.displayName || currentUser?.email}</strong>
          {' '}<span className={`role-pill role-${userProfile?.role}`}>{userProfile?.role}</span>
        </p>

        <hr className="divider" />
        <h3 style={{ fontSize:'0.95rem', fontWeight:800, margin:'16px 0 14px', color:'#333' }}>
          🔑 Change Your Password
        </h3>
        <p style={{ color:'#888', fontSize:'0.82rem', marginBottom:16 }}>
          Uses your current login session — no extra setup or payment required.
        </p>

        <form onSubmit={handleChangePassword}>
          {/* Current password */}
          <div className="form-group">
            <label>Current Password</label>
            <div style={{ position:'relative' }}>
              <input
                type={showCurr ? 'text' : 'password'}
                placeholder="Your current password"
                value={currentPw}
                onChange={e => setCurrentPw(e.target.value)}
                style={{ paddingRight:44 }}
              />
              <ToggleEye show={showCurr} onToggle={() => setShowCurr(s => !s)} />
            </div>
          </div>

          {/* New password */}
          <div className="form-group">
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
              <label style={{ margin:0 }}>New Password</label>
              <button type="button" className="btn btn-outline"
                style={{ fontSize:'0.74rem', padding:'3px 10px' }}
                onClick={applyGenerated}>
                🎲 Generate
              </button>
            </div>
            <div style={{ position:'relative' }}>
              <input
                type={showNew ? 'text' : 'password'}
                placeholder="Min. 6 characters"
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                style={{ paddingRight:44 }}
              />
              <ToggleEye show={showNew} onToggle={() => setShowNew(s => !s)} />
            </div>
            {/* Strength bar */}
            {newPw && (
              <div style={{ marginTop:6 }}>
                <div style={{ height:5, background:'#eee', borderRadius:4, overflow:'hidden' }}>
                  <div style={{ width:`${str.pct}%`, background:str.color, height:'100%', transition:'all 0.3s' }} />
                </div>
                <span style={{ fontSize:'0.74rem', color:str.color, fontWeight:700 }}>{str.label}</span>
              </div>
            )}
          </div>

          {/* Confirm new password */}
          <div className="form-group">
            <label>Confirm New Password</label>
            <div style={{ position:'relative' }}>
              <input
                type={showConf ? 'text' : 'password'}
                placeholder="Repeat new password"
                value={confirmPw}
                onChange={e => setConfirmPw(e.target.value)}
                style={{
                  paddingRight:44,
                  borderColor: confirmPw && confirmPw !== newPw ? '#e74c3c' : undefined,
                }}
              />
              <ToggleEye show={showConf} onToggle={() => setShowConf(s => !s)} />
            </div>
            {confirmPw && confirmPw !== newPw && (
              <small style={{ color:'#e74c3c' }}>Passwords do not match</small>
            )}
          </div>

          <button type="submit" className="btn btn-primary"
            style={{ width:'100%', padding:12, fontSize:'0.95rem' }}
            disabled={saving}>
            {saving ? 'Changing Password…' : '🔒 Change Password'}
          </button>
        </form>
      </div>

      {/* Info box */}
      <div style={{
        maxWidth:520, padding:'12px 16px', background:'#e8f4fd',
        border:'1px solid #bee3f8', borderRadius:8, fontSize:'0.82rem', color:'#1a6fa0',
        marginTop: 4,
      }}>
        ℹ️ Your password is changed securely through Firebase Authentication — no backend server or paid plan needed.
        If you forget your current password, ask your Super Admin to reset it via Firebase Console.
      </div>
    </div>
  )
}

// Small helper component
function ToggleEye({ show, onToggle }) {
  return (
    <button type="button" onClick={onToggle} tabIndex={-1}
      style={{
        position:'absolute', right:12, top:'50%', transform:'translateY(-50%)',
        background:'none', border:'none', cursor:'pointer',
        color:'#888', fontSize:'1rem', padding:0, lineHeight:1,
      }}>
      {show ? '🙈' : '👁'}
    </button>
  )
}
