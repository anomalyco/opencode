import { app, BrowserWindow, Menu } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow = null
let isChromeless = true
let isTransparent = true
let showHalBorder = true
let showBlobOutline = true
let showGlow = true

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 500,
    transparent: isTransparent,
    frame: !isChromeless,
    alwaysOnTop: true,
    resizable: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:1420')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  if (process.platform === 'darwin') {
    mainWindow.setWindowButtonVisibility(!isChromeless)
  }

  createMenu()
}

function recreateWindow() {
  const bounds = mainWindow.getBounds()
  const url = mainWindow.webContents.getURL()
  
  mainWindow.close()
  
  mainWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    transparent: isTransparent,
    frame: !isChromeless,
    alwaysOnTop: true,
    resizable: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  })
  
  mainWindow.loadURL(url)
  
  if (process.platform === 'darwin') {
    mainWindow.setWindowButtonVisibility(!isChromeless)
  }
  
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools()
  }
  
  createMenu()
}

function createMenu() {
  const template = [
    {
      label: 'View',
      submenu: [
        {
          label: 'Always on Top',
          type: 'checkbox',
          checked: true,
          accelerator: 'CmdOrCtrl+T',
          click: (menuItem) => {
            if (mainWindow) {
              mainWindow.setAlwaysOnTop(menuItem.checked)
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Chromeless Window',
          type: 'checkbox',
          checked: isChromeless,
          accelerator: 'CmdOrCtrl+Shift+C',
          click: (menuItem) => {
            isChromeless = menuItem.checked
            recreateWindow()
          }
        },
        {
          label: 'Transparent Background',
          type: 'checkbox',
          checked: isTransparent,
          accelerator: 'CmdOrCtrl+Shift+T',
          click: (menuItem) => {
            isTransparent = menuItem.checked
            recreateWindow()
          }
        },
        { type: 'separator' },
        {
          label: 'Show HAL Border',
          type: 'checkbox',
          checked: showHalBorder,
          accelerator: 'CmdOrCtrl+B',
          click: (menuItem) => {
            showHalBorder = menuItem.checked
            if (mainWindow) {
              mainWindow.webContents.executeJavaScript(`
                localStorage.setItem('hal-show-border', '${showHalBorder}');
                window.location.reload();
              `)
            }
          }
        },
        {
          label: 'Show Blob Outline',
          type: 'checkbox',
          checked: showBlobOutline,
          accelerator: 'CmdOrCtrl+Shift+B',
          click: (menuItem) => {
            showBlobOutline = menuItem.checked
            if (mainWindow) {
              mainWindow.webContents.executeJavaScript(`
                localStorage.setItem('blob-show-outline', '${showBlobOutline}');
                window.location.reload();
              `)
            }
          }
        },
        {
          label: 'Show Glow',
          type: 'checkbox',
          checked: showGlow,
          accelerator: 'CmdOrCtrl+G',
          click: (menuItem) => {
            showGlow = menuItem.checked
            if (mainWindow) {
              mainWindow.webContents.executeJavaScript(`
                localStorage.setItem('show-glow', '${showGlow}');
                window.location.reload();
              `)
            }
          }
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
