# Shortcut: Run Garage Manager as a local website

## Linux

### 1. Make the start script executable (once)

```bash
chmod +x scripts/start-website.sh
```

### 2. Create a desktop shortcut

**Option A – Copy the included .desktop file**

1. Edit `garage-website.desktop` and change the path in `Exec=` to your project folder (replace `/home/mohamad-ghoush/Documents/QuantumLab/garage` with your path).
2. Copy it to your desktop:
   ```bash
   cp garage-website.desktop ~/Desktop/
   ```
3. Mark it as trusted (so it can be launched):
   ```bash
   chmod +x ~/Desktop/garage-website.desktop
   ```
   Or in the file manager: right‑click the file → Properties → Permissions → allow “Execute”.

**Option B – Create the shortcut by hand**

1. Create `~/Desktop/garage-website.desktop` with:

   ```ini
   [Desktop Entry]
   Type=Application
   Name=Hamdan Garage Manager (Website)
   Comment=Run Garage Manager as a local website in your browser
   Exec=gnome-terminal -- bash -c "cd /path/to/your/garage && ./scripts/start-website.sh; exec bash"
   Icon=web-browser
   Terminal=false
   Categories=Office;Network;
   ```

2. Replace `/path/to/your/garage` with the real path to your project (e.g. `/home/you/Documents/QuantumLab/garage`).
3. Make it executable: `chmod +x ~/Desktop/garage-website.desktop`.

Double‑click the shortcut: a terminal will open, the server will start, and the app will open in your browser at http://localhost:4000. Closing the terminal stops the server.

### 3. Run without a shortcut

From the project folder:

```bash
./scripts/start-website.sh
```

---

## Windows

1. Double‑click **`start-garage-website.bat`** in the project folder.
2. Or create a shortcut to `start-garage-website.bat`: right‑click the file → “Create shortcut”, then move the shortcut to the Desktop or Start menu.

The first run may take a bit while the frontend builds; the browser will open at http://localhost:4000. Close the command window to stop the server.
