import { Deferred, Effect, Layer, Schema, Context } from "effect"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { SessionID } from "@/session/schema"
import { lazy } from "@/util/lazy"
import * as Log from "@opencode-ai/core/util/log"
import { SecureInputID } from "./schema"

const log = Log.create({ service: "secure-input" })

// ── Password prompt patterns ────────────────────────────────────────────────
const PASSWORD_PATTERNS = [
  /\[sudo\] password for .+:/i,
  /Password:/i,
  /Enter passphrase for .+:/i,
  /BECOME password:/i,
  /SSH password:/i,
  /passphrase:/i,
  /password for .+:/i,
  /\(yes\/no.*\)\?/i,
] as const

// ── Commands that typically require interaction ──────────────────────────────
const INTERACTIVE_COMMANDS = [
  /^sudo\s/,
  /\bsudo\s/,
  /^ssh\s.*-t\b/,
  /\bssh\s.*-t\b/,
  /^ansible\b.*-K\b/,
  /^ansible\b.*--ask-become-pass\b/,
  /^ansible-playbook\b.*-K\b/,
  /^ansible-playbook\b.*--ask-become-pass\b/,
  /^su\s/,
  /^gpg\s/,
  /\bsudo\b/,
] as const

// ── Schemas ─────────────────────────────────────────────────────────────────

export class Request extends Schema.Class<Request>("SecureInputRequest")({
  id: SecureInputID,
  sessionID: SessionID,
  prompt: Schema.String.annotate({
    description: "The password prompt text displayed to the user",
  }),
  command: Schema.optional(Schema.String).annotate({
    description: "The command that triggered this prompt",
  }),
}) {
  static readonly zod = SecureInputID.zod
}

export class Submitted extends Schema.Class<Submitted>("SecureInputSubmitted")({
  sessionID: SessionID,
  requestID: SecureInputID,
}) {}

export class Cancelled extends Schema.Class<Cancelled>("SecureInputCancelled")({
  sessionID: SessionID,
  requestID: SecureInputID,
}) {}

export class TimedOut extends Schema.Class<TimedOut>("SecureInputTimedOut")({
  sessionID: SessionID,
  requestID: SecureInputID,
}) {}

// ── Events ──────────────────────────────────────────────────────────────────

export const Event = {
  Requested: BusEvent.define("secure-input.requested", Request),
  Submitted: BusEvent.define("secure-input.submitted", Submitted),
  Cancelled: BusEvent.define("secure-input.cancelled", Cancelled),
  TimedOut: BusEvent.define("secure-input.timed-out", TimedOut),
}

// ── Errors ──────────────────────────────────────────────────────────────────

export class CancelledError extends Schema.TaggedErrorClass<CancelledError>()("SecureInputCancelledError", {}) {
  override get message() {
    return "The user cancelled the secure input prompt"
  }
}

export class TimedOutError extends Schema.TaggedErrorClass<TimedOutError>()("SecureInputTimedOutError", {}) {
  override get message() {
    return "Secure input request timed out"
  }
}

// ── Internal state ──────────────────────────────────────────────────────────

interface PendingEntry {
  info: Request
  deferred: Deferred.Deferred<string, CancelledError | TimedOutError>
}

interface State {
  pending: Map<SecureInputID, PendingEntry>
}

// ── Helpesr ─────────────────────────────────────────────────────────────────

const ptySpawn = lazy(async () => {
  const { spawn } = await import("#pty")
  return spawn
})

/**
 * Check whether a command string looks like it needs interactive input.
 */
export function isInteractiveCommand(command: string): boolean {
  return INTERACTIVE_COMMANDS.some((re) => re.test(command))
}

/**
 * Check whether a chunk of PTY output contains a password prompt.
 */
export function detectPasswordPrompt(output: string): string | undefined {
  for (const re of PASSWORD_PATTERNS) {
    const match = output.match(re)
    if (match) return match[0]
  }
  return undefined
}

// ── Service ─────────────────────────────────────────────────────────────────

export interface Interface {
  /** Request a secure input (password) from the user. Returns the password string. */
  readonly request: (input: {
    sessionID: SessionID
    prompt: string
    command?: string
  }) => Effect.Effect<string, CancelledError | TimedOutError>

  /** Submit a password for a pending request. */
  readonly submit: (input: { requestID: SecureInputID; input: string }) => Effect.Effect<void>

  /** Cancel a pending request. */
  readonly cancel: (requestID: SecureInputID) => Effect.Effect<void>

  /** List all pending requests. */
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>

