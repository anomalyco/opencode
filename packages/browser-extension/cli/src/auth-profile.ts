import { dataRoot } from "./paths.ts"
import { Effect, Schema, Semaphore } from "effect"
import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { terminateChildProcess } from "./child-process.ts"
import { isNodeError, writeJsonFileAtomically } from "./fs-durability.ts"
import { redactKnownValues, type CredentialSlot } from "./network-redaction.ts"

const StoredCredentialSlot = Schema.Struct({
  ref: Schema.String.check(Schema.isPattern(/^BC_SECRET_[1-9][0-9]*$/)),
  value: Schema.String,
  sources: Schema.Array(Schema.String),
  expiresAt: Schema.optionalKey(Schema.String),
})

const StoredAuthProfile = Schema.Struct({
  version: Schema.Literal(1),
  name: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  slots: Schema.Array(StoredCredentialSlot),
}).check(Schema.makeFilter((profile) => {
  const refs = profile.slots.map((slot) => slot.ref)
  if (new Set(refs).size !== refs.length) return "Auth profile refs must be unique"
  const sources = profile.slots.flatMap((slot) => slot.sources)
  return new Set(sources).size === sources.length ? undefined : "Auth profile sources must be unique"
}))

interface AuthProfile extends Schema.Schema.Type<typeof StoredAuthProfile> {}

export type AuthProfileSummary = {
  readonly name: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly slotCount: number
  readonly slots: readonly {
    readonly ref: string
    readonly sources: readonly string[]
    readonly expiresAt?: string
    readonly expired: boolean
  }[]
}

export type AuthRunResult = {
  readonly exitCode: number
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
  readonly stdoutTruncated: boolean
  readonly stderrTruncated: boolean
  readonly durationMs: number
}

export interface AuthProfileOptions {
  readonly baseDir?: string
}

export interface AuthRunOptions extends AuthProfileOptions {
  readonly name: string
  readonly command: string
  readonly args?: readonly string[]
  readonly cwd?: string
  readonly timeoutMs?: number
  readonly maxOutputBytes?: number
}

