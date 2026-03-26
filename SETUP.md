# Setup Guide — Firestore Indexes, Cloud Functions & User Management

---

## 1. Fix Firestore Index Error

The audit log no longer needs composite indexes — it now fetches and filters client-side.
No action needed for the audit trail.

If you see index errors on OTHER queries, click the link in the Firebase error message
directly — it opens the Firebase Console with the index pre-filled. Click "Create index".

---

## 2. Firestore Security Rules

Go to **Firebase Console → Firestore → Rules**, paste this:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn()    { return request.auth != null; }
    function role()          { return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role; }
    function isSuperAdmin()  { return role() == 'superadmin'; }
    function isAdminUp()     { return role() in ['admin', 'superadmin']; }
    function notDisabled()   {
      let u = get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
      return u.disabled != true;
    }

    match /branches/{branchId} {
      allow read:          if isSignedIn() && notDisabled();
      allow create, delete: if isSuperAdmin() && notDisabled();
      allow update:        if isAdminUp() && notDisabled();

      match /rateHistory/{histId} {
        allow read:  if isSignedIn() && notDisabled();
        allow write: if isAdminUp()  && notDisabled();
      }
    }

    match /holidays/{holId} {
      allow read:  if isSignedIn();
      allow write: if isAdminUp() && notDisabled();
    }

    match /users/{userId} {
      allow read:  if isSignedIn();
      allow write: if isSuperAdmin() && notDisabled();
    }

    match /auditLogs/{logId} {
      allow read:   if isSignedIn() && notDisabled();
      allow create: if isSignedIn() && notDisabled();
      allow delete: if isSuperAdmin() && notDisabled();
    }
  }
}
```

Click **Publish**.

---

## 3. Cloud Functions Setup (for User Create / Change Password / Disable)

### Step 1 — Install Firebase CLI

```bash
npm install -g firebase-tools
firebase login
```

### Step 2 — Initialize Functions in your project root

```bash
firebase init functions
```

Choose:
- **Use existing project** → select kiosk-edf61
- **JavaScript** (not TypeScript)
- **Yes** to ESLint (optional)
- **Yes** to install dependencies

### Step 3 — Write the Functions

Open `functions/index.js` and replace everything with:

```javascript
const functions = require('firebase-functions')
const admin     = require('firebase-admin')
admin.initializeApp()

// ── Helper: verify caller is superadmin ──
async function verifySuperAdmin(context) {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Not signed in.')
  const doc = await admin.firestore().collection('users').doc(context.auth.uid).get()
  if (doc.data()?.role !== 'superadmin') {
    throw new functions.https.HttpsError('permission-denied', 'Super admin only.')
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

  await admin.firestore().collection('users').doc(userRecord.uid).set({
    displayName: name,
    email,
    role:       role       || 'user',
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
    throw new functions.https.HttpsError('invalid-argument', 'UID and password (min 6 chars) required.')
  }
  await admin.auth().updateUser(uid, { password })
  return { success: true }
})

// ── Toggle Disable User ──────────────────────────────────
exports.toggleUser = functions.https.onCall(async (data, context) => {
  await verifySuperAdmin(context)
  const { uid, disabled } = data
  await admin.auth().updateUser(uid, { disabled: !!disabled })
  await admin.firestore().collection('users').doc(uid).update({ disabled: !!disabled })
  return { success: true }
})
```

### Step 4 — Deploy

```bash
firebase deploy --only functions
```

After deploy, Firebase will show URLs like:
```
https://us-central1-kiosk-edf61.cloudfunctions.net/createUser
https://us-central1-kiosk-edf61.cloudfunctions.net/changePassword
https://us-central1-kiosk-edf61.cloudfunctions.net/toggleUser
```

### Step 5 — Add URLs to .env

Create a `.env` file in your project root (same folder as `package.json`):

```
VITE_CREATE_USER_URL=https://us-central1-kiosk-edf61.cloudfunctions.net/createUser
VITE_CHANGE_PW_URL=https://us-central1-kiosk-edf61.cloudfunctions.net/changePassword
VITE_DISABLE_USER_URL=https://us-central1-kiosk-edf61.cloudfunctions.net/toggleUser
```

Restart dev server: `npm run dev`

> ⚠️ The functions use `onCall` (not HTTP). The admin panel calls them with `fetch`.
> If you prefer `onCall` client SDK, replace the fetch calls in Users.jsx with
> `firebase.functions().httpsCallable('createUser')(data)`.

---

## 4. Using HTTP Callable (Alternative — Simpler)

Instead of fetch + Bearer token, you can use the Firebase Functions SDK:

In `firebase/config.js`, add:
```javascript
import 'firebase/compat/functions'
export const functions = firebase.functions()
```

In `Users.jsx`, replace the fetch call with:
```javascript
const fn = functions.httpsCallable('createUser')
const result = await fn({ name, email, password, role, branches })
```

This handles auth tokens automatically.

---

## 5. Creating Your First Super Admin (Manual)

Since you need a super admin to create users, set one up manually:

1. Go to **Firebase Console → Authentication → Add user**
2. Enter email + password → copy the UID shown
3. Go to **Firestore → users → Add document**
4. Document ID = the UID you copied
5. Add fields:
   - `displayName` (string) → your name
   - `email` (string) → your email
   - `role` (string) → `superadmin`
   - `branches` (array) → `["*"]`
   - `disabled` (boolean) → `false`

Now log in — you'll have full super admin access.

---

## 6. Firestore Indexes (if still needed)

If any query elsewhere throws an index error, go to the URL in the error message.
It pre-fills the index for you — just click **Create index** and wait ~1 minute.

Manually create indexes at: **Firebase Console → Firestore → Indexes → Composite → Add index**

Common indexes needed:
| Collection  | Fields                        | Order |
|-------------|-------------------------------|-------|
| auditLogs   | action ASC, timestamp DESC    | ✓     |
| auditLogs   | branchId ASC, timestamp DESC  | ✓     |
| rateHistory | savedAt DESC                  | ✓     |

