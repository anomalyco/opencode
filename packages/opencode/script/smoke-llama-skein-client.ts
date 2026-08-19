#!/usr/bin/env bun
/**
 * Exercises the generated llama-skein client against a real provider.
 *
 * A typecheck only proves the client compiles against the contract; it cannot
 * catch a route the server does not actually serve, which is exactly the bug
 * that left patchConfigModel calling a dead path for two months. This calls
 * read-only endpoints for real and reports what each one returns.
 *
 *   bun run script/smoke-llama-skein-client.ts [baseUrl]
 */
import { createClient } from "../src/local/llama-skein/gen/client"
import { LlamaSkeinClient } from "../src/local/llama-skein/gen/sdk.gen"

const baseUrl = process.argv[2] ?? process.env["LLAMA_SKEIN_URL"] ?? "http://127.0.0.1:11435"
const TIMEOUT_MS = Number(process.env["LLAMA_SKEIN_TIMEOUT_MS"] ?? 8000)

// Without a per-request deadline a stopped provider makes this hang on the OS
// connect timeout, once per operation, and the run has to be killed.
const api = new LlamaSkeinClient({
  client: createClient({
    baseUrl,
    // Cast: the client's option is typed as the full `typeof fetch` (including
    // Bun's `preconnect`), but only the call signature is ever used.
    fetch: ((request: Request) => fetch(request, { signal: AbortSignal.timeout(TIMEOUT_MS) })) as typeof fetch,
  }),
})

// Read-only only. A smoke test must never mutate a live provider's config.
const checks: Array<[string, () => Promise<{ error?: unknown; data?: unknown }>]> = [
  ["getSystemVersion", () => api.getSystemVersion()],
  ["getSystemCapabilities", () => api.getSystemCapabilities()],
  ["listModels", () => api.listModels()],
  ["getApiModels", () => api.getApiModels()],
  ["getRunning", () => api.getRunning()],
  ["getHardware", () => api.getHardware()],
  ["getHealth", () => api.getHealth()],
  ["getConfigInfo", () => api.getConfigInfo()],
  ["getFitReport", () => api.getFitReport()],
  ["getTuning", () => api.getTuning()],
  ["listTuningProfiles", () => api.listTuningProfiles()],
  ["getSkeinConfig", () => api.getSkeinConfig()],
  ["getDefaultSkeinConfig", () => api.getDefaultSkeinConfig()],
  ["getModelDefault", () => api.getModelDefault()],
  ["listRuntimes", () => api.listRuntimes()],
  ["listModelOperations", () => api.listModelOperations()],
  ["getConfigHistory", () => api.getConfigHistory()],
]

console.log(`smoke-testing ${checks.length} operations against ${baseUrl}\n`)

let ok = 0
const failures: string[] = []

for (const [name, call] of checks) {
  try {
    const res = await call()
    if (res.error !== undefined) {
      // A transport failure never reached the server, so it says nothing about
      // the route — but it must not be reported as a pass either.
      const code = (res.error as { code?: string } | undefined)?.code
      if (code !== undefined && code !== "") {
        failures.push(`${name}: transport error ${code}`)
        console.log(`  FAIL  ${name}  (${code})`)
        continue
      }
      // Distinguish "this server does not serve that route" — the failure this
      // script exists to catch — from an application error on a route that does
      // exist. Go's mux answers an unrouted path with the bare string
      // "404 page not found"; llama-skein's own errors are {src, error} JSON.
      const unrouted = typeof res.error === "string" && res.error.includes("404 page not found")
      if (unrouted) {
        failures.push(`${name}: route not served by this provider`)
        console.log(`  FAIL  ${name}  (route not found)`)
        continue
      }
      ok++
      const detail = typeof res.error === "object" ? JSON.stringify(res.error) : String(res.error)
      console.log(`  ok    ${name}  (route served; app error: ${detail.slice(0, 60)})`)
      continue
    }
    ok++
    console.log(`  ok    ${name}`)
  } catch (err) {
    failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`)
    console.log(`  ERROR ${name}`)
  }
}

console.log(`\n${ok}/${checks.length} operations reachable`)
if (failures.length > 0) {
  console.log("\nfailures:")
  for (const f of failures) console.log(`  ${f}`)
  process.exit(1)
}
