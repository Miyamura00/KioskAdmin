// src/hooks/useScheduledRatesWatcher.js
//
// PURPOSE: Auto-apply scheduled rate changes at their applyAt time,
// regardless of which page the user is on.
//
// USAGE — mount once in your admin layout / AdminContext:
//
//   import { useScheduledRatesWatcher } from '../../hooks/useScheduledRatesWatcher'
//
//   // inside your always-mounted component:
//   useScheduledRatesWatcher({ branchId: activeBranchId, currentUser, userProfile })
//
// This hook subscribes to every pending scheduledRates entry for the branch,
// sets a precise per-entry timer, and applies the entry when it fires — all
// independent of the ScheduledRates UI component being rendered.

import { useEffect } from 'react'
import { db }        from '../firebase/config'
import firebase      from '../firebase/config'

// ── Constants (keep in sync with Rates.jsx) ─────────────────────────────────
const CATEGORIES = ['weekday', 'weekend', 'holiday']

const DEFAULT_TIME_SLOTS = {
  weekday: ['2HRS', '3HRS', '6HRS', '10HRS', '10HRS ONP', '12HRS', '24HRS'],
  weekend: ['2HRS', '3HRS', '6HRS', '10HRS', '12HRS', '24HRS'],
  holiday: ['2HRS', '3HRS', '6HRS', '10HRS', '12HRS', '24HRS'],
}
const DEFAULT_ROOM_TYPES    = ['Econo', 'Premium', 'Deluxe', 'Regency 2']
const DEFAULT_DRIVEIN_TYPES = ['Standard', 'Deluxe']

// ── Helpers ──────────────────────────────────────────────────────────────────

