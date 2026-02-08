# How to Install Unsigned Claxedo

This app is currently distributed unsigned while we await Apple Developer Program approval. This means you need to manually trust the app on first launch.

## macOS Installation

### Method 1: Right-Click Open (Recommended)

1. Download `Claxedo.dmg`
2. Open the DMG file and drag Claxedo to Applications
3. **Important:** Don't double-click the app yet!
4. Open Finder → Applications
5. Find Claxedo.app
6. **Right-click** (or Control+click) on Claxedo.app
7. Select **"Open"** from the menu
8. Click **"Open"** in the security dialog
9. The app will now launch normally on future opens

### Method 2: Terminal Command

```bash
# Remove the quarantine flag
xattr -d com.apple.quarantine /Applications/Claxedo.app
```

Then double-click to open normally.

### Troubleshooting macOS

**Error: "App is damaged"**

```bash
xattr -dr com.apple.quarantine /Applications/Claxedo.app
```

**Error: "Cannot verify developer"**

- You must use right-click → Open, double-clicking won't work

## Windows Installation

1. Download the `.exe` or `.msi` installer
2. When Windows SmartScreen appears:
   - Click **"More info"**
   - Click **"Run anyway"**
3. Complete the installation
4. Future launches won't show the warning

## Linux Installation

No special steps needed! Install normally:

### Debian/Ubuntu

```bash
sudo dpkg -i claxedo_*.deb
```

### Fedora/RHEL

```bash
sudo rpm -i claxedo-*.rpm
```

### AppImage

```bash
chmod +x Claxedo-*.AppImage
./Claxedo-*.AppImage
```

## Why These Steps?

This app is unsigned because:

- We're waiting for Apple Developer Program approval
- Code signing certificates are expensive ($99-400/year)
- This is a beta/development release

**Signed releases coming soon!** Once we have certificates, future updates will install without these warnings.

## Is It Safe?

Yes! The source code is available at [your-repo-url]. These security warnings appear because we haven't paid for code signing certificates yet, not because the app is unsafe.

If you're concerned, you can:

1. Review the source code
2. Build the app yourself from source
3. Wait for official signed releases

## Auto-Updates

Auto-updates will still work even though the initial install is unsigned. The updater uses different signing (Tauri signing keys) that doesn't require expensive certificates.
