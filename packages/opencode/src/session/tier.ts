import type { Provider } from "@/provider/provider"
import { ModelFamily } from "./model-family"

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
type Detected = {
  tier: ModelTier
  source: "config" | "vendor" | "heuristic" | "fallback"
}

// Pure function of the model, but consulted on every request, per tool schema,
// and per stream text-end event — memoized per model object so the ladder and
// regex run once.
const detected = new WeakMap<Provider.Model, Detected>()

export function detect(model: Provider.Model): Detected {
  const cached = detected.get(model)
  if (cached) return cached
  const result = compute(model)
  detected.set(model, result)
  return result
}

function compute(model: Provider.Model): Detected {
  if (model.tier) return { tier: model.tier, source: "config" }
  if (vendor(model)) return { tier: "vendor", source: "vendor" }
  const match = PARAMS_RE.exec(apiId(model))
  if (!match) return { tier: "default", source: "fallback" }
  const params = Number(match[1])
  if (params <= MINIMAL_MAX_PARAMS_B) return { tier: "minimal", source: "heuristic" }
  if (params <= DEFAULT_MAX_PARAMS_B) return { tier: "default", source: "heuristic" }
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

// Vendor-family models keep their prompts and behavior byte-identical; the
// shared ladder in model-family.ts is the single matcher.
function vendor(model: Provider.Model) {
  return ModelFamily.family(model) !== undefined
}

export * as SessionTier from "./tier"
