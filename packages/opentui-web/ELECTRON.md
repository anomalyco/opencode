# Electron Desktop App for OpenTUI Web

OpenTUI Web now includes a complete Electron wrapper, allowing it to run as a standalone desktop application.

## ✅ Implementation Complete

All requirements have been implemented and tested:

### 1. ✅ Electron Dependencies Added

- `electron` v39.1.2
- `electron-builder` v25.1.8
- `concurrently` for running dev server and electron
- `cross-env` for cross-platform environment variables
- `wait-on` for waiting on dev server

### 2. ✅ Electron Main Process (`electron/main.ts`)

- Creates BrowserWindow with proper configuration (1200x800, minimum 800x600)
- **Transparent title bar** with native look (macOS: hiddenInset style, traffic light controls)
- Vibrancy effect for modern aesthetic (macOS)
- Platform-specific styling (macOS, Windows, Linux)
- Loads Vite dev server in development (`http://localhost:3001`)
- Loads built files in production (`dist/index.html`)
- Handles window lifecycle (close, minimize, maximize)
- Opens external links in system browser (not in Electron)
- Full application menu with keyboard shortcuts
- Platform-specific menu items (especially macOS)

### 3. ✅ Preload Script (`electron/preload.ts`)

- Secure context bridge implementation
- No direct Node.js access in renderer
- Whitelisted IPC channels for communication
- Platform detection API
- Type-safe TypeScript declarations
- Automatic body class injection for Electron-specific styling
- Platform-specific CSS support via data attributes

### 4. ✅ Package.json Updated

- `main` field points to `dist-electron/main.js`
- Scripts added:
  - `electron:build-ts` - Compile TypeScript electron code
  - `electron:dev` - Run dev server + electron with hot reload
  - `electron:build` - Build complete distributable packages
  - `electron:start` - Run production build locally
- Electron-builder configuration for macOS, Windows, Linux
- App metadata (name, ID, category)

### 5. ✅ Vite Config Updated

- `base: "./"` for relative paths (Electron compatibility)
- Maintains compatibility with web deployment
- All existing aliases and configurations preserved

### 6. ✅ Electron-Builder Config (in package.json)

- App ID: `ai.opencode.opentui`
- Product name: `OpenTUI`
- macOS: DMG and ZIP packages, Developer Tools category
- Windows: NSIS installer and portable EXE
- Linux: AppImage and DEB packages
- Output directory: `release/`

### 7. ✅ Testing Complete

- ✅ TypeScript compilation successful
- ✅ Production build loads correctly
- ✅ Electron window opens and displays app
- ✅ File structure correct (dist/ for web, dist-electron/ for electron code)

## File Structure

```
packages/opentui-web/
├── electron/
│   ├── main.ts          # Main process (window management, menus)
│   ├── preload.ts       # Preload script (secure IPC bridge)
│   ├── package.json     # ES module marker
│   └── tsconfig.json    # TypeScript config for electron
├── dist/                # Vite build output (web files)
├── dist-electron/       # Compiled electron code
├── release/             # Electron-builder output (installers)
└── package.json         # Updated with electron scripts
```

## Usage

### Development Mode (with Hot Reload)

```bash
bun run electron:dev
```

This starts:

1. Vite dev server on port 3001
2. Compiles Electron TypeScript
3. Launches Electron with DevTools open
4. Hot reload works for renderer process

### Production Build

```bash
bun run electron:build
```

Creates platform-specific installers in `release/`:

- **macOS**: `.dmg` and `.zip`
- **Windows**: `.exe` installer and portable
- **Linux**: `.AppImage` and `.deb`

### Test Production Build (without packaging)

```bash
bun run electron:start
```

## Keyboard Shortcuts

- **Cmd/Ctrl+N**: New session (can be wired to app)
- **Cmd/Ctrl+Q**: Quit application
- **Cmd/Ctrl+R**: Reload
- **Cmd/Ctrl+Shift+R**: Force reload
- **Cmd/Ctrl+Alt+I**: Toggle DevTools
- **Cmd/Ctrl+Plus/Minus**: Zoom in/out
- **Cmd/Ctrl+0**: Reset zoom

## Security Features

- ✅ Context isolation enabled
- ✅ Node integration disabled in renderer
- ✅ Sandbox enabled
- ✅ Secure IPC through whitelisted channels
- ✅ External links open in system browser

## Platform Support

- ✅ macOS (tested)
- ✅ Windows (configured)
- ✅ Linux (configured)

## Notes

- The web version is unchanged and still works normally
- Both web and desktop can coexist
- Uses relative paths (`base: "./"`) for compatibility
- Electron code is separate from web code (clean architecture)
- Modern Electron best practices implemented

## Customization

### Transparent Title Bar

The app features a modern transparent title bar:

**macOS:**

- `titleBarStyle: "hiddenInset"` - Native transparent title bar
- Traffic light controls positioned at (16, 16)
- `vibrancy: "under-window"` - Subtle blur effect
- Content area is draggable at the top (via CSS `-webkit-app-region: drag`)

**Windows:**

- Custom frameless window (`frame: false`)
- Transparent background support

**Linux:**

- Standard frame (can be customized if needed)

To adjust the title bar, modify `electron/main.ts`:

```typescript
mainWindow = new BrowserWindow({
  titleBarStyle: "hiddenInset", // or "hidden", "default"
  trafficLightPosition: { x: 16, y: 16 }, // Adjust position
  vibrancy: "under-window", // or other vibrancy types
  // ...
})
```

### Window Configuration

Customize window size and behavior in `electron/main.ts`:

```typescript
mainWindow = new BrowserWindow({
  width: 1200,
  height: 800,
  minWidth: 800,
  minHeight: 600,
  // ... other options
})
```

### Application Menu

Modify the menu in the `createMenu()` function in `electron/main.ts`.

### Build Configuration

Customize the build in `package.json` under the `build` key.

## Next Steps (Optional)

If you want to add custom features:

1. **Custom IPC**: Add channels in `electron/preload.ts` and handlers in `electron/main.ts`
2. **Native Menus**: Customize menu in `createMenu()` function
3. **App Icons**: Add icons and configure in electron-builder config
4. **Code Signing**: Add signing certificates for distribution
5. **Auto Updates**: Integrate electron-updater for automatic updates

## Troubleshooting

If Electron binary doesn't download:

```bash
cd packages/opentui-web
node node_modules/electron/install.js
```

If you see certificate warnings on macOS, these are normal and don't affect functionality.
