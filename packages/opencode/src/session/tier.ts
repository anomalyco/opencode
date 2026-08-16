import type { Provider } from "@/provider/provider"

export type ModelTier = "minimal" | "default" | "vendor"

// Band edges for the parameter-count heuristic, versioned with the fork plan
// doc (§A0): ≤ MINIMAL_MAX_PARAMS_B → "minimal", ≤ DEFAULT_MAX_PARAMS_B → "default".
export const MINIMAL_MAX_PARAMS_B = 9
export const DEFAULT_MAX_PARAMS_B = 40

// Parses a parameter-count suffix such as "4b", "35B", or "1.5b" out of a model id.
const PARAMS_RE = /(\d+(?:\.\d+)?)\s*[bB]\b/

// Resolution precedence: explicit config/catalog tier (carried on the model),
// then the vendor family guard, then the parameter-count heuristic, then "default".
// The vendor guard runs before the heuristic so frontier ids with a parameter
// suffix (e.g. "gemini-2.5-flash-8b") keep their vendor behavior byte-identical.
// The source distinguishes positive evidence (config, heuristic) from the bare
// fall-through, so consumers like sampling can avoid overriding unknown models.
export function detect(model: Provider.Model): {
  tier: ModelTier
  source: "config" | "vendor" | "heuristic" | "fallback"
} {
  if (model.tier) return { tier: model.tier, source: "config" }
  if (vendor(model)) return { tier: "vendor", source: "vendor" }
  const match = PARAMS_RE.exec(apiId(model))
  if (!match) return { tier: "default", source: "fallback" }
  if (Number(match[1]) <= MINIMAL_MAX_PARAMS_B) return { tier: "minimal", source: "heuristic" }
  if (Number(match[1]) <= DEFAULT_MAX_PARAMS_B) return { tier: "default", source: "heuristic" }
  return { tier: "default", source: "fallback" }
}

export function resolve(model: Provider.Model): ModelTier {
  return detect(model).tier
}

// Config-defined models may carry no upstream api id; fall back to the
// opencode model id rather than crashing mid-stream (E5 calls resolve()
// on every text-end event).
function apiId(model: Provider.Model): string {
  return model.api.id ?? model.id ?? ""
}

// Mirrors the family ladder in session/system.ts provider() — keep in sync.
function vendor(model: Provider.Model) {
  const id = apiId(model)
  if (id.includes("muse")) return true
  if (id.includes("gpt-4") || id.includes("o1") || id.includes("o3")) return true
  if (id.includes("gpt")) return true
  if (id.includes("gemini-")) return true
  if (id.includes("claude")) return true
  if (id.toLowerCase().includes("trinity")) return true
  if (id.toLowerCase().includes("kimi")) return true
  return ["kimi-for-coding", "moonshotai", "moonshotai-cn"].includes(model.providerID)
}

export * as SessionTier from "./tier"
