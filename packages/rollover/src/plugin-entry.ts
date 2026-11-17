/** Server-side effect plugin entry (spec Part A §3, Part B §1). */
import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Schema, Stream } from "effect"
import { createHookDeps, handleUsage, runTransform, runImmediateSwap, trackTouchedFile } from "./adapter/opencode/hooks"
import { normalizeProjectedMessages } from "./adapter/opencode/normalize"
import { runCtl } from "./adapter/opencode/ctl"
import { RolloverDefinition } from "./rpc"

export default define({
  id: "rollover",
  effect: (ctx) =>
    Effect.gen(function* () {
      const deps = createHookDeps(ctx)
      const ctlDeps = {
        store: deps.store,
        homeConfigDir: deps.homeConfigDir,
        projectDir: deps.projectDir,
        env: deps.env,
        modelLimits: deps.modelLimits,
        lastMessages: deps.lastMessages,
        // Bare `/rollover` or `/rollover on` activating a session triggers an
        // immediate catch-up extraction: the ledger is built from the context
        // that already exists (mid-chat activation). Fire-and-forget — the
        // command replies at once, and runNow coalesces with the
        // immediate-swap path when the threshold is exceeded too.
        onActivate: (sid: string) => {
          void deps.scheduler.runNow(sid).catch((error) => deps.log(`[rollover] activation catch-up failed: ${String(error)}`))
        },
      }

      // context hook: resolve the model limit, then run the swap/view flow and
      // mutate the provided array exactly once inside runTransform.
      yield* ctx.session.hook("context", (event) =>
        Effect.scoped(
          Effect.gen(function* () {
            const session = yield* ctx.session.get({ sessionID: event.sessionID }).pipe(Effect.catch(() => Effect.succeed(null)))
            if (!session || session.parentID) return

            let limit: number | null = null
            yield* ctx.model.transform((editor) => {
              const info = editor.get(event.model.providerID, event.model.id)
              limit = info?.limit?.context ?? null
            })
            if (limit) deps.modelLimits.set(event.sessionID, limit)

            yield* Effect.promise(() => runTransform(deps, { messages: event.messages, sessionID: event.sessionID }))
          }),
        ),
      )

      // idle hook: the runner awaits this handler, so run the extraction to
      // completion here (onIdle) — a debounced timer would race the short-lived
      // `opencode run` process exit and often never fire at all. onIdle
      // classifies the pending turn with the deterministic extraction gate
      // and schedules the extraction only when the validated policy says to
      // run; any gate error falls back to the pre-gate behavior.
      yield* ctx.session.hook("experimental.idle", (event) =>
        Effect.gen(function* () {
          const session = yield* ctx.session.get({ sessionID: event.sessionID }).pipe(Effect.catch(() => Effect.succeed(null)))
          if (!session || session.parentID) return
          // The last context snapshot predates the just-finished assistant reply;
          // refresh from the projected session history so extraction can catch up.
          const context = yield* ctx.session
            .context({ sessionID: event.sessionID })
            .pipe(Effect.catch(() => Effect.succeed(null)))
          if (context) deps.lastMessages.set(event.sessionID, normalizeProjectedMessages(context))
          yield* Effect.promise(() => deps.scheduler.onIdle(event.sessionID))
        }),
      )

      // tool.execute.after → touchedFiles
      yield* ctx.tool.hook("execute.after", (event) =>
        Effect.promise(() => trackTouchedFile(deps, event)),
      )

      // per-step usage keeps the current-context counter fresh.
      // session.usage.updated carries the session's CUMULATIVE totals (the
      // projector accumulates into the session row), which would inflate the
      // counter without bound; session.step.ended carries each model call's
      // own usage, whose input + cache.read + cache.write is the request's
      // context size.
      yield* ctx.event
        .subscribe({ types: ["session.step.ended"] })
        .pipe(
          Stream.runForEach((event) => Effect.promise(() => handleUsage(deps, event))),
          Effect.forkScoped,
        )

      // session.deleted → drop in-memory caches; persisted files stay.
      yield* ctx.event
        .subscribe({ types: ["session.deleted"] })
        .pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => {
              const sid = event.data.sessionID
              deps.lastMessages.delete(sid)
              deps.modelLimits.delete(sid)
            }),
          ),
          Effect.forkScoped,
        )

      // The /rollover command's output channel (the goal plugin's pattern): the
      // command endpoint returns NoContent on success and there is no success
      // channel for command output, so the text is published on this RPC event
      // and the plugin's GUI and TUI parts show it as a toast. The command
      // itself succeeds, so clients clear the composer and raise no error
      // toast — failing here would make them restore the draft instead.
      const rpc = yield* ctx.rpc.register(RolloverDefinition, {}).pipe(Effect.orDie)

      // command registration: direct execution (P0-8), zero LLM dispatch.
      // When the command's arguments set a threshold the current context
      // already exceeds, runImmediateSwap starts the swap pipeline at once
      // and reports its outcome on a second notify; the reply's suffix says
      // so. Otherwise the automatic mechanism keeps owning the timing.
      yield* ctx.command.transform((editor) => {
        editor.add({
          name: "rollover",
          description: "Rollover: activate / status and settings",
          execute: (input) =>
            Effect.gen(function* () {
              const session = yield* ctx.session.get({ sessionID: input.sessionID }).pipe(Effect.orDie)
              const label = session.model ? `${session.model.providerID}/${session.model.id}` : null
              const text = yield* Effect.promise(() =>
                runCtl({ ...ctlDeps, sessionModel: () => label }, input.sessionID, input.prompt.text),
              )
              const notify = (t: string) =>
                rpc.events
                  .emit("notify", { sessionID: input.sessionID, text: t })
                  .pipe(Effect.runPromise)
              const suffix = yield* Effect.promise(() => runImmediateSwap(deps, input.sessionID, notify))
              yield* Effect.promise(() => notify(text + suffix))
            }),
        })
      })

      // rollover_ctl tool for agents and advanced use (spec §9.1); targets the caller's parent session.
      yield* ctx.tool.transform((editor) => {
        editor.add({
          name: "rollover_ctl",
          description:
            "Read or change Rollover state for this session. Pass the text after the /rollover command as args (empty activates auto mode, 'status', 'show', 'on', 'off', '150k', or '-n 5'). A threshold or tail setting ('150k', '-n 5') also enables rollover for this session; 'on'/'off' are the pure toggles.",
          input: Schema.Struct({ args: Schema.String.annotate({ description: "Arguments for the /rollover command" }) }),
          execute: (input, toolContext) =>
            Effect.gen(function* () {
              const session = yield* ctx.session.get({ sessionID: toolContext.sessionID }).pipe(Effect.orDie)
              const target = session.parentID ?? toolContext.sessionID
              const label = session.model ? `${session.model.providerID}/${session.model.id}` : null
              const text = yield* Effect.promise(() =>
                runCtl({ ...ctlDeps, sessionModel: () => label }, target, input.args),
              )
              return { content: text, metadata: { sessionID: target } }
            }),
        })
      })

      return
    }),
})
