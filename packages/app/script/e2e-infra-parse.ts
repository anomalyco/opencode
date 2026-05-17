export type E2eInfraLayer = "postgres" | "ollama" | "univer"

const KNOWN: readonly E2eInfraLayer[] = ["postgres", "ollama", "univer"]

/** Which Docker layers `startE2eDockerDeps` should start (`OPENCODE_E2E_INFRA`, comma-separated). */
export function parseOpencodeE2eInfra(): ReadonlySet<E2eInfraLayer> {
  const raw = process.env.OPENCODE_E2E_INFRA?.trim()
  const defaults = "postgres,ollama"
  const src = raw ? raw : defaults
  const out = new Set<E2eInfraLayer>()
  for (const token of src.split(",")) {
    const p = token.trim()
    if (!p) continue
    if (!KNOWN.includes(p as E2eInfraLayer)) {
      throw new Error(`unknown OPENCODE_E2E_INFRA layer "${p}" (allowed: ${KNOWN.join(", ")})`)
    }
    out.add(p as E2eInfraLayer)
  }
  if (out.size === 0) throw new Error("OPENCODE_E2E_INFRA resolved to no layers")
  return out
}
