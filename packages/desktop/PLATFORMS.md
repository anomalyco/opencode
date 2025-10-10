# Platform Support

OpenCode Desktop is a multi-platform application with different UI modes:

## 🖥️ macOS Desktop

- **UI**: Traditional desktop layout with resizable panes
- **Build**: `bun run build:macos`
- **Dev**: `bun run tauri:dev`
- **Output**: `.app` bundle and `.dmg` installer
- **Runs on**: Intel and Apple Silicon Macs

## 📱 iOS Mobile

- **UI**: Mobile-first layout with bottom navigation
- **Build**: `bun run build:ios`
- **Dev**: `bun run ios:dev`
- **Output**: `.ipa` package
- **Runs on**:
  - iPhone (iOS 14+)
  - iPad (iOS 14+)
  - **Apple Silicon Macs (M1/M2/M3/M4)** ✨

## 🌐 Web (Responsive)

- **UI**: Responsive - desktop layout on wide screens, mobile layout on narrow screens
- **Build**: `bun run build`
- **Dev**: `bun run dev`
- **Breakpoint**: 768px (mobile UI activates at < 768px width)
- **Runs on**: Any modern web browser

## Key Features by Platform

| Feature            | macOS Desktop | iOS            | Web          |
| ------------------ | ------------- | -------------- | ------------ |
| Resizable panes    | ✅            | ❌             | ✅           |
| Bottom navigation  | ❌            | ✅             | ✅ (< 768px) |
| Swipe gestures     | ❌            | ✅             | ✅ (< 768px) |
| Drawer menu        | ❌            | ✅             | ✅ (< 768px) |
| Keyboard shortcuts | ✅            | ⚠️ (limited)   | ✅           |
| Haptic feedback    | ❌            | ✅             | ❌           |
| File system access | ✅ (native)   | ⚠️ (sandboxed) | ⚠️ (limited) |

## iOS on Apple Silicon Macs

The iOS build runs natively on Apple Silicon Macs using "Designed for iPad" mode:

- Shows mobile UI (bottom nav, drawer, suggestion chips)
- Runs as native app (not browser-based)
- Installed from `.ipa` file
- Uses mobile-optimized layout and interactions
- Same binary as iPhone/iPad version

**To install on Mac:**

1. Build: `bun run build:ios`
2. Locate IPA: `src-tauri/gen/apple/build/arm64/Release-iphoneos/app_iOS.ipa`
3. Install via Finder or Apple Configurator
4. App appears in Launchpad/Applications

## Development Workflow

### Testing Mobile UI

1. **iOS Simulator**: Most accurate for iOS-specific features

   ```bash
   bun run ios:dev
   ```

2. **Browser (Responsive)**: Fastest for iteration

   ```bash
   bun dev
   # Resize window to < 768px
   ```

3. **Apple Silicon Mac**: Test final iOS build on Mac
   ```bash
   bun run build:ios
   # Install IPA on Mac
   ```

### Testing Desktop UI

1. **macOS Native**:

   ```bash
   bun run tauri:dev
   ```

2. **Browser (Wide)**:
   ```bash
   bun dev
   # Keep window > 768px
   ```

## Build Automation

Build all platforms at once:

```bash
./scripts/build-all.sh
```

Outputs:

- `src-tauri/target/release/bundle/macos/` - macOS desktop
- `src-tauri/target/release/bundle/dmg/` - macOS installer
- `src-tauri/gen/apple/build/arm64/Release-iphoneos/` - iOS app

## Mobile UI Components

The mobile UI includes these custom components:

- `MobileLayout` - Single-pane navigation with tabs
- `MobileNavigation` - Bottom tab bar (Files/Editor/Chat)
- `MobileHeader` - Top header with title and menu button
- `Drawer` - Slide-out settings drawer
- `SuggestionChips` - Context-aware prompt suggestions

Mobile detection is reactive and responds to window resizing in real-time.
