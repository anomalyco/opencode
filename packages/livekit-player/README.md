# LiveKit Player

A standalone Tauri desktop app for visualizing and interacting with LiveKit voice agent rooms.

## Overview

This is a **standalone application** (separate from OpenCode/Codesurf) that provides a beautiful visual interface for LiveKit voice conversations. It acts as an audio conduit - the LiveKit agent handles all VAD, STT, TTS, and LLM processing while this player provides the visual representation.

## Features

✨ **Animated Blob Visualization**
- Organic SVG blob that morphs based on agent state
- Smooth color transitions
- Gooey filter effects for fluid appearance
- Background glow that pulses with activity

🎨 **State-Based Animations**
- **Listening** (Green): Gentle pulse, ready for input
- **Thinking** (Blue): Medium morph when user speaks
- **Speaking** (Purple): Active morph when agent responds
- **Connecting** (Yellow): Rotating animation
- **Disconnected** (Gray): Slow, faded animation

🔊 **Audio Conduit**
- Microphone input with echo cancellation, noise suppression, auto gain
- Audio output playback from agent
- Direct LiveKit room connection

📊 **Connection Info**
- Room name display
- Participant count
- Real-time connection quality (Excellent/Good/Poor/Lost)
- Lucide icons (no emojis)

## Tech Stack

- **Frontend**: React 18.3.1 + TypeScript
- **Desktop**: Tauri 1.7 (Rust-based)
- **Audio**: LiveKit Client SDK 2.15
- **Icons**: Lucide React
- **Styling**: Modern CSS with glassmorphism
- **Build**: Vite 7

## Installation

```bash
cd packages/livekit-player
bun install
```

## Development

Run the Vite dev server (fast reload, no Tauri rebuild needed):

```bash
bun run dev
```

Open browser at http://localhost:1420

## Development with Tauri

Run with Tauri window:

```bash
bun run tauri:dev
```

## Production Build

```bash
bun run tauri:build
```

Output: `src-tauri/target/release/`

## Configuration

Edit `.env` for local settings:

```env
VITE_LIVEKIT_URL=ws://localhost:7880
VITE_LIVEKIT_API_KEY=devkey
VITE_LIVEKIT_API_SECRET=secret
VITE_LIVEKIT_ROOM_NAME=dev
VITE_LIVEKIT_PARTICIPANT_NAME=player-user
```

## Architecture

```
┌─────────────────────┐
│  LiveKit Player     │
│  (Standalone App)   │
│                     │
│  Mic In → Room      │
│  Room → Speakers    │
│  Visual Feedback    │
└──────────┬──────────┘
           │
           ↓
┌─────────────────────┐
│  LiveKit Server     │
│  ws://localhost:7880│
└──────────┬──────────┘
           │
           ↓
┌─────────────────────┐
│  Voice Agent        │
│  (Python/Node)      │
│  VAD/STT/TTS/LLM    │
└─────────────────────┘
```

## Project Structure

```
livekit-player/
├── src/
│   ├── components/
│   │   ├── ChatIndicator.tsx      # Main visual component
│   │   ├── ChatIndicator.css      # Blob animations
│   │   └── ErrorBoundary.tsx      # Error handling
│   ├── utils/
│   │   ├── config.ts              # Environment config
│   │   └── token.ts               # JWT generation
│   ├── App.tsx                    # LiveKit connection
│   ├── main.tsx                   # React entry
│   └── index.css                  # Global styles
├── src-tauri/
│   ├── src/main.rs               # Tauri entry
│   ├── Cargo.toml                # Rust deps
│   ├── tauri.conf.json           # Tauri config
│   └── icons/                    # App icons
├── .env                          # Local config
└── package.json
```

## Best Practices Implemented

✅ **LiveKit Connection**
- JWT token generation (not exposing API secrets)
- Proper room connection with error handling
- Reconnection handling with UI feedback
- Graceful disconnect on window close
- Audio element cleanup

✅ **Error Handling**
- React ErrorBoundary
- Connection error display with retry
- Microphone permission handling
- Audio playback error handling

✅ **Performance**
- Pure CSS/SVG animations (no Three.js overhead)
- Efficient state updates (200ms intervals)
- Debounced audio level checks
- Smooth transitions with CSS

✅ **UI/UX**
- Modern SF Pro Display font stack
- Glassmorphism effects
- Lucide icons
- Responsive animations
- Always-on-top window
- Draggable window area

## Relationship to OpenCode

This is a **separate standalone app** within the monorepo:
- Does NOT depend on OpenCode/Codesurf
- Runs independently as its own Tauri application
- Can be built and distributed separately
- Shares the same LiveKit server with other apps

## Development Workflow

For fast iteration (recommended):
1. `bun run dev` - Hot reload in browser
2. Make changes to React components
3. See updates instantly

For Tauri testing:
1. `bun run tauri:dev` - Full desktop app
2. Test window features, always-on-top, etc.

## License

Part of OpenCode project
