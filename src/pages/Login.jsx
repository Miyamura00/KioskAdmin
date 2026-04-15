// src/pages/Login.jsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth, db }    from '../firebase/config'
import { useAuth }     from '../context/AuthContext'
import { AdminLoader } from '../components/AdminLoader'
import '../styles/login.css'

export function Login() {
  const navigate    = useNavigate()
  // ── Pull currentUser & loading from AuthContext ───────────
  // AuthContext already has ONE onAuthStateChanged listener.
  // We react to its state instead of adding a second listener here.
  const { currentUser, loading, disabledError, clearDisabledError } = useAuth()

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const [showPw,   setShowPw]   = useState(false)

  // ── Redirect once AuthContext confirms a logged-in user ───
  // This replaces the old onAuthStateChanged listener in Login.jsx
  // and avoids the "throttling navigation" loop.
  useEffect(() => {
    if (!loading && currentUser) {
      navigate('/admin', { replace: true })
    }
  }, [currentUser, loading, navigate])

  // Show disabled-account message from AuthContext
  useEffect(() => {
    if (disabledError) {
      setError('⛔ Your account has been disabled. Please contact your administrator.')
      clearDisabledError()
    }
  }, [disabledError, clearDisabledError])

  // ── Login handler ─────────────────────────────────────────
  async function handleLogin(e) {
    e?.preventDefault()
    if (!email.trim() || !password) {
      setError('Please enter your email and password.')
      return
    }
    setSigningIn(true)
    setError('')

    try {
      const cred = await auth.signInWithEmailAndPassword(email.trim(), password)

      // Check Firestore profile — handle offline gracefully
      let profile = null
      try {
        // Try server first (throws if client is offline)
        const snap = await db.collection('users').doc(cred.user.uid)
          .get({ source: 'server' })
        profile = snap.exists ? snap.data() : null
      } catch (_offlineErr) {
        // Fallback to cache if offline
        try {
          const snap = await db.collection('users').doc(cred.user.uid).get()
          profile = snap.exists ? snap.data() : null
        } catch (_cacheErr) {
          // Neither available — let user through; AuthContext validates on next load
          profile = { role: 'user' }
        }
      }

      if (!profile) {
        await auth.signOut()
        setError('Account not found in the system. Contact your administrator.')
        setSigningIn(false)
        return
      }

      if (profile.disabled === true) {
        await auth.signOut()
        setError('⛔ Your account has been disabled. Contact your administrator.')
        setSigningIn(false)
        return
      }

      // Auth succeeded — the useEffect above reacts to currentUser changing
      // and calls navigate('/admin'). Keep spinner until then.

    } catch (err) {
      setSigningIn(false)
      const friendly = {
        'auth/user-not-found':         '❌ No account found with that email.',
        'auth/wrong-password':         '❌ Incorrect password. Please try again.',
        'auth/invalid-email':          '❌ Invalid email address.',
        'auth/too-many-requests':      '⚠️ Too many failed attempts. Try again later.',
        'auth/invalid-credential':     '❌ Incorrect email or password.',
        'auth/user-disabled':          '⛔ Your account has been disabled.',
        'auth/network-request-failed': '⚠️ No internet connection. Check your network.',
      }
      setError(friendly[err.code] || 'Error: ' + err.message)
    }
  }

  // ── Full-screen loading spinner ───────────────────────────
  // Show while Firebase resolves the initial session OR while signing in
  if (loading || signingIn) {
    return <AdminLoader status={loading ? 'Checking authentication...' : 'Signing in...'} />
  }

  // ── Login form ────────────────────────────────────────────
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
              disabled={signingIn}
            />
          </div>

          <div className="login-field">
            <label>Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPw ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={e => { setPassword(e.target.value); setError('') }}
                autoComplete="current-password"
                disabled={signingIn}
                style={{ paddingRight: 44 }}
              />
              <button
                type="button"
                onClick={() => setShowPw(s => !s)}
                tabIndex={-1}
                style={{
                  position: 'absolute', right: 12, top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none', border: 'none',
                  cursor: 'pointer', color: '#888',
                  fontSize: '1rem', padding: 0, lineHeight: 1,
                }}
              >
                {showPw ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          {error && (
            <div className="login-error" style={{
              background: error.startsWith('⛔') ? '#ffe5e5'
                        : error.startsWith('⚠️') ? '#fff3cd' : '#ffe5e5',
              borderColor: error.startsWith('⛔') ? '#f5c6cb'
                         : error.startsWith('⚠️') ? '#ffc107' : '#f5c6cb',
              color: error.startsWith('⚠️') ? '#856404' : '#c0392b',
            }}>
              {error}
            </div>
          )}

          <button className="login-btn" type="submit" disabled={signingIn}>
            SIGN IN
          </button>
        </form>
      </div>
    </div>
  )
}
