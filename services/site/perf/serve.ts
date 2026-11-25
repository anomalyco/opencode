// Serves the production build that script/build.ts wrote (.cloudflare/output) in workerd through
// Miniflare, the runtime check-worker-start.ts uses, for strobe benches (strobe.json `serve`). Every
// outbound fetch gets a 503, as in check-worker-start.ts, so both sides of a bench render the
// build-time GitHub snapshot and no live data.
//
//   bun perf/serve.ts --port 4300
import path from "node:path"
import { parseArgs } from "node:util"
import { readBuildOutput } from "@cloudflare/build-output-utils"
import { Miniflare, Response } from "miniflare"

const args = parseArgs({ options: { port: { type: "string", default: "4300" } } })
const root = path.resolve(import.meta.dir, "..")
const worker = (await readBuildOutput(root)).workers.default
const config = worker.config
if (!worker.bundleDir || !config.manifest) throw new Error("perf/serve: the Build Output has no Worker bundle")
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
const env = Object.fromEntries(
  Object.entries(config.env ?? {}).map(([name, binding]) => {
    if (binding.type === "text") return [name, { type: "text" as const, value: binding.value }]
    if (binding.type === "assets") return [name, { type: "assets" as const }]
    throw new Error(`perf/serve: the ${binding.type} binding ${name} is not emulated`)
  }),
)

const miniflare = new Miniflare({
  cf: false,
  host: "127.0.0.1",
  port: Number(args.values.port),
  workers: [
    {
      config: {
        name: config.name,
        compatibilityDate: config.compatibilityDate,
        compatibilityFlags: config.compatibilityFlags,
        triggers: [{ type: "fetch", pattern: "*/*" }],
        env,
        manifest: { mainModule: config.manifest.mainModule, modules },
        ...(worker.assetsDir ? { assets: { ...config.assets, directory: worker.assetsDir } } : {}),
      },
      dev: {
        outboundService: { type: "fetcher", handler: () => new Response("offline", { status: 503 }) },
      },
    },
  ],
})
console.log(`perf/serve: ${config.name} at ${await miniflare.ready}`)
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => void miniflare.dispose().finally(() => process.exit(0)))
