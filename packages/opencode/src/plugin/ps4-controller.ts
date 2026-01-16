import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { Log } from "../util/log"
import { Bus } from "../bus"
import { Question } from "../question"
import { Session } from "../session"

const log = Log.create({ service: "plugin.ps4-controller" })

/**
 * PS4 DualShock Controller Plugin
 * 
 * This plugin provides PS4 DualShock controller support for the CLI.
 * Features:
 * - L/R buttons for accept/cancel actions
 * - Button mappings displayed in prompts
 * - Vibration feedback when agent needs attention
 * - Configuration via controller buttons
 * 
 * Button Mappings:
 * - L2/R2: Cancel/Accept primary actions
 * - L1/R1: Previous/Next option navigation
 * - Triangle/Circle/X/Square: Quick actions
 * - D-Pad: Navigation
 */

interface ControllerState {
  connected: boolean
  vibrationEnabled: boolean
  buttonLabels: {
    accept: string
    cancel: string
    up: string
    down: string
    left: string
    right: string
    options: string
  }
}

class PS4Controller {
  private state: ControllerState = {
    connected: false,
    vibrationEnabled: true,
    buttonLabels: {
      accept: "R2",
      cancel: "L2",
      up: "D-Pad Up",
      down: "D-Pad Down",
      left: "D-Pad Left",
      right: "D-Pad Right",
      options: "Options",
    },
  }

  constructor() {
    this.initialize()
  }

  private async initialize() {
    // In a real implementation, this would:
    // 1. Check for connected PS4 controllers via HID
    // 2. Initialize the controller connection
    // 3. Set up event listeners for button presses
    // 
    // For now, we simulate the controller being available
    // and can be extended later with actual hardware support via:
    // - node-hid (if native modules become supported)
    // - Bun FFI bindings to libusb/hidapi
    // - WebSocket bridge to browser Gamepad API
    
    log.info("PS4 Controller plugin initializing")
    this.state.connected = true
    log.info("PS4 Controller ready (simulated mode)", {
      buttonMappings: this.state.buttonLabels,
    })
  }

  isConnected(): boolean {
    return this.state.connected
  }

  getButtonLabel(action: keyof ControllerState["buttonLabels"]): string {
    return this.state.buttonLabels[action]
  }

  async vibrate(duration: number = 500, intensity: number = 1.0) {
    if (!this.state.vibrationEnabled) return
    
    log.info("Controller vibration triggered", { duration, intensity })
    
    // In a real implementation, this would send a vibration command
    // to the controller via HID output report. The DualShock 4 protocol
    // supports setting left and right motor intensities (0-255).
    // 
    // Example pseudo-code:
    // const report = new Uint8Array(32);
    // report[0] = 0x05; // Report ID for output
    // report[4] = Math.floor(intensity * 255); // Right motor
    // report[5] = Math.floor(intensity * 255); // Left motor
    // hidDevice.write(report);
    // await Bun.sleep(duration);
    // // Stop vibration
    // report[4] = 0;
    // report[5] = 0;
    // hidDevice.write(report);
  }

  async setLEDColor(r: number, g: number, b: number) {
    log.info("Setting controller LED color", { r, g, b })
    
    // In a real implementation, this would send LED color commands
    // to the controller. DualShock 4 supports RGB LED control.
  }
}

export async function PS4ControllerPlugin(input: PluginInput): Promise<Hooks> {
  const controller = new PS4Controller()

  // Subscribe to session events to trigger vibration when agent needs attention
  Bus.subscribe(Session.Event.Thinking, async (event) => {
    if (controller.isConnected()) {
      // Vibrate briefly when agent starts thinking
      await controller.vibrate(200, 0.3)
    }
  })

  Bus.subscribe(Session.Event.Error, async (event) => {
    if (controller.isConnected()) {
      // Strong vibration on errors to get user's attention
      await controller.vibrate(1000, 1.0)
    }
  })

  Bus.subscribe(Question.Event.Asked, async (event) => {
    if (controller.isConnected()) {
      // Gentle vibration when question is asked
      await controller.vibrate(300, 0.5)
    }
  })

  return {
    event: async ({ event }) => {
      // Log all events for debugging
      // In a full implementation, this could map controller buttons
      // to specific event types
    },

    "permission.ask": async (input, output) => {
      // When permissions are requested, ensure controller feedback
      if (controller.isConnected()) {
        await controller.vibrate(400, 0.4)
      }
    },

    "experimental.chat.system.transform": async (input, output) => {
      // Add controller button hints to system prompts when controller is connected
      if (controller.isConnected()) {
        const buttonInfo = `

## Controller Support Active

PS4 DualShock controller is connected. Button mappings:
- ${controller.getButtonLabel("accept")} - Accept/Confirm
- ${controller.getButtonLabel("cancel")} - Cancel/Go Back
- ${controller.getButtonLabel("up")}/${controller.getButtonLabel("down")} - Navigate options
- ${controller.getButtonLabel("left")}/${controller.getButtonLabel("right")} - Switch tabs/panels

When presenting options to the user, include button hints in format: "[R2] Accept" or "[L2] Cancel"`

        output.system.push(buttonInfo)
      }
    },
  }
}
