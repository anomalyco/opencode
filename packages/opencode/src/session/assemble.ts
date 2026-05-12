import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import { Effect } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { MessageV2 } from "./message-v2"
import { Session } from "./session"
import { MessageID, PartID } from "./schema"
import { SessionAssembleTemplate } from "./assemble-template"
import { loadScriptDefault } from "./script"

const log = Log.create({ service: "session.assemble" })

export interface Input {
  sessionID: string
  sessionDir: string
  workspaceRoot: string
  directory: string
  step: number
  messages: MessageV2.WithParts[]
  session: Session.Info
  agent: {
    name: string
  }
  model: {
    id: string
    providerID: string
  }
}

function valid(input: unknown): input is MessageV2.WithParts[] {
  return (
    Array.isArray(input) &&
    input.every((msg) => {
      if (!msg || typeof msg !== "object") return false
      const value = msg as { info?: { role?: unknown }; parts?: unknown }
      return (value.info?.role === "user" || value.info?.role === "assistant") && Array.isArray(value.parts)
    })
  )
}

function fallback(input: {
  session: Session.Info
  agent: Agent.Info
  model: Provider.Model
  messages: MessageV2.WithParts[]
  reason: string
}) {
  const messageID = MessageID.ascending()
  return [
    ...input.messages,
    {
      info: {
        id: messageID,
        sessionID: input.session.id,
        role: "user",
        time: {
          created: Date.now(),
        },
        agent: input.agent.name,
        model: {
          providerID: input.model.providerID,
          modelID: input.model.id,
        },
      },
      parts: [
        {
          id: PartID.ascending(),
          sessionID: input.session.id,
          messageID,
          type: "text",
          synthetic: true,
          text: `<system-reminder>
The session's custom assemble.ts context template failed (${input.reason}). The original messages are being used for this request.

Tell the user that their custom assemble.ts is invalid and should be fixed in the session directory. This reminder is temporary and will disappear once assemble.ts loads, runs, and returns MessageV2.WithParts[] successfully.
</system-reminder>`,
        },
      ],
    },
  ] satisfies MessageV2.WithParts[]
}

export const run = Effect.fn("SessionAssemble.run")(function* (input: {
  session: Session.Info
  agent: Agent.Info
  model: Provider.Model
  step: number
  messages: MessageV2.WithParts[]
}) {
  const ctx = yield* InstanceState.context
  const dir = Session.folder(input.session.id)
  yield* Effect.promise(() => SessionAssembleTemplate.ensure(dir)).pipe(
    Effect.catchCause((cause) => {
      log.error("failed to ensure assemble script", { sessionID: input.session.id, cause })
      return Effect.void
    }),
  )
  const execute = yield* Effect.promise(() => loadScriptDefault(path.join(dir, "assemble.ts"))).pipe(
    Effect.catchCause((cause) => {
      log.error("failed to load assemble script", { sessionID: input.session.id, cause })
      return Effect.succeed(undefined)
    }),
  )
  if (!execute) return fallback({ ...input, reason: "load error" })
  const result = yield* Effect.promise(() =>
    Promise.resolve(
      execute({
        sessionID: input.session.id,
        sessionDir: dir,
        workspaceRoot: ctx.worktree,
        directory: ctx.directory,
        step: input.step,
        messages: input.messages,
        session: input.session,
        agent: {
          name: input.agent.name,
        },
        model: {
          id: input.model.id,
          providerID: input.model.providerID,
        },
      } satisfies Input),
    ),
  ).pipe(
    Effect.catchCause((cause) => {
      log.error("failed to execute assemble script", { sessionID: input.session.id, cause })
      return Effect.succeed(fallback({ ...input, reason: "execution error" }))
    }),
  )
  if (valid(result)) return result
  log.warn("assemble script returned invalid messages", { sessionID: input.session.id })
  return fallback({ ...input, reason: "invalid return value" })
})

export * as SessionAssemble from "./assemble"
