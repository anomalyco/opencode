import { Schema } from "effect"
import { zod } from "@/util/effect-zod"

export class ConsoleQuotaWindow extends Schema.Class<ConsoleQuotaWindow>("ConsoleQuotaWindow")({
  remainingPercent: Schema.Number,
  resetSeconds: Schema.optional(Schema.Number),
  resetAt: Schema.optional(Schema.Number),
}) {}

export class CodexQuotaSnapshot extends Schema.Class<CodexQuotaSnapshot>("CodexQuotaSnapshot")({
  fiveHour: Schema.optional(ConsoleQuotaWindow),
  weekly: Schema.optional(ConsoleQuotaWindow),
  fetchedAt: Schema.optional(Schema.Number),
}) {
  static readonly zod = zod(this)
}

export class ProviderQuotaWindow extends Schema.Class<ProviderQuotaWindow>("ProviderQuotaWindow")({
  label: Schema.String,
  remainingPercent: Schema.optional(Schema.Number),
  resetSeconds: Schema.optional(Schema.Number),
  resetAt: Schema.optional(Schema.Number),
  confidence: Schema.Literals(["exact", "reported", "estimated"]),
  source: Schema.Literals(["official_api", "response_headers", "client_state", "heuristic"]),
}) {}

export class ProviderQuotaSnapshot extends Schema.Class<ProviderQuotaSnapshot>("ProviderQuotaSnapshot")({
  provider: Schema.String,
  label: Schema.String,
  fetchedAt: Schema.Number,
  status: Schema.Literals(["available", "unavailable"]),
  windows: Schema.mutable(Schema.Array(ProviderQuotaWindow)),
  message: Schema.optional(Schema.String),
}) {}

export class ProviderQuotaResponse extends Schema.Class<ProviderQuotaResponse>("ProviderQuotaResponse")({
  providerQuota: Schema.mutable(Schema.Array(ProviderQuotaSnapshot)),
  fetchedAt: Schema.Number,
}) {
  static readonly zod = zod(this)
}

export class ConsoleState extends Schema.Class<ConsoleState>("ConsoleState")({
  consoleManagedProviders: Schema.mutable(Schema.Array(Schema.String)),
  activeOrgName: Schema.optional(Schema.String),
  switchableOrgCount: Schema.Number,
  providerQuota: Schema.optional(Schema.mutable(Schema.Array(ProviderQuotaSnapshot))),
  codexQuota: Schema.optional(CodexQuotaSnapshot),
}) {
  static readonly zod = zod(this)
}

export const emptyConsoleState: ConsoleState = ConsoleState.make({
  consoleManagedProviders: [],
  activeOrgName: undefined,
  switchableOrgCount: 0,
  providerQuota: undefined,
  codexQuota: undefined,
})
