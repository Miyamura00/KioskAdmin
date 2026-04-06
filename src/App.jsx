// src/App.jsx
import { Routes, Route, Navigate } from 'react-router-dom'
import { Login }       from './pages/Login'
import { Kiosk }       from './pages/Kiosk'
import { AdminLayout } from './pages/admin/AdminLayout'
import { Dashboard }   from './pages/admin/Dashboard'
import { Rates }       from './pages/admin/Rates'
import { Holidays }    from './pages/admin/Holidays'
import { Branches }    from './pages/admin/Branches'
import { Users }       from './pages/admin/Users'
import { AuditLog }    from './pages/admin/AuditLog'
import { Settings }    from './pages/admin/Settings'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AdminProvider }  from './context/AdminContext'

function App() {
  return (
    <Routes>
      {/* ── Public routes — no auth required ── */}
      <Route path="/login" element={<Login />} />
      <Route path="/kiosk" element={<Kiosk />} />

      {/* ── Admin routes — requires login ── */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <AdminProvider>
              <AdminLayout />
            </AdminProvider>
          </ProtectedRoute>
        }
      >
        <Route index              element={<Dashboard />} />
        <Route path="rates"       element={<Rates />} />
        <Route path="holidays"    element={<Holidays />} />
        <Route path="audit"       element={<AuditLog />} />
        <Route path="settings"    element={<Settings />} />
        <Route path="branches"    element={
          <ProtectedRoute minRole="superadmin"><Branches /></ProtectedRoute>
        } />
        <Route path="users"       element={
          <ProtectedRoute minRole="superadmin"><Users /></ProtectedRoute>
        } />
      </Route>

      {/* ── Fallback ── */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}

export default App
