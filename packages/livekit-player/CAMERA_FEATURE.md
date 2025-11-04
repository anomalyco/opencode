# Camera Lens Reflection Feature

## Overview
Added a camera view that appears as a clipped, transparent, reversed (mirrored) fisheye lens reflection in the HAL 9000 eye area of the LiveKit player.

## Features

### Camera View
- **Mirrored/Reversed**: Video is horizontally flipped using `scaleX(-1)`
- **Fisheye Effect**: Circular clip-path creates a lens effect
- **Transparent**: 40% opacity blends with the audio visualizations
- **Clipped**: Only shows circular area (45% radius)
- **Positioned**: Centered over the HAL 9000 eye

### Keyboard Controls
- **Cmd+Shift+C** (Mac) / **Ctrl+Shift+C** (Windows): Toggle camera view on/off
- **Cmd+B**: Toggle HAL border (existing)
- **Cmd+Shift+B**: Toggle blob outline (existing)

### Technical Details

**Video Styling:**
```tsx
style={{
  transform: 'scaleX(-1)',           // Mirror horizontally
  filter: 'contrast(1.2) brightness(0.9)',  // Enhance contrast
  mixBlendMode: 'screen'              // Blend with background
}}
```

**Lens Container:**
```tsx
style={{
  clipPath: 'circle(45% at 50% 50%)',  // Circular clipping
  opacity: 0.4,                         // Transparency
  zIndex: 10                            // Above HAL but below UI
}}
```

**Fisheye Overlay:**
- Radial gradient creates glass lens reflection effect
- Transparent in center, white glow at edges

## Usage

1. Start the LiveKit player
2. Connect to a room
3. Camera will automatically activate (if permissions granted)
4. Toggle on/off with **Cmd+Shift+C**

## Storage
- Preference saved to `localStorage` as `"show-camera"`
- Defaults to `true` (shown)
- Persists across sessions

## Files Modified
- `packages/livekit-player/src/components/ChatIndicator.tsx`
  - Added `cameraVideoRef` and `showCamera` state
  - Added keyboard shortcut handler
  - Added camera setup useEffect
  - Added camera view JSX with fisheye effect

## Backup
Original file backed up to:
- `src/components/ChatIndicator.tsx.backup-camera`
