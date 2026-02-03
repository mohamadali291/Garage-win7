# Getting Started with Garage Management System - Desktop App

## Quick Start (Easiest Way)

### Step 1: Install Dependencies
Open a terminal in the project folder and run:
```bash
npm install
```

This installs everything you need (backend, frontend, and Electron).

### Step 2: Run the App
Choose one of these methods:

**Method A: Simple command**
```bash
npm run electron:dev
```

**Method B: Helper script (Linux/Mac)**
```bash
./scripts/electron-dev.sh
```

**Method C: On Windows (if you have Git Bash or WSL)**
```bash
bash scripts/electron-dev.sh
```

That's it! The app will:
- ✅ Start the backend server automatically
- ✅ Start the frontend automatically  
- ✅ Open in a desktop window
- ✅ No need to run multiple commands!

## What Changed?

### Before (Manual Process)
You had to run these commands in separate terminals:
```bash
# Terminal 1
cd backend
npm run dev

# Terminal 2  
cd frontend
npm run dev

# Terminal 3
# Open browser to http://localhost:5173
```

### After (Automatic Desktop App)
Just run ONE command:
```bash
npm run electron:dev
```

Everything starts automatically in a desktop window!

## Login Credentials
- **Admin**: `admin` / `1234`
- **Saadeyat**: `saadeyat` / `stock123`
- **Viewer**: `viewer` / `viewer123`

## Building for Windows Distribution

If you want to create a `.exe` installer to share with others:

### Step 1: Build the Frontend
```bash
cd frontend
npm run build
cd ..
```

### Step 2: Build the Installer
```bash
npm run electron:build
```

This creates a Windows installer in the `dist/` folder:
- `dist/Hamdan Garage Manager Setup x.x.x.exe`

### Step 3: Install on Windows
Double-click the `.exe` file and follow the installation wizard.

The installed app:
- ✅ Creates a desktop shortcut
- ✅ Adds to Start Menu
- ✅ Runs like any Windows application
- ✅ No npm commands needed!

## File Structure

```
garage/
├── electron-main.js          # ⭐ New: Electron app entry point
├── package.json              # ⭐ Updated: New scripts added
├── ELECTRON_README.md        # ⭐ New: Detailed documentation
├── GETTING_STARTED.md        # ⭐ New: This file
│
├── backend/                  # Node.js API server
│   ├── src/server.js        # Backend entry point
│   ├── .env                 # Backend configuration
│   └── data/
│       └── garage.sqlite    # Database file
│
├── frontend/                 # React UI
│   ├── src/
│   │   ├── App.jsx          # ⭐ Updated: Electron detection
│   │   └── legacyBridge.js  # ⭐ Updated: API URL for Electron
│   └── dist/                # Built frontend (after npm run build)
│
├── build/                    # ⭐ New: App icons directory
│   └── icon-info.txt        # Instructions for custom icons
│
└── scripts/
    └── electron-dev.sh      # ⭐ New: Development helper script
```

## NPM Scripts Reference

| Command | What it does |
|---------|-------------|
| `npm install` | Install all dependencies (root, backend, frontend) |
| `npm run electron:dev` | Start app in development mode |
| `npm start` | Start Electron (alternative to electron:dev) |
| `npm run electron:build` | Build Windows/Linux/Mac installer |
| `npm run frontend:build` | Build frontend only |

## Troubleshooting

### "Port 4000 is already in use"
Another instance is running. Kill it:
```bash
# Linux/Mac
lsof -ti:4000 | xargs kill -9

# Windows (PowerShell)
Get-Process -Id (Get-NetTCPConnection -LocalPort 4000).OwningProcess | Stop-Process
```

### "Cannot find module 'electron'"
Install dependencies:
```bash
npm install
```

### Frontend won't load
Make sure the frontend dev server started. Check the terminal output for errors.

### Database errors
The database is created automatically on first run at:
- Dev: `backend/data/garage.sqlite`
- Production: System user data folder

## What's Next?

### For Development
- The app automatically reloads when you make code changes
- Backend changes require restarting Electron
- Frontend changes hot-reload automatically

### For Distribution
1. Build the installer: `npm run electron:build`
2. Share the `.exe` file from `dist/` folder
3. Users just install and run - no technical knowledge needed!

### Custom Branding
- Add your logo as `build/icon.png` (512x512 or larger)
- Convert to Windows format: `build/icon.ico`
- Rebuild: `npm run electron:build`

## Support & Documentation

- **Full Details**: See `ELECTRON_README.md`
- **Original Web Docs**: See `README.md`
- **Deployment**: See `deploy/README.md`

## Summary

You now have a **single-click desktop application** that:
- ✅ Starts everything automatically
- ✅ Works offline (local database)
- ✅ Syncs with remote server (if configured)
- ✅ Can be distributed as a Windows installer
- ✅ No npm commands needed for end users!

Enjoy your new desktop app! 🚀
