import { Workflow } from "@/workflow/workflow"
import { SessionPrompt } from "@/session/prompt"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ConflictError, notFound } from "../errors"
import { type AnswerPayload, type SavePayload, type StartPayload, WorkflowApiError } from "../groups/workflow"

// Maps the engine's typed start() failures onto the HTTP contract:
// - a broken/invalid workflow file (load failure) → 400 WorkflowApiError, with
//   `workflow` carrying the requested NAME and `path` the failing file (Fund 44).
// - an unknown workflow name → 404 ApiNotFoundError, matching the repo-wide
//   *NotFound → 404 convention (Fund 21).
// The requested name is threaded in because the engine's InvalidError only
// carries the file `path`, not the workflow name.
function apiError(name: string) {
  return (error: Workflow.InvalidError | Workflow.NotFoundError) => {
    if (error._tag === "WorkflowInvalidError")
      return new WorkflowApiError({ message: error.message, workflow: name, path: error.path })
    return notFound(`Workflow not found: ${error.name}`)
  }
}

export const workflowHandlers = HttpApiBuilder.group(InstanceHttpApi, "workflow", (handlers) =>
  Effect.gen(function* () {
    const workflow = yield* Workflow.Service
    const prompt = yield* SessionPrompt.Service

    const list = Effect.fn("WorkflowHttpApi.list")(function* () {
      // list() never fails (broken files are reported as invalid entries), so no
      // error mapping is needed here; apiError still covers start()'s failures.
      return yield* workflow.list()
    })

    const runs = Effect.fn("WorkflowHttpApi.runs")(function* () {
      return yield* workflow.runs()
    })

    const source = Effect.fn("WorkflowHttpApi.source")(function* (ctx: { params: { name: string } }) {
      // read() resolves the named workflow's source through the same discovery
      // precedence start() uses; undefined ⇒ unknown name → 404 (matching the
      // *NotFound → 404 convention). Reading source never executes the module, so
      // there is no load-failure mapping here.
      const result = yield* workflow.read(ctx.params.name)
      if (!result) return yield* notFound(`Workflow not found: ${ctx.params.name}`)
      return result
    })

    const get = Effect.fn("WorkflowHttpApi.get")(function* (ctx: { params: { id: Workflow.RunID } }) {
      // The route param is validated/branded by the params schema (RunID), so a
      // malformed id is a 400 at decode time and never reaches this handler. An
      // unknown id is a 404 (id-addressed, like the session endpoints) rather
      // than a 200 + null.
      const run = yield* workflow.get(ctx.params.id)
      if (!run) return yield* notFound(`Workflow run not found: ${ctx.params.id}`)
      return run
    })

    const start = Effect.fn("WorkflowHttpApi.start")(function* (ctx: {
      params: { name: string }
      payload?: StartPayload
    }) {
      return yield* workflow
        .start({
          name: ctx.params.name,
          args: ctx.payload?.args,
          // Item 17: either cap present ⇒ the struct form, mirroring the tool
          // path; both absent ⇒ unlimited.
          budget:
            ctx.payload?.budget !== undefined || ctx.payload?.budget_tokens !== undefined
              ? { usd: ctx.payload?.budget, tokens: ctx.payload?.budget_tokens }
              : undefined,
          // Already branded by the StartPayload schema decode (SessionID).
          permissionSessionID: ctx.payload?.permissionSessionID,
          // Resume the named source run's journal when supplied (already branded
          // by the StartPayload decode). Absent ⇒ an ordinary fresh start.
          resume_of: ctx.payload?.resume_of,
          // Copy to a mutable array: the engine's StartOptions takes `number[]`
          // while the decoded schema yields a `readonly number[]`.
          invalidate_agents: ctx.payload?.invalidate_agents ? [...ctx.payload.invalidate_agents] : undefined,
          // Item 20: journal replay strategy (prefix default in the engine;
          // only meaningful with resume_of).
          replay: ctx.payload?.replay,
          // When the HTTP caller supplied a session identity, derive subagent
          // permission inheritance from it (parent-session deny/external_directory
          // rules). The HTTP payload carries no caller-agent, so the agent-level
          // edit denies (Plan Mode) are only inherited on the tool path; without a
          // session id this is the documented fallback (no inherited ruleset).
          caller: ctx.payload?.permissionSessionID ? { sessionID: ctx.payload.permissionSessionID } : undefined,
          // Item 12: deliberately NO caller_model here — an HTTP start has no
          // caller-session model context, so default-agent steps keep falling
          // through to the agent's own model / global default.
          prompt,
        })
        .pipe(Effect.mapError(apiError(ctx.params.name)))
    })

    const cancel = Effect.fn("WorkflowHttpApi.cancel")(function* (ctx: { params: { id: Workflow.RunID } }) {
      // The engine returns undefined ONLY when the run is unknown to this
      // workspace (not in the live registry and no persisted row) → 404. A known
      // run (running or already-terminal) returns its snapshot → 200.
      const run = yield* workflow.cancel(ctx.params.id)
      if (!run) return yield* notFound(`Workflow run not found: ${ctx.params.id}`)
      return run
    })

    const pause = Effect.fn("WorkflowHttpApi.pause")(function* (ctx: { params: { id: Workflow.RunID } }) {
      // Same contract as cancel: undefined ⇒ unknown id → 404; a known run returns
      // its snapshot (paused on success) → 200.
      const run = yield* workflow.pause(ctx.params.id)
      if (!run) return yield* notFound(`Workflow run not found: ${ctx.params.id}`)
      return run
    })

    const skip = Effect.fn("WorkflowHttpApi.skip")(function* (ctx: {
      params: { id: Workflow.RunID; agentId: string }
    }) {
      // Item 15: undefined ⇒ unknown to this workspace → 404; the engine's
      // InvalidError (run not live / unknown agent / question node / node not
      // running) ⇒ there is nothing skippable on a known run → 409 (mirroring
      // the answer handler's known-but-unanswerable mapping).
      const run = yield* workflow
        .skipAgent({ id: ctx.params.id, agentId: ctx.params.agentId })
        .pipe(Effect.mapError((error) => new ConflictError({ message: error.message, resource: ctx.params.id })))
      if (!run) return yield* notFound(`Workflow run not found: ${ctx.params.id}`)
      return run
    })

    const answer = Effect.fn("WorkflowHttpApi.answer")(function* (ctx: {
      params: { id: Workflow.RunID }
      payload: AnswerPayload
    }) {
      // Distinguish 404 (unknown id) from 409 (no open question): answer() itself
      // returns undefined for BOTH (Grounding-Delta 1). get() is directory-scoped
      // exactly like answer()'s own probe, so a known-to-this-workspace run is the
      // precondition for "has a question to answer".
      const existing = yield* workflow.get(ctx.params.id)
      if (!existing) return yield* notFound(`Workflow run not found: ${ctx.params.id}`)
      const result = yield* workflow
        .answer({
          id: ctx.params.id,
          answer: ctx.payload.answer,
          // Thread the same prompt-ops the start handler uses so a PARKED run resumed
          // by this answer can dispatch its post-question ctx.agent steps live.
          prompt,
          // When the caller supplied a session identity, surface the resumed run's
          // interactive permission prompts there and derive its subagents' inherited
          // permission ruleset from it — mirroring the start handler. Omitted ⇒ the
          // documented headless fallback (no inherited ruleset).
          permissionSessionID: ctx.payload.permissionSessionID,
          caller: ctx.payload.permissionSessionID ? { sessionID: ctx.payload.permissionSessionID } : undefined,
        })
        .pipe(Effect.mapError(apiError(existing.workflow)))
      // The run exists but answer() declined: there is no open question on it (a
      // live run not waiting, a paused run without a pending_question, or a terminal
      // run) → 409.
      if (!result)
        return yield* new ConflictError({
          message: `Workflow run has no open question: ${ctx.params.id}`,
          resource: ctx.params.id,
        })
      return result
    })

    const save = Effect.fn("WorkflowHttpApi.save")(function* (ctx: { payload: SavePayload }) {
      // The engine validates the name shape + meta statically and refuses to
      // overwrite, returning typed failures. Map them onto the HTTP contract:
      //   - InvalidError (bad name OR statically-invalid meta) → 400 WorkflowApiError,
      //     with `workflow` carrying the requested name and `path` the failing file;
      //   - SaveConflictError (file already exists) → 409 ConflictError.
      // The auth middleware already gates this route, so there is no per-write
      // permission ask here (that is the tool path's concern).
      return yield* workflow
        .save({ name: ctx.payload.name, source: ctx.payload.source, scope: ctx.payload.scope })
        .pipe(
          Effect.mapError((error) => {
            if (error._tag === "WorkflowSaveConflictError")
              return new ConflictError({
                message: `Workflow already exists: ${error.name}`,
                resource: error.path,
              })
            return new WorkflowApiError({ message: error.message, workflow: ctx.payload.name, path: error.path })
          }),
        )
    })

    const exportRun = Effect.fn("WorkflowHttpApi.export")(function* (ctx: { params: { id: Workflow.RunID } }) {
      // Item 27: the engine returns undefined ONLY for a run unknown to this
      // workspace (directory-scoped like get) → 404, matching the get handler.
      const result = yield* workflow.export(ctx.params.id)
      if (!result) return yield* notFound(`Workflow run not found: ${ctx.params.id}`)
      return result
    })

    const remove = Effect.fn("WorkflowHttpApi.remove")(function* (ctx: { params: { id: Workflow.RunID } }) {
      return yield* workflow.remove(ctx.params.id)
    })

    return handlers
      .handle("list", list)
      .handle("runs", runs)
      .handle("source", source)
      .handle("get", get)
      .handle("start", start)
      .handle("cancel", cancel)
      .handle("pause", pause)
      .handle("skip", skip)
      .handle("answer", answer)
      .handle("save", save)
      .handle("export", exportRun)
      .handle("remove", remove)
  }),
)
