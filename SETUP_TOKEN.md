# Setting Up Token for VPS Sync

## 🔑 Your Device Token

**Device Token for Windows Laptop:**
```
d1077fbaf0c3702d02d7348077c4c6686dd0d3403cb10b04
```

**Device ID:** `66b66747909067afd73ed3bd0ab1cfde`  
**Label:** Windows-Laptop-Main

---

## 📋 Do You Need This?

### ❌ NO Token Needed If:
- Using app locally only
- Don't need to sync with VPS
- All data stays on this laptop

### ✅ YES, Need Token If:
- Want to sync with VPS at `garage.quantumlab.codes`
- Need data to sync between laptops
- Want backup on central server

---

## 🔧 How to Add the Token

### Step 1: Create/Edit `.env` File

In `C:\garage\backend\` folder, create a file named `.env`

**Right-click** in the folder → New → Text Document  
Rename it to `.env` (remove the .txt extension)

### Step 2: Add This Content

Open `.env` in Notepad and paste:

```env
SYNC_ROLE=client
DB_PATH=./data/garage.sqlite
SYNC_REMOTE_URL=https://garage.quantumlab.codes
SYNC_DEVICE_TOKEN=d1077fbaf0c3702d02d7348077c4c6686dd0d3403cb10b04
SYNC_INTERVAL_MS=300000
CORS_ORIGIN=*
PORT=4000
```

### Step 3: Save and Restart

1. Save the file (Ctrl+S)
2. Close and restart the app
3. Done! ✅

---

## 🔐 About SSL/HTTPS Certificate

### ❌ NO Certificate Needed!

The VPS already has an SSL certificate (HTTPS):
- ✅ `https://garage.quantumlab.codes` uses Let's Encrypt
- ✅ Automatically trusted by Windows
- ✅ Nothing to install on your laptop

**You don't need to add any certificate manually!**

---

## 🎯 What Each Setting Means

| Setting | Value | What it does |
|---------|-------|--------------|
| `SYNC_ROLE` | `client` | This laptop syncs TO the server |
| `DB_PATH` | `./data/garage.sqlite` | Where local database is stored |
| `SYNC_REMOTE_URL` | `https://garage.quantumlab.codes` | VPS address |
| `SYNC_DEVICE_TOKEN` | Your token | Authentication for this laptop |
| `SYNC_INTERVAL_MS` | `300000` | Auto-sync every 5 minutes |
| `PORT` | `4000` | Local backend port |

---

## ✅ Testing the Sync

### Step 1: Start the App
```cmd
# Use your desktop shortcut OR:
npm run electron:dev
```

### Step 2: Login
Login with any user:
- `garage` / `garage123`
- `saadiyet` / `saadiyet123`
- `naji` / `naji123`

### Step 3: Check Sync Status
Look at the top bar in the app - you should see:
- **"Last sync:"** with a time
- **"Sync now"** button
- **Pending/Conflicts** counters

### Step 4: Test Manual Sync
Click the **"Sync now"** button!

If it works, you'll see the sync time update. ✅

---

## 🔄 How Sync Works

### Automatic Sync
- App syncs every 5 minutes automatically
- Only when internet is available
- Runs in background

### Manual Sync
- Click "Sync now" button anytime
- Forces immediate sync
- Shows progress

### Offline Mode
- App works offline completely
- Data stored locally
- Syncs when connection returns

---

## 🛡️ Security Notes

### Keep Your Token Safe!
- ✅ Don't share your device token
- ✅ Don't commit `.env` to git
- ✅ Each laptop should have unique token

### Token is Like a Password
- Identifies your laptop
- Grants sync permission
- Can be revoked if laptop is lost

---

## 🔧 Troubleshooting

### "Sync not configured" message
**Problem:** No `.env` file or wrong settings  
**Solution:** Create/check `backend\.env` with token

### "Invalid token" error
**Problem:** Token is wrong or revoked  
**Solution:** Request a new token from admin

### Sync shows errors
**Problem:** Internet connection or VPS is down  
**Solution:** Check internet, try manual sync

### No "Sync now" button
**Problem:** Running as server, not client  
**Solution:** Check `SYNC_ROLE=client` in `.env`

---

## 📱 Multiple Laptops

### Each Laptop Needs Its Own Token

If you have more laptops, request new tokens:

```bash
# Admin creates token for each laptop
curl -X POST 'https://garage.quantumlab.codes/api/admin/devices' \
  -H 'Authorization: Bearer ADMIN_TOKEN' \
  -d '{"label":"Laptop-2"}'
```

Each laptop gets:
- Unique device token
- Descriptive label
- Independent sync status

---

## 🎯 Quick Decision Guide

```
Do you want data to sync with VPS?
│
├─ YES → Add token to backend\.env (see Step 1-3 above)
│        Restart app, test sync
│
└─ NO  → Don't add anything
         App works locally, no sync
```

---

## 📝 Example: Complete .env File

```env
# Sync Configuration
SYNC_ROLE=client
SYNC_REMOTE_URL=https://garage.quantumlab.codes
SYNC_DEVICE_TOKEN=d1077fbaf0c3702d02d7348077c4c6686dd0d3403cb10b04
SYNC_INTERVAL_MS=300000

# Database
DB_PATH=./data/garage.sqlite

# Server
PORT=4000
CORS_ORIGIN=*
```

---

## ⚠️ Important Files

### DO commit to git:
- ✅ `backend\.env.example` (template)
- ✅ All code files

### DON'T commit to git:
- ❌ `backend\.env` (contains your real token)
- ❌ `backend\data\*.sqlite` (your database)

The `.gitignore` is already set up to protect these files.

---

## 🎉 Summary

### For Local Use Only:
- ❌ No token needed
- ❌ No certificate needed
- ✅ Just use the app!

### For VPS Sync:
- ✅ Add token to `backend\.env`
- ✅ Token provided above
- ❌ No certificate needed (VPS has it)
- ✅ Restart app and test sync

---

**Your Token (save this):**
```
d1077fbaf0c3702d02d7348077c4c6686dd0d3403cb10b04
```

**Questions?** Check `VPS_ACCESS_GUIDE.md` for more details.