function applyAdjustments(baseRates, adjustments, activeTSlots, activeRTypes) {
  const result = {}
  CATEGORIES.forEach(cat => {
    result[cat] = {}
    ;(activeTSlots[cat] || []).forEach(slot => {
      result[cat][slot] = [...(baseRates[cat]?.[slot] || Array(activeRTypes.length).fill(0))]
    })
  })
  adjustments.forEach(adj => {
    const amt = parseFloat(adj.amount)
    if (isNaN(amt)) return
    CATEGORIES.forEach(cat => {
      ;(activeTSlots[cat] || []).forEach(slot => {
        const slotKey   = `${cat}:${slot}`
        const slotMatch = !adj.slots?.length || adj.slots.includes(slotKey)
        if (!slotMatch) return
        activeRTypes.forEach((_, idx) => {
          const roomMatch = !adj.rooms?.length || adj.rooms.includes(idx)
          if (!roomMatch) return
          const cur = Number(result[cat][slot][idx]) || 0
          if      (adj.type === 'increase') result[cat][slot][idx] = Math.max(0, cur + amt)
          else if (adj.type === 'decrease') result[cat][slot][idx] = Math.max(0, cur - amt)
          else                              result[cat][slot][idx] = Math.max(0, amt)
        })
      })
    })
  })
  return result
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useScheduledRatesWatcher({ branchId, currentUser, userProfile }) {
  useEffect(() => {
    if (!branchId) return

    const timers     = new Map()
    const applyingSet = new Set()

    // ── Core apply logic (self-contained — reads everything from Firestore) ──
    async function applyEntry(entry) {
      if (applyingSet.has(entry.id)) return
      applyingSet.add(entry.id)

      try {
        const branchRef = db.collection('branches').doc(branchId)

        // 1. Fetch fresh branch data (rates + settings)
        const branchSnap = await branchRef.get()
        if (!branchSnap.exists) return
        const branchData = branchSnap.data() || {}

        const mode      = entry.mode || 'walkin'
        const currRates = mode === 'walkin' ? branchData.rates : branchData.driveInRates

        // Derive slot/room config from branch settings (no props needed)
        const settings     = branchData.settings || {}
        const activeTSlots = mode === 'walkin'
          ? (settings.timeSlots       || DEFAULT_TIME_SLOTS)
          : (settings.driveInTimeSlots || DEFAULT_TIME_SLOTS)
        const activeRTypes = mode === 'walkin'
          ? (settings.roomTypes       || DEFAULT_ROOM_TYPES)
          : (settings.driveInRoomTypes || DEFAULT_DRIVEIN_TYPES)

        // 2. Re-fetch the scheduled entry to confirm it is still pending
        //    and pick up any edits made after the timer was set.
        const entrySnap = await branchRef.collection('scheduledRates').doc(entry.id).get()
        if (!entrySnap.exists || entrySnap.data()?.status !== 'pending') {
          console.log(`[ScheduledRatesWatcher] Entry ${entry.id} already gone/applied — skipping.`)
          return
        }
        const freshData = entrySnap.data()

        // 3. Archive current rates to rateHistory
        if (currRates) {
          await branchRef.collection('rateHistory').add({
            savedAt:        firebase.firestore.FieldValue.serverTimestamp(),
            savedBy:        currentUser?.email || 'system',
            savedByName:    userProfile?.displayName || currentUser?.email || 'Auto',
            mode,
            rates:          currRates,
            note:           `Auto-applied scheduled: "${freshData.label || entry.label}"`,
            scheduledLabel: freshData.label || entry.label,
          })
        }

        // 4. Resolve final rates:
        //    - If absolute rates exist (AI / Excel import) → use them directly
        //    - Otherwise compute from adjustments (% / flat increase/decrease)
        let finalRates = freshData.newRates
        const hasRealValues =
          finalRates &&
          Object.values(finalRates).some(cat =>
            Object.values(cat || {}).some(arr =>
              Array.isArray(arr) && arr.some(v => Number(v) > 0)
            )
          )
        if (!hasRealValues && freshData.adjustments?.length) {
          finalRates = applyAdjustments(
            currRates || {},
            freshData.adjustments,
            activeTSlots,
            activeRTypes,
          )
        }

        // 5. Write the new rates to the branch document
        const update = mode === 'walkin'
          ? { rates: finalRates }
          : { driveInRates: finalRates }
        await branchRef.update(update)

        // 6. Remove the applied scheduled entry
        await branchRef.collection('scheduledRates').doc(entry.id).delete()

        // 7. If a rollback was requested, queue it now
        if (freshData.rollbackAt && freshData.rollbackRates) {
          await branchRef.collection('scheduledRates').add({
            label:         `↩ Auto-Rollback: ${freshData.label || entry.label}`,
            applyAt:       freshData.rollbackAt,
            newRates:      freshData.rollbackRates,
            adjustments:   [],
            mode,
            status:        'pending',
            isRollback:    true,
            rollbackFor:   entry.id,
            createdAt:     firebase.firestore.FieldValue.serverTimestamp(),
            createdBy:     currentUser?.email || 'system',
            createdByName: userProfile?.displayName || 'Auto-Rollback',
          })
        }

        console.log(
          `[ScheduledRatesWatcher] ✅ Auto-applied "${freshData.label || entry.label}" `
          + `(branch: ${branchId}, mode: ${mode})`
        )
      } catch (err) {
        console.error('[ScheduledRatesWatcher] applyEntry error:', err)
      } finally {
        applyingSet.delete(entry.id)
      }
    }

    // ── Per-entry timer ───────────────────────────────────────────────────────
    function scheduleTimer(entry) {
      if (timers.has(entry.id)) return           // already queued

      const msUntil = new Date(entry.applyAt) - Date.now()

      if (msUntil <= 0) {
        // Already past due — apply immediately
        applyEntry(entry)
        return
      }

      const t = setTimeout(() => {
        applyEntry(entry)
        timers.delete(entry.id)
      }, msUntil + 100)                           // +100 ms safety buffer

      timers.set(entry.id, t)
    }

    // ── Realtime listener for all entries (all modes) ───────────────────────
    // We intentionally avoid .where('status') + .orderBy('applyAt') because
    // that combination requires a Firestore composite index. Without the index
    // the query silently fails and no timers fire. We fetch all docs ordered
    // by applyAt and filter to pending in memory — no composite index needed.
    const unsub = db
      .collection('branches')
      .doc(branchId)
      .collection('scheduledRates')
      .orderBy('applyAt', 'asc')
      .onSnapshot(
        snap => {
          const entries = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(e => e.status === 'pending')

          // Cancel timers for entries that have been deleted/cancelled
          const liveIds = new Set(entries.map(e => e.id))
          timers.forEach((t, id) => {
            if (!liveIds.has(id)) {
              clearTimeout(t)
              timers.delete(id)
            }
          })

          // Schedule any new / not-yet-scheduled entries
          entries.forEach(scheduleTimer)
        },
        err => console.error('[ScheduledRatesWatcher] snapshot error:', err)
      )

    // ── Cleanup on unmount / branchId change ─────────────────────────────────
    return () => {
      unsub()
      timers.forEach(t => clearTimeout(t))
      timers.clear()
    }
  }, [branchId]) // re-runs only when the active branch changes
}