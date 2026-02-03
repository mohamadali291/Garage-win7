# Electron Desktop App - Setup and Usage

## Overview
This is a desktop application version of the Garage Management System that bundles the backend and frontend together, eliminating the need to run multiple `npm` commands.

## Prerequisites
- Node.js (v14 or higher)
- npm

## Installation

### First Time Setup
1. Install all dependencies:
```bash
cd /path/to/garage
npm install
```

This will automatically install dependencies for both backend and frontend.

## Running the App

### Development Mode

**Option 1: Using the helper script (Linux/Mac)**
```bash
./scripts/electron-dev.sh
```

**Option 2: Using npm command**
```bash
npm run electron:dev
```

This will:
1. Start the frontend dev server (Vite) automatically
2. Launch Electron which starts the backend automatically
3. Open the app window

### Production Mode

First, build the application:
```bash
npm run electron:build
```

This creates a distributable installer in the `dist/` directory:
- **Windows**: `.exe` installer in `dist/`
- **Linux**: `.AppImage` file in `dist/`
- **Mac**: `.dmg` file in `dist/`

## Features

### Automatic Backend Startup
- The backend server starts automatically when you launch the app
- No need to manually run `npm run dev` in the backend folder
- Backend runs on port 4000 by default

### Database Location
- Development: `backend/data/garage.sqlite`
- Production: Stored in system user data folder
  - Windows: `%APPDATA%/garage-management-system/data/`
  - Linux: `~/.config/garage-management-system/data/`
  - Mac: `~/Library/Application Support/garage-management-system/data/`

### System Tray Icon
- App can minimize to system tray (if icon is available)
- Right-click tray icon for quick actions

## Building for Distribution

### Windows Installer
```bash
npm run electron:build
```
Creates: `dist/Hamdan Garage Manager Setup x.x.x.exe`

### Configuration
- Main config: `package.json` under `"build"` section
- Electron main process: `electron-main.js`
- Desktop icons: `build/icon.png` (or .ico for Windows)

## Troubleshooting

### Port Already in Use
If you see "port 4000 already in use":
```bash
# Find and kill the process using port 4000
lsof -ti:4000 | xargs kill -9
```

### Backend Won't Start
Check the console output in the Electron window (DevTools) for error messages.

### Database Issues
The app creates a fresh database in the user data directory on first run.

## Development

### File Structure
```
garage/
├── electron-main.js          # Electron main process
├── package.json              # App configuration
├── backend/                  # Node.js backend
│   ├── src/server.js        # Backend entry point
│   └── data/                # SQLite database
├── frontend/                 # React frontend
│   ├── src/
│   └── dist/                # Built frontend (after npm run build)
├── build/                    # App icons and resources
└── scripts/
    └── electron-dev.sh      # Development helper script
```

### Scripts
- `npm start` - Start Electron app (requires manual frontend/backend setup)
- `npm run electron:dev` - Start in development mode
- `npm run electron:build` - Build distributable app
- `npm run frontend:build` - Build frontend only
- `npm run backend:install` - Install backend deps
- `npm run frontend:install` - Install frontend deps

## User Credentials
Default login credentials:
- Admin: `admin` / `1234`
- Saadeyat: `saadeyat` / `stock123`
- Viewer: `viewer` / `viewer123`

## Sync Configuration
The app inherits sync configuration from `backend/.env`:
- `SYNC_ROLE` - Set to `client` or `server`
- `SYNC_REMOTE_URL` - Remote sync server URL
- `SYNC_DEVICE_TOKEN` - Device authentication token
- `SYNC_INTERVAL_MS` - Auto-sync interval (milliseconds)

## Notes

### For Windows Users
- The built `.exe` installer will:
  - Create desktop shortcut
  - Create start menu entry
  - Allow custom installation directory
  
### For Linux Users
- The `.AppImage` is portable and doesn't require installation
- Just make it executable: `chmod +x Hamdan-Garage-Manager-x.x.x.AppImage`
- Run it: `./Hamdan-Garage-Manager-x.x.x.AppImage`

### Performance
- First launch may take a few seconds while the backend initializes
- Subsequent launches are faster
- Database operations are local and fast
