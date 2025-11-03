# LiveKit Player

A Tauri-wrapped React application that serves as an audio conduit for LiveKit rooms with a ChatGPT-style visual interface.

## Features

- **Audio Conduit**: Captures microphone input and plays room audio output
- **Chat Indicator**: Visual feedback showing agent state (listening, thinking, speaking)
- **Drag & Drop**: Tauri window with drag support and always-on-top
- **Agent Communication**: Direct connection to LiveKit room where agent handles VAD, STT, TTS

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment:
   The `.env` file is already configured for local development:
   ```
   VITE_LIVEKIT_URL=ws://localhost:7880
   VITE_LIVEKIT_API_KEY=devkey
   VITE_LIVEKIT_ROOM_NAME=dev
   VITE_LIVEKIT_PARTICIPANT_NAME=player-user
   ```

3. Ensure LiveKit server is running locally on port 7880

## Development

Run in development mode:
```bash
npm run tauri:dev
```

This will:
- Start Vite dev server on port 1420
- Launch Tauri window with hot-reload

## Build

Build production app:
```bash
npm run tauri:build
```

## Architecture

```
User Microphone → LiveKit Room → Agent (VAD/STT/TTS)
                       ↓
                  Audio Output → User Speakers
```

The player is purely a conduit:
- **Input**: Captures mic audio → sends to room
- **Output**: Receives room audio → plays to speakers
- **Visual**: Shows agent state based on audio activity

Agent handles all the intelligence:
- Voice Activity Detection (VAD)
- Speech-to-Text (STT)
- Text-to-Speech (TTS)
- LLM processing

## Agent States

- **Disconnected**: Not connected to room (gray)
- **Connecting**: Establishing connection (orange)
- **Listening**: Agent ready for input (green)
- **Thinking**: Processing user speech (blue)
- **Speaking**: Agent is responding (purple)
