import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import { RootHttpApi } from "../api"
import { Service as MarketplaceService } from "@/marketplace/service"

export const marketplaceHandlers = HttpApiBuilder.group(RootHttpApi, "marketplace", (handlers) =>
  Effect.gen(function* () {
    const marketplace = yield* MarketplaceService

    const runtime = <T extends { ok: boolean; changed?: boolean }>(result: T) =>
      result.ok && result.changed
        ? disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }).pipe(Effect.as(result))
        : Effect.succeed(result)

    return handlers
      .handle("get", (ctx) => marketplace.get({ cursor: ctx.query.cursor, limit: ctx.query.limit }))
      .handle("refresh", () => marketplace.get({ refresh: true }))
      .handle("icon", (ctx) =>
        marketplace.icon({
          key: ctx.params.key,
          variant: ctx.params.variant,
        }),
      )
      .handle("plan", (ctx) => marketplace.plan(ctx.payload.key))
      .handle("install", (ctx) =>
        marketplace
          .install({
            planId: ctx.payload.plan_id,
            expectedRevision: ctx.payload.expected_revision,
            force: ctx.payload.force,
            acceptUntrusted: ctx.payload.accept_untrusted,
          })
          .pipe(Effect.flatMap(runtime)),
      )
      .handle("updateAll", (ctx) =>
        marketplace
          .updateAll({
            expectedRevision: ctx.payload.expected_revision,
            force: ctx.payload.force,
            acceptUntrusted: ctx.payload.accept_untrusted,
          })
          .pipe(Effect.flatMap(runtime)),
      )
      .handle("updatePlan", () => marketplace.updatePlan())
      .handle("updateApply", (ctx) =>
        marketplace
          .install({
            planId: ctx.payload.plan_id,
            expectedRevision: ctx.payload.expected_revision,
            force: ctx.payload.force,
            acceptUntrusted: ctx.payload.accept_untrusted,
          })
          .pipe(Effect.flatMap(runtime)),
      )
      .handle("uninstall", (ctx) =>
        marketplace
          .uninstall({
            key: ctx.params.key,
            expectedRevision: ctx.query.expected_revision,
          })
          .pipe(Effect.flatMap(runtime)),
      )
      .handle("toggle", (ctx) =>
        marketplace
          .toggle({
            key: ctx.params.key,
            expectedRevision: ctx.payload.expected_revision,
            component: ctx.payload.component,
            id: ctx.payload.id,
            enabled: ctx.payload.enabled,
          })
          .pipe(Effect.flatMap(runtime)),
      )
      .handle("sourceAdd", (ctx) =>
        marketplace.sourceAdd({
          expectedRevision: ctx.payload.expected_revision,
          url: ctx.payload.url,
          name: ctx.payload.name,
          trust: ctx.payload.trust,
          format: ctx.payload.format,
          headerEnv: ctx.payload.header_env,
        }),
      )
      .handle("sourceToggle", (ctx) =>
        marketplace.sourceToggle({
          id: ctx.params.id,
          expectedRevision: ctx.payload.expected_revision,
          enabled: ctx.payload.enabled,
        }),
      )
      .handle("sourceRemove", (ctx) =>
        marketplace.sourceRemove({
          id: ctx.params.id,
          expectedRevision: ctx.query.expected_revision,
        }),
      )
      .handle("profileExport", (ctx) =>
        marketplace.profileExport({
          name: ctx.payload.name,
          description: ctx.payload.description,
        }),
      )
      .handle("profilePlan", (ctx) => marketplace.profilePlan({ profile: ctx.payload.profile, mode: ctx.payload.mode }))
      .handle("profileApply", (ctx) =>
        marketplace
          .profileApply({
            planId: ctx.payload.plan_id,
            expectedRevision: ctx.payload.expected_revision,
            force: ctx.payload.force,
            acceptUntrusted: ctx.payload.accept_untrusted,
          })
          .pipe(Effect.flatMap(runtime)),
      )
      .handle("lockExport", () => marketplace.lockExport())
      .handle("lockVerify", (ctx) => marketplace.lockVerify(ctx.payload.lock))
      .handle("audit", (ctx) => marketplace.audit(ctx.query.limit))
      .handle("cachePrune", (ctx) =>
        marketplace.cachePrune({
          maxAgeDays: ctx.payload.max_age_days,
        }),
      )
  }),
)
