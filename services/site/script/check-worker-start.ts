// Starts the built Worker (the Build Output Specification tree script/build.ts wrote) in workerd
// through Miniflare, the runtime `cf` itself uses, and requests a few pages. Fails when the Worker
// doesn't start or a page answers wrongly, so a bundle that only breaks at startup can't reach a deploy:
// the build, the bundle checks and `cf deploy --dry-run` all passed on 5 Nov for a build whose server
// chunk had split in two (_ssr/ssr.mjs and ssr2.mjs) and that workerd refused to load ("Export
// 'ssr_exports' is not defined").
//
// No secrets and no network: every outbound fetch gets a 503, the way a GitHub or status outage looks,
// and the site falls back to its build-time snapshot as it does in production; `request.cf` uses
// Miniflare's built-in values instead of downloading them.
//
//   bun ./script/check-worker-start.ts
import path from "node:path"
import { readBuildOutput } from "@cloudflare/build-output-utils"
import { Miniflare, Response } from "miniflare"

const root = path.resolve(import.meta.dir, "..")
// Pages with a status must answer exactly that, others anything but a 5xx; a redirect must go to its
// location. The docs page is asked for as a browser asks and, at a second URL, as an agent asks (its
// Markdown twin, src/docs/middleware.ts). The docs' old /v2 address and a V1 docs path redirect.
const pages: { path: string; status?: number; accept?: string; location?: string }[] = [
  { path: "/", status: 200 },
  { path: "/ja", status: 200 },
  { path: "/desktop", status: 200 },
  { path: "/check-worker-start-404", status: 404 },
  { path: "/docs/", status: 200 },
  { path: "/docs/config/", status: 200, accept: "text/markdown" },
  { path: "/v2/docs/config/", status: 301, location: "/docs/config/" },
  { path: "/docs/ja/", status: 302, location: "/v1/docs/ja/" },
]

const started = performance.now()
const worker = (await readBuildOutput(root)).workers.default
const config = worker.config
if (!worker.bundleDir || !config.manifest) throw new Error("check-worker-start: the Build Output has no Worker bundle")
const bundle = worker.bundleDir
const modules = Object.fromEntries(
  await Promise.all(
    Object.entries(config.manifest.modules).map(async ([name, module]) => {
      const file = Bun.file(path.join(bundle, name))
      const contents = module.type === "esm" || module.type === "cjs" ? await file.text() : await file.bytes()
      return [name, { type: module.type, contents }] as const
    }),
  ),
)
// The site binds its assets and text values only; another kind of binding needs emulating here first.
const env = Object.fromEntries(
  Object.entries(config.env ?? {}).map(([name, binding]) => {
    if (binding.type === "text") return [name, { type: "text" as const, value: binding.value }]
    if (binding.type === "assets") return [name, { type: "assets" as const }]
    throw new Error(`check-worker-start: the ${binding.type} binding ${name} is not emulated`)
  }),
)

const errors: string[] = []
let offline = 0
const miniflare = new Miniflare({
  cf: false,
  handleUncaughtError: (error) => errors.push(error.message),
  workers: [
    {
      config: {
        name: config.name,
        compatibilityDate: config.compatibilityDate,
        compatibilityFlags: config.compatibilityFlags,
        // Its routes are for the real zone; here it answers every request.
        triggers: [{ type: "fetch", pattern: "*/*" }],
        env,
        manifest: { mainModule: config.manifest.mainModule, modules },
        ...(worker.assetsDir ? { assets: { ...config.assets, directory: worker.assetsDir } } : {}),
      },
      dev: {
        outboundService: {
          type: "fetcher",
          handler: () => (offline++, new Response("offline", { status: 503 })),
        },
      },
    },
  ],
})

// Requests go to the local server's own address: Miniflare's dispatchFetch uses undici, whose
// dispatcher Bun's fetch ignores, so under Bun it would send them to the real host instead.
const results = await Promise.resolve()
  .then(() => miniflare.ready)
  .then(async (url) => {
    const answers = []
    for (const page of pages) {
      const actual = await fetch(new URL(page.path, url), {
        headers: { accept: page.accept ?? "text/html" },
        redirect: "manual",
      })
        .then(async (response) => {
          await response.arrayBuffer()
          return { status: response.status, location: response.headers.get("location") ?? undefined }
        })
        .catch(() => ({ status: 0, location: undefined }))
      answers.push({ ...page, actual: actual.status, actualLocation: actual.location })
    }
    return answers
  })
  .catch((error: unknown) => {
    errors.push(`the Worker did not start: ${error instanceof Error ? error.message : String(error)}`)
    return []
  })
  // Disposing a runtime that never started rethrows its startup error, already recorded above.
  .finally(() => miniflare.dispose().catch(() => {}))

const failures = results
  .filter(
    (result) =>
      (result.status ? result.actual !== result.status : result.actual === 0 || result.actual >= 500) ||
      result.actualLocation !== result.location,
  )
  .map(
    (result) =>
      `${result.path} answered ${result.actual || "nothing"}${result.status ? `, not ${result.status}` : ""}` +
      (result.actualLocation !== result.location ? ` to ${result.actualLocation}, not ${result.location}` : ""),
  )
if (failures.length || errors.length) {
  console.error(`check-worker-start: FAILED\n${[...errors, ...failures].map((line) => `  ${line}`).join("\n")}`)
  process.exit(1)
}
const answered = results.map((result) => `${result.path} ${result.actual}`).join(", ")
console.log(
  `check-worker-start: ${config.name} starts in workerd; ${answered}; ${offline} outbound calls answered offline (${Math.round(performance.now() - started)} ms)`,
)
