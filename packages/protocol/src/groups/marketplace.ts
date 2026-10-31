import { Marketplace } from "@opencode/schema/marketplace"
import { Location } from "@opencode/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

const root = "/api/experimental/marketplace"
const annotation = (name: string, summary: string) =>
  OpenApi.annotations({
    identifier: `experimental.marketplace.${name}`,
    summary,
    description: "Experimental: may change without compatibility guarantees.",
  })
const params = { key: Schema.String }
const source = { id: Schema.String }
const list = Schema.Struct({ ...LocationQuery.fields, ...Marketplace.ListInput.fields })
const revision = Schema.Struct({ ...LocationQuery.fields, ...Marketplace.RevisionInput.fields })
const audit = Schema.Struct({ ...LocationQuery.fields, ...Marketplace.AuditInput.fields })

export const MarketplaceGroup = HttpApiGroup.make("server.marketplace")
  .add(
    HttpApiEndpoint.get("marketplace.get", root, {
      query: list,
      success: Location.response(Marketplace.View),
    }).annotateMerge(annotation("get", "Get Marketplace")),
    HttpApiEndpoint.post("marketplace.refresh", `${root}/refresh`, {
      query: LocationQuery,
      success: Location.response(Marketplace.View),
    }).annotateMerge(annotation("refresh", "Refresh Marketplace")),
    HttpApiEndpoint.get("marketplace.icon", `${root}/icon/:key/:variant`, {
      params: { ...params, variant: Schema.Literals(["src-light", "src-dark"]) },
      query: LocationQuery,
      success: Location.response(Marketplace.IconResult),
    }).annotateMerge(annotation("icon", "Get Marketplace icon")),
    HttpApiEndpoint.post("marketplace.plan", `${root}/plan`, {
      query: LocationQuery,
      payload: Marketplace.PlanInput,
      success: Location.response(Marketplace.PlanResult),
    }).annotateMerge(annotation("plan", "Plan Marketplace installation")),
    HttpApiEndpoint.post("marketplace.install", `${root}/install`, {
      query: LocationQuery,
      payload: Marketplace.InstallInput,
      success: Location.response(Marketplace.MutationResult),
    }).annotateMerge(annotation("install", "Apply Marketplace plan")),
    HttpApiEndpoint.post("marketplace.updateAll", `${root}/update-all`, {
      query: LocationQuery,
      payload: Marketplace.UpdateAllInput,
      success: Location.response(Marketplace.MutationResult),
    }).annotateMerge(annotation("updateAll", "Update Marketplace items")),
    HttpApiEndpoint.post("marketplace.updatePlan", `${root}/update/plan`, {
      query: LocationQuery,
      success: Location.response(Marketplace.ProfilePlanResult),
    }).annotateMerge(annotation("updatePlan", "Plan Marketplace updates")),
    HttpApiEndpoint.post("marketplace.updateApply", `${root}/update/apply`, {
      query: LocationQuery,
      payload: Marketplace.InstallInput,
      success: Location.response(Marketplace.MutationResult),
    }).annotateMerge(annotation("updateApply", "Apply Marketplace updates")),
    HttpApiEndpoint.delete("marketplace.uninstall", `${root}/install/:key`, {
      params,
      query: revision,
      success: Location.response(Marketplace.MutationResult),
    }).annotateMerge(annotation("uninstall", "Uninstall Marketplace item")),
    HttpApiEndpoint.patch("marketplace.toggle", `${root}/install/:key`, {
      params,
      query: LocationQuery,
      payload: Marketplace.ToggleInput,
      success: Location.response(Marketplace.MutationResult),
    }).annotateMerge(annotation("toggle", "Toggle Marketplace component")),
    HttpApiEndpoint.post("marketplace.sourceAdd", `${root}/source`, {
      query: LocationQuery,
      payload: Marketplace.SourceAddInput,
      success: Location.response(Marketplace.MutationResult),
    }).annotateMerge(annotation("sourceAdd", "Add Marketplace source")),
    HttpApiEndpoint.patch("marketplace.sourceToggle", `${root}/source/:id`, {
      params: source,
      query: LocationQuery,
      payload: Marketplace.SourceToggleInput,
      success: Location.response(Marketplace.MutationResult),
    }).annotateMerge(annotation("sourceToggle", "Toggle Marketplace source")),
    HttpApiEndpoint.delete("marketplace.sourceRemove", `${root}/source/:id`, {
      params: source,
      query: revision,
      success: Location.response(Marketplace.MutationResult),
    }).annotateMerge(annotation("sourceRemove", "Remove Marketplace source")),
    HttpApiEndpoint.post("marketplace.profileExport", `${root}/profile`, {
      query: LocationQuery,
      payload: Marketplace.ProfileExportInput,
      success: Location.response(Marketplace.Profile),
    }).annotateMerge(annotation("profileExport", "Export Marketplace profile")),
    HttpApiEndpoint.post("marketplace.profilePlan", `${root}/profile/plan`, {
      query: LocationQuery,
      payload: Marketplace.ProfilePlanInput,
      success: Location.response(Marketplace.ProfilePlanResult),
    }).annotateMerge(annotation("profilePlan", "Plan Marketplace profile")),
    HttpApiEndpoint.post("marketplace.profileApply", `${root}/profile/apply`, {
      query: LocationQuery,
      payload: Marketplace.InstallInput,
      success: Location.response(Marketplace.MutationResult),
    }).annotateMerge(annotation("profileApply", "Apply Marketplace profile")),
    HttpApiEndpoint.get("marketplace.lockExport", `${root}/lock`, {
      query: LocationQuery,
      success: Location.response(Marketplace.Lock),
    }).annotateMerge(annotation("lockExport", "Export Marketplace lock")),
    HttpApiEndpoint.post("marketplace.lockVerify", `${root}/lock/verify`, {
      query: LocationQuery,
      payload: Marketplace.LockVerifyInput,
      success: Location.response(Marketplace.LockVerifyResult),
    }).annotateMerge(annotation("lockVerify", "Verify Marketplace lock")),
    HttpApiEndpoint.get("marketplace.audit", `${root}/audit`, {
      query: audit,
      success: Location.response(Schema.Array(Marketplace.AuditEntry)),
    }).annotateMerge(annotation("audit", "Read Marketplace audit")),
    HttpApiEndpoint.post("marketplace.cachePrune", `${root}/cache/prune`, {
      query: LocationQuery,
      payload: Marketplace.CachePruneInput,
      success: Location.response(Marketplace.CacheSummary),
    }).annotateMerge(annotation("cachePrune", "Prune Marketplace cache")),
  )
  .annotateMerge(locationQueryOpenApi)
