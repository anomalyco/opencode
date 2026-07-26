import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer, Schema, Duration, Context } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { SessionID } from "@/session/schema"
import { SecureInputID, nextSecureInputID, SecureInputRequest } from "./schema"
export { SecureInputID, SecureInputRequest } from "./schema"
import { spawn } from "@opencode-ai/core/pty"

const PASSWORD_PATTERNS = [
  /\[sudo\] password for .+:/i,
  /Password:/i,
  /Enter passphrase for .+:/i,
  /BECOME password:/i,
  /SSH password:/i,
  /passphrase for .+:/i,
  /password for .+:/i,
  /Sorry, try again\./i,
  /\(yes\/no.*\)\?/i,
] as const

const INTERACTIVE_COMMANDS = [
  /^sudo\s/,
  /\bsudo\s/,
  /^ssh\b/,
  /\bssh\b/,
  /^ansible\b.*-K\b/,
  /^ansible\b.*--ask-become-pass\b/,
  /^ansible-playbook\b.*-K\b/,
  /^ansible-playbook\b.*--ask-become-pass\b/,
  /^su\s/,
  /^gpg\s/,
] as const

export function isInteractiveCommand(command: string): boolean {
  return INTERACTIVE_COMMANDS.some((re) => re.test(command))
}

export function detectPasswordPrompt(output: string): string | undefined {
  for (const re of PASSWORD_PATTERNS) {
    const match = output.match(re)
    if (match) return match[0]
  }
  return undefined
}

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

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("SecureInput.NotFoundError", {
  requestID: SecureInputID,
}) {}

interface PendingEntry {
  info: SecureInputRequest
  resolve: (value: string) => void
  reject: (error: CancelledError | TimedOutError) => void
  promise: Promise<string>
}

interface State {
  pending: Map<SecureInputID, PendingEntry>
}

