// src/context/AdminContext.jsx
import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { db } from '../firebase/config'
import { useAuth } from './AuthContext'

const AdminContext = createContext(null)

function canAccessBranch(profile, branchId) {
  if (!profile) return false
  if (profile.role === 'superadmin') return true
  return (profile.branches || []).some(b => b === '*' || b === branchId)
}

export function AdminProvider({ children }) {
  const { userProfile } = useAuth()
  const [allBranches, setAllBranches]       = useState([])
  const [activeBranchId, setActiveBranchId] = useState('')
  const [branchesLoading, setBranchesLoading] = useState(true)

  const loadBranches = useCallback(async () => {
    if (!userProfile) return
    setBranchesLoading(true)
    try {
      const snap = await db.collection('branches').orderBy('name').get()
      const all  = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      const accessible = all.filter(b => canAccessBranch(userProfile, b.id))
      setAllBranches(accessible)
    } catch (err) {
      console.error('Error loading branches:', err)
    } finally {
      setBranchesLoading(false)
    }
  }, [userProfile])

  useEffect(() => { loadBranches() }, [loadBranches])

  return (
    <AdminContext.Provider value={{
      allBranches, activeBranchId, setActiveBranchId,
      branchesLoading, refreshBranches: loadBranches,
      canAccessBranch: (id) => canAccessBranch(userProfile, id)
    }}>
      {children}
    </AdminContext.Provider>
  )
}

export function useAdmin() {
  return useContext(AdminContext)
}
