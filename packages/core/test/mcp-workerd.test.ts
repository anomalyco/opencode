import path from "node:path"
import { pathToFileURL } from "node:url"
import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "./lib/effect"
import { tmpdirScoped } from "./fixture/tmpdir"

const miniflare = process.env.OPENCODE_TEST_MINIFLARE
const it = testEffect(Layer.empty)
const testWorkerd = miniflare ? it.live : it.live.skip

for (const entry of [
  { date: "2026-01-31", globalTimerType: "number" },
  { date: "2026-07-08", globalTimerType: "object" },
]) {
  testWorkerd(
    `MCP cooldown preserves HTTP 429 under workerd: ${entry.date}`,
    () =>
      Effect.gen(function* () {
        if (!miniflare) return yield* Effect.fail(new Error("OPENCODE_TEST_MINIFLARE must name the Miniflare module"))
        const tmp = yield* tmpdirScoped()
        const build = yield* Effect.promise(() =>
          Bun.build({
            entrypoints: [path.join(import.meta.dir, "fixture/mcp-workerd.ts")],
            target: "node",
            conditions: ["workerd"],
            external: ["node:*"],
          }),
        )
        expect(build.success, build.logs.map(String).join("\n")).toBe(true)
        const artifact = build.outputs[0]
        if (!artifact) return yield* Effect.fail(new Error("Missing workerd bundle"))
        const worker = path.join(tmp.path, "worker.js")
        yield* Effect.promise(() => Bun.write(worker, artifact))
        let requests = 0
        const origin = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.serve({
              port: 0,
              fetch: () => {
                requests += 1
                return new Response("original rejection", { status: 429, headers: { "retry-after": "60" } })
              },
            }),
          ),
          (server) => Effect.promise(() => server.stop(true)),
        )
        const child = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.spawn({
              cmd: [
                "node",
                "--input-type=module",
                "-e",
                `import { Miniflare } from ${JSON.stringify(pathToFileURL(miniflare).href)}
const origin = ${JSON.stringify(origin.url.href)}
const runtime = new Miniflare({
  compatibilityDate: ${JSON.stringify(entry.date)},
  compatibilityFlags: ["nodejs_compat"],
  modules: true,
  modulesRoot: ${JSON.stringify(tmp.path)},
  scriptPath: ${JSON.stringify(worker)},
  outboundService: async (request) => {
    if (request.url !== origin) throw new Error("Unexpected outbound request: " + request.url)
    return fetch(request.url)
  },
})
try {
  const response = await runtime.dispatchFetch(origin)
  const body = await response.text()
  if (response.status !== 200) throw new Error("workerd HTTP " + response.status + ": " + body)
  console.log(body)
} finally {
  await runtime.dispose()
}`,
              ],
              env: process.env,
              timeout: 15_000,
              stdout: "pipe",
              stderr: "pipe",
            }),
          ),
          (child) => Effect.sync(() => child.kill()),
        )
        const [code, output, error] = yield* Effect.promise(() =>
          Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]),
        )
        expect(code, error + output).toBe(0)
        expect(output.trim()).toBe(
          JSON.stringify({
            globalTimerType: entry.globalTimerType,
            firstStatus: 429,
            firstBody: "original rejection",
            firstRetryAfter: "60",
            secondStatus: 429,
            secondBody: "MCP endpoint cooldown after HTTP 429",
          }),
        )
        expect(requests).toBe(1)
      }),
    20_000,
  )
}