export interface Interface {
  readonly request: (input: {
    sessionID: SessionID
    prompt: string
    command?: string
  }) => Effect.Effect<string, CancelledError | TimedOutError>
  readonly submit: (input: { requestID: SecureInputID; input: string }) => Effect.Effect<void, NotFoundError>
  readonly cancel: (requestID: SecureInputID) => Effect.Effect<void, NotFoundError>
  readonly list: () => Effect.Effect<ReadonlyArray<SecureInputRequest>>
  readonly execute: (input: {
    command: string
    cwd: string
    env: Record<string, string>
    sessionID: SessionID
    timeout: Duration.DurationInput
  }) => Effect.Effect<{ output: string; exitCode: number | null }>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SecureInput") {}


function createEntry(info: SecureInputRequest): PendingEntry {
  let resolve!: (value: string) => void
  let reject!: (error: CancelledError | TimedOutError) => void
  const promise = new Promise<string>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { info, resolve, reject, promise }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make<State>(
      Effect.fn("SecureInput.state")(function* () {
        const pending = new Map<SecureInputID, PendingEntry>()
        yield* Effect.addFinalizer(
          Effect.sync(() => {
            for (const item of pending.values()) {
              item.reject(new CancelledError())
            }
            pending.clear()
          }),
        )
        return { pending }
      }),
    )

    const getPending = () => Effect.map(InstanceState.get(state), (s) => s.pending)

    const request = Effect.fn("SecureInput.request")(function* (input: {
      sessionID: SessionID
      prompt: string
      command?: string
    }) {
      const pending = yield* getPending()
      const id = nextSecureInputID()
      yield* Effect.logInfo("requesting secure input", { id })

      const info: SecureInputRequest = {
        id,
        sessionID: input.sessionID,
        prompt: input.prompt,
        command: input.command,
      }
      const entry = createEntry(info)
      pending.set(id, entry)

      return yield* Effect.tryPromise({
        try: () => entry.promise,
        catch: (error) => error as CancelledError | TimedOutError,
      }).pipe(
        Effect.ensuring(Effect.sync(() => pending.delete(id))),
      )
    })

    const submit = Effect.fn("SecureInput.submit")(function* (input: {
      requestID: SecureInputID
      input: string
    }) {
      const pending = yield* getPending()
      const existing = pending.get(input.requestID)
      if (!existing) {
        yield* Effect.logWarning("submit for unknown request", { requestID: input.requestID })
        return yield* new NotFoundError({ requestID: input.requestID })
      }
      pending.delete(input.requestID)
      yield* Effect.logInfo("secure input submitted", { requestID: input.requestID })
      existing.resolve(input.input)
    })

    const cancel = Effect.fn("SecureInput.cancel")(function* (requestID: SecureInputID) {
      const pending = yield* getPending()
      const existing = pending.get(requestID)
      if (!existing) {
        yield* Effect.logWarning("cancel for unknown request", { requestID })
        return yield* new NotFoundError({ requestID })
      }
      pending.delete(requestID)
      yield* Effect.logInfo("secure input cancelled", { requestID })
      existing.reject(new CancelledError())
    })

    const list = Effect.fn("SecureInput.list")(function* () {
      const pending = yield* getPending()
      return Array.from(pending.values(), (x) => x.info)
    })

    const execute = Effect.fn("SecureInput.execute")(function* (input: {
      command: string
      cwd: string
      env: Record<string, string>
      sessionID: SessionID
      timeout: Duration.DurationInput
    }) {
      const pending = yield* getPending()
      const shell = process.platform === "win32" ? "cmd.exe" : "/bin/bash"
      const timeoutMs = Duration.toMillis(Duration.decode(input.timeout))

      const pty = yield* Effect.sync(() =>
        spawn(shell, ["-c", input.command], {
          name: "xterm-256color",
          cwd: input.cwd,
          env: { ...input.env, TERM: "xterm-256color" } as Record<string, string>,
        }),
      )

      return yield* Effect.promise<{ output: string; exitCode: number | null }>(
        () =>
          new Promise<{ output: string; exitCode: number | null }>((resolve) => {
            let output = ""
            let exitCode: number | null = null
            let passwordBuffer = ""
            let currentEntry: PendingEntry | null = null
            let currentID: SecureInputID | null = null

            const dataDisp = pty.onData((chunk: string) => {
              output += chunk

              if (currentEntry) {
                if (currentID) pending.delete(currentID)
                currentEntry = null
                currentID = null
                passwordBuffer = ""
                return
              }

              passwordBuffer += chunk
              if (Buffer.byteLength(passwordBuffer, "utf-8") > 4096) {
                passwordBuffer = passwordBuffer.slice(-2048)
              }

              const promptText = detectPasswordPrompt(passwordBuffer)
              if (!promptText) return

              const id = nextSecureInputID()
              currentID = id
              const info: SecureInputRequest = {
                id,
                sessionID: input.sessionID,
                prompt: promptText,
                command: input.command,
              }
              currentEntry = createEntry(info)
              pending.set(id, currentEntry)
              output = output.replace(promptText, "[password supplied]")
              passwordBuffer = ""

              currentEntry.promise.then((password) => {
                pty.write(password + "\n")
              }).catch(() => {
                pty.kill()
              })
            })

            const exitDisp = pty.onExit((event) => {
              exitCode = event.exitCode
              if (currentID && currentEntry) {
                pending.delete(currentID)
                currentEntry.reject(new CancelledError())
              }
              resolve({ output, exitCode })
            })

            const timeoutId = setTimeout(() => {
              if (exitCode === null) {
                pty.kill()
                if (currentID && currentEntry) {
                  pending.delete(currentID)
                  currentEntry.reject(new TimedOutError())
                }
                resolve({ output, exitCode: null })
              }
            }, timeoutMs)

            return () => {
              clearTimeout(timeoutId)
              dataDisp.dispose()
              exitDisp.dispose()
            }
          }),
      )
    })

    return Service.of({ request, submit, cancel, list, execute })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [] })

export * as SecureInput from "."
