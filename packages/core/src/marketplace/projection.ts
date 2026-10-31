export * as MarketplaceProjection from "./projection.js"

import { Option, Schema } from "effect"
import { Config } from "@opencode/schema/config"
import { ConfigNormalize } from "../config/normalize.js"
import type { MarketplaceInstallPlan, MarketplaceState } from "../marketplace.js"

export class Document extends Config.Document.extend<Document>("Marketplace.Document")({}) {}

/** Translate the catalog's V1-shaped install plan through the same normalization as user config. */
export function document(plan: MarketplaceInstallPlan) {
  const normalized = ConfigNormalize.normalize({
    ...(plan.plugins ? { plugin: plan.plugins } : {}),
    ...(plan.skills
      ? {
          skills: {
            paths: [
              ...(plan.skills?.paths ?? []),
              ...(plan.skills?.items ?? []).flatMap((item) => (item.path ? [item.path] : [])),
            ],
            urls: [
              ...(plan.skills?.urls ?? []),
              ...(plan.skills?.items ?? []).flatMap((item) => (item.url ? [item.url] : [])),
            ],
          },
        }
      : {}),
    ...(plan.agents ? { agent: plan.agents } : {}),
    ...(plan.commands ? { command: plan.commands } : {}),
    ...(plan.mcp ? { mcp: plan.mcp } : {}),
    ...(plan.instructions ? { instructions: plan.instructions } : {}),
  })
  if (normalized.type === "rejected") return { ok: false as const, diagnostics: normalized.diagnostics }
  if (normalized.diagnostics.length) return { ok: false as const, diagnostics: normalized.diagnostics }
  const info = Schema.decodeUnknownOption(Config.Info)(normalized.encoded)
  if (Option.isNone(info)) return { ok: false as const, diagnostics: [{ path: ["$"], message: "invalid config" }] }
  return { ok: true as const, document: new Document({ type: "document", info: info.value }) }
}

export function documents(state: MarketplaceState) {
  return Object.entries(state.installed ?? {})
    .toSorted(([a, left], [b, right]) => (left.priority ?? 0) - (right.priority ?? 0) || a.localeCompare(b))
    .flatMap(([, installed]) => {
      if (installed.enabled === false) return []
      const result = document(installed.active_plan ?? installed.materialized_plan ?? installed.plan)
      return result.ok ? [result.document] : []
    })
}
