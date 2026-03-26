// src/pages/Login.jsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth, db }    from '../firebase/config'
import { useAuth }     from '../context/AuthContext'
import '../styles/login.css'

export function Login() {
  const navigate = useNavigate()
  const { disabledError, clearDisabledError } = useAuth()

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [showPw,   setShowPw]   = useState(false)

  // Show disabled message if AuthContext caught it
  useEffect(() => {
    if (disabledError) {
      setError('⛔ Your account has been disabled. Please contact your administrator.')
      clearDisabledError()
    }
  }, [disabledError])

  // If already logged in, go to admin
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(user => {
      if (user) navigate('/admin')
    })
    return unsub
  }, [navigate])

  async function handleLogin(e) {
    e?.preventDefault()
    if (!email || !password) { setError('Please enter your email and password.'); return }
    setLoading(true); setError('')

    try {
      const cred = await auth.signInWithEmailAndPassword(email, password)
      const snap = await db.collection('users').doc(cred.user.uid).get()

      if (!snap.exists) {
        await auth.signOut()
        setError('Account not found in the system. Contact your administrator.')
        return
      }

      const profile = snap.data()

      // Check disabled flag
      if (profile.disabled === true) {
        await auth.signOut()
        setError('⛔ Your account has been disabled. Please contact your administrator.')
        return
      }

      navigate('/admin')
    } catch (err) {
      const friendlyErrors = {
        'auth/user-not-found':     '❌ No account found with that email address.',
        'auth/wrong-password':     '❌ Incorrect password. Please try again.',
        'auth/invalid-email':      '❌ Please enter a valid email address.',
        'auth/too-many-requests':  '⚠️ Too many failed attempts. Try again later or reset your password.',
        'auth/invalid-credential': '❌ Incorrect email or password.',
        'auth/user-disabled':      '⛔ Your account has been disabled. Contact your administrator.',
        'auth/network-request-failed': '⚠️ Network error. Check your connection.',
      }
      setError(friendlyErrors[err.code] || ('Error: ' + err.message))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-bg">
      <div className="login-card">
        <span className="login-badge">ADMIN ACCESS</span>
        <h1 className="login-title">Rate Management</h1>
        <p className="login-sub">Sign in to manage kiosk rates and settings</p>

        <form onSubmit={handleLogin}>
          <div className="login-field">
            <label>Email Address</label>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => { setEmail(e.target.value); setError('') }}
              autoComplete="email"
              disabled={loading}
            />
          </div>

          <div className="login-field">
            <label>Password</label>
            <div style={{ position:'relative' }}>
              <input
                type={showPw ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={e => { setPassword(e.target.value); setError('') }}
                autoComplete="current-password"
                disabled={loading}
                style={{ paddingRight: 44 }}
              />
              <button
                type="button"
                onClick={() => setShowPw(s => !s)}
                style={{
                  position:'absolute', right:12, top:'50%', transform:'translateY(-50%)',
                  background:'none', border:'none', cursor:'pointer',
                  color:'#888', fontSize:'1rem', padding:0, lineHeight:1,
                }}
                tabIndex={-1}
              >
                {showPw ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          {error && (
            <div className="login-error" style={{
              background: error.startsWith('⛔') ? '#ffe5e5' : error.startsWith('⚠️') ? '#fff3cd' : '#ffe5e5',
              borderColor: error.startsWith('⛔') ? '#f5c6cb' : error.startsWith('⚠️') ? '#ffc107' : '#f5c6cb',
              color: error.startsWith('⚠️') ? '#856404' : '#c0392b',
            }}>
              {error}
            </div>
          )}

          <button className="login-btn" type="submit" disabled={loading}>
            {loading ? 'SIGNING IN…' : 'SIGN IN'}
          </button>
        </form>

        <a href="/kiosk" className="login-back">← Back to Kiosk</a>
      </div>
    </div>
  )
}
