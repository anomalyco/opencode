import type { OpenCodeEvent } from "@opencode-ai/sdk-next"
import { Deferred, Effect, Exit, Fiber, Scope, Stream } from "effect"
import type { GatewayConfig } from "./config"
import type { GatewayTask } from "./store"

export type ChatCompletion = {
  text: string
  model: { providerID: string; modelID: string }
  tokens?: { input: number; output: number; reasoning: number }
  cost?: number
  durationMs: number
}

export type ChatFailure = {
  kind: "timeout" | "rate_limit" | "authentication" | "provider" | "empty_output" | "policy"
  retryable: boolean
  message: string
}

export type ChatEvidence =
  | {
      type: "session_reconciled"
      sessionID: string
      promptMessageID: string
      agent: string
      model: { providerID: string; modelID: string }
    }
  | { type: "prompt_admitted"; admittedSequence: number }
  | { type: "operation_blocked"; tool: string; executed: boolean; interrupted: boolean }
  | {
      type: "model_completed"
      model: { providerID: string; modelID: string }
      tokens?: { input: number; output: number; reasoning: number }
      cost?: number
      durationMs: number
    }
  | { type: "model_failed"; kind: ChatFailure["kind"]; retryable: boolean; durationMs: number }

export type ChatPort = {
  complete(task: GatewayTask): Promise<{ ok: true; value: ChatCompletion } | { ok: false; error: ChatFailure }>
  interrupt(sessionID: string): Promise<boolean>
  close(): Promise<void>
}

export type SessionRuntimeEvent =
  | Extract<ChatEvidence, { type: "session_reconciled" | "prompt_admitted" }>
  | { type: "tool_called"; tool: string; input: unknown; executed: boolean }

export type SessionAssistant = {
  messageID: string
  agent: string
  model: { providerID: string; modelID: string }
  content: readonly (
    | { type: "text"; text: string }
    | { type: "reasoning"; text: string }
    | { type: "tool"; name: string; input?: unknown; executed?: boolean }
  )[]
  tokens?: { input: number; output: number; reasoning: number }
  cost?: number
}

export type SessionRuntime = {
  execute(task: GatewayTask, onEvent: (event: SessionRuntimeEvent) => Promise<void>): Promise<SessionAssistant>
  interrupt(sessionID: string): Promise<boolean>
  close(): Promise<void>
}

export function createChatPort(input: {
  runtime: SessionRuntime
  record?: (task: GatewayTask, event: ChatEvidence) => Promise<void>
  now?: () => number
  modelTimeoutMs: number
}): ChatPort {
  const record = input.record ?? (async () => undefined)
  const now = input.now ?? Date.now

  return {
    complete(task) {
      const startedAt = now()
      let blocked: Extract<SessionRuntimeEvent, { type: "tool_called" }> | undefined
      const run = input.runtime.execute(task, async (event) => {
        if (event.type !== "tool_called") {
          await record(task, event)
          return
        }

        blocked = event
        const interrupted = await input.runtime.interrupt(task.sessionID)
        await record(task, {
          type: "operation_blocked",
          tool: event.tool,
          executed: event.executed,
          interrupted,
        })
      })

      return withTimeout(run, input.modelTimeoutMs).then(
        async (assistant) => {
          const projectedTool = assistant.content.find((part) => part.type === "tool")
          if (projectedTool && !blocked) {
            blocked = {
              type: "tool_called",
              tool: projectedTool.name,
              input: projectedTool.input,
              executed: projectedTool.executed ?? false,
            }
            const interrupted = await input.runtime.interrupt(task.sessionID)
            await record(task, {
              type: "operation_blocked",
              tool: projectedTool.name,
              executed: projectedTool.executed ?? false,
              interrupted,
            })
          }
          if (blocked) return { ok: false as const, error: policyFailure() }

          const text = assistant.content
            .filter((part): part is Extract<SessionAssistant["content"][number], { type: "text" }> => part.type === "text")
            .map((part) => part.text)
            .join("")
            .trim()
          if (!text) {
            const error: ChatFailure = {
              kind: "empty_output",
              retryable: false,
              message: "The model returned no final text.",
            }
            await record(task, {
              type: "model_failed",
              kind: error.kind,
              retryable: error.retryable,
              durationMs: now() - startedAt,
            })
            return { ok: false as const, error }
          }

          const value: ChatCompletion = {
            text,
            model: assistant.model,
            ...(assistant.tokens ? { tokens: assistant.tokens } : {}),
            ...(assistant.cost === undefined ? {} : { cost: assistant.cost }),
            durationMs: now() - startedAt,
          }
          await record(task, {
            type: "model_completed",
            model: value.model,
            ...(value.tokens ? { tokens: value.tokens } : {}),
            ...(value.cost === undefined ? {} : { cost: value.cost }),
            durationMs: value.durationMs,
          })
          return { ok: true as const, value }
        },
        async (cause) => {
          const timeout = cause instanceof ModelTimeoutError
          if (timeout) await input.runtime.interrupt(task.sessionID)
          const error = timeout ? timeoutFailure() : classifyFailure(cause)
          await record(task, {
            type: "model_failed",
            kind: error.kind,
            retryable: error.retryable,
            durationMs: now() - startedAt,
          })
          return { ok: false as const, error }
        },
      )
    },
    interrupt: (sessionID) => input.runtime.interrupt(sessionID),
    close: () => input.runtime.close(),
  }
}

