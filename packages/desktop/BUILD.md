# OpenCode Desktop - Build Guide

## Platform Overview

OpenCode Desktop can be built for three platforms:

1. **macOS Desktop** - Traditional macOS app with desktop UI
2. **iOS** - iPhone and iPad app with mobile UI
3. **iOS on Mac** - iOS app running natively on Apple Silicon Macs with mobile UI

## Prerequisites

- macOS with Xcode installed
- Rust and Cargo
- Bun package manager
- Tauri CLI with iOS support
- Apple Developer account (for iOS builds)

## Development

### macOS Desktop

```bash
bun run tauri:dev
# or
cargo tauri dev
```

### iOS Simulator

```bash
bun run ios:dev
# or
cargo tauri ios dev "iPhone 16 Pro"
```

### Web (responsive mobile)

```bash
bun dev
# Open http://localhost:3000 and resize window < 768px
```

## Building

### Build All Platforms

```bash
./scripts/build-all.sh
```

### Build Individual Platforms

#### macOS Desktop

```bash
bun run build:macos
# Creates: src-tauri/target/release/bundle/macos/OpenCode Desktop.app
# Creates: src-tauri/target/release/bundle/dmg/OpenCode Desktop_*.dmg
```

#### iOS (for iPhone, iPad, and Apple Silicon Macs)

```bash
bun run build:ios
# Creates: src-tauri/gen/apple/build/arm64/Release-iphoneos/app_iOS.ipa
```

#### iOS Simulator Build

```bash
bun run build:ios-sim
# Creates: src-tauri/gen/apple/build/arm64/Release-iphonesimulator/
```

## Outputs

### macOS Desktop

- **Location**: `src-tauri/target/release/bundle/macos/`
- **Format**: `.app` bundle and `.dmg` installer
- **UI**: Desktop layout with resizable panes
- **Runs on**: Intel and Apple Silicon Macs

### iOS App

- **Location**: `src-tauri/gen/apple/build/arm64/Release-iphoneos/`
- **Format**: `.ipa` package
- **UI**: Mobile layout with bottom navigation
- **Runs on**:
  - iPhone (iOS 14+)
  - iPad (iOS 14+)
  - Apple Silicon Macs (M1/M2/M3/M4) via "Designed for iPad"

## Configuration

### macOS Desktop

- Config: `src-tauri/tauri.conf.json`
- Bundle ID: `ai.opencode.desktop`

### iOS

- Config: `src-tauri/tauri.ios.conf.json` (overrides)
- Xcode Project: `src-tauri/gen/apple/app.xcodeproj`
- Bundle ID: `ai.opencode.desktop`
- Development Team: `SW75ZJJ5R6`

## Mac Catalyst / Designed for iPad

The iOS build is configured to run on Apple Silicon Macs via "Designed for iPad" mode:

- **SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD**: Enabled
- **UIDeviceFamily**: `[1, 2, 6]` (iPhone, iPad, Mac)
- **TARGETED_DEVICE_FAMILY**: `"1,2,6"`

This allows the iOS app to be installed and run natively on M1+ Macs while showing the mobile UI.

## Testing

### Test iOS app on Mac

1. Build iOS: `bun run build:ios`
2. Install the IPA on your Apple Silicon Mac
3. The app will run with the mobile UI (bottom navigation, drawer menu, etc.)

### Test responsive web version

1. Run: `bun dev`
2. Open browser to `http://localhost:3000`
3. Resize window to < 768px width
4. Mobile UI should activate automatically

## Distribution

### macOS Desktop

- Use the `.dmg` for distribution
- Can be signed and notarized for distribution outside App Store

### iOS

- Use `--export-method app-store-connect` for App Store
- Use `--export-method release-testing` for TestFlight
- The same build works on iPhone, iPad, and Mac

```bash
# Build for App Store
cargo tauri ios build --export-method app-store-connect
```
