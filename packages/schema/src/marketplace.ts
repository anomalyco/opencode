export * as Marketplace from "./marketplace.js"

import { Schema } from "effect"
import { NonNegativeInt } from "./schema.js"

export const Trust = Schema.Literals(["official", "verified", "community", "private"])
export const ConfiguredTrust = Schema.Literals(["community", "private"])
export const Kind = Schema.Literals(["plugin", "skill", "agent", "command", "mcp", "bundle"])

export const Source = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  url: Schema.String,
  reference: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
  trust: Schema.optional(Trust),
  format: Schema.optional(Schema.Literals(["auto", "opencode", "codex"])),
  header_env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}).annotate({ identifier: "MarketplaceSource" })

export const Skill = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
})

export const InstallPlan = Schema.Struct({
  plugins: Schema.optional(Schema.Array(Schema.Unknown)),
  skills: Schema.optional(
    Schema.Struct({
      paths: Schema.optional(Schema.Array(Schema.String)),
      urls: Schema.optional(Schema.Array(Schema.String)),
      items: Schema.optional(Schema.Array(Skill)),
    }),
  ),
  agents: Schema.optional(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))),
  commands: Schema.optional(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))),
  mcp: Schema.optional(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))),
  instructions: Schema.optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "MarketplaceInstallPlan" })

export const Installed = Schema.Struct({
  source: Schema.String,
  source_url: Schema.optional(Schema.String),
  source_trust: Schema.optional(Trust),
  catalog: Schema.String,
  catalog_name: Schema.optional(Schema.String),
  item: Schema.String,
  name: Schema.String,
  kind: Kind,
  version: Schema.String,
  publisher: Schema.optional(Schema.String),
  fingerprint: Schema.String,
  listing_digest: Schema.optional(Schema.String),
  plan_digest: Schema.optional(Schema.String),
  priority: Schema.optional(Schema.Number),
  installed_at: Schema.String,
  updated_at: Schema.String,
  snapshot: Schema.optional(Schema.Unknown),
  plan: InstallPlan,
  materialized_plan: Schema.optional(Schema.Unknown),
  active_plan: Schema.optional(Schema.Unknown),
  receipt: Schema.Unknown,
  enabled: Schema.optional(Schema.Boolean),
  disabled_skills: Schema.optional(Schema.Array(Schema.String)),
  disabled_mcp: Schema.optional(Schema.Array(Schema.String)),
  catalog_digest: Schema.optional(Schema.String),
  manifest_digest: Schema.optional(Schema.String),
  materialized_digest: Schema.optional(Schema.String),
  artifact_digests: Schema.optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "MarketplaceInstalled" })

export const State = Schema.Struct({
  revision: Schema.optional(NonNegativeInt),
  sources: Schema.optional(Schema.Array(Source)),
  installed: Schema.optional(Schema.Record(Schema.String, Installed)),
}).annotate({ identifier: "MarketplaceState" })

export const CatalogItem = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  kind: Kind,
  version: Schema.String,
  publisher: Schema.optional(
    Schema.Struct({
      name: Schema.String,
      url: Schema.optional(Schema.String),
      verified: Schema.optional(Schema.Boolean),
    }),
  ),
  homepage: Schema.optional(Schema.String),
  repository: Schema.optional(Schema.String),
  license: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
  featured: Schema.optional(Schema.Boolean),
  icon: Schema.optional(Schema.Struct({ "src-light": Schema.String, "src-dark": Schema.optional(Schema.String) })),
  brand_color: Schema.optional(Schema.String),
  permissions: Schema.optional(Schema.Array(Schema.String)),
  setup: Schema.optional(Schema.Array(Schema.String)),
  requires_restart: Schema.optional(Schema.Boolean),
  compatibility: Schema.optional(Schema.Unknown),
  install: InstallPlan,
}).annotate({ identifier: "MarketplaceCatalogItem" })

