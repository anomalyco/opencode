import path from "node:path"
import { parseOpencodeE2eInfra, startE2eDockerDeps } from "./e2e-testcontainers"

/**
 * Verifies Testcontainers + optional Univer stack **without** Playwright or OpenCode.
 * Same Docker deps as `e2e-local.ts` for the given `OPENCODE_E2E_INFRA` (see `e2e-testcontainers.ts`).
 *
 * Usage (from `packages/app`):
 *   bun --env-file=../../.env.development --env-file=.env.e2e ./script/e2e-infra-smoke.ts
 * Or from repo root: `bun run test:e2e:infra-smoke`
 */

const repoDir = path.resolve(import.meta.dir, "../../..")

const infra = parseOpencodeE2eInfra()

console.log("")
console.log("[E2E smoke] layers:", [...infra].join(", "))
console.log(
  `[E2E smoke] Requires Docker.${infra.has("ollama") ? " First run pulls images + Ollama model (often several minutes)." : " First run may pull images."}`,
)
console.log("")

let deps: Awaited<ReturnType<typeof startE2eDockerDeps>> | undefined

const down = async () => {
  await deps?.stop()
}

process.once("SIGINT", () => void down().then(() => process.exit(130)))
process.once("SIGTERM", () => void down().then(() => process.exit(143)))

try {
  deps = await startE2eDockerDeps(infra, repoDir)
  console.log("[E2E smoke] Postgres:", deps.databaseUrl)
  console.log("[E2E smoke] Ollama:", deps.ollamaBaseUrl ?? "(skipped — not in OPENCODE_E2E_INFRA)")
  if (deps.univer) console.log("[E2E smoke] compat:", deps.univer.origin)

  console.log("")
  console.log("[E2E smoke] OK — stopping.")
  await down()
  console.log("[E2E smoke] Done.")
  process.exit(0)
} catch (e) {
  console.error("[E2E smoke] Failed:", e)
  try {
    await down()
  } catch (downErr) {
    console.error("[E2E smoke] down failed after error:", downErr)
  }
  process.exit(1)
}
