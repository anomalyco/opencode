/**
 * Composable E2E infrastructure flags (avoid one-off env vars per stack).
 *
 * **Runner (this repo’s `e2e-local.ts`):** `OPENCODE_E2E_INFRA` — comma-separated layers.
 * Default when unset: `postgres,ollama` (same behavior as the original local E2E runner).
 * Omitting `ollama` is allowed: `e2e-local` points OpenCode-in-Docker at host Ollama (`host.docker.internal:11434`) instead of starting the Ollama container.
 *
 * **Playwright webServer only:** `PLAYWRIGHT_E2E_INFRA` — which extra processes Vite should wrap.
 * Example: `univer` → use `dev-e2e-with-univer.ts` (MinIO Testcontainers + compat + Vite); all MinIO/compat wiring is in `e2e-testcontainers.ts`.
 */

export type E2eInfraLayer = "postgres" | "ollama" | "univer"

const KNOWN: readonly E2eInfraLayer[] = ["postgres", "ollama", "univer"]

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

/** Whether Playwright should start Vite via `dev-e2e-with-univer.ts` (MinIO + compat + Vite). */
export function playwrightWebserverUsesUniver(): boolean {
  const raw = process.env.PLAYWRIGHT_E2E_INFRA?.trim()
  if (!raw) return false
  return raw
    .split(",")
    .map((s) => s.trim())
    .includes("univer")
}