export class AuthProfileError extends Schema.TaggedError<AuthProfileError>()(
  "AuthProfile.Error",
  {
    message: Schema.String,
    operation: Schema.String,
    reason: Schema.Literals(["invalid-name", "not-found", "read-failed", "invalid-json", "invalid-profile", "write-failed", "run-failed"]),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

const defaultBaseDir = (): string => path.join(dataRoot(), "secrets")
const writeLock = Semaphore.makeUnsafe(1)
const profileLockTimeoutMs = 30_000
const staleProfileLockMs = 60_000
const maximumRunOutputBytes = 10_000_000
const maximumTimeoutMs = 2_147_483_647

export const read = Effect.fn("AuthProfile.read")(function* (name: string, options: { readonly baseDir?: string } = {}) {
  const filePath = yield* profilePath(options.baseDir ?? defaultBaseDir(), name)
  const text = yield* Effect.tryPromise({
    try: () => fs.readFile(filePath, "utf8"),
    catch: (cause) => isNodeError(cause) && cause.code === "ENOENT"
      ? new AuthProfileError({ message: `Auth profile not found: ${name}`, operation: "read", reason: "not-found", cause })
      : new AuthProfileError({ message: `Could not read auth profile: ${name}`, operation: "read", reason: "read-failed", cause }),
  })
  return yield* Schema.decodeUnknownEffect(StoredAuthProfile)(yield* Effect.try({
    try: () => JSON.parse(text),
    catch: (cause) => new AuthProfileError({ message: `Auth profile is not valid JSON: ${name}`, operation: "read", reason: "invalid-json", cause }),
  })).pipe(
    Effect.mapError((cause) => cause instanceof AuthProfileError
      ? cause
      : new AuthProfileError({ message: `Auth profile has an invalid shape: ${name}`, operation: "read", reason: "invalid-profile", cause })),
  )
})

export const readOptional = Effect.fn("AuthProfile.readOptional")(function* (name: string, options: { readonly baseDir?: string } = {}) {
  return yield* read(name, options).pipe(
    Effect.catchIf((error) => error.reason === "not-found", () => Effect.succeed(undefined)),
  )
})

export function withLock<A, E, R>(
  name: string,
  options: { readonly baseDir?: string },
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | AuthProfileError, R> {
  const baseDir = options.baseDir ?? defaultBaseDir()
  const acquire = Effect.gen(function* () {
    const filePath = yield* profilePath(baseDir, name)
    const lockPath = `${filePath}.lock`
    yield* Effect.tryPromise({
      try: async () => {
        await fs.mkdir(baseDir, { recursive: true, mode: 0o700 })
        await fs.chmod(baseDir, 0o700)
        const deadline = Date.now() + profileLockTimeoutMs
        while (true) {
          try {
            const handle = await fs.open(lockPath, "wx", 0o600)
            let written = false
            try {
              await handle.writeFile(`${process.pid}\n`)
              written = true
            } finally {
              await handle.close()
              if (!written) await fs.unlink(lockPath).catch(() => {})
            }
            return
          } catch (cause) {
            if (!isNodeError(cause) || cause.code !== "EEXIST") throw cause
            const stat = await fs.stat(lockPath).catch(() => undefined)
            if (stat && Date.now() - stat.mtimeMs > staleProfileLockMs) {
              await fs.unlink(lockPath).catch(() => {})
              continue
            }
            if (Date.now() >= deadline) throw new Error(`Timed out waiting for auth profile lock: ${name}`)
            await new Promise((resolve) => setTimeout(resolve, 25))
          }
        }
      },
      catch: (cause) => new AuthProfileError({ message: `Could not lock auth profile: ${name}`, operation: "lock", reason: "write-failed", cause }),
    })
    return lockPath
  })
  return Effect.acquireUseRelease(
    acquire,
    () => effect,
    (lockPath) => Effect.tryPromise({
      try: () => fs.unlink(lockPath).catch(() => {}).then(() => {}),
      catch: (cause) => new AuthProfileError({ message: `Could not release auth profile lock: ${name}`, operation: "lock", reason: "write-failed", cause }),
    }),
  )
}

const writeProfile = Effect.fnUntraced(function* (options: {
  readonly name: string
  readonly slots: readonly CredentialSlot[]
  readonly baseDir?: string
}) {
  const baseDir = options.baseDir ?? defaultBaseDir()
  const filePath = yield* profilePath(baseDir, options.name)
  const existing = yield* readOptional(options.name, { baseDir })
  const now = new Date().toISOString()
  const profile: AuthProfile = {
    version: 1,
    name: options.name,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    slots: options.slots.map((slot) => ({
      ref: slot.ref,
      value: slot.value,
      sources: [...slot.sources],
      ...(slot.expiresAt ? { expiresAt: slot.expiresAt } : {}),
    })),
  }
  yield* Schema.decodeUnknownEffect(StoredAuthProfile)(profile).pipe(
    Effect.mapError((cause) => new AuthProfileError({ message: `Auth profile has an invalid shape: ${options.name}`, operation: "write", reason: "invalid-profile", cause })),
  )
  if (existing && sameSlots(existing.slots, profile.slots)) return summary(existing)
  yield* Effect.tryPromise({
    try: () => writeJsonFileAtomically(filePath, profile, { dirMode: 0o700 }),
    catch: (cause) => new AuthProfileError({ message: `Could not write auth profile: ${options.name}`, operation: "write", reason: "write-failed", cause }),
  })
  return summary(profile)
})

export const write = Effect.fn("AuthProfile.write")(function* (options: {
  readonly name: string
  readonly slots: readonly CredentialSlot[]
  readonly baseDir?: string
}) {
  return yield* writeLock.withPermit(writeProfile(options))
})

export const status = Effect.fn("AuthProfile.status")(function* (name: string, options: AuthProfileOptions = {}) {
  return summary(yield* read(name, options))
})

export const run = Effect.fn("AuthProfile.run")(function* (options: AuthRunOptions) {
  if (!options.command.trim()) {
    return yield* new AuthProfileError({ message: "Auth command must not be empty", operation: "run", reason: "run-failed" })
  }
  const timeoutMs = options.timeoutMs ?? 120_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > maximumTimeoutMs) {
    return yield* new AuthProfileError({ message: `Auth command timeout must be an integer between 1 and ${maximumTimeoutMs} milliseconds`, operation: "run", reason: "run-failed" })
  }
  const maxOutputBytes = options.maxOutputBytes ?? 1_000_000
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0 || maxOutputBytes > maximumRunOutputBytes) {
    return yield* new AuthProfileError({ message: `Auth command output limit must be an integer between 0 and ${maximumRunOutputBytes} bytes`, operation: "run", reason: "run-failed" })
  }
  const profile = yield* read(options.name, { ...(options.baseDir ? { baseDir: options.baseDir } : {}) })
  const startedAt = Date.now()
  const maxSecretBytes = profile.slots.reduce((max, slot) => Math.max(max, Buffer.byteLength(slot.value)), 0)
  const result = yield* runChild({
      command: options.command,
      args: options.args ?? [],
      ...(options.cwd ? { cwd: options.cwd } : {}),
      timeoutMs,
      maxOutputBytes: maxOutputBytes + maxSecretBytes,
      env: Object.fromEntries(profile.slots.map((slot) => [slot.ref, slot.value])),
    }).pipe(
      Effect.mapError((cause) => new AuthProfileError({ message: `Could not run command with auth profile ${options.name}`, operation: "run", reason: "run-failed", cause })),
    )
  const stdout = redactOutput(result.stdout, profile.slots, maxOutputBytes)
  const stderr = redactOutput(result.stderr, profile.slots, maxOutputBytes)
  return {
    ...result,
    stdout: stdout.text,
    stderr: stderr.text,
    stdoutTruncated: result.stdoutTruncated || stdout.truncated,
    stderrTruncated: result.stderrTruncated || stderr.truncated,
    durationMs: Date.now() - startedAt,
  } satisfies AuthRunResult
})

function summary(profile: AuthProfile): AuthProfileSummary {
  const now = Date.now()
  return {
    name: profile.name,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    slotCount: profile.slots.length,
    slots: profile.slots.map((slot) => ({
      ref: slot.ref,
      sources: [...slot.sources],
      ...(slot.expiresAt ? { expiresAt: slot.expiresAt } : {}),
      expired: slot.expiresAt ? Date.parse(slot.expiresAt) <= now : false,
    })),
  }
}

function profilePath(baseDir: string, name: string): Effect.Effect<string, AuthProfileError> {
  return /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(name)
    ? Effect.succeed(path.join(baseDir, `${name}.json`))
    : Effect.fail(new AuthProfileError({ message: `Invalid auth profile name: ${name}`, operation: "path", reason: "invalid-name" }))
}

function sameSlots(left: readonly CredentialSlot[], right: readonly CredentialSlot[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function redactOutput(text: string, slots: readonly CredentialSlot[], maxBytes: number): { readonly text: string; readonly truncated: boolean } {
  const bytes = Buffer.from(text)
  let cutoff = Math.min(bytes.length, maxBytes)
  let changed = true
  while (changed) {
    changed = false
    for (const slot of slots) {
      if (!slot.value) continue
      const secret = Buffer.from(slot.value)
      let start = bytes.indexOf(secret)
      while (start >= 0 && start < cutoff) {
        if (start + secret.length > cutoff) {
          cutoff = start
          changed = true
          break
        }
        start = bytes.indexOf(secret, start + secret.length)
      }
    }
  }
  return {
    text: redactKnownValues(bytes.subarray(0, cutoff).toString("utf8"), slots),
    truncated: cutoff < bytes.length,
  }
}

function runChild(options: {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd?: string
  readonly timeoutMs: number
  readonly maxOutputBytes: number
  readonly env: Readonly<Record<string, string>>
}): Effect.Effect<Omit<AuthRunResult, "durationMs">, Error> {
  return Effect.callback((resume) => {
    const child = spawn(options.command, [...options.args], {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      env: childEnvironment(options.env),
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let stdoutTruncated = false
    let stderrTruncated = false
    const append = (chunks: Buffer[], chunk: Buffer, currentBytes: number): number => {
      const remaining = options.maxOutputBytes - currentBytes
      if (remaining <= 0) return currentBytes
      chunks.push(chunk.subarray(0, remaining))
      return currentBytes + Math.min(chunk.length, remaining)
    }
    child.stdout.on("data", (chunk: Buffer) => {
      const next = append(stdout, chunk, stdoutBytes)
      stdoutTruncated ||= next - stdoutBytes < chunk.length
      stdoutBytes = next
    })
    child.stderr.on("data", (chunk: Buffer) => {
      const next = append(stderr, chunk, stderrBytes)
      stderrTruncated ||= next - stderrBytes < chunk.length
      stderrBytes = next
    })
    let closed = false
    let settled = false
    let closePromiseResolve: (() => void) | undefined
    const closePromise = new Promise<void>((resolve) => {
      closePromiseResolve = resolve
    })
    const timeout = setTimeout(() => {
      void terminateChildProcess({ child, exit: closePromise, graceMs: 1_000, isExited: () => closed })
    }, options.timeoutMs)
    child.once("error", (cause) => {
      clearTimeout(timeout)
      closed = true
      closePromiseResolve?.()
      if (settled) return
      settled = true
      resume(Effect.fail(cause))
    })
    child.once("close", (code, signal) => {
      clearTimeout(timeout)
      closed = true
      closePromiseResolve?.()
      if (settled) return
      settled = true
      resume(Effect.succeed({
        exitCode: code ?? 1,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdoutTruncated,
        stderrTruncated,
      }))
    })
    return Effect.promise(() => terminateChildProcess({ child, exit: closePromise, graceMs: 1_000, isExited: () => closed }))
  })
}

function childEnvironment(profile: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/^BC_SECRET_[1-9][0-9]*$/.test(name)),
  )
  return { ...inherited, ...profile }
}
