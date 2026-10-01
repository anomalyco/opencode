import type { CancelNotification, PromptRequest, PromptResponse, RequestError } from "@agentclientprotocol/sdk"
import { isSessionNotFoundError, type CommandInfo, type OpenCodeClient } from "@opencode/client/promise"
import { SessionMessage } from "@opencode/schema/session-message"
import { Effect, Ref, type Scope } from "effect"
import { builtinCommands, type ACPCatalog, type Catalog } from "./catalog"
import { currentModel } from "./config-option"
import type { ACPConnection } from "./connection"
import { promptContentToParts } from "./content"
import { ACPError } from "./error"
import {
  ChildSessionUpdateMethod,
  streamTurn,
  type ChildSessionUpdate,
  type TurnControl,
  type TurnStart,
} from "./event"
import { ACPPromise } from "./promise"
import type { ACPSessions, Attached } from "./sessions"

type PreparedPrompt = {
  readonly start: TurnStart
  readonly text: string
  readonly files: Array<{ readonly uri: string; readonly name?: string }>
  readonly synthetic: ReadonlyArray<string>
  readonly slash?: { readonly name: string; readonly args: string }
  readonly command?: CommandInfo
}

export interface Interface {
  prompt(input: PromptRequest, signal?: AbortSignal): Promise<PromptResponse>
  cancel(input: CancelNotification): Promise<void>
  /** Cancels the session's active turn and waits for it to settle. */
  readonly close: (sessionID: string) => Effect.Effect<void, ACPError.Error | RequestError>
}

export function make(input: {
  readonly client: OpenCodeClient
  readonly connection: ACPConnection.Connection
  readonly sessions: ACPSessions.Interface
  readonly catalog: ACPCatalog.Interface
  readonly capabilities: Ref.Ref<{ readonly childSessionUpdates: boolean }>
  readonly run: <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) => Promise<A>
}): Interface {
  const active = new Map<string, { readonly control: TurnControl; readonly turn: Promise<PromptResponse> }>()

  const cancelTurn = (sessionID: string) => {
    const turn = active.get(sessionID)
    if (turn) {
      turn.control.cancelled = true
      turn.control.admission.abort()
    }
    return input.client.session.interrupt({ sessionID })
  }

  const sendUsageUpdate = async (state: Attached, used?: number) => {
    if (!used) return
    const model = await input.run(
      Effect.gen(function* () {
        const catalog = yield* input.catalog.get(state.cwd)
        const current = currentModel(catalog, yield* Ref.get(state.selection))
        return catalog.models.find((item) => item.providerID === current.providerID && item.id === current.id)
      }),
    )
    if (!model?.limit.context) return
    const info = await input.client.session.get({ sessionID: state.id })
    await input.connection.sessionUpdate({
      sessionId: state.id,
      update: {
        sessionUpdate: "usage_update",
        used,
        size: model.limit.context,
        cost: { amount: info.cost, currency: "USD" },
      },
    })
  }

  return {
    prompt: async (params, signal) => {
      // Read everything first so the active check and registration below stay synchronous.
      const resolved = await input.run(
        Effect.gen(function* () {
          const attached = yield* input.sessions.require(params.sessionId)
          return {
            attached,
            catalog: yield* input.catalog.get(attached.cwd),
            childSessionUpdates: (yield* Ref.get(input.capabilities)).childSessionUpdates,
          }
        }),
      )
      const state = resolved.attached
      if (active.has(state.id)) {
        throw new ACPError.ServiceFailureError({
          safeMessage: `Session already has an active ACP prompt: ${state.id}`,
          service: "session",
        })
      }
      const messageID = SessionMessage.ID.create()
      const prepared = preparePrompt(resolved.catalog, params.prompt, messageID)
      const control: TurnControl = { cancelled: false, admission: new AbortController() }
      const extNotification = input.connection.extNotification
      const childSessionUpdate =
        resolved.childSessionUpdates && extNotification
          ? (update: ChildSessionUpdate) => extNotification(ChildSessionUpdateMethod, update).then(() => {})
          : undefined
      // A `$/cancel_request` for this prompt behaves like `session/cancel` for its turn.
      const cancel = () => void cancelTurn(state.id).catch(() => {})
      const turn = streamTurn({
        client: input.client,
        connection: input.connection,
        sessionID: state.id,
        cwd: state.cwd,
        start: prepared.start,
        action: prepared.command !== undefined,
        control,
        connectionSignal: input.connection.signal,
        sessionSignal: state.signal,
        submit: (signal) => submitPrompt(input.client, state, prepared, signal),
        ...(childSessionUpdate ? { childSessionUpdate } : {}),
      })
        .then(async (result) => {
          await sendUsageUpdate(state, result.contextTokens).catch(() => {})
          return result.response
        })
        .finally(() => {
          signal?.removeEventListener("abort", cancel)
          if (active.get(state.id)?.control === control) active.delete(state.id)
        })
      active.set(state.id, { control, turn })
      signal?.addEventListener("abort", cancel, { once: true })
      // The cancel may already be buffered behind the awaits above.
      if (signal?.aborted) cancel()
      return turn
    },
    cancel: async (params) => {
      await cancelTurn(params.sessionId).catch(() => {})
    },
    close: Effect.fnUntraced(function* (sessionID) {
      const turn = active.get(sessionID)
      yield* ACPPromise.promise(() =>
        cancelTurn(sessionID).catch((error) => {
          if (!isSessionNotFoundError(error)) throw error
        }),
      )
      if (turn) yield* Effect.promise(() => turn.turn.catch(() => {}))
    }),
  }
}

