# Audio Playback Setup Guide

## Prerequisites

The audio playback feature requires the `speaker` package, which is a native Node.js module that needs to be compiled.

### System Dependencies

#### macOS

```bash
# Install sox for audio output
brew install sox
```

#### Linux (Ubuntu/Debian)

```bash
# Install ALSA development libraries
sudo apt-get install libasound2-dev

# Or for PulseAudio
sudo apt-get install libpulse-dev
```

#### Windows

```bash
# Install windows-build-tools (if not already installed)
npm install --global windows-build-tools
```

## Installation

### 1. Install Node Packages

The `speaker` package is already in `package.json`, but you need to build the native bindings:

```bash
# Rebuild speaker native module
cd packages/opencode
bun install
```

If using npm instead of bun for the native module:

```bash
npm rebuild speaker
```

### 2. Verify Installation

Check that the speaker module built correctly:

```bash
ls -la node_modules/speaker/build/Release/
# You should see binding.node
```

### 3. Test Audio Output (Optional)

You can test if speaker works with a simple script:

```javascript
const Speaker = require("speaker")

const speaker = new Speaker({
  channels: 1,
  bitDepth: 16,
  sampleRate: 48000,
})

// Generate a simple tone
const frequency = 440 // A4 note
const duration = 1 // 1 second
const sampleRate = 48000
const samples = duration * sampleRate

const buffer = Buffer.alloc(samples * 2) // 2 bytes per sample (16-bit)

for (let i = 0; i < samples; i++) {
  const sample = Math.sin((2 * Math.PI * frequency * i) / sampleRate)
  const value = Math.floor(sample * 32767)
  buffer.writeInt16LE(value, i * 2)
}

speaker.write(buffer)
speaker.end()
```

## Alternative: Use Node.js Instead of Bun

If you have issues with Bun and native modules, you can run the LiveKit integration with Node.js:

```bash
# Install dependencies with npm
npm install

# Run with Node.js
node --loader tsx src/livekit/test-audio-playback.ts
```

## Troubleshooting

### Error: "Could not locate the bindings file"

This means the native module wasn't built. Try:

```bash
# Clean install
rm -rf node_modules
bun install

# If that doesn't work, use npm to rebuild the native module
npm rebuild speaker
```

### Error: "Module did not self-register"

This typically means the module was built for a different Node/Bun version:

```bash
# Rebuild for current version
npm rebuild speaker
```

### macOS: "gyp: No Xcode or CLT version detected"

Install Xcode Command Line Tools:

```bash
xcode-select --install
```

### Linux: "alsa/asoundlib.h: No such file or directory"

Install ALSA development headers:

```bash
sudo apt-get install libasound2-dev
```

### Windows: "MSBuild not found"

Install Visual Studio Build Tools:

```bash
npm install --global windows-build-tools
```

## Runtime Requirements

### Permissions

#### macOS

The application needs microphone and audio output permissions:

1. System Settings → Privacy & Security → Microphone
2. Allow terminal/application access

#### Linux

Ensure your user is in the `audio` group:

```bash
sudo usermod -a -G audio $USER
# Log out and log back in for changes to take effect
```

### Audio System

The speaker must be able to access the system's audio output:

- **macOS**: Uses CoreAudio (built-in)
- **Linux**: Uses ALSA or PulseAudio
- **Windows**: Uses WASAPI (built-in)

## Using Audio Playback

Once setup is complete, audio playback works automatically:

```typescript
import { RoomManager } from "./livekit"

const manager = new RoomManager(config)

// Connect - audio playback starts automatically
await manager.connect({ name: "room" })

// That's it! You'll hear audio from remote participants
```

## Testing Without Audio Hardware

For CI/CD or headless testing, you can mock the speaker module:

```typescript
// Mock speaker in tests
vi.mock("speaker", () => ({
  default: class MockSpeaker {
    write() {}
    end() {}
  },
}))
```

Or use the audio playback in "dry run" mode by catching speaker initialization errors:

```typescript
try {
  playback.start()
} catch (error) {
  console.warn("Speaker not available, running without audio output")
  // Continue without audio output
}
```

## See Also

- [Audio Playback Documentation](./AUDIO_PLAYBACK.md)
- [LiveKit Integration](./README.md)
- [Speaker Package Documentation](https://github.com/TooTallNate/node-speaker)
