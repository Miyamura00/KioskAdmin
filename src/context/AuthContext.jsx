// src/context/AuthContext.jsx
import { createContext, useContext, useState, useEffect } from 'react'
import { auth, db } from '../firebase/config'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [currentUser,    setCurrentUser]    = useState(null)
  const [userProfile,    setUserProfile]    = useState(null)
  const [loading,        setLoading]        = useState(true)
  const [disabledError,  setDisabledError]  = useState(false)

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (user) {
        const snap    = await db.collection('users').doc(user.uid).get()
        const profile = snap.exists ? { id: snap.id, ...snap.data() } : null

        // Silently block disabled users — Login page shows the message
        if (profile && profile.disabled === true) {
          setDisabledError(true)
          await auth.signOut()
          setCurrentUser(null)
          setUserProfile(null)
          setLoading(false)
          return
        }

        setDisabledError(false)
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
    <AuthContext.Provider value={{ currentUser, userProfile, loading, disabledError, clearDisabledError }}>
      {!loading && children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
