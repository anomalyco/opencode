import path from "path"
import { Effect, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import * as Tool from "./tool"
import { AppProcess } from "@opencode-ai/core/process"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { SessionCwd } from "./session-cwd"
import { detect, addArgs, outdatedArgs } from "./package-manager"

const runProcess = (
  proc: AppProcess.Interface,
  cmd: string,
  args: string[],
  cwd: string,
  maxBytes = 128 * 1024,
) =>
  proc
    .run(
      ChildProcess.make(cmd, args, { cwd, extendEnv: true, stdin: "ignore", stdout: "pipe", stderr: "pipe" }),
      { combineOutput: true, maxOutputBytes: maxBytes },
    )
    .pipe(Effect.catch((err) => Effect.fail(new Error(err.message))))

const ADD_DESCRIPTION = [
  "Add one or more dependencies using the project's package manager (auto-detected: bun/pnpm/yarn/npm).",
  "Set `dev=true` for devDependencies. This mutates package.json and the lockfile.",
].join("\n")

export const AddParameters = Schema.Struct({
  packages: Schema.Array(Schema.String).annotate({ description: "Package names (optionally with @version) to add" }),
  dev: Schema.optional(Schema.Boolean).annotate({ description: "Add as devDependencies (default false)" }),
})

export const DepsAddTool = Tool.define(
  "deps_add",
  Effect.gen(function* () {
    const proc = yield* AppProcess.Service
    const fs = yield* FSUtil.Service

    return {
      description: ADD_DESCRIPTION,
      parameters: AddParameters,
      execute: (args: Schema.Schema.Type<typeof AddParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (args.packages.length === 0) throw new Error("at least one package is required")
          const ins = yield* InstanceState.context
          const cwd = SessionCwd.get(ctx.sessionID, ins.directory)
          if (!(yield* fs.existsSafe(path.join(cwd, "package.json")))) {
            throw new Error("No package.json found in the working directory.")
          }
          const pm = yield* detect(fs, cwd)
          const argv = addArgs(pm, [...args.packages], args.dev === true)

          yield* ctx.ask({
            permission: "deps_add",
            patterns: [...args.packages],
            always: ["*"],
            metadata: { packageManager: pm, packages: args.packages, dev: args.dev === true },
          })

          const result = yield* runProcess(proc, pm, argv, cwd)
          const text = (result.output ?? Buffer.alloc(0)).toString("utf8").trim()
          if (result.exitCode !== 0) {
            throw new Error(`${pm} ${argv.join(" ")} failed (exit ${result.exitCode}):\n${text}`)
          }
          return {
            title: `deps_add (${pm})`,
            metadata: { exitCode: 0, packageManager: pm },
            output: `$ ${pm} ${argv.join(" ")}\n${text || "(done)"}`,
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const OUTDATED_DESCRIPTION = [
  "List outdated dependencies using the project's package manager (auto-detected).",
  "Read-only: reports current vs latest versions; does not modify anything.",
].join("\n")

export const OutdatedParameters = Schema.Struct({})

export const DepsOutdatedTool = Tool.define(
  "deps_outdated",
  Effect.gen(function* () {
    const proc = yield* AppProcess.Service
    const fs = yield* FSUtil.Service

    return {
      description: OUTDATED_DESCRIPTION,
      parameters: OutdatedParameters,
      execute: (_args: Schema.Schema.Type<typeof OutdatedParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          const cwd = SessionCwd.get(ctx.sessionID, ins.directory)
          if (!(yield* fs.existsSafe(path.join(cwd, "package.json")))) {
            throw new Error("No package.json found in the working directory.")
          }
          const pm = yield* detect(fs, cwd)
          const argv = outdatedArgs(pm)

          yield* ctx.ask({
            permission: "deps_outdated",
            patterns: ["*"],
            always: ["*"],
            metadata: { packageManager: pm },
          })

          // `outdated` returns a non-zero exit code when updates exist; that's not an error here.
          const result = yield* runProcess(proc, pm, argv, cwd)
          const text = (result.output ?? Buffer.alloc(0)).toString("utf8").trim()
          return {
            title: `deps_outdated (${pm})`,
            metadata: { exitCode: result.exitCode, packageManager: pm },
            output: text || "All dependencies are up to date.",
          }
        }).pipe(Effect.orDie),
    }
  }),
)
