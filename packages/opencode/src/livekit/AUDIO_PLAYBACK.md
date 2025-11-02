# LiveKit Audio Playback

Audio playback implementation for hearing remote participants in LiveKit rooms.

## Overview

The `AudioPlayback` class enables OpenCode to play audio from remote LiveKit participants (such as AI agents) through the system speakers. It handles:

- Audio stream consumption from LiveKit remote tracks
- Multi-participant audio mixing
- Volume control
- Automatic track lifecycle management

## Architecture

```
Remote Participant Audio Track
        ↓
  AudioStream (LiveKit)
        ↓
  ReadableStream<AudioFrame>
        ↓
  AudioPlayback
        ↓
  Audio Mixing
        ↓
  Speaker (node-speaker)
        ↓
  System Audio Output
```

## Features

### ✅ Automatic Playback

- Audio playback is automatically enabled when connecting to a room
- Remote audio tracks are automatically added to playback when subscribed
- Tracks are automatically removed when unsubscribed

### ✅ Multi-Participant Mixing

- Supports multiple simultaneous audio sources
- Mixes audio from all active participants in real-time
- Uses averaging algorithm to prevent clipping

### ✅ Volume Control

- Global playback volume adjustment (0.0 to 1.0)
- Applied to mixed output before speaker

### ✅ Configurable Audio Format

- Sample rate (default: 48kHz)
- Channel count (default: mono)
- Bit depth (default: 16-bit)

## Usage

### Basic Usage (via RoomManager)

The simplest way to use audio playback is through the `RoomManager`, which handles everything automatically:

```typescript
import { RoomManager } from "./livekit"

const manager = new RoomManager({
  serverUrl: "wss://your-livekit-server.com",
  apiKey: "your-api-key",
  apiSecret: "your-api-secret",
})

// Connect to room - audio playback is automatically enabled
await manager.connect({
  name: "my-room",
  participantName: "OpenCode User",
})

// Audio from remote participants will now play through speakers
// Control playback volume
manager.setPlaybackVolume(0.8) // 80% volume

// Get current volume
const volume = manager.getPlaybackVolume()

// Disconnect - automatically stops playback
await manager.disconnect()
```

### Advanced Usage (Direct AudioPlayback Control)

For more control, you can use the `AudioPlayback` class directly:

```typescript
import { AudioPlayback } from "./livekit"
import type { RemoteAudioTrack } from "@livekit/rtc-node"

// Create playback instance
const playback = new AudioPlayback({
  sampleRate: 48000,
  channelCount: 1,
  volume: 1.0,
  bitDepth: 16,
})

// Start playback system
playback.start()

// Add a remote audio track
await playback.addTrack(remoteAudioTrack)

// Control volume
playback.setVolume(0.5) // 50% volume

// Remove a track
playback.removeTrack(trackSid)

// Stop playback
playback.stop()
```

### Volume Control Example

```typescript
// Via LiveKitSessionManager (in TUI)
import { getLiveKitSessionManager } from "./livekit"

const manager = getLiveKitSessionManager()

// Set playback volume
manager.setPlaybackVolume(0.7)

// Get current volume
const volume = manager.getPlaybackVolume()
```

## Configuration

### AudioPlaybackOptions

```typescript
interface AudioPlaybackOptions {
  sampleRate: number // Audio sample rate (e.g., 48000)
  channelCount: number // Number of channels (1 = mono, 2 = stereo)
  volume?: number // Initial volume (0.0 to 1.0, default: 1.0)
  bitDepth?: number // Bit depth (default: 16)
}
```

### Default Configuration

The `RoomManager` uses these defaults:

- **Sample Rate**: 48000 Hz
- **Channels**: 1 (mono)
- **Volume**: 1.0 (100%)
- **Bit Depth**: 16-bit

## How It Works

### 1. Track Subscription

When a remote participant publishes an audio track:

```typescript
// In RoomManager event handler
room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
  if (track.kind === TrackKind.KIND_AUDIO) {
    // Automatically add to playback
    audioPlayback.addTrack(track as RemoteAudioTrack)
  }
})
```

### 2. Audio Stream Processing

Each track creates an `AudioStream` that provides `AudioFrame` objects:

