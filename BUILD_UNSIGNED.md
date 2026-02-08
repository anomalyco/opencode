# Building Unsigned Claxedo Apps

This guide explains how to build Claxedo locally without code signing certificates. Users will need to bypass macOS Gatekeeper manually.

## Prerequisites

- Bun installed
- Rust toolchain installed
- Dependencies installed: `bun install`

## Quick Build (Current Platform Only)

```bash
# From project root
./script/build-unsigned.ts
```

This will:

1. Apply Claxedo patches to OpenCode
2. Build the patched CLI
3. Build the Claxedo desktop app
4. Create distributable packages in `packages/desktop/src-tauri/target/release/bundle/`

## Platform-Specific Builds

### macOS (Current Platform)

```bash
cd packages/desktop
bun run tauri build --config src-tauri/tauri.claxedo.override.json
```

**Output files:**

- `src-tauri/target/release/bundle/dmg/Claxedo_*.dmg` - Drag-and-drop installer
- `src-tauri/target/release/bundle/macos/Claxedo.app` - Application bundle

### Windows (Cross-compile not supported)

Must build on Windows machine:

```bash
cd packages/desktop
bun run tauri build --config src-tauri/tauri.claxedo.override.json
```

### Linux

```bash
cd packages/desktop
bun run tauri build --config src-tauri/tauri.claxedo.override.json
```

**Output files:**

- `src-tauri/target/release/bundle/deb/*.deb` - Debian/Ubuntu
- `src-tauri/target/release/bundle/rpm/*.rpm` - Fedora/RHEL
- `src-tauri/target/release/bundle/appimage/*.AppImage` - Universal Linux

## Distribution Instructions

### For macOS Users

**Important:** Unsigned apps require a manual trust step:

1. Download the `.dmg` file
2. Open the DMG and drag Claxedo to Applications
3. **Do NOT double-click the app yet**
4. Open Finder → Applications folder
5. **Right-click** (or Control+click) on Claxedo.app
6. Select **"Open"** from the menu
7. Click **"Open"** in the dialog that appears
8. App will now run normally on future launches

**Alternative (Terminal):**

```bash
# Remove quarantine flag
xattr -d com.apple.quarantine /Applications/Claxedo.app
```

### For Windows Users

1. Download the `.exe` or `.msi` installer
2. When Windows SmartScreen appears:
   - Click **"More info"**
   - Click **"Run anyway"**
3. Complete installation normally

### For Linux Users

No special steps needed! Install as usual:

```bash
# Debian/Ubuntu
sudo dpkg -i claxedo_*.deb

# Fedora/RHEL
sudo rpm -i claxedo-*.rpm

# AppImage (no install needed)
chmod +x Claxedo-*.AppImage
./Claxedo-*.AppImage
```

## What's Different from Signed Builds?

| Feature         | Signed                     | Unsigned                          |
| --------------- | -------------------------- | --------------------------------- |
| macOS Install   | Double-click works         | Requires right-click → Open       |
| Windows Install | No warnings (with EV cert) | SmartScreen warning               |
| Linux Install   | Same                       | Same                              |
| Auto-updates    | ✅ Works                   | ✅ Works (with Tauri signing key) |
| Security        | Verified identity          | No verification                   |
| User Trust      | High                       | Requires manual trust             |

## Auto-Updates (Still Work!)

Tauri updater uses **different signing** than code signing:

- Uses `TAURI_SIGNING_PRIVATE_KEY` (not Apple certificates)
- Updates work even if app is unsigned
- Users still need to trust the initial install

## When to Switch to Signed Builds

Once you have Apple Developer certificates:

1. Add secrets to GitHub repository
2. Use the GitHub Actions workflow instead: `.github/workflows/release-claxedo.yml`
3. Builds will be notarized and won't require the right-click bypass

## Troubleshooting

### "Cannot be opened because developer cannot be verified"

- User needs to use right-click → Open (see instructions above)

### "App is damaged and can't be opened"

- Remove quarantine: `xattr -dr com.apple.quarantine /path/to/Claxedo.app`

### Build fails with "No signing identity"

- This is expected for unsigned builds - error can be ignored if app builds successfully
- To fully disable signing checks, set `TAURI_SKIP_SIGNING=1` environment variable
