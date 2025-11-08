# LiveKit Integration Removed

## What Was Removed

All LiveKit voice/audio integration has been completely removed from OpenCode.

### Files Deleted:
- `src/livekit/` (entire directory)
  - room-manager.ts
  - room-agent.ts
  - audio-playback.ts
  - microphone-capture.ts
  - transcription.ts
  - types.ts
  - session-manager.ts
  - index.ts
  - All documentation files
- `src/cli/cmd/tui/context/livekit.tsx`
- `src/cli/cmd/tui/component/dialog-livekit.tsx`
- `src/cli/cmd/room.ts`

### Dependencies Removed from package.json:
- `@livekit/rtc-node`
- `livekit-client`
- `livekit-server-sdk`
- `node-record-lpcm16`
- `speaker`

### Code Changes:
- Removed LiveKitProvider from app.tsx
- Removed all voice commands from command palette
- Removed voice status indicator from status bar
- Removed RoomCommand from CLI

### Documentation Deleted:
- VOICE_COMPLETE.md
- VOICE_INPUT_GUIDE.md
- AUDIO_PLAYBACK_STATUS.md
- AUDIO_METER_STATUS.md
- DEBUG_VOICE.md
- LIVEKIT_*.md files

## Clean State

The codebase is now completely free of LiveKit dependencies and code.

To complete the cleanup, run:
```bash
cd /Users/jkneen/Documents/GitHub/flows/opencode-stt/packages/opencode
bun install  # Clean install without LiveKit packages
```

---

**Status:** ✅ All LiveKit code and dependencies removed
**Build:** ✅ Successful
**Ready:** For alternative voice solution if needed
