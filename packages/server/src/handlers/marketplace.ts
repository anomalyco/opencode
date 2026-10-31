import { MarketplaceService } from "@opencode/core/marketplace/service"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { response } from "../location"

export const MarketplaceHandler = HttpApiBuilder.group(Api, "server.marketplace", (handlers) =>
  handlers
    .handle("marketplace.get", (ctx) =>
      response(
        MarketplaceService.Service.use((marketplace) =>
          marketplace.get({ cursor: ctx.query.cursor, limit: ctx.query.limit }),
        ),
      ),
    )
    .handle("marketplace.refresh", () =>
      response(MarketplaceService.Service.use((marketplace) => marketplace.get({ refresh: true }))),
    )
    .handle("marketplace.icon", (ctx) =>
      response(MarketplaceService.Service.use((marketplace) => marketplace.icon(ctx.params))),
    )
    .handle("marketplace.plan", (ctx) =>
      response(MarketplaceService.Service.use((marketplace) => marketplace.plan(ctx.payload.key))),
    )
    .handle("marketplace.install", (ctx) =>
      response(
        MarketplaceService.Service.use((marketplace) =>
          marketplace.install({
            planId: ctx.payload.plan_id,
            expectedRevision: ctx.payload.expected_revision,
            force: ctx.payload.force,
            acceptUntrusted: ctx.payload.accept_untrusted,
          }),
        ),
      ),
    )
    .handle("marketplace.updateAll", (ctx) =>
      response(
        MarketplaceService.Service.use((marketplace) =>
          marketplace.updateAll({
            expectedRevision: ctx.payload.expected_revision,
            force: ctx.payload.force,
            acceptUntrusted: ctx.payload.accept_untrusted,
          }),
        ),
      ),
    )
    .handle("marketplace.updatePlan", () =>
      response(MarketplaceService.Service.use((marketplace) => marketplace.updatePlan())),
    )
    .handle("marketplace.updateApply", (ctx) =>
      response(
        MarketplaceService.Service.use((marketplace) =>
          marketplace.install({
            planId: ctx.payload.plan_id,
            expectedRevision: ctx.payload.expected_revision,
            force: ctx.payload.force,
            acceptUntrusted: ctx.payload.accept_untrusted,
          }),
        ),
      ),
    )
    .handle("marketplace.uninstall", (ctx) =>
      response(
        MarketplaceService.Service.use((marketplace) =>
          marketplace.uninstall({ key: ctx.params.key, expectedRevision: ctx.query.expected_revision }),
        ),
      ),
    )
    .handle("marketplace.toggle", (ctx) =>
      response(
        MarketplaceService.Service.use((marketplace) =>
          marketplace.toggle({
            key: ctx.params.key,
            expectedRevision: ctx.payload.expected_revision,
            component: ctx.payload.component,
            id: ctx.payload.id,
            enabled: ctx.payload.enabled,
          }),
        ),
      ),
    )
    .handle("marketplace.sourceAdd", (ctx) =>
      response(
        MarketplaceService.Service.use((marketplace) =>
          marketplace.sourceAdd({
            expectedRevision: ctx.payload.expected_revision,
            url: ctx.payload.url,
            name: ctx.payload.name,
            trust: ctx.payload.trust,
            format: ctx.payload.format,
            headerEnv: ctx.payload.header_env,
          }),
        ),
      ),
    )
    .handle("marketplace.sourceToggle", (ctx) =>
      response(
        MarketplaceService.Service.use((marketplace) =>
          marketplace.sourceToggle({
            id: ctx.params.id,
            expectedRevision: ctx.payload.expected_revision,
            enabled: ctx.payload.enabled,
          }),
        ),
      ),
    )
    .handle("marketplace.sourceRemove", (ctx) =>
      response(
        MarketplaceService.Service.use((marketplace) =>
          marketplace.sourceRemove({ id: ctx.params.id, expectedRevision: ctx.query.expected_revision }),
        ),
      ),
    )
    .handle("marketplace.profileExport", (ctx) =>
      response(MarketplaceService.Service.use((marketplace) => marketplace.profileExport(ctx.payload))),
    )
    .handle("marketplace.profilePlan", (ctx) =>
      response(MarketplaceService.Service.use((marketplace) => marketplace.profilePlan(ctx.payload))),
    )
    .handle("marketplace.profileApply", (ctx) =>
      response(
        MarketplaceService.Service.use((marketplace) =>
          marketplace.profileApply({
            planId: ctx.payload.plan_id,
            expectedRevision: ctx.payload.expected_revision,
            force: ctx.payload.force,
            acceptUntrusted: ctx.payload.accept_untrusted,
          }),
        ),
      ),
    )
    .handle("marketplace.lockExport", () =>
      response(MarketplaceService.Service.use((marketplace) => marketplace.lockExport())),
    )
    .handle("marketplace.lockVerify", (ctx) =>
      response(MarketplaceService.Service.use((marketplace) => marketplace.lockVerify(ctx.payload.lock))),
    )
    .handle("marketplace.audit", (ctx) =>
      response(MarketplaceService.Service.use((marketplace) => marketplace.audit(ctx.query.limit))),
    )
    .handle("marketplace.cachePrune", (ctx) =>
      response(
        MarketplaceService.Service.use((marketplace) =>
          marketplace.cachePrune({ maxAgeDays: ctx.payload.max_age_days }),
        ),
      ),
    ),
)
