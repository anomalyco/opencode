import { Schema } from "effect"
import { MarketplaceSchema } from "@opencode-ai/core/marketplace-schema"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"

const root = "/marketplace"

export const MarketplacePaths = {
  get: root,
  refresh: `${root}/refresh`,
  icon: `${root}/icon/:key/:variant`,
  plan: `${root}/plan`,
  install: `${root}/install`,
  updateAll: `${root}/update-all`,
  updatePlan: `${root}/update/plan`,
  updateApply: `${root}/update/apply`,
  installed: `${root}/install/:key`,
  source: `${root}/source`,
  sourceItem: `${root}/source/:id`,
  profile: `${root}/profile`,
  profilePlan: `${root}/profile/plan`,
  profileApply: `${root}/profile/apply`,
  lock: `${root}/lock`,
  lockVerify: `${root}/lock/verify`,
  audit: `${root}/audit`,
  cachePrune: `${root}/cache/prune`,
} as const

export const MarketplaceApi = HttpApi.make("marketplace").add(
  HttpApiGroup.make("marketplace")
    .add(
      HttpApiEndpoint.get("get", MarketplacePaths.get, {
        query: MarketplaceSchema.ListInput,
        success: described(MarketplaceSchema.View, "Marketplace state and catalog"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "marketplace.get",
          summary: "Get Marketplace",
          description: "Get local Marketplace state, cached catalogs, and cache statistics.",
        }),
      ),
      HttpApiEndpoint.post("refresh", MarketplacePaths.refresh, {
        success: described(MarketplaceSchema.View, "Refreshed Marketplace"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "marketplace.refresh",
          summary: "Refresh Marketplace",
          description: "Revalidate enabled catalog sources and return the current Marketplace view.",
        }),
      ),
      HttpApiEndpoint.get("icon", MarketplacePaths.icon, {
        params: {
          key: Schema.String,
          variant: Schema.Literals(["src-light", "src-dark"]),
        },
        success: described(MarketplaceSchema.IconResult, "Marketplace icon data"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "marketplace.icon",
          summary: "Get Marketplace icon",
          description: "Load a catalog icon through the authenticated server for local filesystem sources.",
        }),
      ),
      HttpApiEndpoint.post("plan", MarketplacePaths.plan, {
        payload: MarketplaceSchema.PlanInput,
        success: described(MarketplaceSchema.PlanResult, "Marketplace install plan"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "marketplace.plan",
          summary: "Plan Marketplace install",
          description: "Preview trust requirements, permissions, and configuration conflicts.",
        }),
      ),
      HttpApiEndpoint.post("install", MarketplacePaths.install, {
        payload: MarketplaceSchema.InstallInput,
        success: described(MarketplaceSchema.MutationResult, "Marketplace install result"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "marketplace.install",
          summary: "Install Marketplace item",
          description: "Materialize and install a Marketplace item using revision-based concurrency control.",
        }),
      ),
      HttpApiEndpoint.post("updateAll", MarketplacePaths.updateAll, {
        payload: MarketplaceSchema.UpdateAllInput,
        success: described(MarketplaceSchema.MutationResult, "Marketplace update result"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "marketplace.updateAll",
          summary: "Update Marketplace items",
          description: "Atomically update all available Marketplace items.",
        }),
      ),
      HttpApiEndpoint.post("updatePlan", MarketplacePaths.updatePlan, {
        success: described(MarketplaceSchema.ProfilePlanResult, "Marketplace update plan"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "marketplace.updatePlan",
          summary: "Plan Marketplace updates",
          description: "Materialize every available update and return one aggregate one-time plan.",
        }),
      ),
      HttpApiEndpoint.post("updateApply", MarketplacePaths.updateApply, {
        payload: MarketplaceSchema.InstallInput,
        success: described(MarketplaceSchema.MutationResult, "Marketplace update result"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "marketplace.updateApply",
          summary: "Apply Marketplace updates",
          description: "Atomically apply a previously prepared aggregate update plan.",
        }),
      ),
      HttpApiEndpoint.delete("uninstall", MarketplacePaths.installed, {
        params: { key: Schema.String },
        query: MarketplaceSchema.RevisionInput,
        success: described(MarketplaceSchema.MutationResult, "Marketplace uninstall result"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "marketplace.uninstall",
          summary: "Uninstall Marketplace item",
          description: "Remove an installed Marketplace item without rewriting user configuration.",
        }),
      ),
      HttpApiEndpoint.patch("toggle", MarketplacePaths.installed, {
        params: { key: Schema.String },
        payload: MarketplaceSchema.ToggleInput,
        success: described(MarketplaceSchema.MutationResult, "Marketplace component toggle result"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "marketplace.toggle",
          summary: "Toggle Marketplace component",
          description: "Enable or disable a package, skill, or MCP server.",
        }),
      ),
      HttpApiEndpoint.post("sourceAdd", MarketplacePaths.source, {
        payload: MarketplaceSchema.SourceAddInput,
        success: described(MarketplaceSchema.MutationResult, "Marketplace source result"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "marketplace.sourceAdd",
          summary: "Add Marketplace source",
          description: "Add or replace an HTTPS, Git repository, file URL, or local filesystem Marketplace source.",
        }),
      ),
      HttpApiEndpoint.patch("sourceToggle", MarketplacePaths.sourceItem, {
        params: { id: Schema.String },
        payload: MarketplaceSchema.SourceToggleInput,
        success: described(MarketplaceSchema.MutationResult, "Marketplace source result"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "marketplace.sourceToggle",
          summary: "Toggle Marketplace source",
          description: "Enable or disable a Marketplace catalog source.",
        }),
      ),
      HttpApiEndpoint.delete("sourceRemove", MarketplacePaths.sourceItem, {
        params: { id: Schema.String },
        query: MarketplaceSchema.RevisionInput,
        success: described(MarketplaceSchema.MutationResult, "Marketplace source result"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "marketplace.sourceRemove",
          summary: "Remove Marketplace source",
          description: "Remove a source while keeping installed packages manageable.",
        }),
      ),
      HttpApiEndpoint.post("profileExport", MarketplacePaths.profile, {
        payload: MarketplaceSchema.ProfileExportInput,
        success: described(MarketplaceSchema.Profile, "Portable Marketplace profile"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "marketplace.profileExport",
          summary: "Export Marketplace profile",
          description: "Export a deterministic profile without credentials or local cache paths.",
        }),
      ),
      HttpApiEndpoint.post("profilePlan", MarketplacePaths.profilePlan, {
        payload: MarketplaceSchema.ProfilePlanInput,
        success: described(MarketplaceSchema.ProfilePlanResult, "Marketplace profile plan"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "marketplace.profilePlan",
          summary: "Plan Marketplace profile",
          description: "Resolve and materialize an imported v1 or v2 profile without changing registry state.",
        }),
      ),
      HttpApiEndpoint.post("profileApply", MarketplacePaths.profileApply, {
        payload: MarketplaceSchema.InstallInput,
        success: described(MarketplaceSchema.MutationResult, "Marketplace profile result"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "marketplace.profileApply",
          summary: "Apply Marketplace profile",
          description: "Atomically apply a previously prepared one-time profile plan.",
        }),
      ),
      HttpApiEndpoint.post("cachePrune", MarketplacePaths.cachePrune, {
        payload: MarketplaceSchema.CachePruneInput,
        success: described(MarketplaceSchema.CacheSummary, "Marketplace cache summary"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "marketplace.cachePrune",
          summary: "Prune Marketplace cache",
          description: "Remove stale unreferenced content-addressed artifacts.",
        }),
      ),
      HttpApiEndpoint.get("lockExport", MarketplacePaths.lock, {
        success: described(MarketplaceSchema.Lock, "Marketplace lock"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "marketplace.lockExport",
          summary: "Export Marketplace lock",
          description: "Export exact package and artifact digests for reproducibility checks.",
        }),
      ),
      HttpApiEndpoint.post("lockVerify", MarketplacePaths.lockVerify, {
        payload: MarketplaceSchema.LockVerifyInput,
        success: described(MarketplaceSchema.LockVerifyResult, "Marketplace lock verification"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "marketplace.lockVerify",
          summary: "Verify Marketplace lock",
          description: "Compare installed Marketplace packages and artifacts with an exported lock.",
        }),
      ),
      HttpApiEndpoint.get("audit", MarketplacePaths.audit, {
        query: MarketplaceSchema.AuditInput,
        success: described(Schema.Array(MarketplaceSchema.AuditEntry), "Marketplace audit log"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "marketplace.audit",
          summary: "Get Marketplace audit log",
          description: "Return recent durable registry revisions and mutation summaries.",
        }),
      ),
    )
    .annotateMerge(
      OpenApi.annotations({
        title: "marketplace",
        description: "Marketplace catalogs, installations, component state, profiles, and artifact cache.",
      }),
    ),
)
