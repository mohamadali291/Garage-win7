const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

// Provide userData path to preload (sync)
ipcMain.on("getUserDataPath", (event) => {
  event.returnValue = app.getPath("userData");
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "renderer_with_roles.js"),
      contextIsolation: true,   // keep this
      nodeIntegration: false,   // keep this
      sandbox: false            // 🔥 ADD THIS LINE
    }
  });

  win.loadFile("index_with_roles.html");

  // Optional while debugging:
  // win.webContents.openDevTools();
}

app.whenReady().then(createWindow);