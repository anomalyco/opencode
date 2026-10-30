export * as ExtensionGitHub from "./github.js"

import path from "path"
import os from "os"
import { Effect } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { AppProcess } from "@opencode/util/process"
import { ChildProcess } from "effect/process"
import { Hash } from "@opencode/util/hash"
import type { Extension } from "@opencode/schema/extension"

export interface FetchOptions {
  readonly repoUrl: string
  readonly subpath?: string
  readonly ref?: string // branch, tag, or commit SHA
  readonly token?: string
  readonly targetDirectory?: string
}

export interface FetchResult {
  readonly directory: string
  readonly commitSha: string
  readonly source: Extension.Source
  readonly cleanup: Effect.Effect<void>
}

export const fetchRepository = Effect.fn("ExtensionGitHub.fetchRepository")(function* (options: FetchOptions) {
  const fs = yield* FSUtil.Service
  const proc = yield* AppProcess.Service

  // Clean and validate URL
  const trimmed = options.repoUrl.trim()
  let cloneUrl = trimmed
  if (options.token && cloneUrl.startsWith("https://")) {
    cloneUrl = cloneUrl.replace("https://", `https://${options.token}@`)
  }

  // Create isolated temp workspace
  const tempDir = options.targetDirectory ?? path.join(os.tmpdir(), "opencode-ext-" + Hash.fast(`${trimmed}-${Date.now()}`))
  yield* fs.ensureDir(tempDir).pipe(Effect.ignore)

  const cleanup = Effect.gen(function* () {
    yield* fs.remove(tempDir, { recursive: true }).pipe(Effect.orElseSucceed(() => undefined))
  })

  // 1. Clone repository (depth 1 if no commit SHA specified, full fetch if specific ref)
  const isSha = options.ref && /^[0-9a-f]{7,40}$/i.test(options.ref)
  const cloneArgs = isSha
    ? ["clone", cloneUrl, tempDir]
    : options.ref
      ? ["clone", "--depth", "1", "--branch", options.ref, cloneUrl, tempDir]
      : ["clone", "--depth", "1", cloneUrl, tempDir]

  const cloneRes = yield* proc
    .run(
      ChildProcess.make("git", cloneArgs, {
        cwd: path.dirname(tempDir),
        stdin: "ignore",
      }),
    )
    .pipe(Effect.orElseSucceed(() => undefined))

  if (!cloneRes || cloneRes.exitCode !== 0) {
    yield* cleanup
    const stderr = cloneRes?.stderr?.toString("utf8") ?? "Git clone failed"
    // Redact token from error message
    const sanitizedError = options.token ? stderr.replaceAll(options.token, "********") : stderr
    return yield* Effect.fail(new Error(`Failed to clone GitHub repository: ${sanitizedError}`))
  }

  // 2. If commit SHA, checkout explicitly
  if (isSha && options.ref) {
    const checkoutRes = yield* proc
      .run(
        ChildProcess.make("git", ["checkout", options.ref], {
          cwd: tempDir,
          stdin: "ignore",
        }),
      )
      .pipe(Effect.orElseSucceed(() => undefined))

    if (!checkoutRes || checkoutRes.exitCode !== 0) {
      yield* cleanup
      return yield* Effect.fail(new Error(`Failed to checkout commit ${options.ref}`))
    }
  }

  // 3. Obtain resolved commit SHA
  const revParseRes = yield* proc
    .run(
      ChildProcess.make("git", ["rev-parse", "HEAD"], {
        cwd: tempDir,
        stdin: "ignore",
      }),
    )
    .pipe(Effect.orElseSucceed(() => undefined))

  const commitSha = revParseRes && revParseRes.exitCode === 0
    ? revParseRes.stdout.toString("utf8").trim()
    : (options.ref ?? "HEAD")

  // 4. Determine effective directory (if subpath requested)
  let effectiveDir = tempDir
  if (options.subpath) {
    const sub = path.join(tempDir, options.subpath)
    const exists = yield* fs.exists(sub).pipe(Effect.orElseSucceed(() => false))
    if (!exists) {
      yield* cleanup
      return yield* Effect.fail(new Error(`Subdirectory "${options.subpath}" not found in repository`))
    }
    effectiveDir = sub
  }

  const source: Extension.Source = {
    type: "git" as const,
    location: trimmed,
    subpath: options.subpath,
    ref: options.ref ?? commitSha,
    checksum: commitSha,
  }

  return {
    directory: effectiveDir,
    commitSha,
    source,
    cleanup,
  }
})
