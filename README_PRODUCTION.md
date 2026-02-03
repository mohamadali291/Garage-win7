# 🎉 Garage Management System - Production Ready!

## ✅ Everything You Need is Here

This repository is now **production-ready** for Windows deployment!

---

## 📦 What's Included

### ✅ Desktop Application (Electron)
- One-click startup with desktop shortcut
- Auto-starts backend and frontend
- No terminal commands needed
- Works on Windows, Mac, Linux

### ✅ VPS Sync System
- Central server: `https://garage.quantumlab.codes`
- Multi-laptop sync support
- Offline-capable with auto-sync
- Device token authentication

### ✅ Complete Documentation
All guides in repository root - see Quick Links below

### ✅ Production Users
| Username | Password | Role |
|----------|----------|------|
| garage | garage123 | Main Admin |
| saadiyet | saadiyet123 | Stock Manager |
| naji | naji123 | Viewer |

---

## 🚀 Quick Start

### For Windows Users:

```cmd
git pull
npm install
npm run electron:dev
```

Login with: `garage` / `garage123`

### Build Windows Installer:

```cmd
npm run electron:build
```

Creates: `dist\Hamdan Garage Manager Setup x.x.x.exe`

---

## 📚 Documentation (Quick Links)

### Essential Guides:
1. **[GETTING_STARTED.md](GETTING_STARTED.md)** - Start here! ⭐
2. **[WINDOWS_SETUP.md](WINDOWS_SETUP.md)** - Windows-specific guide
3. **[PRODUCTION_BUILD.md](PRODUCTION_BUILD.md)** - Build installer
4. **[SHORTCUT_INSTRUCTIONS.md](SHORTCUT_INSTRUCTIONS.md)** - Desktop shortcut

### Configuration:
5. **[SETUP_TOKEN.md](SETUP_TOKEN.md)** - VPS sync setup
6. **[VPS_ACCESS_GUIDE.md](VPS_ACCESS_GUIDE.md)** - Give access to users
7. **[USER_MANAGEMENT.md](USER_MANAGEMENT.md)** - Manage users

### Reference:
8. **[ELECTRON_README.md](ELECTRON_README.md)** - Technical details
9. **[SECURITY_VULNERABILITIES.md](SECURITY_VULNERABILITIES.md)** - npm warnings explained
10. **[README.md](README.md)** - Original project docs

---

## 🎯 Common Tasks

### Desktop Shortcut (One-Click Start)
```cmd
# Double-click this file in Windows:
create-shortcut.vbs

# Creates "Garage Manager" icon on desktop
```

### Reset All Users
```bash
# Local database:
bash scripts/reset-users-local.sh

# Creates: garage, saadiyet, naji
```

### Build for Distribution
```cmd
npm run electron:build
```

### Add VPS Sync
1. Get device token from admin
2. Create `backend\.env` with token
3. Restart app
4. Click "Sync now" button

---

## 📱 Multi-Machine Deployment

### For Each Windows Laptop:

**Step 1:** Install from .exe
```
Run: Hamdan Garage Manager Setup.exe
```

**Step 2:** Add device token (optional, for sync)
```
Create: backend\.env
Add: SYNC_DEVICE_TOKEN=xxx
```

**Step 3:** Launch and login
```
Desktop: Garage Manager icon
Login: garage / garage123
```

Done! ✅

---

## 🔧 Project Structure

```
garage/
├── electron-main.js              # Electron app entry
├── start-garage-app.bat          # Windows startup script
├── create-shortcut.vbs           # Desktop shortcut creator
│
├── backend/                      # Node.js API server
│   ├── src/server.js            # Backend entry point
│   ├── .env                     # Config (gitignored)
│   └── data/                    # SQLite database
│
├── frontend/                     # React UI
│   ├── src/                     # Source code
│   └── dist/                    # Built files
│
├── scripts/                      # Helper scripts
│   ├── electron-dev.sh          # Dev mode starter
│   ├── reset-users-local.sh     # Reset local users
│   └── reset-users.sh           # Reset VPS users
│
├── build/                        # App icons
│   ├── icon.png                 # Base icon
│   └── icon.ico                 # Windows icon
│
└── docs/                         # All documentation
    └── See Quick Links above
```

---

## ⚙️ Configuration Files

### Local Database (No Sync)
No `.env` needed! Just use the app.

