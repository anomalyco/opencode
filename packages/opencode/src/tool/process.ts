import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import { SessionCwd } from "./session-cwd"
import * as Registry from "./process-registry"

const START_DESCRIPTION = [
  "Start a long-running process in the background (dev server, build watcher, etc.) and return immediately.",
  "Returns a process id; read its output later with process_logs and stop it with process_stop.",
  "Use this instead of the blocking shell for commands that don't exit on their own.",
  "The command runs via the system shell, relative to the session working directory (see change_directory).",
].join("\n")

export const StartParameters = Schema.Struct({
  command: Schema.String.annotate({ description: "The command to run (executed via the system shell)" }),
})

export const ProcessStartTool = Tool.define(
  "process_start",
  Effect.gen(function* () {
    return {
      description: START_DESCRIPTION,
      parameters: StartParameters,
      execute: (args: Schema.Schema.Type<typeof StartParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!args.command.trim()) throw new Error("command is required")
          const ins = yield* InstanceState.context
          const cwd = SessionCwd.get(ctx.sessionID, ins.directory)

          yield* ctx.ask({
            permission: "process_start",
            patterns: [args.command],
            always: ["*"],
            metadata: { command: args.command },
          })

          const proc = yield* Effect.sync(() => Registry.start(args.command, cwd))
          // Give it a moment to emit early output / fail fast.
          yield* Effect.sleep("400 millis")
          const early = Registry.recent(proc, 30)

          return {
            title: `process_start ${proc.id}`,
            metadata: { id: proc.id, status: proc.status },
            output: [
              `Started background process: ${proc.id}`,
              `Command: ${args.command}`,
              `Status: ${proc.status}${proc.exitCode !== null ? ` (exit ${proc.exitCode})` : ""}`,
              early ? `\nEarly output:\n${early}` : "",
              `\nUse process_logs id=${proc.id} to read more, process_stop id=${proc.id} to stop.`,
            ]
              .filter(Boolean)
              .join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const LOGS_DESCRIPTION = [
  "Read recent output from a background process started with process_start.",
  "Returns the process status and the last `lines` lines of combined stdout/stderr.",
].join("\n")

export const LogsParameters = Schema.Struct({
  id: Schema.String.annotate({ description: "The process id returned by process_start" }),
  lines: Schema.optional(Schema.Number).annotate({ description: "How many recent lines to return (default 100)" }),
})

export const ProcessLogsTool = Tool.define(
  "process_logs",
  Effect.gen(function* () {
    return {
      description: LOGS_DESCRIPTION,
      parameters: LogsParameters,
      execute: (args: Schema.Schema.Type<typeof LogsParameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const proc = yield* Effect.sync(() => Registry.get(args.id))
          if (!proc) {
            const known = Registry.list()
              .map((p) => p.id)
              .join(", ")
            throw new Error(`No process with id ${args.id}. Known: ${known || "(none)"}.`)
          }
          const text = Registry.recent(proc, args.lines ?? 100)
          return {
            title: `process_logs ${proc.id} (${proc.status})`,
            metadata: { id: proc.id, status: proc.status, exitCode: proc.exitCode },
            output: [
              `Process ${proc.id} — ${proc.status}${proc.exitCode !== null ? ` (exit ${proc.exitCode})` : ""}`,
              `Command: ${proc.command}`,
              "",
              text || "(no output yet)",
            ].join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const STOP_DESCRIPTION = "Stop a background process started with process_start (sends SIGTERM)."

export const StopParameters = Schema.Struct({
  id: Schema.String.annotate({ description: "The process id returned by process_start" }),
})

export const ProcessStopTool = Tool.define(
  "process_stop",
  Effect.gen(function* () {
    return {
      description: STOP_DESCRIPTION,
      parameters: StopParameters,
      execute: (args: Schema.Schema.Type<typeof StopParameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ok = yield* Effect.sync(() => Registry.stop(args.id))
          if (!ok) throw new Error(`No process with id ${args.id}.`)
          return {
            title: `process_stop ${args.id}`,
            metadata: { id: args.id },
            output: `Sent SIGTERM to ${args.id}.`,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