export const Catalog = Schema.Struct({
  schema: Schema.Literal("opencode.marketplace/v1"),
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  publisher: Schema.optional(
    Schema.Struct({
      name: Schema.String,
      url: Schema.optional(Schema.String),
      verified: Schema.optional(Schema.Boolean),
    }),
  ),
  homepage: Schema.optional(Schema.String),
  updated_at: Schema.optional(Schema.String),
  items: Schema.Array(CatalogItem),
}).annotate({ identifier: "MarketplaceCatalog" })

export const Listing = Schema.Struct({
  status: Schema.optional(Schema.Literals(["available", "installed", "update"])),
  key: Schema.String,
  source: Source,
  catalog: Catalog,
  item: CatalogItem,
  orphaned: Schema.optional(Schema.Boolean),
  catalog_url: Schema.optional(Schema.String),
  catalog_digest: Schema.optional(Schema.String),
  listing_digest: Schema.optional(Schema.String),
  plan_digest: Schema.optional(Schema.String),
  compatibility: Schema.optional(Schema.Struct({ compatible: Schema.Boolean, reasons: Schema.Array(Schema.String) })),
}).annotate({ identifier: "MarketplaceListing" })

export const LoadError = Schema.Struct({
  source: Source,
  message: Schema.String,
}).annotate({ identifier: "MarketplaceLoadError" })

export const CacheSummary = Schema.Struct({
  root: Schema.String,
  objects: NonNegativeInt,
  total_bytes: NonNegativeInt,
  fetch_entries: NonNegativeInt,
  materializations: NonNegativeInt,
}).annotate({ identifier: "MarketplaceCacheSummary" })

export const View = Schema.Struct({
  state: State,
  listings: Schema.Array(Listing),
  errors: Schema.Array(LoadError),
  cache: CacheSummary,
  next_cursor: Schema.optional(Schema.String),
}).annotate({ identifier: "MarketplaceView" })

export const ListInput = Schema.Struct({
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(NonNegativeInt),
}).annotate({ identifier: "MarketplaceListInput" })

export const Conflict = Schema.Struct({
  path: Schema.String,
  current: Schema.Unknown,
  incoming: Schema.Unknown,
}).annotate({ identifier: "MarketplaceConflict" })

export const PlanInput = Schema.Struct({
  key: Schema.String,
}).annotate({ identifier: "MarketplacePlanInput" })

export const IconResult = Schema.Struct({
  data_url: Schema.optional(Schema.String),
}).annotate({ identifier: "MarketplaceIconResult" })

export const PlanResult = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    plan_id: Schema.String,
    revision: NonNegativeInt,
    expires_at: Schema.String,
    key: Schema.String,
    action: Schema.Literals(["install", "update"]),
    listing_digest: Schema.String,
    plan_digest: Schema.String,
    compatibility: Schema.Struct({ compatible: Schema.Boolean, reasons: Schema.Array(Schema.String) }),
    trust_warning: Schema.Boolean,
    conflicts: Schema.Array(Conflict),
    permissions: Schema.Array(Schema.String),
    summary: Schema.String,
  }),
  Schema.Struct({
    ok: Schema.Literal(false),
    reason: Schema.Literals(["not_found", "materialization", "incompatible"]),
    message: Schema.String,
  }),
]).annotate({ identifier: "MarketplacePlanResult" })

export const InstallInput = Schema.Struct({
  plan_id: Schema.String,
  expected_revision: NonNegativeInt,
  force: Schema.optional(Schema.Boolean),
  accept_untrusted: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "MarketplaceInstallInput" })

export const UpdateAllInput = Schema.Struct({
  expected_revision: NonNegativeInt,
  force: Schema.optional(Schema.Boolean),
  accept_untrusted: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "MarketplaceUpdateAllInput" })

export const RevisionInput = Schema.Struct({
  expected_revision: NonNegativeInt,
}).annotate({ identifier: "MarketplaceRevisionInput" })

export const ToggleInput = Schema.Struct({
  expected_revision: NonNegativeInt,
  component: Schema.Literals(["package", "skill", "mcp"]),
  id: Schema.optional(Schema.String),
  enabled: Schema.Boolean,
}).annotate({ identifier: "MarketplaceToggleInput" })