```typescript
const stream = new AudioStream(track, sampleRate, channelCount)
const reader = stream.getReader()

// Read frames continuously
while (true) {
  const { value: frame, done } = await reader.read()
  if (done) break

  // frame.data is Int16Array of audio samples
  audioQueue.push(frame.data)
}
```

### 3. Audio Mixing

The mixer runs at 20ms intervals, combining audio from all tracks:

```typescript
// Collect samples from all active tracks
const trackSamples = tracks.map((t) => t.audioQueue.shift())

// Mix by averaging
for (let i = 0; i < maxLength; i++) {
  let sum = 0,
    count = 0
  for (const samples of trackSamples) {
    if (i < samples.length) {
      sum += samples[i]
      count++
    }
  }
  mixed[i] = (sum / count) * volume
}
```

### 4. Speaker Output

Mixed audio is written to the `speaker` package:

```typescript
const buffer = Buffer.from(mixedSamples.buffer)
speaker.write(buffer)
```

## Performance

- **Latency**: ~20ms frame buffering
- **CPU**: Minimal overhead with simple averaging mixer
- **Memory**: Small per-track audio queues

## Troubleshooting

### No Audio Output

1. **Check speaker package installation**:

   ```bash
   bun add speaker
   ```

2. **Verify system audio permissions**:
   - macOS: Check System Settings → Privacy & Security → Microphone
   - Linux: Ensure ALSA/PulseAudio is configured

3. **Check playback is enabled**:

   ```typescript
   const isActive = playback.isActive()
   console.log("Playback active:", isActive)
   ```

4. **Verify tracks are being added**:
   ```typescript
   const trackCount = playback.getTrackCount()
   console.log("Active tracks:", trackCount)
   ```

### Distorted Audio

1. **Check volume levels**:

   ```typescript
   // Reduce volume if clipping occurs
   playback.setVolume(0.5)
   ```

2. **Verify sample rate matches**:
   - Ensure all tracks use the same sample rate
   - Default is 48000 Hz

### Audio Cutting Out

1. **Check network connection**:
   - Poor connection can cause audio dropouts
   - Monitor LiveKit connection state

2. **Increase buffer size** (if needed):
   - Current implementation uses 20ms frames
   - Adjust `samplesPerFrame` for different buffering

## Integration with Session Manager

The `LiveKitSessionManager` provides a high-level interface:

```typescript
import { initializeLiveKit } from "./livekit"

const manager = await initializeLiveKit(config)

await manager.connectToRoom({
  sessionID: "my-session",
  roomName: "my-room",
  participantName: "User",
})

// Audio playback is now active
// Control via manager methods
manager.setPlaybackVolume(0.8)
```

## API Reference

### AudioPlayback Class

#### Constructor

```typescript
new AudioPlayback(options: AudioPlaybackOptions)
```

#### Methods

**start(): void**

- Start the audio playback system
- Creates speaker instance and mixer

**stop(): void**

- Stop audio playback
- Removes all tracks and closes speaker

**addTrack(track: RemoteAudioTrack): Promise<void>**

- Add a remote audio track to playback
- Auto-starts playback if not already running

**removeTrack(trackSid: string): void**

- Remove a track from playback
- Called automatically when tracks are unsubscribed

**setVolume(level: number): void**

- Set playback volume (0.0 to 1.0)
- Applied to all mixed audio

**getVolume(): number**

- Get current playback volume

**isActive(): boolean**

- Check if playback system is running

**getTrackCount(): number**

- Get number of active audio tracks

### RoomManager Integration

**enableAudioPlayback(): void**

- Manually enable audio playback (called automatically on connect)

**disableAudioPlayback(): void**

- Disable audio playback

**setPlaybackVolume(level: number): void**

- Set playback volume

**getPlaybackVolume(): number**

- Get playback volume

## Dependencies

- **@livekit/rtc-node**: Audio stream and track management
- **speaker**: System audio output
- **Node.js Buffer**: Audio data conversion

## See Also

- [LiveKit Architecture](./ARCHITECTURE.md)
- [Audio Capture](./AUDIO_CAPTURE.md)
- [Room Manager](./room-manager.ts)
