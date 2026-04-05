// src/pages/Login.jsx
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth, db }    from '../firebase/config'
import { useAuth }     from '../context/AuthContext'
import '../styles/login.css'

export function Login() {
  const navigate    = useNavigate()
  const { disabledError, clearDisabledError } = useAuth()

  const [email,        setEmail]        = useState('')
  const [password,     setPassword]     = useState('')
  const [error,        setError]        = useState('')
  const [loading,      setLoading]      = useState(false)
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [showPw,       setShowPw]       = useState(false)

  // Guard: only ONE navigation ever fires — prevents the throttle loop
  const hasNavigated = useRef(false)

  // Show disabled-account message from AuthContext
  useEffect(() => {
    if (disabledError) {
      setError('⛔ Your account has been disabled. Please contact your administrator.')
      clearDisabledError()
    }
  }, [disabledError])

  // ── Single auth-state listener ────────────────────────────
  // This is the ONLY place that calls navigate('/admin').
  // The login handler just signs in — this listener does the redirect.
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(user => {
      if (user) {
        if (!hasNavigated.current) {
          hasNavigated.current = true
          navigate('/admin', { replace: true })
        }
      } else {
        setCheckingAuth(false)
        setLoading(false)
      }
    })
    return unsub
  }, [navigate])

  // ── Login handler ─────────────────────────────────────────
  async function handleLogin(e) {
    e?.preventDefault()
    if (!email.trim() || !password) {
      setError('Please enter your email and password.')
      return
    }
    setLoading(true)
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
        hasNavigated.current = false
        setError('Account not found in the system. Contact your administrator.')
        setLoading(false)
        return
      }

      if (profile.disabled === true) {
        await auth.signOut()
        hasNavigated.current = false
        setError('⛔ Your account has been disabled. Contact your administrator.')
        setLoading(false)
        return
      }

      // Auth succeeded — onAuthStateChanged fires and navigates.
      // Keep spinner showing until navigation happens.

    } catch (err) {
      hasNavigated.current = false
      setLoading(false)
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
  if (checkingAuth || loading) {
    return (
      <div style={{
        position: 'fixed', inset: 0,
        background: 'linear-gradient(135deg, #700909 0%, #d10c0c 100%)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 20, zIndex: 9999,
      }}>
        <div style={{
          width: 56, height: 56,
          border: '5px solid rgba(243,243,42,0.25)',
          borderTop: '5px solid #f3f32a',
          borderRadius: '50%',
          animation: 'spin 0.9s linear infinite',
        }} />
        <p style={{
          color: '#f3f32a', fontWeight: 900,
          fontSize: '0.95rem', letterSpacing: 3,
          fontFamily: 'Arial, sans-serif',
        }}>
          {loading ? 'SIGNING IN…' : 'LOADING…'}
        </p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
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
              disabled={loading}
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
                disabled={loading}
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

          <button className="login-btn" type="submit" disabled={loading}>
            SIGN IN
          </button>
        </form>
      </div>
    </div>
  )
}
