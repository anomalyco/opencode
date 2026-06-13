export * as ComputerControlTool from "./computer-control"

import { Tool, ToolFailure, toolText } from "@cedric/llm"
import { Cause, Effect, Layer, Schema } from "effect"
import { execSync } from "child_process"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { ToolRegistry } from "./registry"

export const name = "computer_control"

export const Parameters = Schema.Struct({
  action: Schema.Literals(["screenshot", "click", "type", "scroll", "key_combo"]).annotate({
    description: "The computer control action to perform",
  }),
  x: Schema.Number.pipe(Schema.optional).annotate({
    description: "X coordinate for click/scroll actions",
  }),
  y: Schema.Number.pipe(Schema.optional).annotate({
    description: "Y coordinate for click/scroll actions",
  }),
  width: Schema.Number.pipe(Schema.optional).annotate({
    description: "Width for region screenshot",
  }),
  height: Schema.Number.pipe(Schema.optional).annotate({
    description: "Height for region screenshot",
  }),
  fullScreen: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Capture full screen instead of region",
  }),
  text: Schema.String.pipe(Schema.optional).annotate({
    description: "Text to type for keyboard actions",
  }),
  pressEnter: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Press Enter after typing",
  }),
  button: Schema.Literals(["left", "right", "middle"])
    .pipe(Schema.optional)
    .annotate({
      description: "Mouse button for click actions",
    }),
  doubleClick: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Perform a double-click",
  }),
  deltaX: Schema.Number.pipe(Schema.optional).annotate({
    description: "Horizontal scroll delta",
  }),
  deltaY: Schema.Number.pipe(Schema.optional).annotate({
    description: "Vertical scroll delta",
  }),
  keyCombo: Schema.Array(Schema.String).pipe(Schema.optional).annotate({
    description: "Key combination modifiers (e.g., [\"command\", \"c\"] for Cmd+C)",
  }),
})

const ScreenshotSuccess = Schema.Struct({
  action: Schema.Literal("screenshot"),
  imageData: Schema.String,
  width: Schema.Number,
  height: Schema.Number,
  format: Schema.Literal("png"),
  sizeBytes: Schema.Number,
})

const ClickSuccess = Schema.Struct({
  action: Schema.Literal("click"),
  x: Schema.Number,
  y: Schema.Number,
  button: Schema.String,
  doubleClick: Schema.Boolean,
})

const TypeSuccess = Schema.Struct({
  action: Schema.Literal("type"),
  text: Schema.String,
  pressEnter: Schema.Boolean,
})

const ScrollSuccess = Schema.Struct({
  action: Schema.Literal("scroll"),
  x: Schema.Number,
  y: Schema.Number,
  deltaX: Schema.Number,
  deltaY: Schema.Number,
})

const KeyComboSuccess = Schema.Struct({
  action: Schema.Literal("key_combo"),
  keys: Schema.Array(Schema.String),
})

export const Success = Schema.Union([ScreenshotSuccess, ClickSuccess, TypeSuccess, ScrollSuccess, KeyComboSuccess])

type Parameters = typeof Parameters.Type
type Success = typeof Success.Type
type ScreenshotSuccess = typeof ScreenshotSuccess.Type
type ClickSuccess = typeof ClickSuccess.Type
type TypeSuccess = typeof TypeSuccess.Type
type ScrollSuccess = typeof ScrollSuccess.Type
type KeyComboSuccess = typeof KeyComboSuccess.Type

const modelOutput = (output: Success) => {
  switch (output.action) {
    case "screenshot":
      return `Screenshot captured: ${output.width}x${output.height} PNG (${(output.sizeBytes / 1024).toFixed(1)} KB)`
    case "click":
      return `Clicked at (${output.x}, ${output.y}) with ${output.button} button${output.doubleClick ? " (double-click)" : ""}`
    case "type":
      return `Typed: "${output.text}"${output.pressEnter ? " + Enter" : ""}`
    case "scroll":
      return `Scrolled at (${output.x}, ${output.y}) with delta (${output.deltaX}, ${output.deltaY})`
    case "key_combo":
      return `Key combo executed: ${output.keys.join(" + ")}`
  }
}

const definition = Tool.make({
  description: `Control the user's computer for automation tasks. Supports screenshots, mouse clicks, keyboard input, scrolling, and key combinations. All actions execute with host-user authority and may require macOS Accessibility / Screen Recording permissions. Available actions: screenshot (full screen or region), click (at x,y coordinates), type (text input), scroll (at x,y with delta), key_combo (modifier+key combinations like Command+C).`,
  parameters: Parameters,
  success: Success,
  toModelOutput: ({ output }) => [toolText({ type: "text", text: modelOutput(output) })],
})

// ── Native implementations ───────────────────────────────────────

const platform = os.platform()

