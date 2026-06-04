# Global Keyboard Hooks with uiohook-napi

> **Severity**: P2 - Feature limited or conflicts with system

## Problem

You want to detect keyboard events globally (even when your app is not focused) for features like:

- Push-to-talk (hold a key to record)
- Global hotkeys that work everywhere
- Keyboard shortcuts that don't conflict with system keys

Electron's `globalShortcut` has limitations:

- Can conflict with other apps
- Limited to specific key combinations
- Cannot detect key hold/release separately

## Solution: uiohook-napi

Use `uiohook-napi` for low-level keyboard (and mouse) event monitoring.

### Why uiohook-napi?

| Feature                   | globalShortcut | uiohook-napi |
| ------------------------- | -------------- | ------------ |
| Key down/up events        | No             | Yes          |
| Detect key hold duration  | No             | Yes          |
| Mouse events              | No             | Yes          |
| Conflict with system keys | Often          | Rarely       |
| Native module             | No             | Yes          |

---

## Implementation

### 1. Install and Configure

```bash
pnpm add uiohook-napi
```

Add to `vite.main.config.ts`:

```typescript
external: [
  "uiohook-napi",
],
```

Add to `forge.config.ts`:

```typescript
const nativeModules = [
  'uiohook-napi',
  'node-gyp-build', // dependency of uiohook-napi
];
```

### 2. Basic Usage

```typescript
import { uIOhook, UiohookKey } from 'uiohook-napi';

// Listen to key events
uIOhook.on('keydown', (e) => {
  console.log('Key down:', e.keycode);

  if (e.keycode === UiohookKey.AltRight) {
    console.log('Right Alt pressed');
  }
});

uIOhook.on('keyup', (e) => {
  console.log('Key up:', e.keycode);
});

// Start listening
uIOhook.start();

// Stop when done
// uIOhook.stop();
```

### 3. Push-to-Talk Pattern

```typescript
import { uIOhook, UiohookKey } from 'uiohook-napi';

const CONFIG = {
  pushToTalkKey: UiohookKey.AltRight,
  debounceMs: 50,
  minRecordingMs: 200,
};

interface State {
  isKeyHeld: boolean;
  lastKeyDownTime: number;
  lastKeyUpTime: number;
  recordingStartTime: number;
  onStart: (() => void) | null;
  onStop: (() => void) | null;
}

const state: State = {
  isKeyHeld: false,
  lastKeyDownTime: 0,
  lastKeyUpTime: 0,
  recordingStartTime: 0,
  onStart: null,
  onStop: null,
};

function isDebounced(lastTime: number): boolean {
  return Date.now() - lastTime < CONFIG.debounceMs;
}

function handleKeyDown(keycode: number): void {
  if (keycode !== CONFIG.pushToTalkKey) return;
  if (isDebounced(state.lastKeyDownTime)) return;
  if (state.isKeyHeld) return;

  state.isKeyHeld = true;
  state.lastKeyDownTime = Date.now();
  state.recordingStartTime = Date.now();

  console.log('Push-to-talk: START');
  state.onStart?.();
}

function handleKeyUp(keycode: number): void {
  if (keycode !== CONFIG.pushToTalkKey) return;
  if (!state.isKeyHeld) return;
  if (isDebounced(state.lastKeyUpTime)) return;

  // Ignore if recording was too short
  if (Date.now() - state.recordingStartTime < CONFIG.minRecordingMs) {
    console.log('Recording too short, ignoring');
    state.isKeyHeld = false;
    return;
  }

  state.isKeyHeld = false;
  state.lastKeyUpTime = Date.now();

  console.log('Push-to-talk: STOP');
  state.onStop?.();
}

export function registerPushToTalk(onStart: () => void, onStop: () => void): void {
  state.onStart = onStart;
  state.onStop = onStop;

  uIOhook.on('keydown', (e) => handleKeyDown(e.keycode));
  uIOhook.on('keyup', (e) => handleKeyUp(e.keycode));
  uIOhook.start();

  console.log('Push-to-talk registered: Hold Right Alt to record');
}

export function unregisterPushToTalk(): void {
  uIOhook.stop();
  state.onStart = null;
  state.onStop = null;
  state.isKeyHeld = false;
}
```

---

## Key Codes Reference

Common keys from `UiohookKey`:

```typescript
import { UiohookKey } from "uiohook-napi";

// Modifier keys
UiohookKey.Alt       // Left Alt
UiohookKey.AltRight  // Right Alt (Option on Mac)
UiohookKey.Ctrl      // Left Ctrl
UiohookKey.CtrlRight // Right Ctrl
UiohookKey.Shift     // Left Shift
UiohookKey.ShiftRight
UiohookKey.Meta      // Cmd on Mac, Win on Windows
UiohookKey.MetaRight

// Function keys
UiohookKey.F1 ... UiohookKey.F12

// Special keys
UiohookKey.Escape
UiohookKey.Enter
UiohookKey.Space
UiohookKey.Tab
UiohookKey.Backspace
```

---

## Simulating Key Presses

```typescript
import { uIOhook, UiohookKey } from 'uiohook-napi';

// Simulate Enter key press
uIOhook.keyTap(UiohookKey.Enter);

// Simulate key combination (Cmd+V)
uIOhook.keyTap(UiohookKey.V, [UiohookKey.Meta]);
```

---

## macOS Permission Requirement

uiohook-napi requires **Input Monitoring** permission on macOS:

- System Settings → Privacy & Security → Input Monitoring
- Add your Electron app

During development, add Terminal to Input Monitoring.

---

## Common Issues

### Events Not Firing

1. Check Input Monitoring permission
2. Ensure `uIOhook.start()` was called
3. Check you're listening to the correct event type

### Duplicate Events

Keyboard auto-repeat can cause rapid keydown events:

```typescript
function handleKeyDown(keycode: number): void {
  if (state.isKeyHeld) return; // Ignore repeats
  state.isKeyHeld = true;
  // ...
}
```

### Key Stuck in "Held" State

If app focus changes during key hold:

```typescript
// Reset state when app loses focus
app.on('browser-window-blur', () => {
  if (state.isKeyHeld) {
    state.isKeyHeld = false;
    // Optionally trigger stop callback
  }
});
```

### Conflicts with System Keys

Some keys are reserved by the OS:

- `Cmd+Tab` (app switcher)
- `Cmd+Space` (Spotlight)
- Volume keys

Prefer using less common keys like:

- `Right Option/Alt`
- `Right Control`
- Function keys (F13-F19 if available)

---

## Best Practices

1. **Always debounce** - Prevent rapid duplicate events
2. **Track key state** - Don't rely solely on events
3. **Provide minimum duration** - Avoid accidental triggers
4. **Clean up properly** - Call `uIOhook.stop()` on app quit
5. **Handle focus changes** - Reset state when app focus changes
6. **Choose non-conflicting keys** - Use Right modifier keys

---

## Combining with Bluetooth Remote

For dual-trigger support (keyboard + Bluetooth remote):

```typescript
// Keyboard: Hold mode (hold to record)
// Bluetooth: Toggle mode (press to start/stop)

export function registerDualTrigger(
  onStart: () => void,
  onStop: () => void,
  onDoubleClick?: () => void
): void {
  // Keyboard via uiohook
  uIOhook.on('keydown', (e) => handleKeyboardDown(e.keycode));
  uIOhook.on('keyup', (e) => handleKeyboardUp(e.keycode));
  uIOhook.start();

  // Bluetooth via node-hid
  initBluetoothRemote(handleBluetoothPress);
}
```

See [Bluetooth HID Device](./bluetooth-hid-device.md) for Bluetooth implementation.
