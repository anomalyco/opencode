import { Effect, Schema, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { UvBinary } from "@opencode-ai/core/uv"
import { InstanceState } from "@/effect/instance-state"
import * as Tool from "./tool"
import DESCRIPTION from "./browser.txt"

const DEFAULT_TIMEOUT = 2 * 60 * 1000
const MAX_TIMEOUT = 10 * 60 * 1000

export const Parameters = Schema.Struct({
  script: Schema.String.annotate({
    description:
      "Python script to run against the browser. Helpers like new_tab(), page_info(), capture_screenshot(), click_at_xy(), and js() are pre-imported; use print() to return data.",
  }),
  timeout: Schema.optional(Schema.Number).annotate({ description: "Optional timeout in seconds (max 600)" }),
})

export const BrowserTool = Tool.define(
  "browser",
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner
    const uv = yield* UvBinary.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "browser",
            patterns: ["*"],
            always: ["*"],
            metadata: {
              script: params.script,
            },
          })

          const timeout = Math.min((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT)
          const directory = yield* InstanceState.directory

          let output = ""
          const exit = yield* Effect.scoped(
            Effect.gen(function* () {
              const spawn = (command: string, args: string[]) =>
                spawner.spawn(
                  ChildProcess.make(command, args, {
                    cwd: directory,
                    extendEnv: true,
                    stdin: Stream.make(params.script).pipe(Stream.encodeText),
                  }),
                )

              // Prefer an installed browser-use, then a system uvx; as a last
              // resort download uv itself (same on-demand provisioning as
              // ripgrep) and run the package through it. uv caches the
              // package after the first call.
              const handle = yield* spawn("browser-use", []).pipe(
                Effect.catch(() => spawn("uvx", ["browser-use"])),
                Effect.catch(() =>
                  uv.filepath.pipe(Effect.flatMap((bin) => spawn(bin, ["tool", "run", "browser-use"]))),
                ),
                Effect.mapError(
                  (cause) =>
                    new Error(
                      `Failed to start the browser-use CLI: ${cause instanceof Error ? cause.message : String(cause)}`,
                    ),
                ),
              )

              yield* Effect.forkScoped(
                Stream.runForEach(Stream.decodeText(handle.all), (chunk) =>
                  Effect.sync(() => {
                    output += chunk
                  }),
                ),
              )

              const abort = Effect.callback<void>((resume) => {
                if (ctx.abort.aborted) return resume(Effect.void)
                const handler = () => resume(Effect.void)
                ctx.abort.addEventListener("abort", handler, { once: true })
                return Effect.sync(() => ctx.abort.removeEventListener("abort", handler))
              })

              const exit = yield* Effect.raceAll([
                handle.exitCode.pipe(Effect.map((code) => ({ kind: "exit" as const, code }))),
                abort.pipe(Effect.map(() => ({ kind: "abort" as const, code: null }))),
                Effect.sleep(`${timeout} millis`).pipe(Effect.map(() => ({ kind: "timeout" as const, code: null }))),
              ])

              if (exit.kind !== "exit") {
                yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.orDie)
              }

              return exit
            }),
          )

          const title = params.script.split("\n")[0] ?? ""
          if (exit.kind === "abort") throw new Error("Browser script was aborted")
          if (exit.kind === "timeout") {
            throw new Error(`Browser script timed out after ${timeout / 1000} seconds\n${output}`.trim())
          }

          const body = output.trim() || "(no output)"
          return {
            title,
            output: exit.code === 0 ? body : `browser-use exited with code ${exit.code}\n${body}`,
            metadata: {
              exitCode: exit.code,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
