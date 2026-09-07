// Measures what one LLM step pays to snapshot the Location tool registry when a
// large MCP inventory is registered: `Tool.snapshot` plus the Code Mode
// instructions built from its catalog (the two per-step calls in
// `SessionContext.select`). Tools are synthetic OpenAPI-shaped MCP registrations
// with realistic descriptions and JSON schemas; nothing is executed.
//
//   bun run script/benchmark-tool-snapshot.ts [--tools 3242] [--iterations 20] [--json out.json]
//   bun run script/benchmark-tool-snapshot.ts --tools 200 --iterations 128 --churn equivalent
// `--churn membership` hides a different tool each step; `equivalent` changes only resources.
//
// Per-iteration heap growth is sampled after a forced GC before the iteration and
// without GC afterwards. This is a growth proxy, not an allocation count: automatic GC
// and heap accounting can hide allocations. Retention is a separate forced-GC number.
import fs from "fs/promises"
import path from "path"
import { heapStats } from "bun:jsc"
import { Effect, Layer, Logger } from "effect"
import type { JsonSchema } from "effect"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { CodeModeInstructions } from "../src/codemode/instructions"
import { Image } from "../src/image"
import { Tool } from "../src/tool"
import type { Permission } from "../src/permission"

const args = process.argv.slice(2)
const flag = (name: string, fallback: number) => {
  const index = args.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = Number(args[index + 1])
  if (!Number.isInteger(value) || value < 1) {
    console.error(`--${name} must be a positive integer`)
    process.exit(1)
  }
  return value
}
const toolCount = flag("tools", 3242)
const iterations = flag("iterations", 20)
const jsonIndex = args.indexOf("--json")
const jsonPath = jsonIndex === -1 ? undefined : args[jsonIndex + 1]
const churnIndex = args.indexOf("--churn")
const churn = churnIndex === -1 ? "none" : args[churnIndex + 1]
if (churn !== "none" && churn !== "equivalent" && churn !== "membership") {
  throw new Error("--churn must be equivalent or membership")
}

const resources = [
  "accounts",
  "zones",
  "dns_records",
  "workers",
  "scripts",
  "kv_namespaces",
  "r2_buckets",
  "queues",
  "pages_projects",
  "access_apps",
  "gateway_rules",
  "load_balancers",
  "tunnels",
  "certificates",
  "firewall_rules",
  "rulesets",
  "logpush_jobs",
  "images",
  "stream_videos",
  "d1_databases",
]
const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const

const body = (index: number): JsonSchema.JsonSchema => ({
  type: "object",
  description: "Request body",
  properties: {
    name: { type: "string", description: "Human readable name for the resource", maxLength: 256 },
    enabled: { type: "boolean", description: "Whether the resource is active" },
    tags: { type: "array", description: "Labels attached to the resource", items: { type: "string" } },
    ttl: { type: "integer", description: "Time to live in seconds", minimum: 60, maximum: 86400 },
    mode: { type: "string", enum: ["off", "on", "custom"], description: "Operating mode" },
    settings: {
      type: "object",
      description: "Nested configuration",
      properties: {
        region: { type: "string", description: "Deployment region such as WNAM or ENAM" },
        retries: { type: "integer", description: "Retry budget", minimum: 0, maximum: 10 },
        origins: {
          type: "array",
          items: {
            type: "object",
            properties: {
              address: { type: "string", description: "Origin host or IP" },
              weight: { type: "number", description: "Traffic weight between 0 and 1" },
            },
            required: ["address"],
          },
        },
      },
    },
    ...(index % 3 === 0 ? { comment: { type: "string", description: "Free form note" } } : {}),
  },
  required: ["name"],
})

