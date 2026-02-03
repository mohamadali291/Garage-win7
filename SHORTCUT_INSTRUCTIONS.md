# Creating a Desktop Shortcut for Garage App

## 🚀 Quick Method (Automatic)

### Step 1: Create the Shortcut
Double-click this file in Windows Explorer:
```
create-shortcut.vbs
```

This will create a **"Garage Manager"** icon on your desktop.

### Step 2: Use the Shortcut
Double-click the desktop icon to start the app!

---

## 📋 What the Shortcut Does

When you click the desktop icon:
1. ✅ Starts the frontend dev server (Vite)
2. ✅ Waits 10 seconds for it to be ready
3. ✅ Opens the Electron app window
4. ✅ Everything works automatically!

---

## 🛠️ Manual Method (If Automatic Doesn't Work)

### Create Shortcut Manually:

1. **Right-click on Desktop** → New → Shortcut

2. **Location**: Paste this (adjust path if needed):
   ```
   C:\garage\start-garage-app.bat
   ```

3. **Name**: 
   ```
   Garage Manager
   ```

4. **Click Finish**

5. **Right-click the shortcut** → Properties → Change Icon
   - Browse to: `C:\garage\build\icon.ico` (if you have one)

---

## 🎯 Alternative: Pin to Taskbar

### After creating the shortcut:

1. Right-click the desktop shortcut
2. Click **"Pin to taskbar"**
3. Now you can start from taskbar!

---

## 📂 Files Created

- `start-garage-app.bat` - The startup script
- `create-shortcut.vbs` - Creates desktop shortcut
- Desktop shortcut: `Garage Manager.lnk`

---

## ⚠️ First Time Setup

Before creating the shortcut, make sure:

1. ✅ You've run `npm install` once
2. ✅ Dependencies are installed (frontend and backend)
3. ✅ The app works when you run `npm run electron:dev`

---

## 🔧 Troubleshooting

### Shortcut doesn't work
- Make sure you ran `npm install` first
- Check the path in the shortcut points to your actual folder
- Try running `start-garage-app.bat` directly (double-click it)

### Frontend doesn't start
- Open the batch file and increase the wait time:
  - Change `timeout /t 10` to `timeout /t 20` (wait 20 seconds)

### Want to see what's happening
- Right-click the shortcut → Properties
- Remove `/min` from the frontend start line to see the window

---

## 🎨 Custom Icon (Optional)

To add a custom icon:

1. Get an `.ico` file (256x256 recommended)
2. Save it as `C:\garage\build\icon.ico`
3. Right-click shortcut → Properties → Change Icon
4. Browse to `C:\garage\build\icon.ico`

You can convert PNG to ICO using:
- https://www.img2go.com/convert-to-ico
- Or search "png to ico converter"

---

## 📝 Advanced: Start on Windows Boot

### To start automatically when Windows starts:

1. Press `Win + R`
2. Type: `shell:startup`
3. Press Enter
4. Copy your shortcut into this folder

Now the app starts automatically when you login to Windows!

---

## 🎉 You're Done!

Double-click the desktop icon and enjoy your one-click garage management app!

---

## Quick Reference

| Want to... | Do this... |
|-----------|-----------|
| Create desktop shortcut | Double-click `create-shortcut.vbs` |
| Start the app | Double-click desktop icon |
| Pin to taskbar | Right-click shortcut → Pin to taskbar |
| Auto-start on boot | Copy shortcut to Startup folder |
| Change icon | Right-click shortcut → Properties → Change Icon |

---

**Need Help?** Check `WINDOWS_SETUP.md` for more details.
