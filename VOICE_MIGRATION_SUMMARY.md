# Voice/LiveKit Migration to Desktop

## Summary

Successfully integrated LiveKit voice capabilities and speech recognition into the OpenCode desktop application.

## Changes Made

### 1. Configuration Updates

**File**: `opencode.json`

Added slash commands for easy access to voice features:

```json
{
  "command": {
    "add_dir": {
      "description": "Add an external directory to the current session",
      "template": "Use the add_directory tool to add the directory path provided by the user to this session."
    },
    "voice": {
      "description": "Start or manage LiveKit voice session",
      "template": "Help the user start a LiveKit voice session. Ask for the room name if not provided, then use bash to execute: opencode room agent start --room {room_name} --transcribe --notes --todos"
    }
  }
}
```

### 2. Desktop Package Dependencies

**File**: `packages/desktop/package.json`

Added LiveKit client library:

```json
{
  "dependencies": {
    "livekit-client": "2.15.14"
  }
}
```

### 3. New Components Created

#### a. Voice Control Component

**File**: `packages/desktop/src/components/voice-control.tsx`

A reusable voice control component with:

- Local speech recognition toggle
- LiveKit room connection indicator
- Recording state visualization
- Mode switching between local and room-based voice

**Features**:

- Microphone on/off button with visual feedback
- Red pulsing dot when recording
- Room connectivity status
- Interim transcript display
- Mode toggle (local vs. LiveKit room)

#### b. LiveKit Context Provider

**File**: `packages/desktop/src/context/livekit.tsx`

Context provider for managing LiveKit rooms:

**API**:

```typescript
interface LiveKitContextValue {
  room: () => Room | undefined
  isConnected: () => boolean
  connect: (roomName: string, participantName: string) => Promise<void>
  disconnect: () => Promise<void>
  enableMicrophone: () => Promise<void>
  disableMicrophone: () => Promise<void>
  isMicrophoneEnabled: () => boolean
}
```

**Features**:

- Room connection management
- Token generation via backend API
- Microphone enable/disable
- Connection state tracking
- Automatic cleanup on unmount

### 4. Enhanced Prompt Input

**File**: `packages/desktop/src/components/prompt-input.tsx`

Integrated speech recognition directly into the prompt input:

**Changes**:

- Added speech recognition import
- Created speech instance with transcript handling
- Added voice recording toggle button
- Transcribed text automatically inserted into prompt
- Visual indicator when recording (microphone icon toggles to mic-off)

**Features**:

- Click microphone button to start/stop recording
- Final transcripts automatically added to input
- Works alongside existing text input
- Seamless integration with file attachments and other features

## Architecture

```
┌─────────────────────────────────────────────────┐
│            Desktop Application                   │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌──────────────────┐  ┌──────────────────┐   │
│  │  PromptInput     │  │  VoiceControl    │   │
│  │  Component       │  │  Component       │   │
│  │                  │  │                  │   │
│  │  [Mic Button]    │  │  [Local/Room]    │   │
│  │  [Text Input]    │  │  [Recording LED] │   │
│  └────────┬─────────┘  └────────┬─────────┘   │
│           │                     │               │
│           └─────────┬───────────┘               │
│                     │                           │
│          ┌──────────▼──────────┐               │
│          │  Speech Recognition  │               │
│          │  (utils/speech.ts)   │               │
│          └──────────┬───────────┘               │
│                     │                           │
│          ┌──────────▼──────────┐               │
│          │   LiveKit Context    │               │
│          │  (context/livekit)   │               │
│          └──────────┬───────────┘               │
│                     │                           │
└─────────────────────┼───────────────────────────┘
                      │
                      ▼
            ┌─────────────────┐
            │  LiveKit Server  │
            │  (livekit.cloud) │
            └─────────────────┘
```

## Usage

### For Users

1. **Local Speech Recognition** (Built-in, no setup):

   ```
   1. Click the microphone button in the prompt input
   2. Speak your prompt
   3. Click again to stop
   4. Text appears automatically in the input
   ```

2. **LiveKit Voice Rooms** (Requires configuration):

   ```bash
   # In terminal
   /voice my-meeting

   # Or via CLI
   opencode room agent start --room my-meeting --transcribe --notes --todos
   ```

3. **Add External Directories**:
   ```bash
   /add_dir /path/to/directory
   ```

### Configuration Required for LiveKit

To use LiveKit features, you need to configure credentials:

**Option 1: Environment Variables**

```bash
export LIVEKIT_URL="wss://your-server.livekit.cloud"
export LIVEKIT_API_KEY="your-api-key"
export LIVEKIT_API_SECRET="your-api-secret"
```

**Option 2: Config File** (`opencode.json`)

