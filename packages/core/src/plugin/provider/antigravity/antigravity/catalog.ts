export * as AntigravityCatalog from "./catalog.js"

import { Model } from "../../../../model.js"
import { Provider } from "../../../../provider.js"
import { AntigravityACP } from "./acp.js"

export const ID = Provider.ID.make("antigravity")

export interface Variant {
  /** The effort level, such as "low", "medium", "high" or "thinking". */
  readonly id: string
  /** The CLI's model id for this effort level. */
  readonly slug: string
  readonly name: string
}

export interface Group {
  /** The model's id: the CLI's model id without its effort suffix. */
  readonly id: string
  /** The model's name: the CLI's name without its effort suffix. */
  readonly name: string
  readonly family: string
  readonly variants: readonly Variant[]
}

/**
 * Groups the CLI's model list into models with effort levels.
 *
 * The CLI names the reasoning effort as part of the model, so "gemini-3.8-flash-high",
 * "gemini-3.8-flash-medium" and "gemini-3.8-flash-low" are one model with three effort levels
 * rather than three models. The CLI's own names make the split unambiguous -- "Gemini 3.8 Flash
 * (High)" is the model "Gemini 3.8 Flash" at effort "high" -- so the grouping is read off the names.
 *
 * The effort suffix is only dropped from the model id when the id really ends with it.
 * "claude-sonnet-4-6" is displayed as "Claude Sonnet 4.6 (Thinking)" and has no "-thinking"
 * suffix, so it keeps its own name.
 */
export function group(entries: readonly AntigravityACP.Model[]): Group[] {
  const models = new Map<string, { name: string; variants: Variant[] }>()
  for (const entry of entries) {
    const split = splitName(entry.name)
    const effort = split.effort === undefined ? undefined : effortId(split.effort)
    const id = effort === undefined ? entry.slug : withoutSuffix(entry.slug, effort)
    const variant = { id: effort ?? "default", slug: entry.slug, name: entry.name }
    const model = models.get(id)
    if (model) model.variants.push(variant)
    else models.set(id, { name: split.name, variants: [variant] })
  }
  return [...models].map(([id, model]) => ({
    id,
    name: model.name,
    family: familyOf(id),
    variants: model.variants,
  }))
}

/**
 * The opencode model for one group.
 *
 * A model with one effort level has nothing to choose between, so it keeps the CLI's own name for it
 * and offers no variants. A model with several effort levels is named after the model they share,
 * and the effort levels become its variants.
 */
export function toModel(group: Group): Model.Info {
  const defaults = Model.Info.default(ID, Model.ID.make(group.id))
  const only = group.variants.length === 1 ? group.variants[0] : undefined
  return {
    ...defaults,
    name: only ? only.name : group.name,
    family: Model.Family.make(group.family),
    variants: only
      ? []
      : group.variants.map((variant) => ({
          id: Model.VariantID.make(variant.id),
          settings: { effort: variant.id, slug: variant.slug },
        })),
  }
}

/**
 * The CLI's model id for an opencode model and an effort level.
 *
 * A model with one effort level has nothing to choose between, so its own model id is used whatever
 * the effort says. Otherwise the named effort wins, and a missing or unknown effort falls back to
 * the model's default.
 */
export function resolveSlug(groups: readonly Group[], modelID: string, effortID?: string) {
  const model = groups.find((candidate) => candidate.id === modelID)
  if (!model) return undefined
  if (model.variants.length === 1) return model.variants[0]?.slug
  const named = effortID === undefined ? undefined : model.variants.find((variant) => variant.id === effortID)
  return (named ?? defaultVariant(model))?.slug
}

function splitName(name: string) {
  const match = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(name)
  if (!match) return { name, effort: undefined }
  return { name: match[1].trim(), effort: match[2].trim() }
}

function effortId(label: string) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

function withoutSuffix(slug: string, effort: string) {
  const suffix = `-${effort}`
  return slug.endsWith(suffix) ? slug.slice(0, -suffix.length) : slug
}

/** The CLI's own default is the highest effort. */
function defaultVariant(model: Group) {
  return (
    model.variants.find((variant) => variant.id === "high") ??
    model.variants.find((variant) => variant.id === "medium") ??
    model.variants[0]
  )
}

function familyOf(id: string) {
  if (id.startsWith("gemini")) return "gemini"
  if (id.startsWith("claude")) return "claude"
  if (id.startsWith("gpt")) return "gpt"
  return id.split("-")[0] ?? id
}
