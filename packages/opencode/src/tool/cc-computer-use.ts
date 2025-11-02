import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./cc-computer-use.txt"
import { $ } from "bun"
import { Log } from "../util/log"
import path from "path"
import os from "os"

const log = Log.create({ service: "computer-use-tool" })

/**
 * cc_computer_use - Anthropic-native computer use tool
 *
 * Production-ready implementation for desktop automation
 * ⚠️ EXPERIMENTAL - Requires special permissions
 */

export const ClaudeCodeComputerUseTool = Tool.define("cc_computer_use", {
  description: DESCRIPTION,
  parameters: z.object({
    action: z
      .enum([
        "screenshot",
        "mouse_move",
        "left_click",
        "right_click",
        "double_click",
        "type",
        "key",
        "cursor_position",
      ])
      .describe("The action to perform"),
    coordinate: z
      .tuple([z.number(), z.number()])
      .optional()
      .describe("Screen coordinates [x, y] for mouse_move"),
    text: z.string().optional().describe("Text to type or key to press"),
  }),
  async execute(params, ctx) {
    log.info("computer use", { action: params.action })

    const platform = process.platform

    try {
      switch (params.action) {
        case "screenshot": {
          const tempFile = path.join(os.tmpdir(), `screenshot-${Date.now()}.png`)

          if (platform === "darwin") {
            await $`screencapture -x -t png ${tempFile}`.quiet()
          } else if (platform === "linux") {
            await $`import -window root ${tempFile}`.quiet()
          } else {
            throw new Error(`Platform ${platform} not supported`)
          }

          const imageBuffer = await Bun.file(tempFile).arrayBuffer()
          const base64 = Buffer.from(imageBuffer).toString("base64")
          await Bun.file(tempFile)
            .unlink()
            .catch(() => {})

          return {
            title: "Screenshot captured",
            output: `Screenshot: data:image/png;base64,${base64.substring(0, 100)}... (${Math.round(base64.length / 1024)}KB)`,
            metadata: {},
          }
        }

        case "mouse_move": {
          if (!params.coordinate) throw new Error("coordinate required")
          const [x, y] = params.coordinate

          if (platform === "darwin") {
            await $`cliclick m:${x},${y}`.quiet()
          } else if (platform === "linux") {
            await $`xdotool mousemove ${x} ${y}`.quiet()
          } else {
            throw new Error(`Platform ${platform} not supported`)
          }

          return {
            title: "Mouse moved",
            output: `Mouse moved to ${x}, ${y}`,
            metadata: {},
          }
        }

        case "left_click": {
          if (platform === "darwin") {
            await $`cliclick c:.`.quiet()
          } else if (platform === "linux") {
            await $`xdotool click 1`.quiet()
          } else {
            throw new Error(`Platform ${platform} not supported`)
          }

          return {
            title: "Left click",
            output: "Performed left click",
            metadata: {},
          }
        }

        case "right_click": {
          if (platform === "darwin") {
            await $`cliclick rc:.`.quiet()
          } else if (platform === "linux") {
            await $`xdotool click 3`.quiet()
          } else {
            throw new Error(`Platform ${platform} not supported`)
          }

          return {
            title: "Right click",
            output: "Performed right click",
            metadata: {},
          }
        }

        case "double_click": {
          if (platform === "darwin") {
            await $`cliclick dc:.`.quiet()
          } else if (platform === "linux") {
            await $`xdotool click --repeat 2 1`.quiet()
          } else {
            throw new Error(`Platform ${platform} not supported`)
          }

          return {
            title: "Double click",
            output: "Performed double click",
            metadata: {},
          }
        }

        case "type": {
          if (!params.text) throw new Error("text required")

          if (platform === "darwin") {
            const escaped = params.text.replace(/["\\]/g, "\\$&")
            await $`osascript -e 'tell application "System Events" to keystroke "${escaped}"'`.quiet()
          } else if (platform === "linux") {
            await $`xdotool type -- ${params.text}`.quiet()
          } else {
            throw new Error(`Platform ${platform} not supported`)
          }

          return {
            title: "Text typed",
            output: `Typed: ${params.text.substring(0, 100)}${params.text.length > 100 ? "..." : ""}`,
            metadata: {},
          }
        }

        case "key": {
          if (!params.text) throw new Error("key name required")

          if (platform === "darwin") {
            const keyMap: Record<string, string> = {
              Return: "return",
              Enter: "return",
              Tab: "tab",
              Escape: "escape",
              Space: "space",
            }
            const key = keyMap[params.text] || params.text.toLowerCase()
            await $`osascript -e 'tell application "System Events" to keystroke "${key}"'`.quiet()
          } else if (platform === "linux") {
            await $`xdotool key ${params.text}`.quiet()
          } else {
            throw new Error(`Platform ${platform} not supported`)
          }

          return {
            title: "Key pressed",
            output: `Pressed: ${params.text}`,
            metadata: {},
          }
        }

        case "cursor_position": {
          let x = 0
          let y = 0

          if (platform === "darwin") {
            // Use Python to get mouse position (most reliable on macOS)
            const result =
              await $`python3 -c "from Quartz import CGEventGetLocation, CGEventCreate; loc = CGEventGetLocation(CGEventCreate(None)); print(f'{int(loc.x)},{int(loc.y)}')"`.text()
            const coords = result.trim().split(",")
            x = parseInt(coords[0])
            y = parseInt(coords[1])
          } else if (platform === "linux") {
            const result = await $`xdotool getmouselocation --shell`.text()
            const lines = result.split("\n")
            x = parseInt(lines[0].split("=")[1])
            y = parseInt(lines[1].split("=")[1])
          } else {
            throw new Error(`Platform ${platform} not supported`)
          }

          return {
            title: "Cursor position",
            output: `Cursor at ${x}, ${y}`,
            metadata: {},
          }
        }

        default:
          throw new Error(`Unknown action: ${params.action}`)
      }
    } catch (error) {
      log.error("computer use failed", { error, action: params.action })
      return {
        title: "Action Failed",
        output: `Failed: ${error instanceof Error ? error.message : String(error)}`,
        metadata: {},
      }
    }
  },
})
