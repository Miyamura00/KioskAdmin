// src/hooks/useAudit.js
import { db } from '../firebase/config'
import firebase from '../firebase/config'

export function useAudit(currentUser, userProfile) {
  async function logAction(action, details, branchId = null, branchName = null) {
    try {
      await db.collection('auditLogs').add({
        action,
        details,
        branchId:   branchId   || null,
        branchName: branchName || null,
        userId:     currentUser?.uid   || 'unknown',
        userEmail:  currentUser?.email || 'unknown',
        userName:   userProfile?.displayName || currentUser?.email || 'unknown',
        timestamp:  firebase.firestore.FieldValue.serverTimestamp(),
      })
    } catch (err) {
      console.error('Audit log error:', err)
    }
  }
  return { logAction }
}