### VPS Sync Enabled
`backend\.env`:
```env
SYNC_ROLE=client
SYNC_REMOTE_URL=https://garage.quantumlab.codes
SYNC_DEVICE_TOKEN=your_token_here
SYNC_INTERVAL_MS=300000
PORT=4000
```

---

## 🎨 Customization

### Change App Name
Edit `package.json`:
```json
"productName": "Your Company Garage"
```

### Custom Icon
Replace files in `build/`:
- `icon.png` (512x512)
- `icon.ico` (Windows)
- `icon.icns` (Mac)

### Change Default Port
Edit `backend\.env`:
```env
PORT=5000
```

---

## 🔐 Security

### Production Security Checklist:
- [x] HTTPS on VPS (Let's Encrypt)
- [x] Password hashing (SHA-256)
- [x] Session tokens for auth
- [x] Device tokens for sync
- [ ] Change default passwords
- [ ] Keep device tokens secure
- [ ] Regular database backups

### npm Security Warnings
See: [SECURITY_VULNERABILITIES.md](SECURITY_VULNERABILITIES.md)

**TL;DR:** Warnings are safe to ignore for internal desktop app.

---

## 📊 Build Information

### Sizes:
- **Installer:** ~150MB
- **Installed:** ~300MB
- **Database:** Grows with data (starts ~1MB)

### Build Time:
- **Frontend:** 1-2 minutes
- **Electron:** 5-10 minutes
- **Total:** ~10 minutes

### Requirements:
- Node.js v20+
- npm 10+
- Windows 10/11
- 500MB disk space

---

## 🚨 Troubleshooting

### Black Screen
**Cause:** Frontend not running  
**Fix:** Start frontend: `cd frontend && npm run dev`

### "NODE_ENV not recognized"
**Cause:** Missing cross-env  
**Fix:** `git pull && npm install`

### Port 4000 in use
**Fix:** Kill process: `netstat -ano | findstr :4000`

### No sync button
**Cause:** Missing `.env` or wrong SYNC_ROLE  
**Fix:** Create `backend\.env` with `SYNC_ROLE=client`

**See:** [WINDOWS_SETUP.md](WINDOWS_SETUP.md) for complete troubleshooting

---

## 🎓 Training Resources

### For Users:
1. Desktop shortcut usage
2. Login credentials
3. Basic app navigation
4. Data entry and editing
5. Excel import/export

### For Admins:
1. Building installer
2. Creating device tokens
3. Managing users
4. Troubleshooting sync
5. Database backups

**All guides in documentation folder!**

---

## 🔄 Update Strategy

### Releasing Updates:

1. **Update version:**
   ```json
   "version": "1.0.1"
   ```

2. **Rebuild:**
   ```cmd
   npm run electron:build
   ```

3. **Distribute:**
   - Send new .exe to users
   - Users reinstall
   - Data preserved automatically

---

## 📞 Support

### Documentation:
- Check guides in repository root
- All common issues covered

### Logs:
- Backend: Terminal output
- Frontend: Browser DevTools (F12)
- Electron: DevTools in app (F12)

### Database:
- Local: `backend\data\garage.sqlite`
- VPS: `/var/lib/garage/garage.sqlite`

---

## ✅ Production Ready Checklist

- [x] Electron desktop app working
- [x] Windows installer builder configured
- [x] Desktop shortcut creator
- [x] VPS sync functional
- [x] Users created (garage, saadiyet, naji)
- [x] Device tokens system
- [x] Complete documentation
- [x] Security vulnerabilities explained
- [x] User management tools
- [x] Windows-specific guides
- [x] Multi-machine deployment ready

---

## 🎯 Next Steps

### For Development:
```cmd
npm run electron:dev
```

### For Production:
```cmd
npm run electron:build
```

### For Distribution:
```
dist\Hamdan Garage Manager Setup x.x.x.exe
```

---

## 🎉 You're All Set!

Everything is ready for production deployment on Windows!

**Quick Commands:**
- Dev: `npm run electron:dev`
- Build: `npm run electron:build`
- Shortcut: `create-shortcut.vbs`

**Login:** `garage` / `garage123`

**Enjoy your production-ready garage management system!** 🚀

---

## 📝 Version History

- **v1.0.0** - Production ready
  - Electron desktop app
  - Windows installer
  - VPS sync
  - Complete documentation
  - User management
  - Security setup

---

**Repository:** https://github.com/mohamadali291/Hamdan.git  
**VPS:** https://garage.quantumlab.codes  
**License:** ISC  
**Author:** Hamdan EV Tronics