export async function createEmbeddedChatPort(input: {
  config: GatewayConfig
  record?: (task: GatewayTask, event: ChatEvidence) => Promise<void>
  modelTimeoutMs?: number
}): Promise<ChatPort> {
  return createChatPort({
    runtime: await createSessionRuntime(input.config),
    ...(input.record ? { record: input.record } : {}),
    modelTimeoutMs: input.modelTimeoutMs ?? 120_000,
  })
}

export function assertConfiguredModelAvailable(
  model: { providerID: string; modelID: string },
  available: readonly { providerID: string; id: string }[],
) {
  if (available.some((item) => item.id === model.modelID && item.providerID === model.providerID)) return
  throw new Error("Configured model is unavailable")
}

async function createSessionRuntime(config: GatewayConfig): Promise<SessionRuntime> {
  const { AbsolutePath, Agent, Location, Model, OpenCode, Prompt, Provider, Session, SessionMessage } =
    await import("@opencode-ai/sdk-next")
  const scope = Scope.makeUnsafe()
  const client = await Effect.runPromise(OpenCode.create().pipe(Effect.provideService(Scope.Scope, scope)))
  const agent = Agent.ID.make("feishu-chat")
  const model = Model.Ref.make({
    id: Model.ID.make(config.model.modelID),
    providerID: Provider.ID.make(config.model.providerID),
  })
  const location = Location.Ref.make({ directory: AbsolutePath.make(config.workspaceDirectory) })
  const available = await Effect.runPromise(
    Effect.gen(function* () {
      for (let attempt = 0; attempt < 40; attempt++) {
        const result = yield* client.models.list({ location })
        if (result.data.some((item) => item.id === model.id && item.providerID === model.providerID)) return result.data
        yield* Effect.sleep("50 millis")
      }
      return []
    }),
  ).catch(async () => {
    await Effect.runPromise(Scope.close(scope, Exit.void))
    throw new Error("Configured model preflight failed")
  })
  const configured = await Promise.resolve()
    .then(() => assertConfiguredModelAvailable(config.model, available))
    .then(
      () => true,
      () => false,
    )
  if (!configured) {
    await Effect.runPromise(Scope.close(scope, Exit.void))
    throw new Error("Configured model is unavailable")
  }

  return {
    async execute(task, onEvent) {
      const sessionID = Session.ID.make(task.sessionID)
      const promptMessageID = SessionMessage.ID.make(task.promptMessageID)
      const program = Effect.scoped(
        Effect.gen(function* () {
          const session = yield* client.sessions.get({ sessionID }).pipe(
            Effect.catchTag("SessionNotFoundError", () =>
              client.sessions.create({
                id: sessionID,
                agent,
                model,
                location,
              }),
            ),
          )
          if (session.agent !== agent) yield* client.sessions.switchAgent({ sessionID, agent })
          if (session.model?.id !== model.id || session.model.providerID !== model.providerID)
            yield* client.sessions.switchModel({ sessionID, model })
          yield* Effect.promise(() =>
            onEvent({
              type: "session_reconciled",
              sessionID: task.sessionID,
              promptMessageID: task.promptMessageID,
              agent: "feishu-chat",
              model: config.model,
            }),
          )

          const terminal = yield* Deferred.make<
            | { type: "completed"; assistantMessageID: typeof promptMessageID }
            | { type: "failed"; error: unknown }
            | { type: "blocked"; assistantMessageID: typeof promptMessageID }
          >()
          let currentPrompt = false
          let assistantMessageID: typeof promptMessageID | undefined
          const monitor = yield* client.sessions.events({ sessionID }).pipe(
            Stream.runForEach((event: OpenCodeEvent) => {
              if (event.type === "session.next.prompted" && event.data.messageID === promptMessageID) {
                currentPrompt = true
                return Effect.void
              }
              if (!currentPrompt) return Effect.void
              if (event.type === "session.next.step.started") {
                assistantMessageID = event.data.assistantMessageID
                return Effect.void
              }
              if (event.type === "session.next.step.ended" && event.data.assistantMessageID === assistantMessageID)
                return Deferred.succeed(terminal, {
                  type: "completed",
                  assistantMessageID: event.data.assistantMessageID,
                }).pipe(Effect.asVoid)
              if (event.type === "session.next.step.failed" && event.data.assistantMessageID === assistantMessageID)
                return Deferred.succeed(terminal, {
                  type: "failed",
                  error: event.data.error,
                }).pipe(Effect.asVoid)
              if (event.type !== "session.next.tool.called" || event.data.assistantMessageID !== assistantMessageID)
                return Effect.void
              return Effect.promise(() =>
                onEvent({
                  type: "tool_called",
                  tool: event.data.tool,
                  input: event.data.input,
                  executed: event.data.provider.executed,
                }),
              ).pipe(
                Effect.andThen(
                  Deferred.succeed(terminal, {
                    type: "blocked",
                    assistantMessageID: event.data.assistantMessageID,
                  }),
                ),
                Effect.asVoid,
              )
            }),
            Effect.catchCause((cause) =>
              Deferred.succeed(terminal, {
                type: "failed",
                error: cause,
              }).pipe(Effect.asVoid),
            ),
            Effect.forkScoped,
          )
          yield* Effect.yieldNow
          const admitted = yield* client.sessions.prompt({
            sessionID,
            id: promptMessageID,
            prompt: Prompt.make({ text: task.promptText }),
          })
          yield* Effect.promise(() =>
            onEvent({
              type: "prompt_admitted",
              admittedSequence: admitted.admittedSeq,
            }),
          )
          const settled = yield* Deferred.await(terminal)
          yield* Fiber.interrupt(monitor)
          if (settled.type === "failed") return yield* Effect.fail(new SessionStepFailedError(settled.error))

          const assistant = yield* client.sessions.message({
            sessionID,
            messageID: settled.assistantMessageID,
          })
          if (assistant.type !== "assistant")
            return {
              messageID: "",
              agent: "feishu-chat",
              model: config.model,
              content: [],
            } satisfies SessionAssistant

          return {
            messageID: assistant.id,
            agent: assistant.agent,
            model: {
              providerID: assistant.model.providerID,
              modelID: assistant.model.id,
            },
            content: assistant.content.map((part) => {
              if (part.type === "text") return { type: "text" as const, text: part.text }
              if (part.type === "reasoning") return { type: "reasoning" as const, text: part.text }
              return {
                type: "tool" as const,
                name: part.name,
                input: "input" in part.state ? part.state.input : undefined,
                executed: part.provider?.executed,
              }
            }),
            ...(assistant.tokens
              ? {
                  tokens: {
                    input: assistant.tokens.input,
                    output: assistant.tokens.output,
                    reasoning: assistant.tokens.reasoning,
                  },
                }
              : {}),
            ...(assistant.cost === undefined ? {} : { cost: assistant.cost }),
          } satisfies SessionAssistant
        }),
      )
      return Effect.runPromise(program)
    },
    interrupt(sessionID) {
      return Effect.runPromise(client.sessions.interrupt({ sessionID: Session.ID.make(sessionID) })).then(
        () => true,
        () => false,
      )
    },
    close() {
      return Effect.runPromise(Scope.close(scope, Exit.void))
    },
  }
}

