# Bluetooth HID Device Integration

> **Severity**: P2 - Feature doesn't work as expected

## Problem

You want to use a Bluetooth remote (like a selfie stick remote) to trigger actions in your Electron app. Using `globalShortcut` to capture media keys (Volume Up/Down) intercepts ALL sources including:

- Physical keyboard function keys (F11/F12)
- Bluetooth remotes
- Touch Bar controls
- Other apps using these keys

This breaks normal keyboard functionality for the user.

## Solution: Direct HID Device Monitoring

Use `node-hid` to directly monitor a specific Bluetooth device by its Vendor ID and Product ID.

### Why This Works

| Aspect        | globalShortcut                  | node-hid                   |
| ------------- | ------------------------------- | -------------------------- |
| Scope         | All input sources               | Specific device only       |
| System keys   | Intercepted (breaks normal use) | Unaffected                 |
| Setup         | Simple                          | Requires VID/PID discovery |
| Native module | No                              | Yes (needs rebuild)        |

## Implementation

### 1. Install and Configure

```bash
pnpm add node-hid
```

Add to `vite.main.config.ts`:

```typescript
external: [
  "node-hid",
],
```

Add to `forge.config.ts` nativeModules:

```typescript
const nativeModules = ['node-hid'];
```

### 2. Find Your Device VID/PID

Create a scanner script (`scripts/scan-hid-devices.js`):

```javascript
const HID = require('node-hid');

console.log('===========================================');
console.log('  HID Device Scanner');
console.log('===========================================\n');

const devices = HID.devices();
console.log(`Found ${devices.length} HID devices:\n`);

// Filter potential Bluetooth remotes
const potentialRemotes = devices.filter((d) => {
  const name = (d.product || '').toLowerCase();
  return (
    name.includes('selfie') ||
    name.includes('remote') ||
    name.includes('bluetooth') ||
    d.usagePage === 12
  ); // Consumer Control
});

if (potentialRemotes.length > 0) {
  console.log('=== Potential Bluetooth Remotes ===\n');
  potentialRemotes.forEach((d, i) => {
    console.log(`[${i + 1}] ${d.product || 'Unknown'}`);
    console.log(`    Vendor ID:  0x${d.vendorId.toString(16).padStart(4, '0')} (${d.vendorId})`);
    console.log(`    Product ID: 0x${d.productId.toString(16).padStart(4, '0')} (${d.productId})`);
    console.log(`    Usage Page: ${d.usagePage}`);
    console.log(`    Usage:      ${d.usage}\n`);
  });
}
```

Run it:

```bash
node scripts/scan-hid-devices.js
```

Example output:

```
[1] Selfie
    Vendor ID:  0x248a (9354)
    Product ID: 0x8266 (33382)
    Usage Page: 12
    Usage:      1
```

### 3. Monitor the Device

```typescript
import HID from 'node-hid';

const CONFIG = {
  vendorId: 0x248a,
  productId: 0x8266,
  usagePage: 12, // Consumer Control
  usage: 1,
};

let hidDevice: HID.HID | null = null;

function initBluetoothRemote(): boolean {
  try {
    const devices = HID.devices();
    const device = devices.find(
      (d) =>
        d.vendorId === CONFIG.vendorId &&
        d.productId === CONFIG.productId &&
        d.usagePage === CONFIG.usagePage &&
        d.usage === CONFIG.usage
    );

    if (!device?.path) {
      console.log('Bluetooth remote not found');
      return false;
    }

    console.log(`Found Bluetooth remote: ${device.product}`);
    hidDevice = new HID.HID(device.path);

    hidDevice.on('data', (data: Buffer) => {
      // Button press: non-zero value after report ID
      if (data.length >= 2 && data[1] !== 0) {
        handleButtonPress();
      }
    });

    hidDevice.on('error', (err: Error) => {
      console.error('HID error:', err.message);
      scheduleReconnect();
    });

    return true;
  } catch (error) {
    console.error('Failed to init Bluetooth remote:', error);
    return false;
  }
}
```

### 4. Handle Reconnection

Bluetooth devices disconnect frequently. Implement auto-reconnection:

```typescript
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let isShuttingDown = false;

function scheduleReconnect(): void {
  if (isShuttingDown) return;

  // Clean up existing device
  if (hidDevice) {
    try {
      hidDevice.close();
    } catch {}
    hidDevice = null;
  }

  // Cancel existing timer
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }

  console.log('Bluetooth disconnected, reconnecting in 3s...');

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (isShuttingDown) return;

    const success = initBluetoothRemote();
    if (!success) {
      scheduleReconnect(); // Keep trying
    }
  }, 3000);
}

function cleanup(): void {
  isShuttingDown = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (hidDevice) {
    try {
      hidDevice.close();
    } catch {}
    hidDevice = null;
  }
}
```

## Common Bluetooth Remote Types

| Device Type          | Typical Key           | HID Usage Page      |
| -------------------- | --------------------- | ------------------- |
| Selfie stick remote  | Volume Up (0xE9)      | 12 (Consumer)       |
| Media remote         | Play/Pause, Next/Prev | 12 (Consumer)       |
| Presentation clicker | Page Up/Down          | 1 (Generic Desktop) |

## Troubleshooting

### Device Not Found

1. Check Bluetooth connection in System Settings
2. Re-run the scanner script
3. Try disconnecting and reconnecting the device
4. Some devices only show up when actively sending input

### Permission Errors

On macOS, your app may need **Input Monitoring** permission:

- System Settings → Privacy & Security → Input Monitoring
- Add your Electron app (or Terminal during development)

### Device Data Format

Different remotes send different data:

```typescript
hidDevice.on('data', (data: Buffer) => {
  // Log raw data to understand your device's format
  console.log('Raw data:', data.toString('hex'));

  // Common patterns:
  // [reportId, keyCode, 0, 0, ...] - Simple remote
  // [reportId, modifier, keyCode, ...] - Complex remote
});
```

## Complete Example with Double-Click Detection

```typescript
const CONFIG = {
  doubleClickMs: 500,
  debounceMs: 50,
};

let lastPressTime = 0;
let pendingClick: ReturnType<typeof setTimeout> | null = null;

function handleButtonPress(): void {
  const now = Date.now();
  const timeSinceLastPress = now - lastPressTime;
  lastPressTime = now;

  // Double-click detection
  if (timeSinceLastPress < CONFIG.doubleClickMs && timeSinceLastPress > CONFIG.debounceMs) {
    if (pendingClick) {
      clearTimeout(pendingClick);
      pendingClick = null;
    }
    handleDoubleClick();
    return;
  }

  // Single click - wait to confirm it's not a double-click
  pendingClick = setTimeout(() => {
    pendingClick = null;
    handleSingleClick();
  }, CONFIG.doubleClickMs);
}
```

## Key Insight

**globalShortcut vs node-hid**:

- `globalShortcut`: System-wide hotkey that intercepts from ALL sources
- `node-hid`: Direct device communication that ONLY reads from the specific device

For dedicated hardware triggers (remotes, foot pedals, etc.), always prefer direct HID access to avoid interfering with normal keyboard operation.
