import { Cause, Context, Effect, Fiber, Layer, Option, Schema } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { NamedError } from "@opencode-ai/core/util/error"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { ContentBlock, SessionNotification } from "@agentclientprotocol/sdk"
import { Config } from "@/config/config"
import { EffectBridge } from "@/effect/bridge"
import { InstanceState } from "@/effect/instance-state"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Permission } from "@/permission"
import { Session } from "./session"
import { SessionRunState } from "./run-state"
import { SessionStatus } from "./status"
import { MessageID, PartID, SessionID } from "./schema"
import type { SessionPrompt } from "./prompt"
import { DSHClient, DSHError } from "./dsh-client"
import { DSHModel } from "./dsh-model"
import { DSHProjection } from "./dsh-projection"

const Binding = Schema.Struct({
  sessionId: Schema.optional(Schema.NonEmptyString),
  directory: Schema.NonEmptyString,
  owner: SessionID,
  model: Schema.optional(Schema.NonEmptyString),
})
const decodeBinding = Schema.decodeUnknownSync(Binding)

export interface Interface {
  readonly selected: (sessionID: SessionID) => Effect.Effect<boolean>
  readonly prompt: (input: SessionPrompt.PromptInput) => Effect.Effect<SessionV1.WithParts>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DSH") {}

const layer = Layer.effect(Service, Effect.gen(function* () {
  const config = yield* Config.Service
  const sessions = yield* Session.Service
  const permission = yield* Permission.Service
  const events = yield* EventV2Bridge.Service
  const runs = yield* SessionRunState.Service
  const status = yield* SessionStatus.Service
  const state = yield* InstanceState.make(() => Effect.succeed(new Set<SessionID>()))

  const binding = (id: SessionID) => sessions.get(id).pipe(
    Effect.map((session) => session.metadata?.dsh === undefined ? undefined : decodeBinding(session.metadata.dsh)),
    Effect.orDie,
  )

  const selected = Effect.fn("DSH.selected")(function* (sessionID: SessionID) {
    const cfg = yield* config.get()
    if (cfg.backend?.type === "dsh") return true
    if (yield* binding(sessionID)) throw new DSHError("this session belongs to DSH. Select the DSH backend to continue it.")
    return false
  })

  const prompt = Effect.fn("DSH.prompt")(function* (input: SessionPrompt.PromptInput) {
    const cfg = yield* config.get()
    if (cfg.backend?.type !== "dsh") throw new DSHError("DSH is not selected.")
    const backend = cfg.backend
    const ctx = yield* InstanceState.context
    const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
    if ((input.agent && input.agent !== "build") || input.variant || (input.model && input.model.providerID !== "dsh")) {
      throw new DSHError("select the build agent and a configured DSH model; configure execution policy in DSH.")
    }
    if (input.messageID && Option.isSome(yield* sessions.findMessage(input.sessionID,
      (message) => message.info.id === input.messageID).pipe(Effect.orDie))) {
      throw new DSHError("this message ID already exists; the prompt was not resent.")
    }
    if (session.revert) throw new DSHError("reverted transcripts cannot be continued in DSH; create a new session.")
    if (input.noReply || input.system || input.tools || (input.format && input.format.type !== "text")) {
      throw new DSHError("noReply, custom system prompts, tool overrides, and structured output are unsupported; configure DSH's profile instead.")
    }
    const content: ContentBlock[] = input.parts.map((part) => {
      if (part.type === "text") return { type: "text", text: part.text }
      if (part.type === "file" && part.url.startsWith("file:")) {
        return { type: "resource_link", uri: part.url, name: part.filename ?? part.url }
      }
      throw new DSHError("only text and local file references are supported; remove image, agent, or subtask attachments.")
    })
    if (!content.length) throw new DSHError("a prompt must contain text or a local file reference.")
    const saved = yield* binding(input.sessionID)
    if (saved && saved.owner !== input.sessionID) throw new DSHError("forked DSH transcripts cannot share a runtime session; create a new session.")
    if (saved && saved.directory !== ctx.directory) throw new DSHError("saved session belongs to a different workspace.")
    const selectedModelKey = input.model?.modelID ?? saved?.model ?? DSHModel.defaultModel(backend)
    const selectedModel = DSHModel.entries(backend).find((item) => item.key === selectedModelKey)
    if (!selectedModel) throw new DSHError(`model "${selectedModelKey}" is not configured for the DSH backend.`)
    const modelRoute = selectedModel.key === "profile" ? undefined : route(selectedModel.key)
    const history = yield* sessions.messages({ sessionID: input.sessionID, limit: 1 }).pipe(Effect.orDie)
    if (!saved && history.length) {
      throw new DSHError("existing OpenCode history cannot be imported into DSH; create a new session.")
    }
    const active = yield* InstanceState.get(state)
    if (active.has(input.sessionID)) throw new DSHError("a prompt is already running in this session; wait or cancel it first.")
    active.add(input.sessionID)

    const user: SessionV1.User = {
      id: input.messageID ?? MessageID.ascending(), sessionID: input.sessionID, role: "user",
      time: { created: Date.now() }, agent: input.agent ?? "build",
      model: { providerID: ProviderV2.ID.make("dsh"), modelID: ModelV2.ID.make(selectedModel.key) },
    }
    const info: SessionV1.Assistant = {
      id: MessageID.ascending(), parentID: user.id, sessionID: input.sessionID, role: "assistant",
      time: { created: Date.now() }, agent: user.agent, mode: user.agent,
      providerID: user.model.providerID, modelID: user.model.modelID,
      path: { cwd: ctx.directory, root: ctx.worktree }, cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }
    const bridge = yield* EffectBridge.make()
    const projection = new DSHProjection(info,
      (part) => bridge.promise(sessions.updatePart(part)),
      (part, delta) => bridge.promise(sessions.updatePartDelta({
        sessionID: part.sessionID, messageID: part.messageID, partID: part.id, field: "text", delta,
      })),
    )
    const result = { info, parts: projection.parts }
    const work = Effect.gen(function* () {
      yield* status.set(input.sessionID, { type: "busy" })
      yield* sessions.setMetadata({ sessionID: input.sessionID, metadata: {
        ...session.metadata,
        dsh: { owner: input.sessionID, directory: ctx.directory, sessionId: saved?.sessionId, model: saved?.model },
      } })
      yield* sessions.updateMessage(user)
      for (const part of input.parts) {
        if (part.type !== "text" && part.type !== "file") continue
        yield* sessions.updatePart({ ...part, id: part.id ?? PartID.ascending(), sessionID: input.sessionID, messageID: user.id })
      }
      yield* sessions.updateMessage(info)
      yield* sessions.touch(input.sessionID)
      const target: { id?: string; ready: boolean } = { id: saved?.sessionId, ready: false }
      const buffered: SessionNotification[] = []
      const replies = new Set<Fiber.Fiber<boolean>>()
      const client = new DSHClient(backend, ctx.directory, {
        update: async (event) => {
          if (!target.ready) {
            buffered.push(event)
            return
          }
          if (event.sessionId !== target.id) throw new DSHError("runtime sent output for an unowned session.")
          await projection.update(event.update)
        },
        permission: async (request) => {
          if (request.sessionId !== target.id) return { outcome: { outcome: "cancelled" } }
          const allow = request.options.find((option) => option.kind === "allow_once")
          const reject = request.options.find((option) => option.kind === "reject_once")
          if (!allow || !reject) return { outcome: { outcome: "cancelled" } }
          const reply = bridge.fork(permission.ask({
            sessionID: input.sessionID, permission: "dsh", patterns: [request.toolCall.toolCallId],
            always: [], metadata: { title: request.toolCall.title ?? "DSH tool" },
            tool: { messageID: info.id, callID: request.toolCall.toolCallId },
            ruleset: [{ permission: "dsh", pattern: "*", action: "ask" }],
          }).pipe(Effect.match({ onFailure: () => false, onSuccess: () => true })))
          replies.add(reply)
          try {
            const accepted = await bridge.promise(Fiber.join(reply))
            return { outcome: { outcome: "selected", optionId: accepted ? allow.optionId : reject.optionId } }
          } catch {
            // Interrupted permission waits reject through the Fiber bridge.
            return { outcome: { outcome: "cancelled" } }
          } finally {
            replies.delete(reply)
          }
        },
      })
      yield* Effect.gen(function* () {
        target.id = yield* Effect.promise(() => client.session(saved?.sessionId))
        while (buffered.length) {
          const event = buffered.shift()!
          if (event.sessionId !== target.id) throw new DSHError("runtime sent output for an unowned session.")
          yield* Effect.promise(() => projection.update(event.update))
        }
        target.ready = true
        if (modelRoute) {
          yield* Effect.promise(() => client.setConfigOption(target.id!, "model", modelRoute.value))
        }
        yield* sessions.setMetadata({ sessionID: input.sessionID, metadata: {
          ...session.metadata,
          dsh: { owner: input.sessionID, directory: ctx.directory, sessionId: target.id, model: selectedModel.key },
        } })
        const response = yield* Effect.promise(() => client.prompt(target.id!, content))
        info.finish = response.stopReason === "end_turn" ? "stop" : response.stopReason
        if (response.stopReason === "cancelled") info.error = new SessionV1.AbortedError({ message: "DSH execution cancelled" }).toObject()
      }).pipe(
        Effect.onInterrupt(() => Effect.promise(async () => {
          info.error = new SessionV1.AbortedError({ message: "DSH execution cancelled" }).toObject()
          if (target.id) await client.cancel(target.id).catch(() => {})
        })),
        Effect.ensuring(Effect.gen(function* () {
          yield* Effect.forEach(replies, (reply) => Fiber.interrupt(reply), { discard: true })
          yield* Effect.promise(() => client.close())
        })),
      )
      return result
    }).pipe(
      Effect.catchCause((cause) => Effect.gen(function* () {
        if (Cause.hasInterruptsOnly(cause)) return yield* Effect.failCause(cause)
        const message = cause.reasons.flatMap((reason) => reason._tag === "Die" && reason.defect instanceof DSHError ? [reason.defect.message] : [])[0]
          ?? "DSH backend execution failed; check DSH configuration. No prompt was retried."
        info.error = new NamedError.Unknown({ message }).toObject()
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: info.error })
        return result
      })),
      Effect.ensuring(Effect.gen(function* () {
        info.time.completed = Date.now()
        yield* Effect.promise(() => projection.finish())
        yield* sessions.updateMessage(info)
      })),
    )
    return yield* runs.ensureRunning(input.sessionID, Effect.succeed(result), work).pipe(
      Effect.ensuring(Effect.sync(() => active.delete(input.sessionID))),
    )
  })
  return Service.of({ selected, prompt })
}))

export const node = LayerNode.make({
  service: Service, layer,
  deps: [Config.node, Session.node, Permission.node, EventV2Bridge.node, SessionRunState.node, SessionStatus.node],
})

function route(key: string) {
  const separator = key.indexOf("/")
  if (separator <= 0 || separator === key.length - 1) {
    throw new DSHError(`model key "${key}" must use the provider/model format.`)
  }
  return {
    value: JSON.stringify([key.slice(0, separator), key.slice(separator + 1)]),
  }
}

export * as DSH from "./dsh"
