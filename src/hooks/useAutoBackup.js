import { useEffect, useRef } from 'react'
import { useNavigate }       from 'react-router-dom'
import { useAuth }           from '../context/AuthContext'
import { db }                from '../firebase/config'

const FREQ_DAYS = { daily: 1, weekly: 7, biweekly: 14, monthly: 30 }

function isBackupDue(schedule) {
  if (!schedule?.frequency || schedule.frequency === 'off') return false
  const last = schedule.lastBackupAt ? new Date(schedule.lastBackupAt) : null
  if (!last) return true   // never backed up → always due
  const diffDays = (Date.now() - last.getTime()) / 86400000
  return diffDays >= (FREQ_DAYS[schedule.frequency] ?? 7)
}

export function useAutoBackup() {
  const { currentUser } = useAuth()
  const navigate        = useNavigate()
  const checkedUid      = useRef(null)   // prevent double-check on re-renders

  useEffect(() => {
    // Only check once per uid (i.e. once per login session)
    if (!currentUser?.uid)              return
    if (checkedUid.current === currentUser.uid) return
    checkedUid.current = currentUser.uid

    let cancelled = false

    async function checkAndRedirect() {
      try {
        const doc    = await db.collection('users').doc(currentUser.uid).get()
        const sched  = doc.data()?.backupSchedule

        if (cancelled) return

        if (isBackupDue(sched)) {
          console.info('[useAutoBackup] Backup is due — navigating to backup page')
          // Small delay so the app finishes rendering before the redirect
          setTimeout(() => {
            if (!cancelled) navigate('/admin/backup?autorun=1')
          }, 1500)
        }
      } catch (err) {
        // Non-fatal — just log and let the user proceed normally
        console.warn('[useAutoBackup] Could not check backup schedule:', err.message)
      }
    }

    checkAndRedirect()
    return () => { cancelled = true }
  }, [currentUser?.uid, navigate])
}
