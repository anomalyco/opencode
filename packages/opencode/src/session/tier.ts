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
export function resolve(model: Provider.Model): ModelTier {
  if (model.tier) return model.tier
  if (vendor(model)) return "vendor"
  const match = PARAMS_RE.exec(model.api.id)
  if (!match) return "default"
  if (Number(match[1]) <= MINIMAL_MAX_PARAMS_B) return "minimal"
  // 10B–40B is the "default" band; larger sizes without a family match also
  // get "default" (the vendor case was handled above).
  return "default"
}

// Mirrors the family ladder in session/system.ts provider() — keep in sync.
function vendor(model: Provider.Model) {
  const id = model.api.id
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
