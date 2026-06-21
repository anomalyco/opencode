export * as TermuxTool from "./termux"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { spawn } from "child_process"

export const name = "zero_termux_api"

export const Input = Schema.Struct({
  action: Schema.optional(Schema.Literals([
    "notification",
    "toast",
    "clipboard-get",
    "clipboard-set",
    "battery",
    "vibrate",
    "tts-speak",
    "location",
    "torch",
    "volume",
    "brightness",
    "contact-list",
    "sms-list",
    "sms-send",
    "telephony-deviceinfo",
    "wifi-connectioninfo"
  ])),
  apiCommand: Schema.optional(Schema.String).annotate({
    description: "Autonomously run any Termux API command directly (e.g. 'termux-camera-photo', 'termux-vibrate', etc.) without prefix constraints.",
  }),
  args: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Arguments to pass to the Termux API command (e.g. ['-t', 'Title', '-c', 'Content'] for notification)",
  }),
})

export const Output = Schema.Struct({
  success: Schema.Boolean,
  output: Schema.String,
})

function runTermuxCommand(executable: string, args: readonly string[]) {
  return Effect.promise<{ success: boolean; output: string }>(() => {
    return new Promise((resolve) => {
      // Spawns the executable using Termux libc protection
      const proc = spawn(executable, args, {
        env: { ...process.env, LD_PRELOAD: "" },
        stdio: "pipe",
      })

      let output = ""
      let errorOutput = ""

      const timer = setTimeout(() => {
        proc.kill()
        resolve({
          success: false,
          output: `Command '${executable}' timed out. Make sure the Termux:API Android application is installed and has necessary permissions.`,
        })
      }, 2000)

      proc.stdout.on("data", (data) => {
        output += data.toString()
      })
      proc.stderr.on("data", (data) => {
        errorOutput += data.toString()
      })

      proc.on("close", (code) => {
        clearTimeout(timer)
        if (code === 0) {
          resolve({ success: true, output })
        } else {
          // If execution fails with ENOENT, it means termux-api package or the command is missing
          resolve({
            success: false,
            output: `Command failed with code ${code}. Stderr: ${errorOutput}. Make sure termux-api is installed.`,
          })
        }
      })

      proc.on("error", (err: any) => {
        clearTimeout(timer)
        if (err.code === "ENOENT") {
          resolve({
            success: false,
            output: `Command '${executable}' not found. Please install the termux-api package on Android (pkg install termux-api) and enable Termux API permissions.`,
          })
        } else {
          resolve({ success: false, output: `Process error: ${err.message}` })
        }
      })
    })
  })
}

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description: "Interact with Android system features (notifications, clipboard, battery, vibration) via Termux APIs.",
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text: `Termux command result: success=${output.success}\nOutput:\n${output.output}`,
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: ["*"],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })

              const actionMap: Record<string, string> = {
                notification: "termux-notification",
                toast: "termux-toast",
                "clipboard-get": "termux-clipboard-get",
                "clipboard-set": "termux-clipboard-set",
                battery: "termux-battery-status",
                vibrate: "termux-vibrate",
                "tts-speak": "termux-tts-speak",
                location: "termux-location",
                torch: "termux-torch",
                volume: "termux-volume",
                brightness: "termux-brightness",
                "contact-list": "termux-contact-list",
                "sms-list": "termux-sms-list",
                "sms-send": "termux-sms-send",
                "telephony-deviceinfo": "termux-telephony-deviceinfo",
                "wifi-connectioninfo": "termux-wifi-connectioninfo",
              }

              let executable = ""
              if (input.apiCommand) {
                executable = input.apiCommand
              } else if (input.action) {
                executable = actionMap[input.action]
              } else {
                return yield* Effect.fail(new ToolFailure({ message: "Either 'action' or 'apiCommand' must be provided." }))
              }

              const commandArgs = input.args || []

              const result = yield* runTermuxCommand(executable, commandArgs)
              return result
            }).pipe(
              Effect.mapError((err) => (err instanceof ToolFailure ? err : new ToolFailure({ message: "Termux API call failed" })))
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
