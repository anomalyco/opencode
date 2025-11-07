# Voice Input Guide

Voice input is now enabled in OpenCode! Here's how to use it:

## Quick Start

### 1. Set Up LiveKit Credentials

You have two options:

**Option A: LiveKit Cloud (Recommended)**
```bash
export LIVEKIT_URL="wss://your-project.livekit.cloud"
export LIVEKIT_API_KEY="your-api-key"
export LIVEKIT_API_SECRET="your-api-secret"
```

**Option B: Local Development**
```bash
# Start local LiveKit server
docker run --rm -p 7880:7880 \
  -e LIVEKIT_KEYS="devkey: secret" \
  livekit/livekit-server \
  --dev

# Set credentials
export LIVEKIT_URL="ws://localhost:7880"
export LIVEKIT_API_KEY="devkey"
export LIVEKIT_API_SECRET="secret"
```

### 2. Install Audio Dependencies

Voice input requires **SoX** for microphone access:

**macOS:**
```bash
brew install sox
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt-get install sox libsox-fmt-all libasound2-dev
```

### 3. Start OpenCode

```bash
bun dev
# or
opencode
```

### 4. Enable Voice Input

In the OpenCode TUI, press **Ctrl+P** (command palette) and type:
- **"Start Voice Input"** - Opens connection dialog
- Enter your LiveKit credentials
- Press Enter to connect

You'll see **🎤 room-name** in the bottom status bar when connected!

## Features

### Voice Status Indicator
- **🎤 room-name** - Shows when voice is active
- Click the indicator to see connection details
- Use "Disconnect Voice" command to disconnect

### Commands Available

| Command | Description |
|---------|-------------|
| Start Voice Input | Opens connection dialog |
| Disconnect Voice | Disconnects from LiveKit room |

## How Voice Works

When connected to a LiveKit room:

1. **Microphone Auto-Enabled** - Your mic starts capturing automatically
2. **Real-Time Transcription** - Speech converted to text (coming soon: auto-insert into prompt)
3. **Multi-Participant** - Join from browser at [meet.livekit.io](https://meet.livekit.io)
4. **Room-Based** - Multiple people can be in same room

## Architecture

```
OpenCode TUI
    ↓
LiveKit Room
    ↓
Microphone → Speech-to-Text → Transcription
```

## Roadmap

- [ ] Auto-insert transcribed text into prompt
- [ ] Voice activity indicator (animated mic icon)
- [ ] Push-to-talk mode
- [ ] Keyboard shortcut for voice (Ctrl+Shift+V)
- [ ] Voice commands ("submit", "clear", etc.)
- [ ] Text-to-speech for responses

## Troubleshooting

### "sox: not found"
Install SoX using the commands above.

### "Connection failed"
- Verify LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET are set
- Check network connectivity
- Test credentials at [meet.livekit.io](https://meet.livekit.io)

### "No microphone access"
- Check system permissions for microphone
- Run `sox -V` to verify installation
- Try different audio input device

### Voice indicator doesn't show
- Refresh the TUI (Ctrl+C and restart)
- Check console for connection errors
- Verify room connection succeeded

## Advanced: Transcription Integration

The LiveKit transcription service is ready but needs wiring to the prompt input.

To enable auto-transcription into prompt, edit `src/cli/cmd/tui/component/prompt/index.tsx`:

```typescript
// Add in Prompt component
const livekit = useLiveKit()
const roomManager = livekit.roomManager()

// Listen for transcription events
if (roomManager) {
  const transcription = new TranscriptionService({
    language: "en-US",
    interimResults: true,
  })
  
  transcription.on("final", (result) => {
    // Insert transcribed text into prompt
    input.setText(input.plainText + " " + result.text)
  })
  
  await transcription.startTranscription()
}
```

## Getting LiveKit Credentials

### LiveKit Cloud (Free Tier)
1. Go to [cloud.livekit.io](https://cloud.livekit.io/)
2. Sign up (free account available)
3. Create a new project
4. Copy credentials from project settings

### Self-Hosted
1. Follow [LiveKit self-hosting guide](https://docs.livekit.io/deploy/)
2. Generate API keys
3. Use your server URL and keys

## Testing

Test your connection in a browser first:
1. Go to [meet.livekit.io](https://meet.livekit.io/)
2. Enter your server URL
3. Join the same room name
4. Verify audio works

Then connect from OpenCode using the same credentials!

---

**Voice input is now ready!** Press Ctrl+P and search for "Voice" to get started.
