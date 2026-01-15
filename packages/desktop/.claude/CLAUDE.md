# OpenCode Desktop Package Guide

> **Package**: `packages/desktop`
> **Purpose**: Native desktop application
> **Framework**: Tauri v2
> **Frontend**: Wraps `packages/app`

## Overview

The desktop package provides a native application wrapper around the OpenCode web interface using Tauri. It offers:
- Native window controls
- System tray integration
- Auto-updates
- Deep system integration
- File system access
- Native notifications
- Global shortcuts
- Better performance than browser

## Directory Structure

```
packages/desktop/
├── scripts/
│   └── predev.ts          # Pre-development setup
├── src/
│   ├── main.tsx           # Frontend entry point
│   └── lib/               # Desktop-specific utilities
├── src-tauri/             # Rust backend
│   ├── src/
│   │   ├── main.rs        # Tauri app entry
│   │   └── lib.rs         # Rust library code
│   ├── tauri.conf.json    # Tauri configuration
│   ├── Cargo.toml         # Rust dependencies
│   └── icons/             # App icons
├── package.json
└── tsconfig.json
```

## Architecture

```
┌─────────────────────────────────────┐
│      Native Window (Tauri)          │
│  ┌───────────────────────────────┐  │
│  │   WebView (Chromium/WebKit)   │  │
│  │  ┌─────────────────────────┐  │  │
│  │  │   App (@opencode-ai/app) │  │  │
│  │  │   - SolidJS frontend     │  │  │
│  │  └─────────────────────────┘  │  │
│  └───────────────────────────────┘  │
│                                     │
│  Tauri Core (Rust)                  │
│  - IPC Bridge                       │
│  - System APIs                      │
│  - Plugin System                    │
└─────────────────────────────────────┘
```

## Key Features

### 1. Native Window

- Custom title bar
- Window controls (minimize, maximize, close)
- Frameless window support
- Window state persistence
- Multi-window support

### 2. System Integration

- Menu bar integration
- System tray icon
- Global shortcuts
- File associations
- URL scheme handling

### 3. File System

- Native file dialogs
- Direct file system access
- Better performance than browser
- No CORS restrictions

### 4. Native Features

- System notifications
- Auto-updates
- Process management
- Shell execution
- HTTP requests without CORS

## Tauri Configuration

### `src-tauri/tauri.conf.json`

```json
{
  "productName": "OpenCode",
  "identifier": "ai.opencode.desktop",
  "version": "1.1.19",
  "build": {
    "beforeBuildCommand": "bun run build",
    "beforeDevCommand": "bun run dev",
    "devUrl": "http://localhost:1420",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [{
      "title": "OpenCode",
      "width": 1200,
      "height": 800,
      "minWidth": 800,
      "minHeight": 600,
      "decorations": false,
      "transparent": true
    }]
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/icon.png"
    ]
  },
  "plugins": {
    "updater": {},
    "dialog": {},
    "shell": {},
    "notification": {},
    "store": {},
    "os": {}
  }
}
```

## Frontend Integration

### Main Entry (`src/main.tsx`)

```typescript
import { render } from 'solid-js/web'
import { App } from '@opencode-ai/app'
import { TauriProvider } from './lib/tauri'

render(() => (
  <TauriProvider>
    <App platform="desktop" />
  </TauriProvider>
), document.getElementById('root')!)
```

### Tauri API Usage

```typescript
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { sendNotification } from '@tauri-apps/plugin-notification'

// Invoke Rust command
const result = await invoke('my_command', { arg: 'value' })

// Open file dialog
const filePath = await open({
  multiple: false,
  directory: false
})

// Send notification
await sendNotification({
  title: 'OpenCode',
  body: 'Task completed!'
})
```

## Rust Backend

### Main Entry (`src-tauri/src/main.rs`)

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

#[tauri::command]
fn my_command(arg: String) -> String {
    format!("Received: {}", arg)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![my_command])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

## Tauri Plugins

### Built-in Plugins

- **dialog**: File/folder dialogs
- **shell**: Execute shell commands
- **notification**: System notifications
- **store**: Persistent key-value storage
- **updater**: Auto-update functionality
- **os**: OS information
- **process**: Process management
- **http**: HTTP requests
- **window-state**: Persist window state

### Using Plugins

```typescript
// Dialog
import { open, save } from '@tauri-apps/plugin-dialog'

const file = await open({
  filters: [{ name: 'TypeScript', extensions: ['ts', 'tsx'] }]
})

// Shell
import { Command } from '@tauri-apps/plugin-shell'

const output = await Command.create('git', ['status']).execute()

// Store
import { Store } from '@tauri-apps/plugin-store'

const store = new Store('.settings.dat')
await store.set('theme', 'dark')
const theme = await store.get('theme')

// Updater
import { check } from '@tauri-apps/plugin-updater'

const update = await check()
if (update?.available) {
  await update.downloadAndInstall()
}
```

## Window Management

### Window State

```typescript
import { getCurrentWindow } from '@tauri-apps/api/window'

const window = getCurrentWindow()

// Window controls
await window.minimize()
await window.maximize()
await window.close()

// Window state
const isFullscreen = await window.isFullscreen()
const isMaximized = await window.isMaximized()

// Window events
await window.onCloseRequested((event) => {
  // Prevent default close
  event.preventDefault()
  // Custom close logic
})
```

### Custom Title Bar

```tsx
import { getCurrentWindow } from '@tauri-apps/api/window'

function TitleBar() {
  const window = getCurrentWindow()

  return (
    <div data-tauri-drag-region class="titlebar">
      <div class="title">OpenCode</div>
      <div class="controls">
        <button onClick={() => window.minimize()}>−</button>
        <button onClick={() => window.toggleMaximize()}>□</button>
        <button onClick={() => window.close()}>×</button>
      </div>
    </div>
  )
}
```

