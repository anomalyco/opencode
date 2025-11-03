# Quick Start Guide

## Prerequisites

1. **LiveKit Server**: Must be running locally on `ws://localhost:7880`
2. **Rust**: Required for Tauri (install from https://rustup.rs)
3. **Bun**: Package manager (already installed in project)

## Start the Player

### Development Mode

```bash
cd packages/livekit-player
bun run tauri:dev
```

This will:
1. Start Vite dev server on port 1420
2. Launch Tauri window with the player
3. Connect to LiveKit room "dev" at ws://localhost:7880

### What You Should See

- A draggable window with a colored orb
- Status text showing connection state:
  - **Orange "Connecting..."** → Establishing connection
  - **Green "Listening..."** → Ready for audio input
  - **Blue "Processing..."** → User speaking (mic active)
  - **Purple "Speaking..."** → Agent responding (audio playing)

## Architecture

```
┌─────────────────┐
│  LiveKit Player │
│   (This App)    │
│                 │
│  Mic Input ────→│
│  ←──── Audio Out│
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│  LiveKit Room   │
│     "dev"       │
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│  Agent Process  │
│  (VAD/STT/TTS)  │
└─────────────────┘
```

## Troubleshooting

**"Connecting..." forever?**
- Check LiveKit server is running on port 7880
- Verify .env file has correct `VITE_LIVEKIT_URL=ws://localhost:7880`

**No audio?**
- Check microphone permissions in system settings
- Verify speaker/headphone output is connected
- Check browser console for audio errors

**Window won't drag?**
- Dragging works on the background, not on the orb itself
- The orb area has `-webkit-app-region: no-drag` for future controls

## Configuration

Edit `.env` to change settings:

```env
VITE_LIVEKIT_URL=ws://localhost:7880
VITE_LIVEKIT_API_KEY=devkey
VITE_LIVEKIT_ROOM_NAME=dev
VITE_LIVEKIT_PARTICIPANT_NAME=player-user
```

## Production Build

```bash
bun run tauri:build
```

Builds platform-specific executable in `src-tauri/target/release/`
