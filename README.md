# Hotel Kiosk System — React + Vite

A full-featured hotel kiosk and admin console built with **React 18**, **Vite**, and **Firebase**.

## Project Structure

```
src/
├── firebase/
│   └── config.js              # Firebase credentials (already set)
├── context/
│   ├── AuthContext.jsx         # Global auth session
│   └── AdminContext.jsx        # Branch list & active branch
├── hooks/
│   └── useToast.js             # Toast notification hook
├── components/
│   ├── Toast.jsx               # Toast notification display
│   ├── Modal.jsx               # Reusable modal dialog
│   └── ProtectedRoute.jsx      # Role-based route guard
├── pages/
│   ├── Login.jsx               # Login page
│   ├── Kiosk.jsx               # Public kiosk display
│   └── admin/
│       ├── AdminLayout.jsx     # Sidebar + topbar shell
│       ├── Dashboard.jsx       # Stats overview
│       ├── Rates.jsx           # Rate management (with custom slots/rooms)
│       ├── Holidays.jsx        # Holiday events + weekend schedule
│       ├── Branches.jsx        # Branch CRUD + kiosk link (super admin)
│       └── Users.jsx           # User CRUD (super admin)
└── styles/
    ├── admin.css
    ├── kiosk.css
    └── login.css
```

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Add your images
Place these in `public/images/`:
- `image1.png` — Hotel logo (displayed on kiosk)
- `image2.png` — Decorative background image (kiosk right side)

### 3. (Optional) Cloud Function for user creation
To create Firebase Auth users from the admin panel, set up a Cloud Function:

```javascript
// functions/index.js
const functions = require('firebase-functions')
const admin     = require('firebase-admin')
admin.initializeApp()

exports.createUser = functions.https.onCall(async (data, context) => {
  // Verify caller is superadmin
  const callerDoc = await admin.firestore().collection('users').doc(context.auth.uid).get()
  if (callerDoc.data()?.role !== 'superadmin') throw new functions.https.HttpsError('permission-denied', 'Not authorized')

  const { name, email, password, role, branches } = data
  const userRecord = await admin.auth().createUser({ email, password, displayName: name })

  await admin.firestore().collection('users').doc(userRecord.uid).set({
    displayName: name,
    email,
    role,
    branches,
    createdAt:  admin.firestore.FieldValue.serverTimestamp(),
    createdBy:  context.auth.uid,
  })

  return { uid: userRecord.uid }
})
```

Then set your Cloud Function URL in `.env`:
```
VITE_CREATE_USER_URL=https://YOUR_REGION-YOUR_PROJECT.cloudfunctions.net/createUser
```

**Without a Cloud Function:** Create users manually in Firebase Console > Authentication, then their Firestore profile will link on first login.

### 4. Firestore Security Rules
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() { return request.auth != null; }
    function userRole()   { return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role; }
    function isSuperAdmin() { return userRole() == 'superadmin'; }
    function isAdminOrAbove() { return userRole() in ['admin', 'superadmin']; }

    match /branches/{branchId} {
      allow read: if isSignedIn();
      allow create, delete: if isSuperAdmin();
      allow update: if isAdminOrAbove();

      match /rateHistory/{histId} {
        allow read: if isSignedIn();
        allow write: if isAdminOrAbove();
      }
    }

    match /users/{userId} {
      allow read: if isSignedIn();
      allow write: if isSuperAdmin();
    }
  }
}
```

### 5. Run development server
```bash
npm run dev
```

### 6. Build for production
```bash
npm run build
npm run preview
```

## URL Routes

| Route | Description |
|-------|-------------|
| `/login` | Admin login page |
| `/admin` | Dashboard (requires login) |
| `/admin/rates` | Rate management |
| `/admin/holidays` | Holiday schedule |
| `/admin/branches` | Branch management (super admin) |
| `/admin/users` | User management (super admin) |
| `/kiosk?branch=BRANCH_ID` | Public kiosk display |

## Features

### Kiosk Display
- Real-time Firestore updates (no refresh needed)
- Automatically shows Weekday / Weekend / Holiday rates based on current date/time
- ONP (Overnight Package) row shown only between 8 PM – 6 AM
- Branch name displayed at bottom

### Rate Management
- **Super Admin**: Add, rename, or delete time slots per category (e.g. add "10HRS PROMO")
- **Super Admin**: Add, rename, or delete room types per branch (e.g. "Regency 1", "Suite")
- All roles with access: manually edit rate values per slot per room type
- Export full rate history to Excel

### Holiday Management
- Add/edit/delete holiday events with start and end dates
- Set weekend schedule (start day/hour and end day/hour)
- Kiosk automatically switches to holiday rates on matching dates

### Branch Management (Super Admin only)
- Create branches with auto-generated URL slug
- Optionally copy rates & settings from another branch
- View and copy kiosk link for each branch
- Delete branch (removes all rates, history, and settings)

### User Management (Super Admin only)
- Create users with role and branch assignment
- Roles: User, Admin, Super Admin
- Assign specific branches or "All Branches" access
- Edit role and branch access
- Delete users (removes Firestore profile; Firebase Auth account must be deleted manually or via Cloud Function)