function classifyFailure(cause: unknown): ChatFailure {
  const status = readStatusCode(cause)
  if (status === 401 || status === 403 || includesFailureName(cause, "auth"))
    return {
      kind: "authentication",
      retryable: false,
      message: "Model authentication failed.",
    }
  if (status === 429 || includesFailureName(cause, "rate"))
    return {
      kind: "rate_limit",
      retryable: true,
      message: "The model is temporarily rate limited.",
    }
  return {
    kind: "provider",
    retryable: status === undefined || status >= 500,
    message: "The model request failed.",
  }
}

function readStatusCode(value: unknown, depth = 0): number | undefined {
  if (depth > 4 || typeof value !== "object" || value === null) return undefined
  for (const key of ["statusCode", "status", "code"]) {
    const candidate = Reflect.get(value, key)
    if (typeof candidate === "number") return candidate
  }
  for (const key of ["cause", "error", "reason"]) {
    const candidate = readStatusCode(Reflect.get(value, key), depth + 1)
    if (candidate !== undefined) return candidate
  }
  return undefined
}

function includesFailureName(value: unknown, fragment: string) {
  if (typeof value !== "object" || value === null) return false
  return ["name", "_tag", "type"].some((key) => {
    const candidate = Reflect.get(value, key)
    return typeof candidate === "string" && candidate.toLowerCase().includes(fragment)
  })
}

function policyFailure(): ChatFailure {
  return {
    kind: "policy",
    retryable: false,
    message: "This chat cannot execute tools.",
  }
}

function timeoutFailure(): ChatFailure {
  return {
    kind: "timeout",
    retryable: true,
    message: "The model request timed out.",
  }
}

class ModelTimeoutError extends Error {}

class SessionStepFailedError extends Error {
  constructor(override readonly cause: unknown) {
    super("The provider step failed.")
  }
}

function withTimeout<A>(promise: Promise<A>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ModelTimeoutError()), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}