const input = (method: (typeof methods)[number], index: number): JsonSchema.JsonSchema => ({
  type: "object",
  properties: {
    account_id: { type: "string", description: "Account identifier", maxLength: 32 },
    ...(index % 2 === 0 ? { zone_id: { type: "string", description: "Zone identifier", maxLength: 32 } } : {}),
    ...(method === "GET"
      ? {
          page: { type: "integer", description: "Page number of paginated results", minimum: 1 },
          per_page: { type: "integer", description: "Number of results per page", minimum: 5, maximum: 1000 },
          order: { type: "string", enum: ["id", "name", "created_on", "modified_on"], description: "Sort field" },
          direction: { type: "string", enum: ["asc", "desc"], description: "Sort direction" },
          match: { type: "string", enum: ["any", "all"], description: "Whether to match all or any filter" },
        }
      : {}),
    ...(method === "POST" || method === "PUT" || method === "PATCH" ? { body: body(index) } : {}),
    ...(method !== "POST" && method !== "GET" ? { identifier: { type: "string", description: "Resource id" } } : {}),
  },
  required: ["account_id"],
})

const output: JsonSchema.JsonSchema = {
  type: "object",
  properties: {
    success: { type: "boolean" },
    errors: {
      type: "array",
      items: { type: "object", properties: { code: { type: "integer" }, message: { type: "string" } } },
    },
    messages: {
      type: "array",
      items: { type: "object", properties: { code: { type: "integer" }, message: { type: "string" } } },
    },
    result: { description: "Operation result" },
    result_info: {
      type: "object",
      properties: {
        page: { type: "integer" },
        per_page: { type: "integer" },
        count: { type: "integer" },
        total_count: { type: "integer" },
      },
    },
  },
}

const synthetic = (index: number) => {
  const method = methods[index % methods.length]!
  const resource = resources[index % resources.length]!
  const child = resources[(index * 7 + 3) % resources.length]!
  const single = method !== "GET" && method !== "POST"
  const route = `/accounts/{account_id}/${resource}/${index}/${child}${single ? "/{identifier}" : ""}`
  const verb =
    method === "GET"
      ? "get"
      : method === "POST"
        ? "post"
        : method === "PUT"
          ? "put"
          : method === "PATCH"
            ? "patch"
            : "delete"
  return {
    name: `${verb}_${resource}_${index}_${child}`,
    description: `${method} ${route}`,
    input: input(method, index),
  }
}

const bytes = new TextEncoder()
const registryLayer = AppNodeBuilder.build(Tool.node, [
  Image.node.replace(Layer.mock(Image.Service, { normalize: (_, content) => Effect.succeed(content) })),
])

const program = Effect.gen(function* () {
  const registry = yield* Tool.Service
  const inventory = Array.from({ length: toolCount }, (_, index) => synthetic(index))
  const schemaBytes = inventory.reduce(
    (total, tool) => total + bytes.encode(JSON.stringify(tool.input)).length + bytes.encode(tool.description).length,
    0,
  )
  // Mirrors `McpTool` registration: one namespace, Code Mode enabled, JSON schema input and output.
  yield* registry.transform((draft) => {
    draft.namespace({ name: "cloudflare-api", description: "Cloudflare REST API" })
    for (const tool of inventory) {
      draft.add({
        name: tool.name,
        options: { namespace: "cloudflare-api", codemode: true },
        description: tool.description,
        input: { ...tool.input, type: "object", additionalProperties: false },
        output,
        execute: () => Effect.succeed({ output: null, content: "" }),
      })
    }
    for (const name of ["read", "edit", "write", "shell", "glob", "grep"]) {
      draft.add({
        name,
        options: { codemode: false },
        description: `Built-in ${name} tool`,
        input: { type: "object", properties: { path: { type: "string" } }, additionalProperties: false },
        execute: () => Effect.succeed({ output: undefined, content: "" }),
      })
    }
  })

  const step = (index: number) =>
    Effect.gen(function* () {
      const started = performance.now()
      const rules: Permission.Ruleset =
        churn === "none"
          ? []
          : [
              {
                action:
                  churn === "membership"
                    ? `cloudflare-api_${inventory[index % inventory.length]!.name}`
                    : "cloudflare-api_*",
                resource: churn === "membership" ? "*" : `project-${index}`,
                effect: "deny",
              },
            ]
      const snapshot = yield* registry.snapshot(rules)
      const snapshotMs = performance.now() - started
      const instructions = CodeModeInstructions.make(snapshot.codeModeCatalog)
      return { definitions: snapshot.definitions.length, instructions, snapshotMs, catalog: snapshot.codeModeCatalog }
    })

  const samples: Array<{ ms: number; snapshotMs: number; heapGrowth: number }> = []
  const catalogs = new WeakSet<object>()
  let rendered = 0
  let definitions = 0
  Bun.gc(true)
  Bun.gc(true)
  const retainedBefore = process.memoryUsage().heapUsed
  for (let index = 0; index < iterations; index++) {
    Bun.gc(true)
    Bun.gc(true)
    const before = heapStats().heapSize
    const started = performance.now()
    const result = yield* step(index)
    const ms = performance.now() - started
    const heapGrowth = heapStats().heapSize - before
    if (result.catalog && !catalogs.has(result.catalog)) {
      catalogs.add(result.catalog)
      rendered++
    }
    definitions = result.definitions
    samples.push({ ms, snapshotMs: result.snapshotMs, heapGrowth })
  }
  Bun.gc(true)
  Bun.gc(true)
  const retained = process.memoryUsage().heapUsed
  return { samples, definitions, schemaBytes, retainedBefore, retained, rendered }
}).pipe(Effect.scoped, Effect.provide(registryLayer), Effect.provide(Logger.layer([])))

