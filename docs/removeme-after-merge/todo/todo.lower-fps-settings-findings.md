# Lower FPS Settings Findings

## Issue

OpenCode TUI runs at 60 FPS by default, which can cause issues when working over RDP (Remote Desktop Protocol).

## Solution Implemented

### Environment Variable: `OPENCODE_EXPERIMENTAL_FPS`

Users can set the FPS via the `OPENCODE_EXPERIMENTAL_FPS` environment variable:

```bash
OPENCODE_EXPERIMENTAL_FPS=15 bun run --cwd packages/opencode src/index.ts
```

This caps the render loop to the specified FPS, which helps with RDP performance.

## Key Technical Finding

OpenTUI has **two** FPS-related settings:

1. **`targetFps`** - The goal/aim for FPS (can render faster if there's pending work)
2. **`maxFps`** - The hard cap (absolute maximum, cannot exceed)

Initially only `targetFps` was set, which allowed FPS to still spike up to 60. Setting both is required to truly cap the FPS.

### Implementation

**File**: `packages/opencode/src/cli/cmd/tui/app.tsx:179-180`

```typescript
{
  targetFps: Flag.OPENCODE_EXPERIMENTAL_FPS ?? 60,
  maxFps: Flag.OPENCODE_EXPERIMENTAL_FPS,
  // ...
}
```

## Files Modified

1. **`packages/opencode/src/config/config.ts`** - Added `fps` to TUI config schema (for future config file support)

2. **`packages/opencode/src/flag/flag.ts`** - Added `OPENCODE_EXPERIMENTAL_FPS` flag:

   ```typescript
   export const OPENCODE_EXPERIMENTAL_FPS = number("OPENCODE_EXPERIMENTAL_FPS")
   ```

   Where `number()` parses the env var and returns `undefined` if invalid.

3. **`packages/opencode/src/cli/cmd/tui/app.tsx`** - Changed render options to use the flag for both `targetFps` and `maxFps`

## Debug Information

- The debug overlay (toggle via `renderer.toggleDebugOverlay()` at line 578) shows current FPS
- This confirms FPS is being tracked internally by OpenTUI

## OpenTUI Source

- OpenTUI is an external dependency (`@opentui/core` v0.1.79)
- Source code is at `/home/ubuntu/gits/opentui`
- The relevant code is in `packages/core/src/renderer.ts`:
  - Line 88-89: Config options `targetFps` and `maxFps`
  - Line 324: `private maxFps: number = 60`
  - Line 351: `private targetFrameTime: number = 1000 / this.targetFps`
  - Line 352: `private minTargetFrameTime: number = 1000 / this.maxFps`
  - Line 735: Frame delay calculation using `minTargetFrameTime`

## Future Enhancements (Not Implemented)

- Config file support (`tui.fps` in opencode.jsonc)
- Auto-detection for remote sessions (SSH_TTY, TMUX, etc.)
- Priority: env var > config > auto-detect > default (60)