export const SourceAddInput = Schema.Struct({
  expected_revision: NonNegativeInt,
  url: Schema.String,
  name: Schema.optional(Schema.String),
  trust: Schema.optional(ConfiguredTrust),
  format: Schema.optional(Schema.Literals(["auto", "opencode", "codex"])),
  header_env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}).annotate({ identifier: "MarketplaceSourceAddInput" })

export const SourceToggleInput = Schema.Struct({
  expected_revision: NonNegativeInt,
  enabled: Schema.Boolean,
}).annotate({ identifier: "MarketplaceSourceToggleInput" })

export const ProfileExportInput = Schema.Struct({
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
}).annotate({ identifier: "MarketplaceProfileExportInput" })

export const CachePruneInput = Schema.Struct({
  max_age_days: Schema.optional(NonNegativeInt),
}).annotate({ identifier: "MarketplaceCachePruneInput" })

const LockPackage = Schema.Struct({
  key: Schema.String,
  source_url: Schema.optional(Schema.String),
  catalog: Schema.String,
  item: Schema.String,
  version: Schema.String,
  listing_digest: Schema.optional(Schema.String),
  plan_digest: Schema.optional(Schema.String),
  materialized_digest: Schema.optional(Schema.String),
  artifact_digests: Schema.Array(Schema.String),
})

export const Lock = Schema.Struct({
  schema: Schema.Literal("opencode.marketplace.lock/v1"),
  generated_at: Schema.String,
  packages: Schema.Array(LockPackage),
}).annotate({ identifier: "MarketplaceLock" })

export const LockVerifyInput = Schema.Struct({ lock: Lock }).annotate({ identifier: "MarketplaceLockVerifyInput" })

export const LockVerifyResult = Schema.Struct({
  ok: Schema.Boolean,
  errors: Schema.Array(Schema.String),
}).annotate({ identifier: "MarketplaceLockVerifyResult" })

export const AuditInput = Schema.Struct({ limit: Schema.optional(NonNegativeInt) }).annotate({
  identifier: "MarketplaceAuditInput",
})

export const AuditEntry = Schema.Struct({
  id: NonNegativeInt,
  revision: NonNegativeInt,
  action: Schema.String,
  data: Schema.Record(Schema.String, Schema.Unknown),
  time_created: NonNegativeInt,
}).annotate({ identifier: "MarketplaceAuditEntry" })

export const MutationResult = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    changed: Schema.Boolean,
    view: View,
    connect_mcp: Schema.Array(Schema.String),
    preserved: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    ok: Schema.Literal(false),
    reason: Schema.Literals([
      "conflict",
      "revision",
      "trust",
      "not_found",
      "materialization",
      "incompatible",
      "plan_not_found",
      "plan_expired",
      "plan_consumed",
    ]),
    message: Schema.String,
    revision: Schema.optional(NonNegativeInt),
    conflicts: Schema.optional(Schema.Array(Conflict)),
  }),
]).annotate({ identifier: "MarketplaceMutationResult" })

const ProfileSource = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  url: Schema.String,
  trust: Schema.optional(Trust),
  format: Schema.optional(Schema.Literals(["auto", "opencode", "codex"])),
})

const ProfilePackage = Schema.Struct({
  key: Schema.String,
  source: Schema.String,
  catalog: Schema.String,
  item: Schema.String,
  name: Schema.String,
  kind: Schema.String,
  version: Schema.String,
  listing_digest: Schema.optional(Schema.String),
  plan_digest: Schema.optional(Schema.String),
  priority: Schema.optional(Schema.Number),
  enabled: Schema.Boolean,
  components: Schema.Struct({
    skills: Schema.Record(Schema.String, Schema.Boolean),
    mcp: Schema.Record(Schema.String, Schema.Boolean),
  }),
})

export const Profile = Schema.Struct({
  schema: Schema.Literal("opencode.marketplace.profile/v2"),
  name: Schema.String,
  description: Schema.optional(Schema.String),
  generated_at: Schema.String,
  sources: Schema.Array(ProfileSource),
  packages: Schema.Array(ProfilePackage),
}).annotate({ identifier: "MarketplaceProfile" })