## Development

### Running the App

```bash
# Development mode (opens native window)
bun run --cwd packages/desktop tauri dev

# Web-only dev server (no native window)
bun run --cwd packages/desktop dev

# Type checking
bun run --cwd packages/desktop typecheck
```

### Building

```bash
# Build the application
bun run --cwd packages/desktop tauri build

# Output locations:
# - macOS: src-tauri/target/release/bundle/macos/
# - Windows: src-tauri/target/release/bundle/msi/
# - Linux: src-tauri/target/release/bundle/deb|rpm|appimage/
```

### Build Artifacts

**macOS:**
- `.app` - Application bundle
- `.dmg` - Disk image installer

**Windows:**
- `.exe` - Executable
- `.msi` - Windows installer

**Linux:**
- `.deb` - Debian package
- `.rpm` - Red Hat package
- `.AppImage` - Universal Linux app

## Platform-Specific Features

### macOS

```typescript
import { platform } from '@tauri-apps/plugin-os'

if (await platform() === 'macos') {
  // macOS-specific code
  // - Touch Bar support
  // - Native menu bar
  // - Dock integration
}
```

### Windows

```typescript
if (await platform() === 'windows') {
  // Windows-specific code
  // - Taskbar integration
  // - Jump lists
  // - Windows notifications
}
```

### Linux

```typescript
if (await platform() === 'linux') {
  // Linux-specific code
  // - Desktop file integration
  // - System tray
}
```

## Configuration & Settings

### Persistent Storage

```typescript
import { Store } from '@tauri-apps/plugin-store'

const settings = new Store('settings.json')

// Save settings
await settings.set('opencode', {
  theme: 'dark',
  apiUrl: 'http://localhost:4096',
  autoUpdate: true
})

// Load settings
const config = await settings.get('opencode')

// Watch for changes
await settings.onChange((key, value) => {
  console.log(`Setting ${key} changed:`, value)
})
```

## Auto-Updates

### Update Configuration

```typescript
import { check, Update } from '@tauri-apps/plugin-updater'
import { ask } from '@tauri-apps/plugin-dialog'

async function checkForUpdates() {
  try {
    const update = await check()

    if (update?.available) {
      const yes = await ask(
        `Update to ${update.version} is available. Download now?`,
        { title: 'Update Available' }
      )

      if (yes) {
        await update.downloadAndInstall()
        // Restart app
        await relaunch()
      }
    }
  } catch (error) {
    console.error('Update check failed:', error)
  }
}
```

## Security

### Content Security Policy

```json
{
  "security": {
    "csp": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
  }
}
```

### Allowed APIs

Only expose necessary Tauri APIs:

```json
{
  "allowlist": {
    "all": false,
    "shell": {
      "open": true
    },
    "dialog": {
      "all": true
    }
  }
}
```

## Debugging

### DevTools

```typescript
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'

// Open DevTools
await getCurrentWebviewWindow().openDevTools()
```

### Rust Console

View Rust logs in terminal where you ran `tauri dev`.

## Testing

### Frontend Tests

```typescript
import { test, expect } from 'bun:test'
import { render } from '@solidjs/testing-library'

test('renders app', () => {
  const { container } = render(() => <App />)
  expect(container).toBeInTheDocument()
})
```

### Integration Tests

Use Tauri's built-in testing:

```rust
#[cfg(test)]
mod tests {
    use tauri::test::mock_builder;

    #[test]
    fn test_command() {
        let app = mock_builder().build();
        // Test Tauri commands
    }
}
```

## Distribution

### macOS

```bash
# Sign and notarize
export APPLE_CERTIFICATE="..."
export APPLE_CERTIFICATE_PASSWORD="..."
bun run --cwd packages/desktop tauri build

# Upload to App Store Connect (optional)
```

### Windows

```bash
# Sign with certificate
export TAURI_SIGNING_CERTIFICATE="..."
bun run --cwd packages/desktop tauri build

# Create installer
```

### Linux

```bash
# Build for multiple formats
bun run --cwd packages/desktop tauri build -- --target deb rpm appimage
```

## Common Tasks

### Adding a Custom Menu

```rust
use tauri::menu::{Menu, MenuItem};

let menu = Menu::new(app)?
    .add_item(MenuItem::new(app, "Quit", true, None)?)
    .build()?;
```

### Adding a System Tray

```rust
use tauri::tray::TrayIconBuilder;

TrayIconBuilder::new()
    .icon(app.default_window_icon().unwrap().clone())
    .build(app)?;
```

### Custom Protocol

```rust
use tauri::webview::WebviewBuilder;

WebviewBuilder::new("main", WebviewUrl::Custom("opencode://".into()))
    .build()?;
```

## Performance Tips

1. **Lazy Load**: Load heavy resources on demand
2. **Native Modules**: Use Rust for CPU-intensive tasks
3. **Caching**: Cache data in Store plugin
4. **Minimize IPC**: Reduce JavaScript-Rust calls
5. **Use Workers**: Offload work to web workers

## Troubleshooting

### Build Errors
- Check Rust toolchain is installed
- Update dependencies: `cargo update`
- Clear cache: `cargo clean`

### Runtime Errors
- Check DevTools console
- Review Rust console output
- Verify plugin configuration

### Performance Issues
- Profile with DevTools
- Check IPC overhead
- Optimize render cycles

## Related Documentation

- Root guide: `../../CLAUDE.md`
- App package: `../app/CLAUDE.md`
- Tauri docs: https://tauri.app/
- Rust docs: https://doc.rust-lang.org/

---

The desktop package provides native capabilities while reusing the web frontend. Understanding Tauri's architecture and the IPC bridge is key to working on desktop-specific features.
