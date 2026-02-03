# Production Build Guide

## 🎯 Building for Production (Windows .exe)

This guide shows how to create a production Windows installer that doesn't require dev servers.

---

## 📋 Current Users on VPS

Your VPS (`https://garage.quantumlab.codes`) has these users:

| Username | Password | Role | Access |
|----------|----------|------|--------|
| `garage` | `garage123` | Main Admin | Full access ✅ |
| `saadiyet` | `saadiyet123` | Stock Manager | Items & transfers |
| `naji` | `naji123` | Viewer | Read-only |

**Note:** Old users (admin, saadeyat, viewer) are also present but use the new ones above.

---

## 🚀 Step-by-Step Production Build

### Prerequisites

Make sure you have:
- ✅ Node.js installed
- ✅ All dependencies installed (`npm install`)
- ✅ Git pulled latest code
- ✅ Backend `.env` configured (if using sync)

---

### Step 1: Build the Frontend

```cmd
cd C:\garage\frontend
npm run build
```

This creates `frontend\dist\` folder with production files.

**Wait for:** "✓ built in XXms"

---

### Step 2: Build Windows Installer

```cmd
cd C:\garage
npm run electron:build
```

This will:
- Package the app with Electron
- Include the built frontend
- Include the backend
- Create Windows installer (.exe)

**Wait time:** 5-10 minutes (downloads and packages everything)

---

### Step 3: Find Your Installer

After build completes, find the installer here:
```
C:\garage\dist\Hamdan Garage Manager Setup x.x.x.exe
```

This is your **production installer**! 🎉

---

## 📦 What's in the Production Build?

The `.exe` installer includes:
- ✅ Electron runtime
- ✅ Node.js backend (embedded)
- ✅ React frontend (pre-built, static files)
- ✅ All dependencies
- ✅ SQLite database (created on first run)

**Users don't need:**
- ❌ Node.js installed
- ❌ npm commands
- ❌ Terminal/Command Prompt
- ❌ Git
- ❌ Any technical knowledge

---

## 🎯 Distributing the App

### For Windows Users:

1. **Copy the installer** to USB/email/network:
   ```
   Hamdan Garage Manager Setup x.x.x.exe
   ```

2. **User runs the installer**:
   - Double-click the .exe
   - Follow installation wizard
   - Creates desktop shortcut automatically
   - Creates start menu entry

3. **User launches the app**:
   - Desktop icon or Start Menu
   - Everything works automatically!

---

## 🔧 Production Configuration

### Backend .env for Production Users

If users need to sync with VPS, they need `.env` file.

**Location after installation:**
```
C:\Users\<Username>\AppData\Local\Programs\hamdan-garage-manager\resources\app\backend\.env
```

**Or simpler:** Provide `.env` file and tell users:
1. Install the app
2. Go to installation folder
3. Navigate to `backend\` subfolder
4. Put `.env` file there
5. Restart app

**Better approach:** Include `.env` template in the installer (see Advanced section).

---

## 🎨 Custom Branding (Optional)

### Add Your Logo/Icon

1. Get a PNG image (512x512 or larger)
2. Convert to multiple formats:
   - `build\icon.png` (512x512) - Base image
   - `build\icon.ico` - Windows installer
   - `build\icon.icns` - Mac (if needed)

3. Use online converter: https://www.img2go.com/convert-to-ico

4. Place files in `C:\garage\build\` folder

5. Rebuild: `npm run electron:build`

---

## ⚙️ Build Configuration

The build settings are in `package.json`:

```json
{
  "build": {
    "appId": "com.hamdan.garage",
    "productName": "Hamdan Garage Manager",
    "win": {
      "target": "nsis",
      "icon": "build/icon.ico"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true
    }
  }
}
```

**Customizations you can make:**
- Change `productName` for different app name
- Change `appId` for unique identifier
- Modify NSIS options for installer behavior

---

## 📊 Build Size

**Installer size:** ~150MB
- Electron: ~100MB
- Node.js: ~20MB
- Your app: ~30MB

**Installed size:** ~300MB

This is normal for Electron apps!

---

## 🔍 Testing the Production Build

### Before Distributing:

1. **Install on a test machine**:
   - Run the .exe installer
   - Complete installation
   - Launch the app

2. **Test all features**:
   - ✅ Login with all users
   - ✅ Create/edit data
   - ✅ Export/import Excel
   - ✅ Sync (if configured)
   - ✅ App restart

3. **Test without internet**:
   - Disconnect network
   - App should work offline
   - Sync button shows "offline" or queues changes

---

## 🚨 Troubleshooting Build Issues

### Build fails with "electron-builder not found"
```cmd
npm install electron-builder --save-dev
```

### Frontend build fails
```cmd
cd frontend
npm install
npm run build
```

### "Command failed: npm run frontend:build"
Frontend has errors. Check:
```cmd
cd frontend
npm run build
```
Fix any errors shown.

### Installer is too large
This is normal! Electron apps are large. 150MB is expected.

### Users can't install (Admin rights needed)
Set `"oneClick": false` in package.json (already done).
Users can choose install location and don't need admin.

---

## 🎯 Production vs Development

| Feature | Development | Production |
|---------|-------------|------------|
| Frontend | Vite dev server | Built static files |
| Hot reload | ✅ Yes | ❌ No (not needed) |
| Source maps | ✅ Yes | ❌ No (optimized) |
| Size | Smaller | Larger (all bundled) |
| Speed | Faster dev | Faster runtime |
| Startup | Requires 2 commands | One-click |
| Distribution | Source code | Single .exe |

---

## 📝 Build Checklist

Before building:

- [ ] Code is tested and working
- [ ] Frontend builds without errors
- [ ] Backend tested with production data
- [ ] `.env` template ready (if using sync)
- [ ] Custom icon added (optional)
- [ ] Version number updated in package.json
- [ ] All dependencies installed

Build commands:
- [ ] `cd frontend && npm run build`
- [ ] `cd .. && npm run electron:build`
- [ ] Test installer on clean machine
- [ ] Document installation steps for users

---

## 🔄 Update Strategy

### When You Release Updates:

1. **Update version** in `package.json`:
   ```json
   "version": "1.0.1"
   ```

2. **Rebuild**:
   ```cmd
   npm run electron:build
   ```

3. **Distribute new installer**:
   - Send to users
   - They uninstall old version
   - Install new version
   - Data is preserved (database stays)

### Auto-Update (Advanced)

Electron-builder supports auto-update, but requires:
- Code signing certificate ($$)
- Update server
- Additional configuration

For internal company use, manual updates are simpler.

---

## 🎉 Quick Production Build Commands

```cmd
# Full production build (one command)
cd C:\garage
npm run electron:build

