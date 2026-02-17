WIN7 CLIENT SETUP (UNTESTED)

Goal: Run the app on Windows 7 as a client (sync to Hetzner).
This folder is a copy of the app prepared for Win7. It still requires Node.js on Win7.

1) Install Node.js that supports Windows 7 (Node 14.x is usually the last supported).
2) Open CMD in this folder and run:
   cd backend
   npm install

3) Configure backend\.env with your sync settings:
   SYNC_ROLE=client
   SYNC_REMOTE_URL=https://garage.quantumlab.codes
   SYNC_DEVICE_TOKEN=... (token for this device)
   PORT=4000

4) Start the app:
   start-win7.bat

Notes:
- This uses the prebuilt frontend in frontend\dist. Do not run frontend build on Win7.
- If npm install fails due to native modules, you may need VS Build Tools + Python 3.

