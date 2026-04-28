import { Automation } from "@/automation/automation"
import { AutomationID, AutomationRunID } from "@/automation/schema"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { notFound } from "../errors"
import { AutomationRunsQuery, RunArchivePayload, RunReadPayload } from "../groups/automation"

function mapNotFound<A, R>(
  effect: Effect.Effect<A, InstanceType<typeof Automation.NotFoundError>, R>,
): Effect.Effect<A, ReturnType<typeof notFound>, R> {
  return effect.pipe(Effect.mapError((error) => notFound(error.data.message)))
}

export const automationHandlers = HttpApiBuilder.group(InstanceHttpApi, "automation", (handlers) =>
  Effect.gen(function* () {
    const automation = yield* Automation.Service

    const list = Effect.fn("AutomationHttpApi.list")(function* () {
      return yield* automation.list()
    })

    const create = Effect.fn("AutomationHttpApi.create")(function* (ctx: { payload: Automation.CreateInput }) {
      return yield* automation.create(ctx.payload)
    })

    const runs = Effect.fn("AutomationHttpApi.runs")(function* (ctx: { query: typeof AutomationRunsQuery.Type }) {
      return yield* automation.listRuns(ctx.query)
    })

    const runGet = Effect.fn("AutomationHttpApi.runGet")(function* (ctx: { params: { runID: AutomationRunID } }) {
      return yield* mapNotFound(automation.getRun(ctx.params.runID))
    })

    const findings = Effect.fn("AutomationHttpApi.findings")(function* (ctx: {
      params: { runID: AutomationRunID }
    }) {
      return yield* mapNotFound(automation.listFindings(ctx.params.runID))
    })

    const diff = Effect.fn("AutomationHttpApi.diff")(function* (ctx: { params: { runID: AutomationRunID } }) {
      return yield* mapNotFound(automation.diff(ctx.params.runID))
    })

    const read = Effect.fn("AutomationHttpApi.read")(function* (ctx: {
      params: { runID: AutomationRunID }
      payload?: typeof RunReadPayload.Type
    }) {
      return yield* mapNotFound(automation.markRunRead(ctx.params.runID, ctx.payload?.read))
    })

    const archive = Effect.fn("AutomationHttpApi.archive")(function* (ctx: {
      params: { runID: AutomationRunID }
      payload?: typeof RunArchivePayload.Type
    }) {
      return yield* mapNotFound(automation.archiveRun(ctx.params.runID, ctx.payload?.archived))
    })

    const cancel = Effect.fn("AutomationHttpApi.cancel")(function* (ctx: { params: { runID: AutomationRunID } }) {
      return yield* mapNotFound(automation.cancelRun(ctx.params.runID))
    })

    const get = Effect.fn("AutomationHttpApi.get")(function* (ctx: { params: { automationID: AutomationID } }) {
      return yield* mapNotFound(automation.get(ctx.params.automationID))
    })

    const update = Effect.fn("AutomationHttpApi.update")(function* (ctx: {
      params: { automationID: AutomationID }
      payload: Automation.UpdateInput
    }) {
      return yield* mapNotFound(automation.update(ctx.params.automationID, ctx.payload))
    })

    const remove = Effect.fn("AutomationHttpApi.remove")(function* (ctx: { params: { automationID: AutomationID } }) {
      return yield* automation.remove(ctx.params.automationID)
    })

    const duplicate = Effect.fn("AutomationHttpApi.duplicate")(function* (ctx: {
      params: { automationID: AutomationID }
    }) {
      return yield* mapNotFound(automation.duplicate(ctx.params.automationID))
    })

    const runNow = Effect.fn("AutomationHttpApi.runNow")(function* (ctx: {
      params: { automationID: AutomationID }
    }) {
      return yield* mapNotFound(automation.runNow(ctx.params.automationID))
    })

    return handlers
      .handle("list", list)
      .handle("create", create)
      .handle("runs", runs)
      .handle("runGet", runGet)
      .handle("findings", findings)
      .handle("diff", diff)
      .handle("read", read)
      .handle("archive", archive)
      .handle("cancel", cancel)
      .handle("get", get)
      .handle("update", update)
      .handle("remove", remove)
      .handle("duplicate", duplicate)
      .handle("runNow", runNow)
  }),
)
