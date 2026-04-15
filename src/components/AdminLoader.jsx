// src/components/AdminLoader.jsx
// Admin Console page loader — completely separate from the kiosk loader.
// Usage:
//   import { AdminLoader } from '../components/AdminLoader'
//   if (authLoading) return <AdminLoader />

export function AdminLoader({ status = 'Initializing Admin Console' }) {
  return (
    <div className="admin-auth-loader" role="status" aria-label="Loading admin console">
      <div className="admin-auth-loader-inner">

        {/* Brand */}
        <div className="aal-brand">
          <div className="aal-icon" aria-hidden="true">🏨</div>
          <div className="aal-text">
            <span className="aal-name">KioskAdmin</span>
            <span className="aal-sub">Admin Console</span>
          </div>
        </div>

        {/* Spinner + status */}
        <div className="aal-spinner-wrap">
          <div className="aal-spinner" aria-hidden="true" />
          <span className="aal-status">{status}</span>
        </div>

        {/* Progress bar */}
        <div className="aal-bar-track" aria-hidden="true">
          <div className="aal-bar" />
        </div>
      </div>

      <span className="aal-version">KioskAdmin v2</span>
    </div>
  )
}

// Compact inline loader for button states
// Usage: <LoginBtn isLoading={loading} onClick={handleLogin} />
export function LoginBtn({ isLoading, children, ...props }) {
  return (
    <button
      className={`login-btn${isLoading ? ' loading' : ''}`}
      disabled={isLoading}
      aria-busy={isLoading}
      {...props}
    >
      {children}
    </button>
  )
}
