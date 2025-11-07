# Audio Level Meter - Implementation Status

## ✅ What Was Added

### 1. Audio Level Detection in MicrophoneCapture
**File:** `src/livekit/microphone-capture.ts`

Added RMS (Root Mean Square) audio level calculation:
```typescript
// Calculate audio level from samples
let sum = 0
for (let i = 0; i < samples.length; i++) {
  sum += samples[i] * samples[i]
}
const rms = Math.sqrt(sum / samples.length)
// Normalize to 0-1 range
this.currentLevel = Math.min(1.0, rms / 32767)
```

**New Methods:**
- `getLevel()` - Returns current audio level (0.0 to 1.0)
- `setLevelCallback(callback)` - Register callback for level changes

### 2. Audio Level in LiveKit Context
**File:** `src/cli/cmd/tui/context/livekit.tsx`

- Added `audioLevel` signal
- Polls `roomManager.getMicrophoneLevel()` every 100ms (10 FPS)
- Updates audio level in real-time

### 3. Visual Meter in Status Bar
**File:** `src/cli/cmd/tui/app.tsx`

Added visual bar meter next to room name:
```
🎤 room-name ▁▂▃▄▅
```

The bars animate based on audio level:
- Silent: No bars
- Quiet: ▁
- Medium: ▁▂▃
- Loud: ▁▂▃▄▅
- Very Loud: ▁▂▃▄▅▆▇█

### 4. RoomManager Integration
**File:** `src/livekit/room-manager.ts`

Added `getMicrophoneLevel()` method:
```typescript
getMicrophoneLevel(): number {
  // TODO: Integrate with MicrophoneCapture
  return 0  // Placeholder
}
```

## ⚠️ Current Limitation

**The meter shows bars but currently returns 0** because:

1. ✅ Audio level calculation is implemented in `MicrophoneCapture`
2. ❌ `MicrophoneCapture` is **not integrated into `RoomManager`**
3. ❌ `RoomManager.getMicrophoneLevel()` returns 0 (placeholder)

### Why It's Not Working Yet

The microphone capture flow needs completion:

```
Current Flow:
SoX Microphone → ??? → LiveKit Room
                  ↑
                  Missing MicrophoneCapture integration

Needed Flow:
SoX Microphone → MicrophoneCapture → AudioSource → LiveKit Room
                       ↓
                  getLevel() → Status Bar Meter
```

## 🔧 To Make It Work

Need to integrate `MicrophoneCapture` into `RoomManager`:

### Step 1: Add MicrophoneCapture field to RoomManager

```typescript
// In room-manager.ts
import { MicrophoneCapture } from "./microphone-capture"

export class RoomManager {
  private microphoneCapture?: MicrophoneCapture
  // ...
}
```

### Step 2: Start MicrophoneCapture on connect

```typescript
async enableMicrophone(): Promise<void> {
  const audioSource = new AudioSource(48000, 1)
  
  this.microphoneCapture = new MicrophoneCapture(audioSource, {
    sampleRate: 48000,
    channelCount: 1,
  })
  
  this.microphoneCapture.start()
  
  // Publish audio track
  await this.room.localParticipant?.publishTrack(audioSource, {
    name: "microphone",
    source: "microphone",
  })
  
  this.microphoneState.enabled = true
}
```

### Step 3: Update getMicrophoneLevel

```typescript
getMicrophoneLevel(): number {
  if (this.microphoneCapture) {
    return this.microphoneCapture.getLevel()
  }
  return 0
}
```

### Step 4: Stop on disconnect

```typescript
async disableMicrophone(): Promise<void> {
  if (this.microphoneCapture) {
    this.microphoneCapture.stop()
    this.microphoneCapture = undefined
  }
  this.microphoneState.enabled = false
}
```

## 🎯 Current Visual Behavior

Right now in the status bar you see:

```
🎤 room-name
```

**After integration**, when you speak you'll see:

```
🎤 room-name ▁▂▃▄▅
              ↑
              Animated bars showing your voice level
```

The bars will:
- ✅ Update 10 times per second (smooth animation)
- ✅ Show real-time audio level
- ✅ Help you see if mic is working
- ✅ Visual feedback for voice input

## 📊 Technical Details

### Audio Level Calculation (RMS)

```typescript
// RMS = Root Mean Square
// Measures the "energy" in the audio signal
sum = sample₁² + sample₂² + ... + sampleₙ²
rms = √(sum / n)
level = rms / 32767  // Normalize for int16
```

### Update Frequency

- Microphone: Captures continuously
- Level calculation: Every audio chunk (~20ms)
- UI update: 10 times per second (100ms polling)
- Visual: Smooth bar animation

### Bar Mapping

```typescript
const bars = Math.round(level * 5)
// level 0.0-0.2 → ▁
// level 0.2-0.4 → ▁▂
// level 0.4-0.6 → ▁▂▃
// level 0.6-0.8 → ▁▂▃▄
// level 0.8-1.0 → ▁▂▃▄▅
```

### Characters Used

```
▁ ▂ ▃ ▄ ▅ ▆ ▇ █
↑              ↑
Quiet         Loud
```

## 🧪 Testing (When Integrated)

### Test 1: Silent
```
# Don't speak
Expected: 🎤 room-name (no bars)
```

### Test 2: Whisper
```
# Whisper quietly
Expected: 🎤 room-name ▁
```

### Test 3: Normal Speech
```
# Speak normally
Expected: 🎤 room-name ▁▂▃▄
```

### Test 4: Loud/Shout
```
# Speak loudly
Expected: 🎤 room-name ▁▂▃▄▅▆▇█
```

## 📝 Files Changed

1. **Modified:**
   - `src/livekit/microphone-capture.ts` - Added level calculation
   - `src/cli/cmd/tui/context/livekit.tsx` - Added level polling
   - `src/cli/cmd/tui/app.tsx` - Added visual meter
   - `src/livekit/room-manager.ts` - Added getMicrophoneLevel()

2. **Status:**
   - ✅ Build: Successful
   - ✅ UI: Visual meter ready
   - ⚠️ Data: Returns 0 (needs integration)

## 🚀 Next Steps

1. Integrate `MicrophoneCapture` into `RoomManager.enableMicrophone()`
2. Connect `AudioSource` to LiveKit track publishing
3. Test audio level meter with real audio
4. Add calibration (if levels too high/low)

## 💡 Alternative: Quick Test

To test the meter visual without full integration:

```typescript
// In livekit.tsx connect(), after roomManager.connect():

// Simulate audio level for testing
let testLevel = 0
const testInterval = setInterval(() => {
  testLevel = Math.sin(Date.now() / 200) * 0.5 + 0.5  // Oscillate 0-1
  setAudioLevel(testLevel)
}, 100)
```

This will make the bars animate even without real audio, to verify the visual works.

---

**Current Status:** ✅ UI Ready | ⚠️ Awaiting MicrophoneCapture Integration  
**Visual:** Meter displays in status bar  
**Data:** Returns 0 until integrated  
