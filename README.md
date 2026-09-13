# Anti-Paper MSME Ledger

An elite, offline-first Progressive Web App designed specifically for Micro, Small, and Medium Enterprises (MSMEs). 
The MSME Ledger features a robust transactional core, lightning-fast POS UI, and a background synchronization engine that natively guarantees data consistency even through unstable network drops.

## Features

- **Offline-First POS Dashboard**: Fully operational Point of Sale system requiring no persistent internet connection.
- **Sales History & Ledger**: Comprehensive chronological tabulation of all recorded transactions, payment statuses, and network sync states.
- **Background Synchronization**: Dexie-based queue that automatically detects network restoration and flushes transactions to the MongoDB backend concurrently. Includes a manual "Force Sync" override.
- **Native PWA Installation**: Fully configured via `vite-plugin-pwa` with aggressive Workbox offline caching. Users can "Add to Home Screen" on iOS/Android for a native app experience.
- **Idempotent ACID Transactions**: Prevents duplicated sync payloads across spotty networks via strict UUID mapping.
- **Debt Ledger & WhatsApp Engine**: Real-time insights into outstanding balances, featuring deep-link generators to easily text debtors professional reminders.
- **Utilitarian Design System**: High-contrast, highly legible Tailwind CSS design system tailored for rapid mobile tap-entry.

## Tech Stack

- **Frontend**: React, Vite, Tailwind CSS, Dexie.js (IndexedDB), Vite PWA
- **Backend**: Node.js, Express, Mongoose
- **Database**: MongoDB (via backend), IndexedDB (via frontend)

## Quick Start (Local Development)

### 1. Backend Setup
```bash
cd server
npm install
# Ensure MongoDB is running locally on port 27017 or adjust the MONGO_URI in server.js
npm run dev
```

### 2. Frontend Setup
```bash
# In the root directory
npm install
npm run dev
```

Visit `http://localhost:5173` to view the application.

## Production Deployment (Vercel & Render)

When deploying to production, you must link the frontend to the backend and the backend to the cloud database using Environment Variables.

**Vercel (Frontend):**
Add `VITE_API_URL` pointing to your hosted Render URL (e.g. `https://your-backend-name.onrender.com`).

**Render (Backend):**
Add `MONGO_URI` pointing to your MongoDB Atlas connection string.

## The "Airplane Mode" Architecture
This repository implements advanced optimistic UI patterns mirroring systems like Linear. The frontend and backend maintain an absolute zero-collision guarantee by relying entirely on UUIDs generated exclusively by the client. Errors encountered locally (e.g. stock limitations) bubble up and naturally trigger local database rollbacks, bypassing the need to constantly query the cloud.
