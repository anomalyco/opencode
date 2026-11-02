export * as SandboxCheck from "./check.js"

import fs from "node:fs/promises"
import { Effect, Schema } from "effect"
import { ChildProcess } from "effect/process"
import { AppProcess } from "@opencode/util/process"
import { MacSandbox } from "./macos.js"
import { SandboxFileWorker } from "./file-worker.js"
import { SandboxFileProtocol } from "./file-protocol.js"
import type { SandboxPolicy } from "./policy.js"

/** Apply the real profile, then boot the embedded runtime without running project code. */
export const run = Effect.fn("SandboxCheck.run")(function* (policy: SandboxPolicy.Policy, helper = true) {
  const subprocess = yield* AppProcess.Service
  const launch = MacSandbox.launch(policy, "/bin/sh", ["-c", "exit 0"], {
    PATH: "/usr/bin:/bin",
    HOME: policy.scratch,
    TMPDIR: policy.scratch,
  })
  yield* subprocess
    .run(
      ChildProcess.make(launch.command, launch.args, {
        cwd: policy.directory,
        env: launch.env,
        extendEnv: false,
      }),
      { timeout: "5 seconds", maxOutputBytes: 4096, maxErrorBytes: 4096 },
    )
    .pipe(
      Effect.flatMap(AppProcess.requireSuccess),
      Effect.mapError(
        (cause) =>
          new Error(
            `Cannot apply sandbox profile: ${cause.stderr?.trim() || (cause.cause instanceof Error ? cause.cause.message : `exit ${cause.exitCode}`)}`,
          ),
      ),
    )
  if (!helper) return
  const worker = MacSandbox.fileLaunch(
    policy,
    yield* Effect.tryPromise(() => fs.realpath(process.execPath)),
    SandboxFileWorker.configured(policy),
  )
  yield* subprocess
    .run(ChildProcess.make(worker.command, worker.args, { cwd: policy.scratch, env: worker.env, extendEnv: false }), {
      stdin: JSON.stringify({ op: "stat", path: policy.directory }),
      timeout: "5 seconds",
      maxOutputBytes: 4096,
      maxErrorBytes: 4096,
    })
    .pipe(
      Effect.flatMap(AppProcess.requireSuccess),
      Effect.mapError(
        (cause) =>
          new Error(
            `Cannot start sandbox file runtime: ${cause.stderr?.trim() || (cause.cause instanceof Error ? cause.cause.message : `exit ${cause.exitCode}`)}`,
          ),
      ),
      Effect.flatMap((result) =>
        Schema.decodeUnknownEffect(Schema.fromJsonString(SandboxFileProtocol.Reply))(result.stdout.toString()),
      ),
      Effect.flatMap((reply) =>
        reply.op === "stat"
          ? Effect.void
          : Effect.fail(new Error("Sandbox file runtime did not return its startup probe")),
      ),
    )
})
