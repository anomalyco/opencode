import { app, BrowserWindow, Menu, shell } from "electron"
import * as path from "path"

const isDev = process.env.NODE_ENV === "development"
const VITE_DEV_SERVER_URL = "http://localhost:3001"

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    title: "OpenTUI",
    backgroundColor: "#1a1a1a",
    show: false, // Show after ready-to-show to prevent flicker
    titleBarStyle: "hidden", // macOS: completely hidden title bar, only traffic lights visible
    trafficLightPosition: { x: 20, y: 22 }, // Position of macOS window controls
    transparent: false, // Keep window opaque for performance
    ...(process.platform === "win32" && {
      // Windows: custom title bar
      frame: false,
      backgroundColor: "#00000000",
    }),
  })

  // Show window when ready
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show()
  })

  // Load the app
  if (isDev) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"))
  }

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })

  mainWindow.on("closed", () => {
    mainWindow = null
  })

  // Create application menu
  createMenu()
}

function createMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        {
          label: "New Session",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            mainWindow?.webContents.send("new-session")
          },
        },
        { type: "separator" },
        {
          label: "Quit",
          accelerator: "CmdOrCtrl+Q",
          click: () => {
            app.quit()
          },
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "close" }],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Learn More",
          click: async () => {
            await shell.openExternal("https://opencode.ai")
          },
        },
        {
          label: "Documentation",
          click: async () => {
            await shell.openExternal("https://opencode.ai/docs")
          },
        },
      ],
    },
  ]

  // Add macOS-specific menu items
  if (process.platform === "darwin") {
    template.unshift({
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    })

    // Window menu for macOS
    template[4].submenu = [
      { role: "minimize" },
      { role: "zoom" },
      { type: "separator" },
      { role: "front" },
      { type: "separator" },
      { role: "window" },
    ]
  }

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// App lifecycle
app.whenReady().then(() => {
  createWindow()

  app.on("activate", () => {
    // On macOS, re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// Quit when all windows are closed (except on macOS)
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})

// Handle IPC messages from renderer
// Example: Listen for custom events
// ipcMain.on('some-event', (event, arg) => {
//   console.log('Received event:', arg)
// })