const result = await Effect.runPromise(program)

const sorted = (values: ReadonlyArray<number>) => values.toSorted((a, b) => a - b)
const percentile = (values: ReadonlyArray<number>, value: number) => {
  const list = sorted(values)
  return list[Math.min(Math.ceil(list.length * value) - 1, list.length - 1)] ?? 0
}
const mib = (value: number) => (value / 1024 / 1024).toFixed(2)
const times = result.samples.map((sample) => sample.ms)
const growth = result.samples.map((sample) => sample.heapGrowth)
const warm = result.samples.slice(1)

console.log(
  `tools ${toolCount} (input schema + description bytes ${mib(result.schemaBytes)} MiB), direct definitions ${result.definitions}`,
)
console.log(`snapshot + instructions per step, ${iterations} iterations`)
console.log(`  churn ${churn}, distinct catalog instances ${result.rendered}`)
console.log(
  `  first    ${times[0]!.toFixed(1)} ms (snapshot ${result.samples[0]!.snapshotMs.toFixed(1)} ms), heap growth ${mib(growth[0]!)} MiB`,
)
console.log(
  `  warm     p50 ${percentile(
    warm.map((sample) => sample.ms),
    0.5,
  ).toFixed(1)} ms, p95 ${percentile(
    warm.map((sample) => sample.ms),
    0.95,
  ).toFixed(1)} ms, max ${Math.max(...warm.map((sample) => sample.ms)).toFixed(1)} ms`,
)
console.log(
  `  warm     snapshot only p50 ${percentile(
    warm.map((sample) => sample.snapshotMs),
    0.5,
  ).toFixed(1)} ms, p95 ${percentile(
    warm.map((sample) => sample.snapshotMs),
    0.95,
  ).toFixed(1)} ms`,
)
console.log(
  `  warm     heap growth p50 ${mib(
    percentile(
      warm.map((sample) => sample.heapGrowth),
      0.5,
    ),
  )} MiB, p95 ${mib(
    percentile(
      warm.map((sample) => sample.heapGrowth),
      0.95,
    ),
  )} MiB`,
)
console.log(`  retained heapUsed after forced GC ${mib(result.retained)} MiB`)
console.log(
  `  retained heapUsed before snapshots ${mib(result.retainedBefore)} MiB, delta ${mib(result.retained - result.retainedBefore)} MiB`,
)

if (jsonPath) {
  await fs.mkdir(path.dirname(jsonPath), { recursive: true })
  await fs.writeFile(
    jsonPath,
    JSON.stringify(
      { revision: process.env.OPENCODE_BENCH_REVISION, bun: Bun.version, toolCount, iterations, churn, ...result },
      null,
      2,
    ),
  )
}