function preparePrompt(catalog: Catalog, prompt: PromptRequest["prompt"], messageID: string): PreparedPrompt {
  const parts = promptContentToParts(prompt)
  const visible = parts.filter((part) => part.type !== "text" || (!part.synthetic && !part.ignored))
  const synthetic = parts.flatMap((part) => (part.type === "text" && part.synthetic ? [part.text] : []))
  const text = visible.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
  const files = visible.flatMap((part) => (part.type === "file" ? [{ uri: part.url, name: part.filename }] : []))
  const slash = detectSlashCommand(text)
  const command = slash ? catalog.commands.find((item) => item.name === slash.name) : undefined
  const start = turnStart(messageID, slash)
  return { start, text, files, synthetic, slash, command }
}

async function submitPrompt(client: OpenCodeClient, session: Attached, prompt: PreparedPrompt, signal: AbortSignal) {
  if (prompt.synthetic.length > 0) {
    await client.session.synthetic({
      sessionID: session.id,
      text: prompt.synthetic.join("\n\n"),
      description: "ACP embedded context",
      delivery: "steer",
      resume: false,
    })
  }
  if (prompt.start.type === "compaction") return client.session.compact({ sessionID: session.id, id: prompt.start.id })
  if (prompt.command) {
    return client.session.command(
      {
        sessionID: session.id,
        name: prompt.command.name,
        text: prompt.slash?.args ?? "",
        files: prompt.files,
        delivery: "steer",
      },
      { signal },
    )
  }
  return client.session.prompt(
    { sessionID: session.id, id: prompt.start.id, text: prompt.text, files: prompt.files, delivery: "steer" },
    { signal },
  )
}

function turnStart(messageID: string, slash: PreparedPrompt["slash"]): TurnStart {
  if (slash && builtinCommands.get(slash.name)?.start === "compaction") return { type: "compaction", id: messageID }
  return { type: "input", id: messageID }
}

function detectSlashCommand(text: string): { readonly name: string; readonly args: string } | undefined {
  const value = text.trim()
  if (!value.startsWith("/")) return undefined
  const [name, ...rest] = value.slice(1).split(/\s+/)
  if (!name) return undefined
  return { name, args: rest.join(" ").trim() }
}

export * as ACPTurn from "./turn"
