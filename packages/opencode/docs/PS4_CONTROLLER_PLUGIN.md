# PS4 DualShock Controller Plugin

This plugin provides PS4 DualShock controller support for the OpenCode CLI, allowing users to interact with the assistant using a game controller.

## Features

- **Controller Button Mappings**: Navigate and interact with the CLI using PS4 controller buttons
- **Vibration Feedback**: Receive haptic feedback when the agent needs attention or encounters errors
- **Visual Button Hints**: See controller button assignments in prompts and questions
- **Accept/Cancel Actions**: Use L2/R2 triggers for confirm/cancel operations

## Button Mappings

The plugin maps the following PS4 DualShock buttons:

| Button | Action |
|--------|--------|
| R2 (Right Trigger) | Accept / Confirm |
| L2 (Left Trigger) | Cancel / Go Back |
| R1 / L1 | Next / Previous Option |
| D-Pad Up / Down | Navigate options |
| D-Pad Left / Right | Switch tabs/panels |
| Triangle / Circle / X / Square | Quick actions |
| Options Button | Open options menu |

## Vibration Events

The controller vibrates in the following scenarios:

| Event | Vibration Pattern |
|-------|------------------|
| Agent starts thinking | Short vibration (200ms, 30% intensity) |
| Question asked | Medium vibration (300ms, 50% intensity) |
| Permission requested | Medium vibration (400ms, 40% intensity) |
| Error encountered | Long vibration (1000ms, 100% intensity) |

## Usage

The plugin is automatically loaded as an internal plugin when OpenCode starts. No additional configuration is required.

### Button Hints in Prompts

When the controller is connected, prompts and questions will automatically include button hints:

```
Continue with this action?
[R2] Accept  [L2] Cancel
```

### System Instructions

The plugin adds controller button information to the system prompt, instructing the agent to include button hints when presenting options to the user.

## Implementation Details

### Current Status

The plugin is currently implemented in **simulated mode**. This means:

- The controller interface and button mappings are defined
- Event handlers for vibration feedback are in place
- System prompt integration works correctly
- Button hints are displayed in prompts

### Future Enhancements

To enable actual hardware support, the following implementations could be added:

#### Option 1: Native Module (requires Bun native module support)
```typescript
// Using node-hid or dualshock-controller packages
import HID from 'node-hid';
// Initialize and read from PS4 controller HID device
```

#### Option 2: Bun FFI Bindings
```typescript
// Use Bun FFI to call into libusb or hidapi C libraries
import { dlopen, FFIType, suffix } from "bun:ffi";
// Bind to USB/HID library functions
```

#### Option 3: Browser Gamepad API Bridge
```typescript
// Create a WebSocket bridge to browser's Gamepad API
// Browser client reads controller and sends events to CLI
```

## Plugin Architecture

The plugin implements the standard OpenCode plugin interface:

```typescript
export async function PS4ControllerPlugin(input: PluginInput): Promise<Hooks>
```

It provides the following hooks:

- **event**: Listens to all bus events for controller feedback
- **permission.ask**: Triggers vibration when permissions are requested
- **experimental.chat.system.transform**: Adds controller information to system prompts

## Testing

Tests are located in `packages/opencode/test/plugin/ps4-controller.test.ts`.

Run tests with:
```bash
bun test test/plugin/ps4-controller.test.ts
```

## Configuration

The controller settings are currently hardcoded but could be made configurable:

```typescript
interface ControllerConfig {
  vibrationEnabled: boolean;
  buttonMappings: {
    accept: string;
    cancel: string;
    // ... other mappings
  };
  vibrationIntensity: {
    thinking: number;
    question: number;
    permission: number;
    error: number;
  };
}
```

## Troubleshooting

### Controller Not Detected

Currently, the plugin runs in simulated mode. To check if it's loaded:
1. Look for log messages: "PS4 Controller plugin initializing"
2. Check system prompts include controller button information

### Future: Real Hardware Issues

When hardware support is added:

- **Connection issues**: Ensure controller is paired via Bluetooth or connected via USB
- **Permission issues**: May need udev rules on Linux for HID device access
- **Driver issues**: Ensure ds4drv or similar drivers are installed on Linux

## Related Files

- Plugin implementation: `packages/opencode/src/plugin/ps4-controller.ts`
- Plugin registration: `packages/opencode/src/plugin/index.ts`
- Tests: `packages/opencode/test/plugin/ps4-controller.test.ts`

## Contributing

To extend the plugin with actual hardware support:

1. Choose an implementation strategy (native module, FFI, or WebSocket bridge)
2. Implement device detection and connection
3. Add event listeners for button presses
4. Implement vibration and LED control commands
5. Update tests to include hardware-specific scenarios
6. Update this documentation with setup instructions

## License

This plugin is part of OpenCode and follows the same MIT license.
