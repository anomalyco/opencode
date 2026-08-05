// Model family/version discovery and quant-tier parsing, ported from Skein.
//
// Source: internal/providers/model_gallery.go, internal/providers/recommend.go
// Pinned commit: 95f0801a9a27d209f7c1ea1e136d665ac52b89e1 (last change to these
// functions in /Users/andreas/dev/skein)
//
// Context-floor selection (bestRecommendationVariant, OptimalCtxSize) is
// deliberately not ported here: it depends on live VRAM/host capacity data that
// belongs to the multi-host fit evaluation slice, not the catalog domain.

export type FamilyVersion = {
  family: string
  version: number
}

// Captures a coarse (family, version) pair from a model or repo name: a run of
// letters followed by an optional v and a version number.
// "Qwen3.6-35B-A3B" -> {family: "qwen", version: 3.6}; "gemma-4-26B" ->
// {family: "gemma", version: 4}; "deepseek-v4" -> {family: "deepseek", version: 4}.
const MODEL_FAMILY_RE = /([a-z]{3,})[-_. ]?v?(\d+(?:\.\d+)?)/g
const TRAILING_V_SEP_RE = /[-_. ]*v?$/

/**
 * Extract the first family/version pair from a name, or null when no versioned
 * family is recognizable. The family is the whole normalized prefix before the
 * version ("mistral-small-3.1" -> "mistralsmall"), so sibling lines like
 * mistral-small vs mistral-large stay distinct. Parameter counts like "35B" are
 * not versions: digits immediately followed by "b" are skipped.
 */
export function modelFamilyVersion(name: string): FamilyVersion | null {
  const lower = basename(name).toLowerCase()
  for (const match of lower.matchAll(MODEL_FAMILY_RE)) {
    const versionText = match[2]
    if (!versionText) continue
    const matchEnd = match.index + match[0].length
    const versionStart = matchEnd - versionText.length
    if (lower.slice(matchEnd).startsWith("b")) continue // "35b" is a size, not a version
    const version = Number(versionText)
    if (!Number.isFinite(version)) continue
    const family = [...lower.slice(0, versionStart).replace(TRAILING_V_SEP_RE, "")]
      .filter((char) => char >= "a" && char <= "z")
      .join("")
    if (family.length < 3) continue
    return { family, version }
  }
  return null
}

function basename(value: string) {
  const trimmed = value.replace(/\/+$/, "")
  return trimmed.split("/").at(-1) || value
}

export type FamilyUpgrade<T> = {
  candidate: T
  replaces: string
}

export type FamilyClassification<T> = {
  upgrades: FamilyUpgrade<T>[]
  fresh: T[]
}

/**
 * Split candidates into upgrades (same family as an installed model, strictly
 * newer version) and fresh finds (families never installed). Same-or-older
 * variants of an installed family are dropped from both lists — the caller
 * already has as-good-or-better, so it is neither a fresh find nor an upgrade.
 * `nameOf` returns name sources to try in priority order (for example
 * repository first, then a variant filename) until one parses. Callers should
 * filter out already-installed exact candidates before calling this. Pure
 * function.
 */
export function classifyByInstalledFamily<T>(
  candidates: readonly T[],
  installed: readonly string[],
  nameOf: (candidate: T) => readonly string[],
): FamilyClassification<T> {
  const families = new Map<string, { version: number; name: string }>()
  for (const name of installed) {
    const parsed = modelFamilyVersion(name)
    if (!parsed) continue
    const current = families.get(parsed.family)
    if (!current || parsed.version > current.version) families.set(parsed.family, { version: parsed.version, name })
  }

  const upgrades: FamilyUpgrade<T>[] = []
  const fresh: T[] = []
  for (const candidate of candidates) {
    const parsed = nameOf(candidate)
      .map((source) => modelFamilyVersion(source))
      .find((value): value is FamilyVersion => value !== null)
    if (!parsed) {
      fresh.push(candidate)
      continue
    }
    const current = families.get(parsed.family)
    if (current) {
      if (parsed.version > current.version) upgrades.push({ candidate, replaces: current.name })
      continue
    }
    fresh.push(candidate)
  }
  return { upgrades, fresh }
}

/**
 * Normalize a GGUF filename's quantization marker to a lowercase canonical
 * label, including the human-friendly quality tiers ("Quality", "Balanced", …)
 * some quantizer orgs use instead of explicit q*_k_* markers. Returns "unknown"
 * when no recognized marker is present.
 */
export function parseRecommendationQuant(filename: string): string {
  const lower = filename.toLowerCase().replaceAll("-", "_")
  if (lower.includes("_i_quality") || lower.includes("_quality")) return "q5_k_m"
  if (lower.includes("_i_balanced") || lower.includes("_balanced")) return "q4_k_m"
  if (lower.includes("_i_compact") || lower.includes("_compact")) return "q4_k_s"
  if (lower.includes("_i_mini") || lower.includes("_mini")) return "q3_k_m"
  if (lower.includes("_i_nano") || lower.includes("_nano")) return "q2_k"
  const patterns = [
    "ud_q5_k_m",
    "ud_q4_k_m",
    "ud_q8_0",
    "iq4_nl",
    "iq4_xs",
    "iq3_m",
    "iq2_m",
    "iq2_xs",
    "q8_0",
    "q6_k",
    "q5_k_m",
    "q5_k_s",
    "q4_k_m",
    "q4_k_s",
    "q4_0",
    "q3_k_m",
    "q3_k_s",
    "q2_k",
  ]
  return patterns.find((pattern) => lower.includes(pattern)) ?? "unknown"
}

// Lower rank is better quality; quants absent from this table are unranked.
const RECOMMENDATION_QUANT_RANK: Record<string, number> = {
  q8_0: 1,
  q6_k: 2,
  q5_k_m: 3,
  q5_k_s: 4,
  q4_k_m: 5,
  iq4_nl: 5,
  ud_q4_k_m: 5,
  q4_k_s: 6,
  iq4_xs: 6,
  q4_0: 7,
  q3_k_m: 8,
  iq3_m: 8,
  q3_k_s: 9,
  q2_k: 10,
  iq2_m: 10,
  iq2_xs: 11,
}

/** Lower rank is better quality. Returns null for unranked/unknown quantizations. */
export function recommendationQuantRank(quant: string): number | null {
  return RECOMMENDATION_QUANT_RANK[quant] ?? null
}
