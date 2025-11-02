# Using Voice Sessions in OpenCode

## How to Start a Voice Session

You can start a LiveKit voice session in **two ways**:

### Method 1: Using the `/voice` Command

1. In any OpenCode session, type `/voice` in the prompt
2. Press Enter
3. Enter your room name when prompted
4. The LiveKit room agent will start automatically

### Method 2: Using the Command Palette

1. Press `Ctrl+P` to open the command palette
2. Search for "Start LiveKit Voice Session" (in the Voice category)
3. Select it or use the keybind `livekit_connect`
4. Enter your room name when prompted
5. The LiveKit room agent will start automatically

## What Happens When You Connect

When you start a voice session, OpenCode automatically launches a room agent with:

- **`--transcribe`** - Transcribes all voice conversations
- **`--notes`** - Auto-generates conversation notes
- **`--todos`** - Auto-extracts todos from the conversation

The command executed is:
```bash
opencode room agent start --room {your_room_name} --transcribe --notes --todos
```

## Requirements

- LiveKit server must be running and accessible
- Configure your LiveKit credentials in environment variables or OpenCode config
- Microphone access (handled by the room agent process)

## Architecture

The voice session uses a **two-process architecture**:

1. **TUI Process** (this interface)
   - Manages UI and connection state
   - Displays transcriptions and notes
   - Does NOT handle audio directly

2. **Room Agent Process** (spawned automatically)
   - Handles microphone capture
   - Manages audio playback
   - Performs transcription
   - Generates notes and todos
   - Runs independently in background

This separation prevents race conditions and keeps the TUI responsive.

## Troubleshooting

If the voice dialog doesn't appear:
1. Make sure you're in a session (not on the home screen)
2. Try rebuilding: `npm run build`
3. Restart OpenCode

If the room agent doesn't start:
1. Check that `opencode` is in your PATH
2. Verify LiveKit server is running
3. Check environment variables for LiveKit credentials
