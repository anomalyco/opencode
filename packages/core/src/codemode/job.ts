export * as CodeModeJob from "./job.js"

import { Identifier } from "@opencode/schema/identifier"
import { Cause, Context, Deferred, Effect, Exit, Option, type Scope, Semaphore } from "effect"
import { extension } from "mime-types"
import { Flag } from "../flag.js"
import { Job } from "../job.js"
import { SystemNotice } from "../session/system-notice.js"
import type { Session } from "../session.js"
import type { Tool } from "../tool.js"
import { ToolOutput } from "../tool-output.js"

export function notice(job: Pick<Job.Info, "id" | "status" | "output" | "error">) {
  const state = job.status === "running" ? "cancelled" : job.status
  const body = job.status === "running" ? "Interrupted by server restart." : (job.output ?? job.error ?? state)
  return {
    description: "Script",
    text: SystemNotice.render(`Code Mode script ${job.id} ${SystemNotice.outcome(state)}.`, {
      label: "Result",
      text: body,
    }),
    metadata: { source: "codemode", jobID: job.id, state },
  }
}

const BLOCK_TIMEOUT = "2 minutes"

type Execute = (context: Tool.Context) => Effect.Effect<Tool.NormalizedResult, Tool.Error>
type Run = (context: Tool.Context, execute: Execute) => ReturnType<Execute>

/** Only a session drain can hand off work and report its result. */
export const Current = Context.Reference<Run | undefined>("@opencode/CodeModeJob", { defaultValue: () => undefined })

export const make = Effect.fnUntraced(function* (
  jobs: Job.Interface,
  synthetic: Session.Interface["synthetic"],
  scope: Scope.Scope,
) {
  // A custom session runner can drain without installing the Location's tool services.
  const services = Option.all({
    flags: yield* Effect.serviceOption(Flag.Service),
    output: yield* Effect.serviceOption(ToolOutput.Service),
  })
  if (Option.isNone(services)) return
  const { flags, output } = services.value
  const truncate = Effect.fnUntraced(function* (text: string) {
    const bounded = yield* output.truncate({ content: [{ type: "text", text }] })
    return bounded.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
  })

  return Effect.fn("CodeModeJob.execute")(function* (context: Tool.Context, execute: Execute) {
    if (!(yield* flags.enabled("full_codemode"))) return yield* execute(context)
    const id = `cm_${Identifier.ascending()}`
    const sessionID = context.sessionID
    const result = yield* Deferred.make<Tool.NormalizedResult, Tool.Error>()
    const detached = yield* Deferred.make<void>()
    const progress = Semaphore.makeUnsafe(1)
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        yield* context.progress({ background: true })
        yield* jobs.start({
          id,
          type: "codemode",
          title: "Code Mode script",
          recovery: { kind: "codemode", sessionID, jobID: id },
          run: Effect.gen(function* () {
            const exit = yield* execute({
              ...context,
              progress: (update) =>
                progress.withPermit(
                  Deferred.isDone(detached).pipe(
                    // The background flag tells clients this script can move to the background.
                    Effect.flatMap((done) => (done ? Effect.void : context.progress({ ...update, background: true }))),
                  ),
                ),
            }).pipe(Effect.provideService(Job.BlockingParent, id), Effect.interruptible, Effect.exit)
            yield* Deferred.done(result, exit)
            if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) return yield* Effect.failCause(exit.cause)
            const text = Exit.isFailure(exit)
              ? Cause.pretty(exit.cause)
              : exit.value.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
            const body = yield* truncate(text)
            if (Exit.isFailure(exit) || exit.value.metadata?.error === true) return yield* Effect.fail(new Error(body))
            return body
          }),
        })
        const blocked = yield* restore(jobs.block({ id, sessionID }).pipe(Effect.timeoutOption(BLOCK_TIMEOUT))).pipe(
          Effect.onInterrupt(() => jobs.cancel(id)),
        )
        if (Option.isSome(blocked) && blocked.value?.type === "finished") return yield* Deferred.await(result)
        const job = yield* jobs.background(id)
        if (!job?.notificationID) return yield* Effect.interrupt
        const notificationID = job.notificationID
        // Drain the last progress publication before the tool row becomes terminal.
        yield* progress.withPermit(Deferred.succeed(detached, undefined))
        yield* Effect.gen(function* () {
          const { info } = yield* jobs.wait({ id })
          // Session removal cancels the job and removes its outbox row.
          if (!info || info.status === "cancelled") return
          // Synthetic messages carry text. Keep the script's file results accessible without putting base64 in its inbox.
          const exit = yield* Deferred.await(result).pipe(Effect.exit)
          const files = Exit.isSuccess(exit) ? exit.value.content.filter((part) => part.type === "file") : []
          const paths = yield* Effect.forEach(files, (file) => {
            const prefix = `data:${file.mime};base64,`
            if (!file.uri.startsWith(prefix)) return Effect.succeed(file.uri)
            const ext = extension(file.mime)
            return output
              .save(Buffer.from(file.uri.slice(prefix.length), "base64"), ext ? `.${ext}` : "")
              .pipe(Effect.catchDefect(() => Effect.succeed(`Could not save ${file.mime} attachment.`)))
          })
          const message = notice(
            paths.length
              ? { ...info, output: yield* truncate([info.output ?? info.error, ...paths].join("\n")) }
              : info,
          )
          yield* synthetic({ id: notificationID, sessionID, ...message }).pipe(
            Effect.catchTag("Session.NotFoundError", () => Effect.void),
          )
          yield* jobs.completeBackground(notificationID)
        }).pipe(Effect.interruptible, Effect.forkIn(scope))
        const text = `Script ${id} is still running; its result will arrive in this session.`
        return {
          content: [{ type: "text" as const, text }],
          output: { output: text, toolCalls: [], files: [] },
          metadata: { jobID: id },
        }
      }),
    )
  }) satisfies Run
})
