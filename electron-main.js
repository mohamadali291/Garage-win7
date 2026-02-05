require("dotenv").config();
const { app, BrowserWindow, Tray, Menu, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const appIconPath = (() => {
  const buildDir = path.join(__dirname, "build");
  const icoPath = path.join(buildDir, "icon.ico");
  const pngPath = path.join(buildDir, "icon.png");

  if (process.platform === "win32" && fs.existsSync(icoPath)) {
    return icoPath;
  }
  if (fs.existsSync(pngPath)) {
    return pngPath;
  }
  if (fs.existsSync(icoPath)) {
    return icoPath;
  }
  return null;
})();

let mainWindow = null;
let backendProcess = null;
let tray = null;
const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

// When packaged: backend is in resources/ (extraResources), frontend is in app.asar (files)
const backendRoot = isDev ? __dirname : process.resourcesPath;
const frontendRoot = isDev ? __dirname : path.join(process.resourcesPath, "app.asar");

// Backend configuration
const BACKEND_PORT = process.env.PORT || 4000;
const BACKEND_SCRIPT = path.join(backendRoot, "backend", "src", "server.js");

// Frontend configuration
const FRONTEND_URL = isDev ? "http://localhost:5173" : `file://${path.join(frontendRoot, "frontend", "dist", "index.html")}`;

// Database path configuration
const DB_DIR = path.join(app.getPath("userData"), "data");
const DB_PATH = path.join(DB_DIR, "garage.sqlite");

console.log("[Electron] App starting...");
console.log("[Electron] isDev:", isDev);
console.log("[Electron] backendRoot:", backendRoot);
console.log("[Electron] frontendRoot:", frontendRoot);
console.log("[Electron] Backend script:", BACKEND_SCRIPT);
console.log("[Electron] Frontend URL:", FRONTEND_URL);
console.log("[Electron] Database path:", DB_PATH);

// Ensure database directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
  console.log("[Electron] Created database directory:", DB_DIR);
}

// Start the Node.js backend server
function startBackend() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(BACKEND_SCRIPT)) {
      reject(new Error(`Backend script not found: ${BACKEND_SCRIPT}`));
      return;
    }

    console.log("[Backend] Starting backend server...");

    const backendDir = path.join(backendRoot, "backend");

    // When packaged, run backend in-process (no system Node.js required).
    // When in dev, spawn a separate process so logs and restarts are independent.
    if (app.isPackaged) {
      try {
        process.env.PORT = BACKEND_PORT.toString();
        process.env.DB_PATH = DB_PATH;
        process.env.NODE_ENV = "production";
        process.chdir(backendDir);
        const dotenv = require("dotenv");
        dotenv.config({ path: path.join(backendDir, ".env") });
        const backendNodeModules = path.join(backendDir, "node_modules");
        const Module = require("module");
        Module.globalPaths.unshift(backendNodeModules);
        const backendDirSlash = backendDir + path.sep;
        const originalResolve = Module._resolveFilename;
        Module._resolveFilename = function (request, parent, isMain, options) {
          if (parent && parent.filename && (parent.filename === BACKEND_SCRIPT || parent.filename.startsWith(backendDirSlash))) {
            try {
              const backendPaths = [backendNodeModules].concat(Module._nodeModulePaths(backendDir));
              const fakeParent = { paths: backendPaths };
              return originalResolve.call(this, request, fakeParent, isMain, options);
            } catch (_) {}
          }
          return originalResolve.call(this, request, parent, isMain, options);
        };
        require(BACKEND_SCRIPT);
      } catch (err) {
        console.error("[Backend] In-process start failed:", err);
        reject(err);
        return;
      }
    } else {
      const env = {
        ...process.env,
        PORT: BACKEND_PORT.toString(),
        DB_PATH: DB_PATH,
        NODE_ENV: isDev ? "development" : "production"
      };
      backendProcess = spawn("node", [BACKEND_SCRIPT], {
        cwd: backendDir,
        env: env,
        stdio: ["ignore", "pipe", "pipe"]
      });
      backendProcess.stdout.on("data", (data) => {
        console.log(`[Backend] ${data.toString().trim()}`);
      });
      backendProcess.stderr.on("data", (data) => {
        console.error(`[Backend Error] ${data.toString().trim()}`);
      });
      backendProcess.on("error", (error) => {
        console.error("[Backend] Failed to start:", error);
        reject(error);
      });
      backendProcess.on("exit", (code, signal) => {
        console.log(`[Backend] Process exited with code ${code} and signal ${signal}`);
        backendProcess = null;
      });
    }

    // Wait for backend to be ready
    const checkBackend = setInterval(() => {
      const http = require("http");
      const req = http.get(`http://localhost:${BACKEND_PORT}/api/health`, (res) => {
        if (res.statusCode === 200) {
          clearInterval(checkBackend);
          console.log("[Backend] Server is ready!");
          resolve();
        }
      });
      req.on("error", () => {
        // Still waiting for backend to start
      });
      req.end();
    }, 500);

    // Timeout after 30 seconds
    setTimeout(() => {
      clearInterval(checkBackend);
      reject(new Error("Backend failed to start within 30 seconds"));
    }, 30000);
  });
}

// Stop the backend server
function stopBackend() {
  if (backendProcess) {
    console.log("[Backend] Stopping backend server...");
    backendProcess.kill();
    backendProcess = null;
  }
}

// Create the main application window
function createWindow() {
  const windowOptions = {
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    },
    show: false
  };

  if (appIconPath) {
    windowOptions.icon = appIconPath;
  }

  mainWindow = new BrowserWindow(windowOptions);

  // Load the frontend
  if (isDev) {
    mainWindow.loadURL(FRONTEND_URL);
    // Open DevTools in development mode
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(frontendRoot, "frontend", "dist", "index.html"));
  }

  // Show window when ready
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  // Handle window closed
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Inject Electron detection flag
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.executeJavaScript(`
      window.isElectron = true;
      window.electronAPI = {
        platform: '${process.platform}'
      };
    `);
  });
}

// Create system tray icon
function createTray() {
  // Only create tray if icon exists
  if (appIconPath) {
    tray = new Tray(appIconPath);
    
    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Show App",
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          } else {
            createWindow();
          }
        }
      },
      {
        label: "Quit",
        click: () => {
          app.quit();
        }
      }
    ]);

    tray.setToolTip("Hamdan Garage Manager");
    tray.setContextMenu(contextMenu);

    tray.on("click", () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      } else {
        createWindow();
      }
    });
  }
}

// App lifecycle handlers
app.on("ready", async () => {
  try {
    console.log("[Electron] App ready, starting backend...");
    await startBackend();
    console.log("[Electron] Backend started, creating window...");
    createWindow();
    createTray();
  } catch (error) {
    console.error("[Electron] Failed to start app:", error);
    const msg = error && error.message ? error.message : String(error);
    dialog.showErrorBox("Hamdan Garage Manager", "Failed to start: " + msg);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  // On macOS, keep app running when all windows are closed
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On macOS, re-create window when dock icon is clicked
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", () => {
  stopBackend();
});

app.on("will-quit", () => {
  stopBackend();
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("[Electron] Uncaught exception:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("[Electron] Unhandled rejection:", error);
});