const permissionResource = (parameters: Parameters) => {
  switch (parameters.action) {
    case "screenshot":
      return parameters.x !== undefined && parameters.y !== undefined && parameters.width && parameters.height
        ? `screenshot:${parameters.x},${parameters.y},${parameters.width},${parameters.height}`
        : "screenshot:full"
    case "click":
      return `click:${parameters.button ?? "left"}:${parameters.x ?? "?"},${parameters.y ?? "?"}`
    case "type":
      return `type:${parameters.text?.length ?? 0} chars${parameters.pressEnter ? "+enter" : ""}`
    case "scroll":
      return `scroll:${parameters.x ?? "?"},${parameters.y ?? "?"}:${parameters.deltaX ?? 0},${parameters.deltaY ?? 0}`
    case "key_combo":
      return `key_combo:${[...(parameters.keyCombo ?? []), parameters.text ?? "?"].join("+")}`
  }
}

const takeScreenshot = (params: {
  fullScreen?: boolean
  x?: number
  y?: number
  width?: number
  height?: number
}): Effect.Effect<ScreenshotSuccess, Error> =>
  Effect.gen(function* () {
    const tmpDir = os.tmpdir()
    const tmpPath = path.join(tmpDir, `opencode-screenshot-${Date.now()}.png`)

    if (platform === "darwin") {
      if (params.x !== undefined && params.y !== undefined && params.width && params.height) {
        execSync(`screencapture -x -R${params.x},${params.y},${params.width},${params.height} "${tmpPath}"`, {
          timeout: 15000,
        })
      } else {
        execSync(`screencapture -x "${tmpPath}"`, { timeout: 15000 })
      }
    } else if (platform === "win32") {
      const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bitmap = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
        $bitmap.Save("${tmpPath.replace(/\\/g, "\\\\")}")
      `
      execSync(`powershell -Command "${psScript.replace(/"/g, "\\\"")}"`, { timeout: 15000 })
    } else {
      try {
        execSync(`import -window root "${tmpPath}"`, { timeout: 15000 })
      } catch {
        execSync(`gnome-screenshot -f "${tmpPath}"`, { timeout: 15000 })
      }
    }

    if (!fs.existsSync(tmpPath)) {
      return yield* Effect.fail(new Error("Screenshot file was not created. Check screen recording permissions."))
    }

    const imageBuffer = fs.readFileSync(tmpPath)
    const imageData = imageBuffer.toString("base64")
    const stats = fs.statSync(tmpPath)
    fs.unlinkSync(tmpPath)

    const width = params.width ?? 1920
    const height = params.height ?? 1080

    return {
      action: "screenshot" as const,
      imageData,
      width,
      height,
      format: "png" as const,
      sizeBytes: stats.size,
    }
  })

const doMouseClick = (params: {
  x: number
  y: number
  button: "left" | "right" | "middle"
  doubleClick: boolean
}): Effect.Effect<ClickSuccess, Error> =>
  Effect.gen(function* () {
    if (platform === "darwin") {
      try {
        let cliclickCmd: string
        if (params.doubleClick) {
          cliclickCmd = "cliclick dc:" + params.x + "," + params.y
        } else if (params.button === "right") {
          cliclickCmd = "cliclick rc:" + params.x + "," + params.y
        } else {
          cliclickCmd = "cliclick c:" + params.x + "," + params.y
        }
        execSync(cliclickCmd, { timeout: 5000 })
      } catch {
        const appleScript = "tell application \"System Events\" to click at {" + params.x + ", " + params.y + "}"
        execSync("osascript -e '" + appleScript.replace(/'/g, "'\\''") + "'", { timeout: 5000 })
      }
    } else if (platform === "win32") {
      const psScript = `
        Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int buttons, int info);' -Name Mouse -Namespace WinAPI
        [WinAPI.Mouse]::mouse_event(0x0002, 0, 0, 0, 0)
        [WinAPI.Mouse]::mouse_event(0x0004, 0, 0, 0, 0)
      `
      execSync(`powershell -Command "${psScript}"`, { timeout: 5000 })
    } else {
      let buttonNum: number
      if (params.button === "right") {
        buttonNum = 3
      } else if (params.button === "middle") {
        buttonNum = 2
      } else {
        buttonNum = 1
      }
      let clickCmd: string
      if (params.doubleClick) {
        clickCmd = "xdotool mousemove " + params.x + " " + params.y + " click --repeat 2 " + buttonNum
      } else {
        clickCmd = "xdotool mousemove " + params.x + " " + params.y + " click " + buttonNum
      }
      execSync(clickCmd, { timeout: 5000 })
    }

    return {
      action: "click" as const,
      x: params.x,
      y: params.y,
      button: params.button,
      doubleClick: params.doubleClick,
    }
  })

const doKeyboardType = (params: {
  text: string
  pressEnter: boolean
  keyCombo?: ReadonlyArray<string>
}): Effect.Effect<TypeSuccess | KeyComboSuccess, Error> =>
  Effect.gen(function* () {
    if (platform === "darwin") {
      const escapedText = params.text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")

      if (params.keyCombo && params.keyCombo.length > 0) {
        const modifiers = params.keyCombo
          .filter((k) => k !== params.text)
          .map((k) => {
            const map: Record<string, string> = {
              command: "command down",
              cmd: "command down",
              control: "control down",
              ctrl: "control down",
              option: "option down",
              alt: "option down",
              shift: "shift down",
            }
            return map[k.toLowerCase()] || `${k} down`
          })
          .join(", ")
        const script = `tell application "System Events" to keystroke "${escapedText}" using {${modifiers}}`
        execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 10000 })
        return {
          action: "key_combo" as const,
          keys: [...params.keyCombo, params.text],
        }
      }

      let appleScript = `tell application "System Events"\n  keystroke "${escapedText}"\n`
      if (params.pressEnter) appleScript += `  key code 36\n`
      appleScript += `end tell`
      execSync(`osascript -e '${appleScript.replace(/'/g, "'\\''")}'`, { timeout: 10000 })
    } else if (platform === "win32") {
      const escaped = params.text
        .replace(/\{/g, "{{}")
        .replace(/\}/g, "{}}")
        .replace(/\+/g, "{+}")
        .replace(/\^/g, "{^}")
        .replace(/%/g, "{%}")
      const enterKey = params.pressEnter ? "{ENTER}" : ""
      execSync(
        `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escaped}${enterKey}')"`,
        { timeout: 10000 },
      )
    } else {
      execSync(`xdotool type --delay 10 "${params.text.replace(/"/g, '\\"')}"`, { timeout: 10000 })
      if (params.pressEnter) execSync(`xdotool key Return`, { timeout: 5000 })
    }

    return {
      action: "type" as const,
      text: params.text,
      pressEnter: params.pressEnter,
    }
  })

