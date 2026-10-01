export * as MonitorTool from "./monitor.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { ID, Info } from "@opencode/schema/monitor"
import { Effect, Schema } from "effect"
import { Monitor } from "../../monitor.js"
import { Shell } from "../../shell.js"
import { ShellSelect } from "../../shell/select.js"
import { ShellPermission } from "../shell-permission.js"

export const description = `Start a background watcher and return immediately with its task ID. Use monitor for "tell me each time X happens" or "watch until a known end". Each stdout line is event data; nearby lines are batched. By default, events steer your ongoing work at the next safe step boundary, without cancelling running tools, or wake this session when idle. Choose delivery: "queue" to wait until the current turn ends. Stderr is logged without creating events. End your turn when there is no other work; never poll or sleep waiting for a monitor.
Use plain background shell for a single "tell me when it's done". Every pipe stage must flush lines (for example, grep --line-buffered). Filters must include failure states as well as success; silence must never be interpreted as "still running". Poll remote APIs no more often than every 30 seconds. Watchers must exit at their known end. The default lifetime is 5 minutes, maximum 30 minutes. High event rates or excessive output stop the monitor. Use monitor_stop with its ID to cancel early.
Examples:
- Log errors: tail -n 0 -F app.log | grep --line-buffered -Ei 'error|fatal|panic|failed'
- CI job by job: run a small script that queries gh api repos/OWNER/REPO/actions/runs/RUN_ID/jobs every 30s, prints each newly completed job once (including failures, cancellations and timeouts), then prints the final run conclusion and exits when the run completes. Report API errors too.
- Local process: run a small script that observes a known PID, prints state changes, then prints that the process exited and exits itself. For only its final completion, prefer a plain background shell command instead.`

export const Plugin = {
  id: "opencode.tool.monitor",
  effect: Effect.fn("MonitorTool.Plugin")(function* (ctx: Context) {
    const monitors = yield* Monitor.Service
    const shell = yield* Shell.Service
    const select = yield* ShellSelect.Service
    const prepare = yield* ShellPermission.prepare
    yield* ctx.tool
      .transform((editor) => {
        editor.add({
          name: "monitor",
          options: { codemode: false, permission: "shell" },
          description,
          input: Monitor.Input,
          output: Info,
          execute: (input, context) =>
            Effect.gen(function* () {
              return yield* monitors.start(input, {
                sessionID: context.sessionID,
                shell,
                shellPath: yield* select.resolve({ priority: "compat" }),
                before: (invocation) => prepare(invocation, context).pipe(Effect.asVoid),
              })
            }).pipe(
              Effect.map((info) => ({
                output: info,
                content: [
                  {
                    type: "text" as const,
                    text: `Monitor started: ${info.id} (${info.description}). Events will arrive automatically. End your turn if there is no other work. Expires: ${new Date(info.expiresAt).toISOString()}. Log: ${info.log}`,
                  },
                ],
                metadata: { monitorID: info.id, shellID: info.shellID },
              })),
              Effect.mapError((error) => new ToolFailure({ message: "Unable to start monitor", error })),
            ),
        })
        editor.add({
          name: "monitor_stop",
          options: { codemode: false, permission: "shell" },
          description:
            "Stop a monitor from this session by its returned task ID. Its saved process group is terminated and one final event is delivered.",
          input: Schema.Struct({ id: ID }),
          output: Info,
          execute: (input, context) =>
            monitors.stop({ id: input.id, sessionID: context.sessionID }).pipe(
              Effect.map((info) => ({
                output: info,
                content: [
                  {
                    type: "text" as const,
                    text: `Monitor ${info.id} ended: ${info.reason}. ${info.eventCount} events.`,
                  },
                ],
                metadata: { monitorID: info.id },
              })),
              Effect.mapError((error) => new ToolFailure({ message: "Unable to stop monitor", error })),
            ),
        })
      })
      .pipe(Effect.orDie)
  }),
}
