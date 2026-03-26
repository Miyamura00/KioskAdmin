# GitHub + Vercel Deployment Guide

## Step 1 — Create the .env file (if not done yet)

In your project root, create a file named exactly `.env` with:

```
VITE_FIREBASE_API_KEY=AIzaSyCx8lDuqt2OFPRrkCrKU0knY-eoXn2H3rM
VITE_FIREBASE_AUTH_DOMAIN=kiosk-edf61.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=kiosk-edf61
VITE_FIREBASE_STORAGE_BUCKET=kiosk-edf61.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=579100160054
VITE_FIREBASE_APP_ID=1:579100160054:web:3b1ab13dac30c7bc18a897
```

This file is in `.gitignore` so it will NOT be uploaded to GitHub.

---

## Step 2 — Push to GitHub

```bash
# Inside your hotel-kiosk folder:
git init
git add .
git commit -m "Initial commit"

# Create a new repo on GitHub (github.com → New repository)
# Then connect and push:
git remote add origin https://github.com/YOUR_USERNAME/hotel-kiosk.git
git branch -M main
git push -u origin main
```

> ✅ Your `.env` file will NOT appear on GitHub because of `.gitignore`

---

## Step 3 — Deploy on Vercel

1. Go to **vercel.com** → Sign in with GitHub
2. Click **Add New Project**
3. Select your `hotel-kiosk` repository
4. Framework Preset: **Vite** (auto-detected)
5. Before deploying, click **Environment Variables** and add each variable:

   | Name | Value |
   |------|-------|
   | `VITE_FIREBASE_API_KEY` | `AIzaSyCx8lDuqt2OFPRrkCrKU0knY-eoXn2H3rM` |
   | `VITE_FIREBASE_AUTH_DOMAIN` | `kiosk-edf61.firebaseapp.com` |
   | `VITE_FIREBASE_PROJECT_ID` | `kiosk-edf61` |
   | `VITE_FIREBASE_STORAGE_BUCKET` | `kiosk-edf61.firebasestorage.app` |
   | `VITE_FIREBASE_MESSAGING_SENDER_ID` | `579100160054` |
   | `VITE_FIREBASE_APP_ID` | `1:579100160054:web:3b1ab13dac30c7bc18a897` |

6. Click **Deploy**

After deploy, your app will be at something like `https://hotel-kiosk.vercel.app`

---

## Step 4 — Add Vercel domain to Firebase Auth

Firebase blocks sign-ins from unknown domains. You must whitelist your Vercel URL:

1. Go to **Firebase Console → Authentication → Settings → Authorized domains**
2. Click **Add domain**
3. Add your Vercel URL: `hotel-kiosk.vercel.app` (without https://)
4. Click **Add**

> Every time you add a custom domain, add it here too.

---

## Step 5 — Kiosk URLs after deployment

Your kiosk URLs will be:
```
https://hotel-kiosk.vercel.app/kiosk?branch=YOUR_BRANCH_ID
https://hotel-kiosk.vercel.app/admin
https://hotel-kiosk.vercel.app/login
```

---

## About Firebase Config Security

The Firebase config values (API key etc.) are **not truly secret** — they are needed 
by the browser to connect to Firebase. The real security comes from **Firestore Rules**, 
which you have already set up to restrict what each user can read and write.

The `.env` approach hides the values from your public GitHub repository, which is 
good practice. But Firebase security relies on your Firestore/Auth rules, not on 
hiding the config.

See: https://firebase.google.com/docs/projects/api-keys
