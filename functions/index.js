const functions = require("firebase-functions")
const admin     = require("firebase-admin")
admin.initializeApp()

// ── Helper: verify caller is superadmin ──
async function verifySuperAdmin(context) {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Not signed in.")
  const doc = await admin.firestore().collection("users").doc(context.auth.uid).get()
  if (doc.data()?.role !== "superadmin") {
    throw new functions.https.HttpsError("permission-denied", "Super admin only.")
  }
}

// ── Create User ──────────────────────────────────────────
exports.createUser = functions.https.onCall(async (data, context) => {
  await verifySuperAdmin(context)
  const { name, email, password, role, branches } = data
  
  const userRecord = await admin.auth().createUser({
    email,
    password,
    displayName: name,
  })

  await admin.firestore().collection("users").doc(userRecord.uid).set({
    displayName: name,
    email,
    role:       role       || "user",
    branches:   branches   || [],
    disabled:   false,
    createdAt:  admin.firestore.FieldValue.serverTimestamp(),
    createdBy:  context.auth.uid,
  })

  return { uid: userRecord.uid, success: true }
})

// ── Change Password ──────────────────────────────────────
exports.changePassword = functions.https.onCall(async (data, context) => {
  await verifySuperAdmin(context)
  const { uid, password } = data
  if (!uid || !password || password.length < 6) {
    throw new functions.https.HttpsError("invalid-argument", "UID and password (min 6 chars) required.")
  }
  await admin.auth().updateUser(uid, { password })
  return { success: true }
})

// ── Toggle Disable User ──────────────────────────────────
exports.toggleUser = functions.https.onCall(async (data, context) => {
  await verifySuperAdmin(context)
  const { uid, disabled } = data
  await admin.auth().updateUser(uid, { disabled: !!disabled })
  await admin.firestore().collection("users").doc(uid).update({ disabled: !!disabled })
  return { success: true }
})