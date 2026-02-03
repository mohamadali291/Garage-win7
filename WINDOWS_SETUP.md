# Windows Setup Guide

## Quick Start on Windows

### Step 1: Install Node.js
Download and install from: https://nodejs.org/
- Choose LTS (Long Term Support) version
- Include npm in the installation

### Step 2: Clone/Pull the Repository
```cmd
cd path\to\your\folder
git pull
```

### Step 3: Install Dependencies
Open Command Prompt or PowerShell in the project folder:

```cmd
npm install
```

This will:
- Install Electron and all root dependencies
- Install backend dependencies automatically
- Install frontend dependencies automatically

**Note**: This may take 5-10 minutes on first install (Electron is ~100MB)

### Step 4: Run the Desktop App
```cmd
npm run electron:dev
```

**OR simply:**
```cmd
npm start
```

The app will:
- ✅ Start the backend server automatically
- ✅ Start the frontend automatically  
- ✅ Open in a desktop window

## Common Issues on Windows

### Issue 1: "NODE_ENV is not recognized as an internal or external command"

**Solution**: This is already fixed! Make sure you have the latest code:
```cmd
git pull
npm install
```

The fix uses `cross-env` to handle environment variables on Windows.

### Issue 2: Port 4000 Already in Use

**Solution**: Kill the process using that port.

**PowerShell:**
```powershell
Get-Process -Id (Get-NetTCPConnection -LocalPort 4000).OwningProcess | Stop-Process -Force
```

**Command Prompt:**
```cmd
netstat -ano | findstr :4000
taskkill /PID <PID_NUMBER> /F
```

Replace `<PID_NUMBER>` with the actual process ID from the first command.

### Issue 3: "npm is not recognized"

**Solution**: Node.js is not installed or not in PATH.
1. Install Node.js from https://nodejs.org/
2. Restart your terminal/Command Prompt
3. Try again

### Issue 4: Permission Denied Errors

**Solution**: Run Command Prompt/PowerShell as Administrator:
- Right-click Command Prompt/PowerShell
- Select "Run as administrator"
- Navigate to project folder
- Run `npm install` again

### Issue 5: Slow Installation

This is normal! Electron is a large package (~100MB). The first installation takes time.

## Login Credentials

After the app starts, login with:
- **Admin**: `garage` / `garage123`
- **Stock Manager**: `saadiyet` / `saadiyet123`
- **Viewer**: `naji` / `naji123`

## Building Windows Installer

To create a `.exe` installer for distribution:

### Step 1: Build Frontend
```cmd
cd frontend
npm run build
cd ..
```

### Step 2: Build Installer
```cmd
npm run electron:build
```

This creates: `dist\Hamdan Garage Manager Setup x.x.x.exe`

### Step 3: Distribute
The `.exe` file in the `dist` folder can be:
- Shared with other users
- Installed on any Windows computer
- Run without needing Node.js or npm

## File Paths on Windows

### Database Location
- **Development**: `backend\data\garage.sqlite`
- **Production (after install)**: `%APPDATA%\garage-management-system\data\garage.sqlite`

### Configuration
- Backend config: `backend\.env`
- Frontend config: `frontend\.env` (if needed)

## NPM Scripts Reference

| Command | What it does |
|---------|-------------|
| `npm install` | Install all dependencies |
| `npm start` | Start Electron app (simple) |
| `npm run electron:dev` | Start app in development mode |
| `npm run electron:build` | Build Windows installer (.exe) |
| `npm run frontend:build` | Build frontend only |
| `npm run backend:install` | Install backend dependencies only |
| `npm run frontend:install` | Install frontend dependencies only |

## Syncing with VPS

Your Windows laptop can sync with the central server at `garage.quantumlab.codes`.

### Configuration
Edit `backend\.env`:
```env
SYNC_ROLE=client
SYNC_REMOTE_URL=https://garage.quantumlab.codes
SYNC_DEVICE_TOKEN=your_token_here
SYNC_INTERVAL_MS=300000
PORT=4000
```

Replace `your_token_here` with the device token provided by the admin.

### How Sync Works
1. App runs locally (offline capable)
2. Automatically syncs every 5 minutes when online
3. Manual sync via "Sync now" button in the app
4. Conflicts can be resolved by admin users

## Troubleshooting Tools

### Check if Backend is Running
```cmd
curl http://localhost:4000/api/health
```

If this returns `{"ok":true}`, the backend is working.

### View Running Node Processes
```cmd
tasklist | findstr node
```

### Kill All Node Processes (Nuclear Option)
```cmd
taskkill /F /IM node.exe
```

**Warning**: This kills ALL Node.js processes!

## Development Tips

### Hot Reload
- **Frontend**: Changes auto-reload (Vite hot module replacement)
- **Backend**: Requires restarting Electron (Ctrl+C and run again)

### DevTools
The Electron window has Chrome DevTools enabled in development mode:
- Press F12 or Ctrl+Shift+I to open
- View console logs, network requests, etc.

### Logs
Backend logs appear in the terminal where you ran `npm run electron:dev`

## Performance Tips

### First Launch
The first time you run the app may take 10-20 seconds while:
- Backend initializes
- Database is created
- Frontend dev server starts

### Subsequent Launches
- Much faster (3-5 seconds)
- Backend and database are already initialized

### Build Size
The built installer will be approximately:
- Download size: ~150MB
- Installed size: ~300MB

This includes Electron, Node.js runtime, and all dependencies.

## Need Help?

1. Check this guide first
2. Check `GETTING_STARTED.md` for general info
3. Check `ELECTRON_README.md` for technical details
4. Check `USER_MANAGEMENT.md` for user/login issues

## Security Notes

- **Never commit** `backend\.env` with real tokens
- **Change default passwords** after first login
- **Keep your device token secure** - it's like a password
- **Backup your database** regularly (see `USER_MANAGEMENT.md`)

---

## Quick Checklist

Before running the app, make sure:
- ✅ Node.js installed (check with `node --version`)
- ✅ Git pulled latest changes
- ✅ Ran `npm install`
- ✅ Port 4000 is free
- ✅ Backend `.env` configured (if syncing)

Then just run:
```cmd
npm run electron:dev
```

Enjoy! 🚀
