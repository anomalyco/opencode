import { e2eEmit } from "../e2e/emit"
import { assertHostWorkosForUniverE2e } from "../e2e/assert-univer-workos-env"
import { parseOpencodeE2eInfra } from "./e2e-infra-parse"

/**
 * Convenience entry: forwards to Vitest browser config. **Stack lifecycle** (Docker deps, OpenCode, Vite, env) lives in
 * `test/browser/support/use-full-app-stack.ts` — each spec calls `useFullAppStack()` in its root `describe`.
 *
 * `OPENCODE_E2E_INFRA` (default `postgres,ollama`; add `univer` for MinIO + compat) is read from the environment by each file's `beforeAll`.
 */

const appDir = process.cwd()

const extra = (() => {
  const args = process.argv.slice(2)
  if (args[0] === "--") return args.slice(1)
  return args
})()

const infra = parseOpencodeE2eInfra()
if (infra.has("univer")) assertHostWorkosForUniverE2e()

const targets = extra.length > 0 ? extra : ["test/browser"]
e2eEmit(`[e2e-local] bun x vitest run -c vitest.e2e.config.ts ${targets.join(" ")}`)

const proc = Bun.spawn(["bun", "x", "vitest", "run", "-c", "vitest.e2e.config.ts", ...targets], {
  cwd: appDir,
  stdio: "inherit",
})

process.exit(await proc.exited)
