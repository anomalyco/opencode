export * as SandboxFiles from "./files.js"

import path from "node:path"
import { Effect, Schema } from "effect"
import { ChildProcess } from "effect/process"
import type { AppProcess } from "@opencode/util/process"
import { EnvironmentFiles } from "../environment/files.js"
import { SandboxFileProtocol } from "./file-protocol.js"
import type { SandboxPolicy } from "./policy.js"

const decodeRequest = Schema.decodeUnknownEffect(SandboxFileProtocol.Request)
const decodeReply = Schema.decodeUnknownEffect(Schema.fromJsonString(SandboxFileProtocol.Reply))

export interface Interface extends EnvironmentFiles.Files {
  readonly check: (path: string, operation: "write" | "remove") => Effect.Effect<void, EnvironmentFiles.Failed>
}

/** Agent-only file binding. The launch is already confined; failure never falls back to host I/O. */
export function make(options: {
  readonly process: Pick<AppProcess.Interface, "run">
  readonly launch: SandboxPolicy.Launch
  readonly directory: string
  readonly cwd: string
}): Interface {
  const absolute = (value: string) => path.resolve(options.directory, value)
  const run = (request: SandboxFileProtocol.Request) =>
    Effect.gen(function* () {
      yield* decodeRequest(request).pipe(
        Effect.mapError((cause) => new EnvironmentFiles.Failed({ path: request.path, cause })),
      )
      const frame = JSON.stringify(request)
      if (Buffer.byteLength(frame) > SandboxFileProtocol.MAX_FRAME_BYTES)
        return yield* new EnvironmentFiles.Failed({
          path: request.path,
          cause: new Error("File helper request exceeds its collection limit"),
        })
      const result = yield* options.process
        .run(
          ChildProcess.make(options.launch.command, options.launch.args, {
            cwd: options.cwd,
            env: options.launch.env,
            extendEnv: false,
            detached: process.platform !== "win32",
            forceKillAfter: "1 second",
          }),
          {
            stdin: frame,
            maxOutputBytes: SandboxFileProtocol.MAX_FRAME_BYTES,
            maxErrorBytes: 64 * 1024,
            timeout: "30 seconds",
          },
        )
        .pipe(Effect.mapError((cause) => new EnvironmentFiles.Failed({ path: request.path, cause })))
      if (result.exitCode !== 0 || result.stdoutTruncated || result.stderrTruncated)
        return yield* new EnvironmentFiles.Failed({
          path: request.path,
          cause: new Error(result.stderr.toString().trim() || "File helper failed or exceeded its collection limit"),
        })
      const reply = yield* decodeReply(result.stdout.toString("utf8")).pipe(
        Effect.mapError((cause) => new EnvironmentFiles.Failed({ path: request.path, cause })),
      )
      if (reply.op === "error") {
        if (reply.kind === "NotFound") return yield* new EnvironmentFiles.NotFound({ path: request.path })
        if (reply.kind === "WrongKind" && reply.actual)
          return yield* new EnvironmentFiles.WrongKind({ path: request.path, actual: reply.actual })
        return yield* new EnvironmentFiles.Failed({ path: request.path, cause: new Error(reply.message) })
      }
      if (reply.op !== request.op)
        return yield* new EnvironmentFiles.Failed({
          path: request.path,
          cause: new Error("File helper returned a mismatched operation"),
        })
      return reply
    })
  const failure = (value: string, cause: unknown) => new EnvironmentFiles.Failed({ path: absolute(value), cause })
  const plain = (
    value: string,
    error: EnvironmentFiles.NotFound | EnvironmentFiles.WrongKind | EnvironmentFiles.Failed,
  ) => (error instanceof EnvironmentFiles.WrongKind ? failure(value, error) : error)

  return {
    check: (value, operation) =>
      Effect.suspend(() => run({ op: "check", path: absolute(value), operation })).pipe(
        Effect.mapError((error) => failure(value, error)),
        Effect.asVoid,
      ),
    read: (value, range) =>
      Effect.suspend(() => run({ op: "read", path: absolute(value), range })).pipe(
        Effect.flatMap((reply) => {
          if (reply.op !== "read") return Effect.fail(failure(value, new Error("Missing read reply")))
          const bytes = Buffer.from(reply.data, "base64")
          if (bytes.length > SandboxFileProtocol.MAX_DATA_BYTES || bytes.toString("base64") !== reply.data)
            return Effect.fail(failure(value, new Error("Invalid file helper binary reply")))
          return Effect.succeed({ info: reply.info, bytes })
        }),
      ),
    stat: (value) =>
      Effect.suspend(() => run({ op: "stat", path: absolute(value) })).pipe(
        Effect.mapError((error) => plain(value, error)),
        Effect.flatMap((reply) =>
          reply.op === "stat"
            ? Effect.succeed(reply.info)
            : Effect.fail(failure(value, new Error("Missing stat reply"))),
        ),
      ),
    list: (value) =>
      Effect.suspend(() => run({ op: "list", path: absolute(value) })).pipe(
        Effect.flatMap((reply) =>
          reply.op === "list"
            ? Effect.succeed(reply.entries)
            : Effect.fail(failure(value, new Error("Missing list reply"))),
        ),
      ),
    write: (value, bytes) =>
      Effect.suspend(() => {
        if (bytes.byteLength > SandboxFileProtocol.MAX_DATA_BYTES)
          return Effect.fail(failure(value, new Error("File helper write exceeds its collection limit")))
        return run({ op: "write", path: absolute(value), data: Buffer.from(bytes).toString("base64") })
      }).pipe(
        Effect.mapError((error) => failure(value, error)),
        Effect.asVoid,
      ),
    mkdir: (value) =>
      Effect.suspend(() => run({ op: "mkdir", path: absolute(value) })).pipe(
        Effect.mapError((error) => failure(value, error)),
        Effect.asVoid,
      ),
    remove: (value) =>
      Effect.suspend(() => run({ op: "remove", path: absolute(value) })).pipe(
        Effect.mapError((error) => failure(value, error)),
        Effect.asVoid,
      ),
    move: (from, to) =>
      Effect.suspend(() => run({ op: "move", path: absolute(from), to: absolute(to) })).pipe(
        Effect.mapError((error) => plain(from, error)),
        Effect.asVoid,
      ),
  }
}
