// src/components/ProtectedRoute.jsx
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const ROLE_LEVEL = { user: 1, admin: 2, superadmin: 3 }

export function ProtectedRoute({ children, minRole }) {
  const { currentUser, userProfile } = useAuth()

  if (!currentUser) return <Navigate to="/login" replace />

  if (minRole) {
    const userLevel = ROLE_LEVEL[userProfile?.role] ?? 0
    if (userLevel < ROLE_LEVEL[minRole]) return <Navigate to="/admin" replace />
  }

  return children
}