  /**
   * Execute a command interactively via PTY.
   * Detects password prompts and delegates to request() for user input.
   */
  readonly execute: (input: {
    command: string
    cwd: string
    env: Record<string, string>
    sessionID: SessionID
    timeout: number
  }) => Effect.Effect<{ output: string; exitCode: number | null }>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SecureInput") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const state = yield* InstanceState.make<State>(
      Effect.fn("SecureInput.state")(function* () {
        const state: State = {
          pending: new Map(),
        }

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            for (const item of state.pending.values()) {
              yield* Deferred.fail(item.deferred, new CancelledError())
            }
            state.pending.clear()
          }),
        )

        return state
      }),
    )

    const request = Effect.fn("SecureInput.request")(function* (input: {
      sessionID: SessionID
      prompt: string
      command?: string
    }) {
      const pending = (yield* InstanceState.get(state)).pending
      const id = SecureInputID.ascending()
      log.info("requesting secure input", { id, sessionID: input.sessionID })

      const deferred = yield* Deferred.make<string, CancelledError | TimedOutError>()
      const info = Schema.decodeUnknownSync(Request)({
        id,
        sessionID: input.sessionID,
        prompt: input.prompt,
        command: input.command,
      })
      pending.set(id, { info, deferred })
      yield* bus.publish(Event.Requested, info)

      return yield* Effect.ensuring(
        Deferred.await(deferred),
        Effect.sync(() => {
          pending.delete(id)
        }),
      )
    })

    const submit = Effect.fn("SecureInput.submit")(function* (input: {
      requestID: SecureInputID
      input: string
    }) {
      const pending = (yield* InstanceState.get(state)).pending
      const existing = pending.get(input.requestID)
      if (!existing) {
        log.warn("submit for unknown request", { requestID: input.requestID })
        return
      }
      pending.delete(input.requestID)
      log.info("secure input submitted", { requestID: input.requestID })
      yield* bus.publish(Event.Submitted, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
      })
      yield* Deferred.succeed(existing.deferred, input.input)
    })

    const cancel = Effect.fn("SecureInput.cancel")(function* (requestID: SecureInputID) {
      const pending = (yield* InstanceState.get(state)).pending
      const existing = pending.get(requestID)
      if (!existing) {
        log.warn("cancel for unknown request", { requestID })
        return
      }
      pending.delete(requestID)
      log.info("secure input cancelled", { requestID })
      yield* bus.publish(Event.Cancelled, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
      })
      yield* Deferred.fail(existing.deferred, new CancelledError())
    })

    const list = Effect.fn("SecureInput.list")(function* () {
      const pending = (yield* InstanceState.get(state)).pending
      return Array.from(pending.values(), (x) => x.info)
    })

    const execute = Effect.fn("SecureInput.execute")(function* (input: {
      command: string
      cwd: string
      env: Record<string, string>
      sessionID: SessionID
      timeout: number
    }) {
      const pending = (yield* InstanceState.get(state)).pending
      const spawn = yield* Effect.promise(() => ptySpawn())
      const shell = process.platform === "win32" ? "cmd.exe" : "/bin/bash"

      const pty = yield* Effect.sync(() =>
        spawn(shell, ["-c", input.command], {
          name: "xterm-256color",
          cwd: input.cwd,
          env: { ...input.env, TERM: "xterm-256color" } as Record<string, string>,
        }),
      )

      let output = ""
      let passwordResolve: ((value: string) => void) | null = null
      let passwordBuffer = ""
      let exited = false
      let exitCode: number | null = null

      const done = yield* Effect.promise<{ output: string; exitCode: number | null }>(
        (resolve) => {
          // ── PTY data handler ──────────────────────────────────────────────
          const dataDisp = pty.onData((chunk: string) => {
            output += chunk

            // If we're waiting for a password, buffer the output and check for prompts
            if (!passwordResolve) {
              passwordBuffer += chunk
              // Only keep last 4KB for prompt detection
              if (Buffer.byteLength(passwordBuffer, "utf-8") > 4096) {
                passwordBuffer = passwordBuffer.slice(-2048)
              }

              const prompt = detectPasswordPrompt(passwordBuffer)
              if (prompt) {
                passwordResolve = (() => {
                  const deferred = Deferred.unsafeMake<string, CancelledError | TimedOutError>()
                  const id = SecureInputID.ascending()
                  const info = Schema.decodeUnknownSync(Request)({
                    id,
                    sessionID: input.sessionID,
                    prompt,
                    command: input.command,
                  })
                  pending.set(id, { info, deferred })

                  bus.publish(Event.Requested, info).pipe(Effect.runFork)

                  deferred.pipe(
                    Deferred.await,
                    Effect.match({
                      onSuccess: (value) => {
                        pty.write(value + "\n")
                        passwordResolve = null
                        passwordBuffer = ""
                        // Strip the prompt from output
                        output = output.replace(prompt, "[password supplied]")
                      },
                      onFailure: () => {
                        pty.kill()
                      },
                    }),
                    Effect.runFork,
                  )

                  return deferred
                })() as unknown as Promise<string>
              }
            }
          })

          // ── PTY exit handler ──────────────────────────────────────────────
          const exitDisp = pty.onExit((event: { exitCode: number }) => {
            exited = true
            exitCode = event.exitCode
            resolve({ output, exitCode })
          })

          // ── Timeout ───────────────────────────────────────────────────────
          const timeoutId = setTimeout(() => {
            if (!exited) {
              pty.kill()
              resolve({ output, exitCode: null })
            }
          }, input.timeout)

          // ── Abort handler (via memory dealloc) ────────────────────────────
          return () => {
            clearTimeout(timeoutId)
            dataDisp.dispose()
            exitDisp.dispose()
          }
        },
      )

      return done
    })

    return Service.of({ request, submit, cancel, list, execute })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer))

export * as SecureInput from "."