export const ProfileDocument = Schema.Union([
  Profile,
  Schema.Struct({
    schema: Schema.Literal("opencode.marketplace.profile/v1"),
    name: Schema.String,
    description: Schema.optional(Schema.String),
    generated_at: Schema.String,
    sources: Schema.Array(ProfileSource),
    packages: Schema.Array(ProfilePackage),
  }),
]).annotate({ identifier: "MarketplaceProfileDocument" })

export const ProfilePlanInput = Schema.Struct({
  profile: ProfileDocument,
  mode: Schema.optional(Schema.Literals(["merge", "replace"])),
}).annotate({ identifier: "MarketplaceProfilePlanInput" })

export const ProfilePlanResult = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    plan_id: Schema.String,
    revision: NonNegativeInt,
    expires_at: Schema.String,
    actions: Schema.Array(Schema.Struct({ key: Schema.String, action: Schema.Literals(["install", "update"]) })),
    trust_warning: Schema.Boolean,
    conflicts: Schema.Array(Conflict),
  }),
  Schema.Struct({
    ok: Schema.Literal(false),
    reason: Schema.Literals(["not_found", "materialization", "incompatible", "digest"]),
    message: Schema.String,
  }),
]).annotate({ identifier: "MarketplaceProfilePlanResult" })

export type Trust = typeof Trust.Type
export type ConfiguredTrust = typeof ConfiguredTrust.Type
export type Kind = typeof Kind.Type
export interface Source extends Schema.Schema.Type<typeof Source> {}
export interface Skill extends Schema.Schema.Type<typeof Skill> {}
export interface InstallPlan extends Schema.Schema.Type<typeof InstallPlan> {}
export interface Installed extends Schema.Schema.Type<typeof Installed> {}
export interface State extends Schema.Schema.Type<typeof State> {}
export interface CatalogItem extends Schema.Schema.Type<typeof CatalogItem> {}
export interface Catalog extends Schema.Schema.Type<typeof Catalog> {}
export interface Listing extends Schema.Schema.Type<typeof Listing> {}
export interface LoadError extends Schema.Schema.Type<typeof LoadError> {}
export interface CacheSummary extends Schema.Schema.Type<typeof CacheSummary> {}
export interface View extends Schema.Schema.Type<typeof View> {}
export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export interface Conflict extends Schema.Schema.Type<typeof Conflict> {}
export interface PlanInput extends Schema.Schema.Type<typeof PlanInput> {}
export interface IconResult extends Schema.Schema.Type<typeof IconResult> {}
export type PlanResult = typeof PlanResult.Type
export interface InstallInput extends Schema.Schema.Type<typeof InstallInput> {}
export interface UpdateAllInput extends Schema.Schema.Type<typeof UpdateAllInput> {}
export interface RevisionInput extends Schema.Schema.Type<typeof RevisionInput> {}
export interface ToggleInput extends Schema.Schema.Type<typeof ToggleInput> {}
export interface SourceAddInput extends Schema.Schema.Type<typeof SourceAddInput> {}
export interface SourceToggleInput extends Schema.Schema.Type<typeof SourceToggleInput> {}
export interface ProfileExportInput extends Schema.Schema.Type<typeof ProfileExportInput> {}
export interface CachePruneInput extends Schema.Schema.Type<typeof CachePruneInput> {}
export interface Lock extends Schema.Schema.Type<typeof Lock> {}
export interface LockVerifyInput extends Schema.Schema.Type<typeof LockVerifyInput> {}
export interface LockVerifyResult extends Schema.Schema.Type<typeof LockVerifyResult> {}
export interface AuditInput extends Schema.Schema.Type<typeof AuditInput> {}
export interface AuditEntry extends Schema.Schema.Type<typeof AuditEntry> {}
export type MutationResult = typeof MutationResult.Type
export interface Profile extends Schema.Schema.Type<typeof Profile> {}
export type ProfileDocument = typeof ProfileDocument.Type
export interface ProfilePlanInput extends Schema.Schema.Type<typeof ProfilePlanInput> {}
export type ProfilePlanResult = typeof ProfilePlanResult.Type
