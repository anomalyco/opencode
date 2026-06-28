import path from "path"
import { Effect, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import * as Tool from "./tool"
import { AppProcess } from "@opencode-ai/core/process"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { SessionCwd } from "./session-cwd"
import { detect } from "./package-manager"

const DESCRIPTION = [
  "Run the project's test suite and return the result.",
  "",
  "Auto-detects the runner: a `test` script in package.json (run via the detected package manager),",
  "otherwise Go (go.mod), Rust (Cargo.toml), or Python (pyproject.toml/pytest).",
  "Pass `path` to scope to a file/dir and `filter` to pass a name filter to the runner.",
  "Prefer this over running tests through the shell so the command + output are structured.",
].join("\n")

export const Parameters = Schema.Struct({
  path: Schema.optional(Schema.String).annotate({ description: "File or directory to scope the tests to" }),
  filter: Schema.optional(Schema.String).annotate({ description: "Test name filter passed to the runner" }),
})

export const TestTool = Tool.define(
  "test",
  Effect.gen(function* () {
    const proc = yield* AppProcess.Service
    const fs = yield* FSUtil.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          const cwd = SessionCwd.get(ctx.sessionID, ins.directory)

          const resolved = yield* (() =>
            Effect.gen(function* () {
              if (yield* fs.existsSafe(path.join(cwd, "package.json"))) {
                const pm = yield* detect(fs, cwd)
                const base = pm === "npm" ? ["test", "--"] : ["test"]
                const extra = [...(args.filter ? [args.filter] : []), ...(args.path ? [args.path] : [])]
                return { cmd: pm, args: [...base, ...extra] }
              }
              if (yield* fs.existsSafe(path.join(cwd, "go.mod"))) {
                return { cmd: "go", args: ["test", ...(args.filter ? ["-run", args.filter] : []), args.path ?? "./..."] }
              }
              if (yield* fs.existsSafe(path.join(cwd, "Cargo.toml"))) {
                return { cmd: "cargo", args: ["test", ...(args.filter ? [args.filter] : [])] }
              }
              if (
                (yield* fs.existsSafe(path.join(cwd, "pyproject.toml"))) ||
                (yield* fs.existsSafe(path.join(cwd, "pytest.ini")))
              ) {
                return {
                  cmd: "pytest",
                  args: [...(args.filter ? ["-k", args.filter] : []), ...(args.path ? [args.path] : [])],
                }
              }
              return undefined
            }))()

          if (!resolved) {
            throw new Error("Could not detect a test runner (no package.json/go.mod/Cargo.toml/pyproject.toml).")
          }

          yield* ctx.ask({
            permission: "test",
            patterns: [resolved.cmd],
            always: ["*"],
            metadata: { command: `${resolved.cmd} ${resolved.args.join(" ")}` },
          })

          const result = yield* proc
            .run(
              ChildProcess.make(resolved.cmd, resolved.args, {
                cwd,
                extendEnv: true,
                stdin: "ignore",
                stdout: "pipe",
                stderr: "pipe",
              }),
              { combineOutput: true, maxOutputBytes: 256 * 1024 },
            )
            .pipe(Effect.catch((err) => Effect.fail(new Error(err.message))))

          const text = (result.output ?? Buffer.alloc(0)).toString("utf8").trim()
          const header = `$ ${resolved.cmd} ${resolved.args.join(" ")}\n(exit ${result.exitCode})\n`

          return {
            title: `test ${resolved.cmd}${result.exitCode === 0 ? "" : " ✗"}`,
            metadata: { exitCode: result.exitCode, command: resolved.cmd },
            output: header + (text || "(no output)"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
