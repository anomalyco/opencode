# Voice Input Debug Guide

## Current Status: Connected to Room ✅

You mentioned:
- ✅ Connected to LiveKit room
- ⚠️ Hearing feedback (yourself speaking)
- 🎤 Using HyperX microphone

## What's Happening

**You're connected successfully!** The feedback you hear is because:

1. Your microphone captures your voice
2. Voice is sent to LiveKit room
3. LiveKit echoes it back to all participants (including you)
4. You hear yourself through your speakers with slight delay
5. If speakers are loud, mic picks it up again = FEEDBACK LOOP

## Immediate Solutions

### Solution 1: Use Headphones (RECOMMENDED)
```
Plug in headphones → Eliminates feedback completely
```

### Solution 2: Mute System Volume
```bash
# While speaking, mute your Mac's volume
# Press Volume Down until muted
# Or: Click speaker icon in menu bar → Mute
```

### Solution 3: Lower Microphone Volume
In OpenCode TUI:
```
Ctrl+P → "Mute Room Audio" → This stops you hearing yourself
```

## Check Connection Status

### In OpenCode TUI:
Look at the **bottom status bar**:
```
🎤 room-name  ← If you see this, you're connected!
```

### Check Browser Console (if using web interface):
```javascript
// Open browser console (Cmd+Option+I)
// Look for:
[LiveKit] Connected to room: your-room-name
[LiveKit] Microphone marked as enabled
```

### Check Terminal Logs:
```bash
# If you started with `bun dev`, check output for:
[LiveKit] Connected to room
[MicrophoneCapture] Started successfully
```

## Verify Audio is Working

### Test 1: Check if Agent Hears You
If there's an AI agent in the room:
- Speak: "Hello, can you hear me?"
- Agent should transcribe and respond

### Test 2: Join from Browser
1. Open https://meet.livekit.io
2. Enter your server URL
3. Join same room name
4. You should see "OpenCode User" participant
5. Speak in browser → Check if OpenCode participant's audio indicator moves

### Test 3: Check Microphone Capture
```bash
# In terminal, test if SoX captures audio
sox -d -t wav test-mic.wav trim 0 3
# Speak for 3 seconds
# Then play back:
afplay test-mic.wav
```

## Debug Checklist

- [x] Connected to LiveKit room ✅
- [ ] Microphone is capturing audio
- [ ] Audio is being published to room
- [ ] Remote participants can hear you
- [ ] Agent is transcribing your speech
- [ ] Feedback is resolved (using headphones/mute)

## Common Issues & Fixes

### Issue: "I can hear myself (feedback)"
**Fix:** Use headphones or mute speakers

### Issue: "Agent doesn't respond to my voice"
**Check:**
1. Is agent running? (`opencode room agent start`)
2. Is transcription enabled? (should be by default)
3. Are you in the same room?

### Issue: "No audio being captured"
**Fix:**
```bash
# Check SoX installation
sox --version

# Check mic permissions (macOS)
# System Preferences → Security & Privacy → Microphone → Terminal (allow)

# Test mic directly
sox -d -t wav - | play -
# Speak and you should hear yourself with slight delay
```

### Issue: "Connection failed"
**Fix:**
```bash
# Verify credentials
echo $LIVEKIT_URL
echo $LIVEKIT_API_KEY
echo $LIVEKIT_API_SECRET

# Test connection with LiveKit Meet
open https://meet.livekit.io
```

## Advanced Debugging

### Enable Verbose Logging
Add to your environment:
```bash
export DEBUG="livekit*"
export NODE_DEBUG="livekit"
```

### Check RoomManager State
In OpenCode console:
```typescript
const manager = livekit.roomManager()
console.log("Connected:", manager?.getConnectionState())
console.log("Microphone:", manager?.getMicrophoneState())
```

### Monitor Audio Levels
```bash
# Terminal-based audio level monitor
sox -d -t wav - | play - pitch 100
```

## Next Steps

1. **Stop Feedback:**
   - Put on headphones, OR
   - Press Ctrl+P → "Mute Room Audio"

2. **Test Voice Input:**
   - Say "Hello, this is a test"
   - Check if agent transcribes it

3. **Verify Two-Way Communication:**
   - Join from browser at meet.livekit.io
   - Speak in browser → Should hear in OpenCode
   - Speak in OpenCode → Should hear in browser

## Getting Help

If still having issues:

1. Share console logs:
   ```bash
   tail -100 /tmp/opencode-server.log
   ```

2. Share connection details:
   ```bash
   echo "URL: $LIVEKIT_URL"
   echo "Room: [your-room-name]"
   ```

3. Share microphone info:
   ```bash
   sox --version
   system_profiler SPAudioDataType | grep -A 5 "Input"
   ```

---

**Current Status:** ✅ Connected | ⚠️ Feedback Issue | 🎧 Use Headphones
