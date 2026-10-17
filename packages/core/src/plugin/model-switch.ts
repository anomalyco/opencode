export * as ModelSwitchPlugin from "./model-switch.js"

import { Message } from "@opencode/ai"
import { define } from "@opencode/plugin/effect/plugin"
import type { SessionMessage } from "@opencode/schema/session-message"
import { Effect, Option, Schema } from "effect"

const key = "opencode.model-switch"
const decodeAnnounced = Schema.decodeUnknownOption(Schema.Array(Schema.String))

const list = (names: ReadonlyArray<string>) => names.map((name) => `\`${name}\``).join(" and ")

/**
 * When a request offers a different model a history whose tool calls name
 * tools this request does not offer, remind the model once which of those
 * tools it lacks. The reminder is persisted so later requests, and later
 * switches to models with the same tools, do not repeat it.
 */
export const Plugin = define({
  id: key,
  effect: Effect.fn(function* (ctx) {
    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        const offered = new Set(Object.keys(event.tools))

        // Cheap check first: does the outgoing request call any tool it does not offer?
        const outgoing = event.messages.flatMap((message) => (message.role === "assistant" ? message.content : []))
        if (!outgoing.some((part) => part.type === "tool-call" && !offered.has(part.name))) return

        // Only calls another model made count; a tool this model used and then lost is not a switch.
        const history = yield* ctx.session
          .context({ sessionID: event.sessionID })
          .pipe(Effect.orElseSucceed((): ReadonlyArray<SessionMessage.Info> => []))
        const foreign = history.filter(
          (message): message is SessionMessage.Assistant =>
            message.type === "assistant" &&
            (message.model.providerID !== event.model.providerID || message.model.id !== event.model.id),
        )
        const calls = foreign.flatMap((message) =>
          message.content.flatMap((part) => (part.type === "tool" ? [part.name] : [])),
        )
        const removed = [...new Set(calls)].filter((name) => !offered.has(name))
        if (removed.length === 0) return

        // Say nothing if the most recent reminder already named all of them.
        const last = history.findLast((message) => message.metadata?.[key] !== undefined)
        const announced = Option.getOrUndefined(decodeAnnounced(last?.metadata?.[key])) ?? []
        if (removed.every((name) => announced.includes(name))) return

        // GPT models edit through patch; everything else uses edit and write.
        const added = (removed.includes("patch") ? ["edit", "write"] : ["patch"]).filter((name) => offered.has(name))
        const text = `<system-reminder>
You are continuing a conversation started by a different model. Some tools it used are not available to you. ${list(removed)} ${removed.length === 1 ? "is" : "are"} no longer available and must not be called${added.length > 0 ? `; use ${list(added)} instead` : ""}.
</system-reminder>`

        // Before the user's prompt, matching where agent-switch reminders land.
        const at = event.messages.at(-1)?.role === "user" ? event.messages.length - 1 : event.messages.length
        event.messages.splice(at, 0, Message.user(text))
        yield* ctx.session
          .synthetic({ sessionID: event.sessionID, text, metadata: { [key]: removed }, resume: false })
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("failed to persist model switch reminder", { sessionID: event.sessionID, cause }),
            ),
          )
      }),
    )
  }),
})
