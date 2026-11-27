export * as UsageLimits from "./usage-limits.js"

import { Schema } from "effect"
import { Model } from "./model.js"
import { Money } from "./money.js"
import { Provider } from "./provider.js"
import { optional } from "./schema.js"

const Percent = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 100 }))
const Instant = Schema.Finite.annotate({ description: "Milliseconds since the Unix epoch" })

/** One provider-reported quota window. */
export interface Window extends Schema.Schema.Type<typeof Window> {}
export const Window = Schema.Struct({
  id: Schema.String,
  name: optional(Schema.String),
  windowSeconds: Schema.Finite.pipe(optional),
  percent: Percent,
  limited: Schema.Boolean,
  resetsAt: Instant,
}).annotate({ identifier: "UsageLimits.Window" })

/** A provider's allowance for the connected account. */
export interface Allowance extends Schema.Schema.Type<typeof Allowance> {}
export const Allowance = Schema.Struct({
  providerID: Provider.ID,
  name: Schema.String,
  usageURL: optional(Schema.String),
  plan: optional(Schema.String),
  windows: Schema.Array(Window),
}).annotate({ identifier: "UsageLimits.Allowance" })

/** A model a budget covers, by the IDs OpenCode knows it by. */
export interface BudgetModel extends Schema.Schema.Type<typeof BudgetModel> {}
export const BudgetModel = Schema.Struct({
  providerID: Provider.ID,
  modelID: Model.ID,
  name: Schema.String,
  /** What a per-model budget's member has spent on this model this month. */
  spent: Money.USD.pipe(optional),
}).annotate({ identifier: "UsageLimits.BudgetModel" })

/** A monthly spend limit the OpenCode Console workspace sets on the member. */
export interface Budget extends Schema.Schema.Type<typeof Budget> {}
export const Budget = Schema.Struct({
  id: Schema.String,
  limit: Money.USD,
  /** The member's spend this month, or the pooled spend of a combined budget; per model, the most on one model. */
  spent: Money.USD,
  /** `each` limits every member separately; `combined` pools everyone's spend against one limit. */
  scope: Schema.Literals(["each", "combined"]),
  /** `set` counts spend across the budget's models; `model` limits each model separately. */
  per: Schema.Literals(["set", "model"]),
  /** `all` covers every model and billable service; `models` covers only `models`. */
  coverage: Schema.Literals(["all", "models"]),
  models: Schema.Array(BudgetModel),
  /** The vendors whose models the budget counts, by name; empty when it doesn't count by vendor. */
  vendors: Schema.Array(Schema.String),
  /** The input price per 1M tokens from which the budget counts a model, when it sets one. */
  inputPriceAtLeast: Money.USDPerMillionTokens.pipe(optional),
  /** The budget counts models picked one by one, rather than by vendor or price. */
  picked: Schema.Boolean,
  /** Everyone in the workspace pools spend against it, so reaching it pauses model use for all of them. */
  shared: Schema.Boolean,
  resetsAt: Instant,
}).annotate({ identifier: "UsageLimits.Budget" })

/** Usage limits available to the accounts connected at a location. */
export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  workspace: Schema.Struct({
    id: Schema.String,
    name: Schema.String.pipe(optional),
    /** The member's usage page in OpenCode Console. */
    usageURL: Schema.String,
  }).pipe(optional),
  allowances: Schema.Array(Allowance),
  /** Sources that could not be read while another source returned data. */
  unavailable: Schema.Array(Provider.ID).pipe(optional),
  budgets: Schema.Array(Budget),
}).annotate({ identifier: "UsageLimits.Info" })
