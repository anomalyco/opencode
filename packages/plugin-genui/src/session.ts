export * as GenUISession from "./session.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import type { Session } from "@opencode/schema/session"
import { Effect, Stream } from "effect"
import { GenUI } from "./genui.js"

const enter = `<system-reminder>
The user is viewing this session in the OpenCode app. For the occasional answer that is clearly better seen or clicked than read, such as a dashboard, a chart of real data or a form, ${GenUI.RENDER_TOOL} draws interactive UI while you write it; load the genui skill first. Answer everything else in text as usual. When the in-app browser is connected, its tools are in your tool list and the browser skill explains them.
</system-reminder>`

const leave = `<system-reminder>
${GenUI.RENDER_TOOL} is no longer available in this session, because the user is not in the OpenCode app or turned generated UI off. Answer in text.
</system-reminder>`

/**
 * Offers the render tool, and tells the agent it may use it, only while the user can see generated UI: the app marks
 * its prompts with `metadata.genui = true` while the setting is on, so the latest prompt decides.
 */
export const register = Effect.fn("GenUISession.register")(function* (ctx: {
  readonly session: Pick<Context["session"], "hook" | "synthetic">
  readonly event: Context["event"]
}) {
  // In memory only: after a restart a session counts as unknown, so its next app prompt repeats the reminder once.
  const available = new Map<Session.ID, boolean>()

  yield* ctx.session.hook("prompt", (event) => {
    const previous = available.get(event.sessionID)
    const offered = event.metadata?.genui === true
    available.set(event.sessionID, offered)
    const text = offered && previous !== true ? enter : !offered && previous === true ? leave : undefined
    if (!text) return Effect.void
    // The prompt hook runs before its prompt is admitted, so the reminder is admitted just ahead of it and both reach
    // the model in one step. Sent from the context hook instead, it arrives after the step and runs another one.
    return ctx.session
      .synthetic({ sessionID: event.sessionID, text, resume: false })
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to persist the GenUI reminder", { sessionID: event.sessionID, cause }),
        ),
      )
  })

  yield* ctx.session.hook("context", (event) =>
    Effect.sync(() => {
      if (available.get(event.sessionID) !== true) delete event.tools[GenUI.RENDER_TOOL]
    }),
  )

  yield* ctx.event.subscribe().pipe(
    Stream.filter((event) => event.type === "session.deleted"),
    Stream.runForEach((event) =>
      Effect.sync(() => {
        available.delete(event.data.sessionID)
      }),
    ),
    Effect.forkScoped({ startImmediately: true }),
  )
})
