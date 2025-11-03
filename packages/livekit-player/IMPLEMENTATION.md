# LiveKit Player Implementation

A Tauri-wrapped React application that serves as an audio conduit for LiveKit rooms with real-time visual feedback.

## What Was Built

### Core Features

1. **Audio Conduit**
   - Microphone input capture with echo cancellation, noise suppression, and auto gain
   - Room audio output playback
   - Direct connection to LiveKit room (agent handles VAD/STT/TTS)

2. **Visual Interface**
   - ChatGPT-style status indicator with animated orb
   - Real-time state visualization (disconnected, connecting, listening, thinking, speaking)
   - Animated waveform during agent speech
   - Connection info display (room name, participant count)

3. **Tauri Desktop App**
   - Draggable window with always-on-top capability
   - 400x500px compact interface
   - Cross-platform support (macOS, Windows, Linux)

## Project Structure

```
livekit-player/
├── src/
│   ├── components/
│   │   ├── ChatIndicator.tsx       # Main visual component
│   │   └── ChatIndicator.css       # Animations and styling
│   ├── utils/
│   │   └── config.ts               # Environment configuration
│   ├── App.tsx                     # LiveKit room connection
│   ├── main.tsx                    # React entry point
│   └── index.css                   # Global styles
├── src-tauri/
│   ├── src/
│   │   └── main.rs                 # Tauri Rust entry point
│   ├── Cargo.toml                  # Rust dependencies
│   └── tauri.conf.json             # Tauri configuration
├── .env                            # Environment variables
├── package.json                    # Node dependencies
├── vite.config.ts                  # Vite bundler config
├── README.md                       # Full documentation
├── QUICKSTART.md                   # Quick start guide
└── IMPLEMENTATION.md               # This file
```

## Architecture

### Data Flow

```
User Speaks → Microphone → LiveKit Room → Agent (VAD/STT/LLM/TTS)
                                ↓
                          Audio Output → Speakers
                                ↓
                          Visual Update → UI State
```

### State Management

The player tracks 5 agent states:

- **disconnected** (gray): Not connected to room
- **connecting** (orange): Establishing connection
- **listening** (green): Agent ready, waiting for input
- **thinking** (blue): User speaking, agent processing
- **speaking** (purple): Agent responding with audio

State detection:
- Uses LiveKit's `ConnectionState` for connection status
- Monitors `isSpeaking` on local participant (user) and remote participants (agent)
- Updates UI at 100ms intervals for smooth transitions

### Audio Configuration

```typescript
audioCaptureDefaults: {
  echoCancellation: true,    // Prevent feedback
  noiseSuppression: true,    // Clean audio
  autoGainControl: true      // Normalize volume
}
```

## Environment Configuration

The player reads from `.env`:

```env
VITE_LIVEKIT_URL=ws://localhost:7880              # LiveKit server URL
VITE_LIVEKIT_API_KEY=devkey                       # API key (local dev)
VITE_LIVEKIT_ROOM_NAME=dev                        # Room to join
VITE_LIVEKIT_PARTICIPANT_NAME=player-user         # Participant identity
```

**Security Note**: In production, use a token server instead of exposing API keys to the browser.

## Technologies Used

### Frontend
- **React 19**: UI framework
- **TypeScript 5**: Type safety
- **Vite 7**: Build tool and dev server
- **LiveKit Client 2.15**: WebRTC audio/video SDK
- **@livekit/components-react 2.9**: React hooks and components

### Desktop
- **Tauri 1.7**: Rust-based desktop framework
- **Rust**: System-level integration

## Key Files Explained

### `App.tsx`
- Initializes LiveKit room connection
- Handles connection errors
- Passes room context to child components
- Configures audio capture settings

### `ChatIndicator.tsx`
- Uses LiveKit React hooks (`useRoomContext`, `useRemoteParticipants`, `useLocalParticipant`)
- Monitors speaking state changes
- Animates visual indicators based on state
- Displays connection metadata

### `tauri.conf.json`
- Window configuration (size, decorations, always-on-top)
- Build settings (dev server, output directory)
- Security settings (permissions, CSP)

## Usage

### Development
```bash
cd packages/livekit-player
bun run tauri:dev
```

### Production Build
```bash
bun run tauri:build
```

Output: `src-tauri/target/release/` (platform-specific executable)

## Next Steps / Enhancements

Potential improvements:

1. **Token Server**: Implement proper token generation instead of using API key directly
2. **Settings Panel**: Add UI for changing rooms, adjusting audio levels
3. **Keyboard Shortcuts**: Push-to-talk, mute toggle
4. **Visual Customization**: Themes, color schemes
5. **System Tray**: Minimize to tray, quick access menu
6. **Recording**: Save conversation audio locally
7. **Transcription Display**: Show real-time text of conversation
8. **Agent Selection**: Switch between different agents/models

## Testing Checklist

- [ ] Window launches and is draggable
- [ ] Connects to LiveKit room successfully
- [ ] Microphone captures audio (check system permissions)
- [ ] Audio output plays from room
- [ ] Status changes to "listening" when connected
- [ ] Status changes to "thinking" when user speaks
- [ ] Status changes to "speaking" when agent responds
- [ ] Waveform animates during agent speech
- [ ] Connection info displays correctly
- [ ] Window stays on top of other applications
- [ ] Error handling displays message on connection failure

## Dependencies

Runtime:
- LiveKit server running on configured URL
- Microphone access (system permissions)
- Audio output device

Build-time:
- Rust toolchain (via rustup)
- Bun package manager
- Node.js 18+ (for tooling)

## License

Part of OpenCode project (see root LICENSE)
