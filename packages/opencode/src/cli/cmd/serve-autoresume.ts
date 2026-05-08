import { Cause, Effect, Ref } from "effect"
import { WorkspaceRef } from "@/effect/instance-ref"
import { InstanceStore } from "@/project/instance-store"
import { pickAction, ResumePrompt } from "@/session/auto-resume"
import { SessionPrompt } from "@/session/prompt"
import * as Session from "@/session/session"
import { SessionRevert } from "@/session/revert"

function num(key: string, fallback: number) {
  const raw = Number(process.env[key])
  if (!Number.isFinite(raw)) return fallback
  return Math.max(0, Math.floor(raw))
}

function stale(now: number, created: number, age: number) {
  return now - created > age
}

export const autoresume = Effect.fn("Cli.serve.autoresume")(function* () {
  const scan = num("OPENCODE_SERVE_RESUME_SCAN_LIMIT", 30)
  const max = num("OPENCODE_SERVE_RESUME_MAX", 3)
  const age = num("OPENCODE_SERVE_RESUME_AGE_MS", 60 * 60 * 1000)
  if (scan <= 0 || max <= 0) return

  const rows = yield* Effect.sync(() => [...Session.listGlobal({ limit: scan })])
  const store = yield* InstanceStore.Service
  const session = yield* Session.Service
  const prompt = yield* SessionPrompt.Service
  const revert = yield* SessionRevert.Service
  const count = yield* Ref.make(0)

  for (const item of rows) {
    if ((yield* Ref.get(count)) >= max) break

    const ok = yield* store
      .provide(
        { directory: item.directory },
        Effect.gen(function* () {
          const msgs = yield* session.messages({ sessionID: item.id })
          const action = pickAction(msgs)
          if (!action) return false
          if (action.type === "unanswered" && stale(Date.now(), action.user.time.created, age)) return false

          if (action.type === "unanswered") {
            yield* revert.cleanup(item)
            yield* session.touch(item.id)
            yield* prompt.loop({ sessionID: item.id })
            return true
          }

          yield* prompt.prompt({
            sessionID: item.id,
            agent: action.user.agent,
            model: action.user.model,
            parts: [{ type: "text", text: ResumePrompt, synthetic: true }],
          })
          return true
        }),
      )
      .pipe(
        Effect.provideService(WorkspaceRef, item.workspaceID),
        Effect.catchCause((cause) => {
          const error = Cause.squash(cause)
          if (error instanceof Session.BusyError) return Effect.succeed(false)
          return Effect.logWarning("auto resume failed", { sessionID: item.id, error }).pipe(Effect.as(false))
        }),
      )
    if (!ok) continue
    yield* Ref.update(count, (v) => v + 1)
  }
})