# This does:
# 1. Builds frontend (npm run frontend:build)
# 2. Packages Electron app
# 3. Creates installer in dist\

# Find your installer:
dir dist\*.exe
```

---

## 📱 Multi-Machine Deployment

### For Multiple Windows Laptops:

1. **Build once** (on any Windows machine)
2. **Copy installer** to shared location
3. **Each user:**
   - Runs installer
   - Gets unique device token from admin
   - Adds `.env` with their token
   - Restarts app

### Device Tokens per Machine:

Each laptop needs its own token. Admin creates tokens:

```bash
# Via API (admin user)
curl -X POST 'https://garage.quantumlab.codes/api/admin/devices' \
  -H 'Authorization: Bearer ADMIN_TOKEN' \
  -d '{"label":"Laptop-UserName"}'
```

Returns unique `deviceToken` for that laptop.

---

## 🔐 Security for Production

### Before Distribution:

1. **Change default passwords**:
   - Don't use `garage123` in production
   - Use strong passwords

2. **Secure device tokens**:
   - Each laptop gets unique token
   - Don't share tokens
   - Revoke tokens for lost laptops

3. **Database backups**:
   - VPS should have automated backups
   - See `deploy/backup/backup-garage-sqlite.sh`

4. **HTTPS only**:
   - VPS uses `https://garage.quantumlab.codes` ✅
   - Never use `http://` for remote sync

---

## 📖 Summary

### Development (Current):
```cmd
# Two terminals needed
Terminal 1: cd frontend && npm run dev
Terminal 2: npm run electron:dev
```

### Production (After Build):
```cmd
# One installer for everyone
dist\Hamdan Garage Manager Setup x.x.x.exe

# Users: Just double-click and install!
```

---

## ✅ Production Ready Checklist

Your app is production-ready when:

- [x] All users exist on VPS (garage, saadiyet, naji)
- [x] VPS sync working
- [x] Desktop shortcut created
- [ ] Frontend built: `npm run frontend:build`
- [ ] Windows installer created: `npm run electron:build`
- [ ] Installer tested on clean machine
- [ ] User documentation ready
- [ ] Device tokens created for each laptop
- [ ] Backup strategy in place

**Next step:** Run the build commands above! 🚀