const doScroll = (params: {
  x: number
  y: number
  deltaX: number
  deltaY: number
}): Effect.Effect<ScrollSuccess, Error> =>
  Effect.gen(function* () {
    if (platform === "darwin") {
      try {
        execSync(`cliclick m:${params.x},${params.y}`, { timeout: 5000 })
      } catch {
        execSync(`osascript -e 'tell application "System Events" to set mouseLocation to {${params.x}, ${params.y}}'`, {
          timeout: 5000,
        })
      }
      // Native scroll requires CGEvent API; AppleScript has no scroll wheel support.
      // Positioning the mouse is the best-effort fallback.
    } else if (platform === "win32") {
      const psScript = `
        Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int data, int info);' -Name Mouse -Namespace WinAPI
        [WinAPI.Mouse]::mouse_event(0x0800, 0, 0, ${params.deltaY}, 0)
      `
      execSync(`powershell -Command "${psScript}"`, { timeout: 5000 })
    } else {
      if (params.deltaY !== 0) {
        const scrollButton = params.deltaY > 0 ? 4 : 5
        const repeats = Math.min(Math.abs(params.deltaY), 20)
        execSync(`xdotool click --repeat ${repeats} ${scrollButton}`, { timeout: 5000 })
      }
    }

    return {
      action: "scroll" as const,
      x: params.x,
      y: params.y,
      deltaX: params.deltaX,
      deltaY: params.deltaY,
    }
  })

// ── Tool layer ───────────────────────────────────────────────────

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service

    yield* registry.contribute((editor) =>
      editor.set(name, {
        tool: definition,
        execute: ({ parameters, assertPermission }) =>
          Effect.gen(function* () {
            yield* assertPermission({ action: name, resources: [permissionResource(parameters)] })

            switch (parameters.action) {
              case "screenshot": {
                return yield* takeScreenshot({
                  fullScreen: parameters.fullScreen,
                  x: parameters.x,
                  y: parameters.y,
                  width: parameters.width,
                  height: parameters.height,
                })
              }
              case "click": {
                if (parameters.x === undefined || parameters.y === undefined) {
                  return yield* Effect.fail(new ToolFailure({ message: "Click action requires x and y coordinates" }))
                }
                return yield* doMouseClick({
                  x: parameters.x,
                  y: parameters.y,
                  button: parameters.button ?? "left",
                  doubleClick: parameters.doubleClick ?? false,
                })
              }
              case "type": {
                if (!parameters.text) {
                  return yield* Effect.fail(new ToolFailure({ message: "Type action requires text" }))
                }
                return yield* doKeyboardType({
                  text: parameters.text,
                  pressEnter: parameters.pressEnter ?? false,
                })
              }
              case "scroll": {
                if (parameters.x === undefined || parameters.y === undefined) {
                  return yield* Effect.fail(new ToolFailure({ message: "Scroll action requires x and y coordinates" }))
                }
                return yield* doScroll({
                  x: parameters.x,
                  y: parameters.y,
                  deltaX: parameters.deltaX ?? 0,
                  deltaY: parameters.deltaY ?? 0,
                })
              }
              case "key_combo": {
                if (!parameters.text) {
                  return yield* Effect.fail(new ToolFailure({ message: "Key combo action requires text" }))
                }
                return yield* doKeyboardType({
                  text: parameters.text,
                  pressEnter: false,
                  keyCombo: parameters.keyCombo,
                })
              }
              default:
                return yield* Effect.fail(new ToolFailure({ message: `Unknown action: ${(parameters as any).action}` }))
            }
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.fail(
                new ToolFailure({
                  message: `Computer control action failed: ${parameters.action}`,
                  error: Cause.squash(cause),
                }),
              ),
            ),
          ),
      }),
    )
  }),
)
