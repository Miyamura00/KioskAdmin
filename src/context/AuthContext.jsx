// src/context/AuthContext.jsx
import { createContext, useContext, useState, useEffect } from 'react'
import { auth, db } from '../firebase/config'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [currentUser,   setCurrentUser]   = useState(null)
  const [userProfile,   setUserProfile]   = useState(null)
  const [loading,       setLoading]       = useState(true)
  const [disabledError, setDisabledError] = useState(false)

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (user) {
        const snap    = await db.collection('users').doc(user.uid).get()
        const profile = snap.exists ? { id: snap.id, ...snap.data() } : null
        if (profile?.disabled === true) {
          await auth.signOut()
          setCurrentUser(null)
          setUserProfile(null)
          setDisabledError(true)
          setLoading(false)
          return
        }
        setCurrentUser(user)
        setUserProfile(profile)
      } else {
        setCurrentUser(null)
        setUserProfile(null)
      }
      setLoading(false)
    })
    return unsub
  }, [])

  function clearDisabledError() { setDisabledError(false) }

  return (
    // Always render children — kiosk and public pages must not be blocked
    <AuthContext.Provider value={{ currentUser, userProfile, loading, disabledError, clearDisabledError }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
