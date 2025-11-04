# How to See the Camera View

## Quick Start
1. **Start the app**: `npm run dev`
2. **Connect to LiveKit room** (camera will auto-start)
3. **Look for the circular camera view** in the center of the HAL 9000 eye (agent audio visualization)

## Camera Features
- **Mirrored**: Video is horizontally flipped
- **Circular clipping**: 45% radius circle
- **70% opacity**: Transparent overlay
- **White border**: 3px rgba(255,255,255,0.3) border for visibility
- **Positioned**: Centered in the blob visualization

## Toggle Camera
- Press **Cmd+Shift+C** (Mac) or **Ctrl+Shift+C** (Windows) to toggle on/off
- Watch console for `[Camera]` debug messages

## Debugging
Open browser console and look for:
```
[Camera] useEffect triggered - showCamera: true connectionState: connected
[Camera] Requesting camera access...
[Camera] Got access
```

## If You Don't See It

### Check Console
1. Open DevTools Console (F12)
2. Look for `[Camera]` messages
3. Check for permission errors

### Check localStorage
In console, run:
```javascript
localStorage.getItem('show-camera')  // Should return "true"
```

### Force Enable
In console, run:
```javascript
localStorage.setItem('show-camera', 'true')
// Then refresh page
```

### Check Camera Permissions
- Browser should prompt for camera access
- Make sure you clicked "Allow"
- Check browser settings: chrome://settings/content/camera

### Verify Connection
- Camera only shows when `ConnectionState.Connected`
- Make sure you're connected to a LiveKit room

## Camera Location
The camera appears as a **circular lens** overlaid on:
- **Agent Audio Visualization** (purple blob)
- **HAL 9000 Eye** area
- Center of the screen

## Visual Appearance
```
┌─────────────────────────────┐
│                             │
│     [Purple Blob Area]      │
│                             │
│    ┌───────────────┐        │
│    │   ╭───────╮   │        │
│    │  │ CAMERA │  │  ← Camera here!
│    │   ╰───────╯   │        │
│    └───────────────┘        │
│                             │
└─────────────────────────────┘
```

The camera is a **280x280px circular view** with:
- Mirrored video
- Fish-eye radial gradient overlay
- White glowing border

## Still Not Seeing It?

1. **Check if video element exists**:
```javascript
document.querySelector('video')
```

2. **Check showCamera state** in React DevTools

3. **Try toggling** with Cmd+Shift+C multiple times

4. **Check z-index** - it's set to 10, should be above blobs

5. **Look for the white border** - it should stand out against the purple