```json
{
  "livekit": {
    "serverUrl": "wss://your-server.livekit.cloud",
    "apiKey": "your-api-key",
    "apiSecret": "your-api-secret"
  }
}
```

## Technical Details

### Speech Recognition

The desktop app uses the **Web Speech API** for local speech recognition:

- **Browser Support**: Chrome, Edge, Safari (partial)
- **Languages**: Automatic detection from browser locale
- **Features**:
  - Interim results (real-time transcription)
  - Final results (committed transcription)
  - Continuous recognition with automatic restart
  - Smart word boundary detection

**Implementation**: `packages/desktop/src/utils/speech.ts`

### LiveKit Integration

LiveKit provides real-time communication features:

- **Room-based voice chat**: Multiple participants
- **Audio tracks**: Microphone input/output
- **Data channels**: Tool sharing, notes, todos
- **Transcription**: Server-side speech-to-text
- **Recording**: Session recording capabilities

**Implementation**: `packages/opencode/src/livekit/`

## Benefits

### For End Users

1. **Hands-free coding**: Speak prompts instead of typing
2. **Faster input**: Voice is often faster than typing
3. **Accessibility**: Better support for users with typing difficulties
4. **Multi-modal**: Combine voice and text seamlessly
5. **Collaborative**: Join voice rooms with team members

### For Developers

1. **Reusable components**: VoiceControl can be used anywhere
2. **Flexible architecture**: Easy to switch providers
3. **Context-based state**: Clean state management
4. **TypeScript support**: Full type safety
5. **Solid.js patterns**: Reactive and efficient

## Next Steps

### Enhancements

1. **Voice Commands**: Add keyword detection for special commands
2. **Speaker Identification**: Multi-speaker transcription
3. **Language Selection**: Allow users to choose transcription language
4. **Voice Profiles**: Custom voice settings per user
5. **Noise Cancellation**: Better audio processing
6. **Push-to-talk**: Hold key to record
7. **Keyboard Shortcuts**: Quick access to voice features

### Integration

1. **Agent Voice Responses**: AI speaks responses back
2. **Real-time Collaboration**: Multiple users in voice rooms
3. **Screen Sharing**: Share screens in voice sessions
4. **Meeting Notes**: Auto-generate meeting summaries
5. **Action Items**: Extract todos from conversations

### Backend Requirements

For full LiveKit features, you'll need:

1. **Token Generation Endpoint**: `/api/livekit/token`
   - Input: `{ roomName, participantName }`
   - Output: `{ token }`
   - Uses `livekit-server-sdk` to generate JWT

2. **LiveKit Server**:
   - Cloud: https://cloud.livekit.io
   - Self-hosted: Docker/Kubernetes deployment
   - Local dev: `docker run livekit/livekit-server --dev`

## Testing

### Local Speech (No Setup Required)

```bash
cd packages/desktop
bun install
bun dev

# Open http://localhost:3000
# Click microphone button
# Speak and verify text appears
```

### LiveKit Features (Requires Setup)

```bash
# 1. Configure credentials
export LIVEKIT_URL="wss://your-server.livekit.cloud"
export LIVEKIT_API_KEY="your-key"
export LIVEKIT_API_SECRET="your-secret"

# 2. Start agent
opencode room agent start --room test-room

# 3. In desktop app, join room
# VoiceControl component will show "Room" mode
```

## Files Modified/Created

### Modified

- `opencode.json` - Added `/add_dir` and `/voice` commands
- `packages/desktop/package.json` - Added livekit-client dependency
- `packages/desktop/src/components/prompt-input.tsx` - Integrated voice button

### Created

- `packages/desktop/src/components/voice-control.tsx` - Voice control component
- `packages/desktop/src/context/livekit.tsx` - LiveKit context provider
- `VOICE_MIGRATION_SUMMARY.md` - This documentation

## Troubleshooting

### Speech Recognition Not Working

**Problem**: Microphone button doesn't appear

**Solution**:

- Use Chrome or Edge browser
- Ensure HTTPS or localhost (required for Web Speech API)
- Check browser permissions for microphone access

### LiveKit Connection Failed

**Problem**: Can't connect to room

**Solutions**:

1. Verify credentials are correct
2. Check server URL format: `wss://...` not `https://...`
3. Ensure API key/secret are valid
4. Test network connectivity to LiveKit server

### No Transcription

**Problem**: Speaking but nothing appears

**Solutions**:

1. Check microphone permissions in browser
2. Verify microphone is working in other apps
3. Check browser console for errors
4. Try different browser (Chrome recommended)

## Resources

- [LiveKit Documentation](https://docs.livekit.io/)
- [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
- [OpenCode LiveKit Guide](packages/opencode/src/livekit/README.md)
- [LiveKit Cloud](https://cloud.livekit.io/)

## License

Same as OpenCode main license.
