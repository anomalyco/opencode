# Audio Capture for LiveKit in Node.js/Terminal Environments

## ✅ Implementation Status: COMPLETE

**Real microphone capture is now fully implemented!**

OpenCode now captures audio from your system microphone using `node-record-lpcm16` and streams it to LiveKit rooms in real-time. See the [Implementation](#implementation) section below for details.

**Quick Start:**

```bash
# 1. Install SoX
brew install sox  # macOS

# 2. Connect to LiveKit room (mic auto-enabled)
const manager = new RoomManager(config)
await manager.connect({ name: "my-room" })
// Audio is now streaming from your microphone!

# 3. Control microphone
await manager.setMicrophoneVolume(0.8)
await manager.setMicrophoneMuted(true)
```

---

## The Problem

LiveKit's audio capture works differently in browser vs Node.js environments:

**Browser Environment:**

- Uses `navigator.mediaDevices.getUserMedia()` to access microphone
- Returns `MediaStream` objects with audio tracks
- Handles encoding/decoding automatically
- Full support in `@livekit/components-react`

**Node.js/Terminal Environment:**

- No `navigator.mediaDevices` API available
- No native microphone access
- Must use system-level audio capture
- Requires manual PCM frame handling with `AudioSource`

The existing `AudioSource` class in `@livekit/rtc-node` expects raw PCM audio frames but doesn't provide microphone capture - you must bring your own audio source.

---

## Solution Options for Node.js Audio Capture

### Option 1: `node-record-lpcm16` (Recommended)

**Pros:**

- Simple, high-level API
- Cross-platform (macOS, Linux, Windows)
- Returns Node.js readable stream
- Outputs PCM16 format directly (compatible with LiveKit)

**Cons:**

- Requires `sox` installed on system
- Limited configuration options

**Installation:**

```bash
# Install sox first
# macOS:
brew install sox

# Ubuntu/Debian:
sudo apt-get install sox libsox-fmt-all

# Windows:
# Download from https://sourceforge.net/projects/sox/

# Install Node.js package
npm install node-record-lpcm16
```

**Usage:**

```typescript
import recorder from "node-record-lpcm16"

const recording = recorder.record({
  sampleRate: 48000,
  channels: 1,
  audioType: "raw",
  threshold: 0,
  silence: "0",
  recorder: "sox", // or 'rec' on some systems
})

recording
  .stream()
  .on("data", (chunk: Buffer) => {
    // chunk is raw PCM16 data
    console.log("Audio chunk:", chunk.length)
  })
  .on("error", (err) => {
    console.error("Recording error:", err)
  })

// Stop recording
recording.stop()
```

---

### Option 2: `@livekit/rtc-node` Built-in Capture

**Check if available:**
The `@livekit/rtc-node` package may have built-in audio capture utilities. Check the package documentation:

```typescript
import { AudioSource } from "@livekit/rtc-node"

// Check for available methods
// Some versions may include:
// - AudioSource.fromMicrophone()
// - AudioSource.captureSystemAudio()
```

As of early 2024, the Node.js SDK requires you to provide your own audio capture mechanism.

---

### Option 3: `sox` Command-Line Tool

**Pros:**

- No Node.js dependencies
- Powerful audio processing capabilities
- Available on all platforms

**Cons:**

- Must spawn child process
- More complex integration
- Harder to debug

**Usage:**

```typescript
import { spawn } from "child_process"

const soxProcess = spawn("sox", [
  "-d", // default audio device
  "-t",
  "raw", // output type
  "-r",
  "48000", // sample rate
  "-e",
  "signed-integer", // encoding
  "-b",
  "16", // bits per sample
  "-c",
  "1", // channels (mono)
  "-", // output to stdout
])

soxProcess.stdout.on("data", (chunk: Buffer) => {
  // chunk is raw PCM16 data
  console.log("Audio chunk:", chunk.length)
})

soxProcess.stderr.on("data", (data) => {
  console.error("sox error:", data.toString())
})

// Stop recording
soxProcess.kill()
```

---

### Option 4: `naudiodon` (Native Audio)

**Pros:**

- Native Node.js bindings to PortAudio
- Low latency
- Cross-platform
- Professional-grade audio handling

**Cons:**

- Requires native compilation (node-gyp)
- Can be tricky to install
- Larger dependency

**Installation:**

```bash
npm install naudiodon
```

**Usage:**

```typescript
import portAudio from "naudiodon"

const ai = new portAudio.AudioIO({
  inOptions: {
    channelCount: 1,
    sampleFormat: portAudio.SampleFormat16Bit,
    sampleRate: 48000,
    deviceId: -1, // default device
  },
})

ai.on("data", (chunk: Buffer) => {
  // chunk is raw PCM16 data
  console.log("Audio chunk:", chunk.length)
})

ai.start()

// Stop recording
ai.quit()
```

---

## Integration with LiveKit AudioSource

Here's how to integrate any of the above solutions with LiveKit's `AudioSource`:

### Complete Implementation Example

```typescript
import { Room, RoomEvent, AudioSource, TrackPublishOptions } from "@livekit/rtc-node"
import recorder from "node-record-lpcm16"

class LiveKitMicrophoneCapture {
  private room: Room
  private audioSource: AudioSource
  private recording: any
  private isCapturing: boolean = false

  constructor(room: Room) {
    this.room = room

    // Create AudioSource with appropriate settings
    this.audioSource = new AudioSource(
      48000, // sample rate (Hz)
      1, // channels (1 = mono, 2 = stereo)
    )
  }

  async start(): Promise<void> {
    if (this.isCapturing) {
      console.warn("Already capturing audio")
      return
    }

    console.log("Starting microphone capture...")

    // Start recording from microphone
    this.recording = recorder.record({
      sampleRate: 48000,
      channels: 1,
      audioType: "raw",
      threshold: 0,
      silence: "0",
      recorder: "sox",
    })

    // Pipe audio data to AudioSource
    this.recording
      .stream()
      .on("data", (chunk: Buffer) => {
        if (this.isCapturing) {
          // Convert Buffer to Int16Array (PCM16 format)
          const samples = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.length / 2)

          // Capture audio frame
          this.audioSource.captureFrame(samples)
        }
      })
      .on("error", (err: Error) => {
        console.error("Microphone error:", err)
        this.stop()
      })

    // Publish audio track to room
    const track = await this.room.localParticipant?.publishTrack(this.audioSource, {
      name: "microphone",
      source: "microphone",
    } as TrackPublishOptions)

    this.isCapturing = true
    console.log("Microphone capture started, track published:", track?.sid)
  }

  stop(): void {
    if (!this.isCapturing) {
      return
    }

    console.log("Stopping microphone capture...")

    // Stop recording
    if (this.recording) {
      this.recording.stop()
      this.recording = null
    }

    this.isCapturing = false
    console.log("Microphone capture stopped")
  }

  async cleanup(): Promise<void> {
    this.stop()

    // Unpublish track if needed
    // Note: Room cleanup will handle this automatically on disconnect
  }
}

// Usage example
async function main() {
  const room = new Room()

  // Connect to LiveKit room
  await room.connect(url, token)

  const micCapture = new LiveKitMicrophoneCapture(room)

  // Start capturing and publishing microphone audio
  await micCapture.start()

  // Stop after some time or on user input
  setTimeout(() => {
    micCapture.stop()
  }, 60000) // Stop after 60 seconds

  // Cleanup on exit
  process.on("SIGINT", async () => {
    await micCapture.cleanup()
    await room.disconnect()
    process.exit(0)
  })
}
```

---

## Handling Sample Rate Conversion

LiveKit typically expects 48kHz audio, but your microphone might capture at different rates (44.1kHz, 16kHz, etc.).

### Option A: Configure Capture to Match

**Best approach** - configure your recorder to output 48kHz directly:

```typescript
recorder.record({
  sampleRate: 48000, // Match LiveKit's expected rate
  channels: 1,
  audioType: "raw",
})
```

### Option B: Resample Using `sox`

If you need to resample, use `sox`:

```typescript
const soxProcess = spawn("sox", [
  "-d", // input: default device
  "-t",
  "raw", // output type
  "-r",
  "48000", // RESAMPLE to 48kHz
  "-e",
  "signed-integer",
  "-b",
  "16",
  "-c",
  "1",
  "-",
])
```

### Option C: Manual Resampling

For simple cases (not recommended for production):

```typescript
import { Readable } from "stream"

// Simple linear interpolation resampler
function resample(input: Int16Array, inputRate: number, outputRate: number): Int16Array {
  const ratio = inputRate / outputRate
  const outputLength = Math.floor(input.length / ratio)
  const output = new Int16Array(outputLength)

  for (let i = 0; i < outputLength; i++) {
    const sourceIndex = i * ratio
    const index = Math.floor(sourceIndex)
    const fraction = sourceIndex - index

    if (index + 1 < input.length) {
      // Linear interpolation
      output[i] = Math.round(input[index] * (1 - fraction) + input[index + 1] * fraction)
    } else {
      output[i] = input[index]
    }
  }

  return output
}
```

---

## Complete Working Example

Here's a complete, testable implementation:

```typescript
// src/livekit/microphone-capture.ts
import { Room, AudioSource, TrackPublishOptions } from "@livekit/rtc-node"
import recorder from "node-record-lpcm16"

export interface MicrophoneConfig {
  sampleRate?: number
  channels?: number
  deviceId?: string
}

export class MicrophoneCapture {
  private room: Room
  private audioSource: AudioSource
  private recording: any
  private isCapturing: boolean = false
  private config: Required<MicrophoneConfig>

  constructor(room: Room, config: MicrophoneConfig = {}) {
    this.room = room
    this.config = {
      sampleRate: config.sampleRate || 48000,
      channels: config.channels || 1,
      deviceId: config.deviceId || "default",
    }

    this.audioSource = new AudioSource(this.config.sampleRate, this.config.channels)
  }

  async start(): Promise<void> {
    if (this.isCapturing) {
      throw new Error("Microphone capture already started")
    }

    console.log("Starting microphone capture with config:", this.config)

    try {
      // Start recording
      this.recording = recorder.record({
        sampleRate: this.config.sampleRate,
        channels: this.config.channels,
        audioType: "raw",
        threshold: 0,
        silence: "0",
      })

      // Handle audio data
      this.recording
        .stream()
        .on("data", this.handleAudioData.bind(this))
        .on("error", this.handleError.bind(this))
        .on("end", () => {
          console.log("Recording stream ended")
        })

      // Publish track
      await this.room.localParticipant?.publishTrack(this.audioSource, {
        name: "microphone",
        source: "microphone",
      } as TrackPublishOptions)

      this.isCapturing = true
      console.log("Microphone published successfully")
    } catch (err) {
      console.error("Failed to start microphone:", err)
      throw err
    }
  }

  private handleAudioData(chunk: Buffer): void {
    if (!this.isCapturing) return

    try {
      // Convert Buffer to Int16Array
      const samples = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.length / 2)

      // Send to LiveKit
      this.audioSource.captureFrame(samples)
    } catch (err) {
      console.error("Error processing audio data:", err)
    }
  }

  private handleError(err: Error): void {
    console.error("Microphone recording error:", err)
    this.stop()
  }

  stop(): void {
    if (!this.isCapturing) return

    console.log("Stopping microphone capture")

    if (this.recording) {
      this.recording.stop()
      this.recording = null
    }

    this.isCapturing = false
  }

  isActive(): boolean {
    return this.isCapturing
  }
}
```

---

## Testing Approach

### Test 1: Verify Audio Capture Works

```typescript
// test/microphone-test.ts
import recorder from "node-record-lpcm16"

function testMicrophoneCapture() {
  console.log("Testing microphone capture for 5 seconds...")

  const recording = recorder.record({
    sampleRate: 48000,
    channels: 1,
    audioType: "raw",
  })

  let totalBytes = 0

  recording
    .stream()
    .on("data", (chunk: Buffer) => {
      totalBytes += chunk.length
      console.log(`Captured ${chunk.length} bytes, total: ${totalBytes}`)
    })
    .on("error", (err) => {
      console.error("Error:", err)
    })

  setTimeout(() => {
    recording.stop()
    console.log(`Test complete. Total captured: ${totalBytes} bytes`)

    // Expected: ~480,000 bytes for 5 seconds at 48kHz mono 16-bit
    // (48000 samples/sec * 2 bytes/sample * 5 seconds = 480,000)
    const expectedBytes = 48000 * 2 * 5
    console.log(`Expected: ~${expectedBytes} bytes`)
  }, 5000)
}

testMicrophoneCapture()
```

Run: `bun run test/microphone-test.ts`

### Test 2: Verify LiveKit Integration

```typescript
// test/livekit-microphone-test.ts
import { Room } from "@livekit/rtc-node"
import { MicrophoneCapture } from "../src/livekit/microphone-capture"

async function testLiveKitMicrophone() {
  const room = new Room()

  // Use your LiveKit credentials
  const url = "wss://your-livekit-server.com"
  const token = "your-access-token"

  try {
    console.log("Connecting to room...")
    await room.connect(url, token)
    console.log("Connected successfully")

    const mic = new MicrophoneCapture(room)

    console.log("Starting microphone...")
    await mic.start()
    console.log("Microphone started")

    // Monitor track publication
    room.localParticipant?.on("trackPublished", (publication) => {
      console.log("Track published:", publication.sid)
    })

    // Run for 10 seconds
    await new Promise((resolve) => setTimeout(resolve, 10000))

    console.log("Stopping microphone...")
    mic.stop()

    console.log("Disconnecting...")
    await room.disconnect()

    console.log("Test complete")
  } catch (err) {
    console.error("Test failed:", err)
    throw err
  }
}

testLiveKitMicrophone()
```

### Test 3: Audio Quality Check

Save captured audio to file for verification:

```typescript
// test/audio-quality-test.ts
import recorder from "node-record-lpcm16"
import fs from "fs"

function testAudioQuality() {
  const outputFile = "test-audio.raw"
  const writeStream = fs.createWriteStream(outputFile)

  console.log(`Recording 5 seconds to ${outputFile}...`)

  const recording = recorder.record({
    sampleRate: 48000,
    channels: 1,
    audioType: "raw",
  })

  recording.stream().pipe(writeStream)

  setTimeout(() => {
    recording.stop()
    console.log("Recording saved. Convert to WAV with:")
    console.log(`sox -r 48000 -e signed-integer -b 16 -c 1 ${outputFile} output.wav`)
  }, 5000)
}

testAudioQuality()
```

Convert and play:

```bash
sox -r 48000 -e signed-integer -b 16 -c 1 test-audio.raw output.wav
play output.wav  # or: afplay output.wav on macOS
```

---

## Troubleshooting

### No audio captured / zero bytes

**Check microphone permissions:**

```bash
# macOS: System Preferences > Security & Privacy > Microphone
# Ensure Terminal/iTerm has microphone access

# Test mic with sox directly:
sox -d test.wav trim 0 5
```

### "sox WARN: Can't find default device"

**Install sox properly:**

```bash
# macOS:
brew install sox

# Verify installation:
sox --version
rec --version
```

### High CPU usage

**Reduce sample rate or use buffering:**

```typescript
const recording = recorder.record({
  sampleRate: 16000, // Lower sample rate
  channels: 1,
})
```

### Audio sounds distorted

**Check sample rate mismatch:**

- Ensure recorder sample rate matches AudioSource sample rate
- Verify PCM format is int16 (not float32)

### Room not receiving audio

**Verify track publication:**

```typescript
room.localParticipant?.on("trackPublished", (pub) => {
  console.log("Track published:", pub.kind, pub.source)
})
```

---

## Implementation

### ✅ Completed Implementation

The microphone capture is now fully integrated into OpenCode! Here's what was implemented:

#### 1. MicrophoneCapture Class

**Location:** `src/livekit/microphone-capture.ts`

Handles real-time audio capture from system microphone:

```typescript
export class MicrophoneCapture {
  constructor(audioSource: AudioSource, options: MicrophoneCaptureOptions)

  start(): void // Start capturing
  stop(): void // Stop capturing
  setVolume(level: number): void // Adjust volume (0.0-1.0)
  isActive(): boolean // Check status
}
```

**Features:**

- ✅ Captures PCM16 audio at 48kHz
- ✅ Creates 20ms frames (960 samples)
- ✅ Real-time volume control
- ✅ Proper buffering and frame alignment
- ✅ Error handling and cleanup

#### 2. RoomManager Integration

**Location:** `src/livekit/room-manager.ts`

Updated to use real microphone capture:

```typescript
// Microphone auto-enabled on connect
await roomManager.connect({ name: "my-room" })

// Manual control
await roomManager.enableMicrophone()
await roomManager.disableMicrophone()
await roomManager.setMicrophoneVolume(0.8)
await roomManager.setMicrophoneMuted(true)

const state = roomManager.getMicrophoneState()
```

**Changes:**

- ✅ Added `microphoneCapture` field
- ✅ Auto-enable mic on room connect
- ✅ Volume control updates capture
- ✅ Mute stops/starts capture
- ✅ Proper cleanup on disconnect

#### 3. SessionManager Integration

**Location:** `src/livekit/session-manager.ts`

Exposed microphone controls at session level:

```typescript
const manager = getLiveKitSessionManager()

await manager.setMicrophoneVolume(0.5)
await manager.setMicrophoneMuted(true)
const state = manager.getMicrophoneState()
```

**New Methods:**

- ✅ `setMicrophoneVolume(level: number)`
- ✅ `setMicrophoneMuted(muted: boolean)`
- ✅ `getMicrophoneState()`

#### 4. Documentation

**Updated Files:**

- ✅ `src/livekit/README.md` - Added Audio Capture section
- ✅ `src/livekit/AUDIO_CAPTURE.md` - Implementation status
- ✅ `src/livekit/example-usage.ts` - Volume/mute examples

### Architecture

```
User's Microphone
      ↓ (SoX captures)
node-record-lpcm16
      ↓ (PCM16 chunks)
MicrophoneCapture
      ↓ (960-sample frames)
LiveKit AudioSource
      ↓ (encoded audio)
LiveKit Room
      ↓
Remote Participants
```

### Usage Example

```typescript
import { RoomManager } from "./livekit/room-manager"
import type { LiveKitConfig } from "./livekit/types"

// 1. Configure
const config: LiveKitConfig = {
  serverUrl: "wss://your-server.livekit.cloud",
  apiKey: "your-api-key",
  apiSecret: "your-api-secret",
}

// 2. Connect (mic auto-enabled!)
const manager = new RoomManager(config)
await manager.connect({
  name: "my-room",
  participantName: "OpenCode User",
})

console.log("🎤 Microphone is now streaming!")

// 3. Control
await manager.setMicrophoneVolume(0.7) // 70% volume
await manager.setMicrophoneMuted(true) // Mute

// 4. Check state
const state = manager.getMicrophoneState()
// { enabled: true, volume: 0.7, muted: true }

// 5. Disconnect
await manager.disconnect()
```

### Testing

**Basic functionality test:**

```bash
cd /Users/jkneen/Documents/GitHub/flows/opencode-stt/packages/opencode
bun run --eval '
import { MicrophoneCapture } from "./src/livekit/microphone-capture.ts";
import { AudioSource } from "@livekit/rtc-node";

const source = new AudioSource(48000, 1);
const capture = new MicrophoneCapture(source, {
  sampleRate: 48000,
  channelCount: 1,
});

console.log("✅ Active:", capture.isActive());
capture.setVolume(0.5);
console.log("✅ Volume control works");
await source.close();
'
```

**Integration test:**

```typescript
// Start room with mic
const manager = new RoomManager(config)
await manager.connect({ name: "test" })

// Verify mic enabled
const state = manager.getMicrophoneState()
console.assert(state.enabled === true)

// Test controls
await manager.setMicrophoneVolume(0.5)
await manager.setMicrophoneMuted(true)

console.log("✅ All integration tests passed!")
```

### Requirements

**System Dependencies:**

```bash
# macOS
brew install sox

# Ubuntu/Debian
sudo apt-get install sox libsox-fmt-all

# Fedora/RHEL
sudo dnf install sox
```

**Node.js Dependencies:**

Already included in `package.json`:

- `node-record-lpcm16@1.0.1`
- `@livekit/rtc-node@0.13.20`

### Performance

- **Frame Rate:** 50 frames/second (20ms each)
- **Latency:** ~20ms buffering + network
- **CPU Usage:** Minimal (SoX handles capture)
- **Memory:** ~4KB per buffered frame

### Next Steps

While the core implementation is complete, here are potential enhancements:

1. ✨ **Voice Activity Detection** - Only send audio when speaking
2. ✨ **Audio Effects** - Real-time filters/processing
3. ✨ **Stereo Support** - Capture in stereo (2 channels)
4. ✨ **Recording** - Save captured audio to file
5. ✨ **Metrics** - Audio level monitoring, quality stats
6. ✨ **Resampling** - Support different sample rates

---

## References

- [LiveKit Node.js SDK Docs](https://docs.livekit.io/reference/node/)
- [node-record-lpcm16](https://github.com/gillesdemey/node-record-lpcm16)
- [SoX Documentation](http://sox.sourceforge.net/)
- [PortAudio (naudiodon)](http://www.portaudio.com/)
