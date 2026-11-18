#!/usr/bin/env bun

// Regenerates conformance/catalog.json from the reference CodeMode: a set of tools as JSON Schema documents, and what
// the reference makes of them: the catalog with its generated signatures, `searchSignature`, `toolExpression`, and
// the results of programs that search, call unknown tools, and pass invalid input.
// Usage: bun conformance/catalog.ts [reference] — the reference CodeMode package directory, from the argument,
// CODEMODE_REF, or by default ../codemode relative to this workspace.
//
// Effect Schema tools are written out as the JSON Schema document the reference renders them from (with
// `validated: true`); the Rust side declares them with `Schema::validated`.

import { join, resolve } from "node:path"
import { writeRecording } from "./recording.ts"

const override = process.argv[2] ?? process.env.CODEMODE_REF
const pkg = override === undefined ? resolve(import.meta.dir, "../../codemode") : resolve(override)
const { Effect, Schema } = await import(Bun.resolveSync("effect", join(pkg, "src")))
const { CodeMode, Extension, Namespace, OpenAPI, Tool, searchSignature, toolExpression } = await import(
  join(pkg, "src/index.ts")
)
const { Layer } = await import(Bun.resolveSync("effect", join(pkg, "src")))
const { HttpClient, HttpClientRequest, HttpClientResponse } = await import(Bun.resolveSync("effect/http", join(pkg, "src")))
const { cases } = await import("./openapi-specs.ts")

type Spec = {
  path: string
  description: string
  input: unknown
  output?: unknown
  freeform?: boolean
  result?: unknown
  /** The input as JSON text, whose key order JavaScript changes when it parses it: integer-like keys first. */
  inputText?: string
}

const document = (schema: unknown, decoded = false) => {
  const doc = Schema.toJsonSchemaDocument(decoded ? Schema.toType(schema) : schema, { onExcessProperty: "error" })
  const defs = doc.definitions as Record<string, unknown>
  return Object.keys(defs).length === 0 ? doc.schema : { ...doc.schema, $defs: defs }
}

const User = Schema.Struct({ login: Schema.String, id: Schema.Number }).annotate({ identifier: "User" })
const effect = {
  "orders.lookup": {
    description: "Look up an order by ID",
    input: Schema.Struct({ id: Schema.String }),
    output: Schema.Struct({ id: Schema.String, status: Schema.String }),
  },
  "orders.list": {
    description: "List orders, newest first",
    input: Schema.Struct({
      status: Schema.optionalKey(Schema.Literals(["open", "closed"])).annotate({ description: "Filter by status" }),
      limit: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(100))),
      cursor: Schema.optional(Schema.String),
    }),
    output: Schema.Array(Schema.Struct({ id: Schema.String, total: Schema.Number })),
  },
  "users.get": {
    description: "Get a user and the users they follow",
    input: Schema.Struct({ login: Schema.String.annotate({ description: "GitHub login\n\nCase-insensitive." }) }),
    output: Schema.Struct({ user: User, follows: Schema.Array(User), tags: Schema.Record(Schema.String, Schema.Number) }),
  },
  "net.ping": {
    description: "Ping a host",
    input: Schema.Struct({ host: Schema.String }),
    output: undefined,
  },
  "util.now": {
    description: "The current time",
    input: Schema.Struct({}),
    output: Schema.NullOr(Schema.String),
  },
  fetchPage: {
    description: "Fetch a page",
    input: Schema.Struct({ url: Schema.String.annotate({ description: "Page URL" }) }),
    output: Schema.String,
    freeform: true,
  },
  "context7.resolve-library-id": {
    description: "Resolve a library ID",
    input: Schema.Struct({ libraryName: Schema.String }),
    output: Schema.String,
  },
}

const integerKeys = `{"type":"object","properties":{"b":{"type":"string"},"10":{"type":"number"},"2":{"type":"boolean","description":"Two"},"a":{"type":"object","properties":{"z":{"type":"string"},"0":{"type":"string"},"01":{"type":"string"},"4294967295":{"type":"null"},"4294967294":{"type":"null"}}}},"required":["10","b"]}`
const json: Array<Spec> = [
  {
    path: "keys.ordered",
    description: "Integer-like property names, rendered in JavaScript key order",
    input: JSON.parse(integerKeys),
    inputText: integerKeys,
  },
  {
    path: "adapter.call",
    description: "Call an adapter-described tool",
    input: { type: "object", properties: { id: { type: "string" }, count: { type: "number" } }, required: ["id"] },
  },
  {
    path: "files.upload",
    description: "Send a document to the workspace",
    input: {
      type: "object",
      properties: { attachment: { type: "string", description: "Local path of the payload to send" } },
      required: ["attachment"],
    },
    output: { type: "object", properties: { sent: { type: "boolean" } }, required: ["sent"] },
  },
  {
    path: "files.patch",
    description: "Apply a patch",
    input: {
      type: "object",
      properties: { patchText: { type: "string", description: "The full patch text, */ included", minLength: 1 } },
      required: ["patchText"],
    },
    freeform: true,
  },
  {
    path: "search.advanced",
    description: "Every keyword the renderer knows",
    input: {
      type: "object",
      $defs: { Tag: { type: "string", enum: ["a", "b"], description: "A tag" } },
      properties: {
        when: { type: "string", format: "date-time", default: "now", deprecated: true },
        count: { type: "integer", minimum: 1, maximum: 10, multipleOf: 2 },
        ratio: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 1 },
        name: { type: "string", minLength: 1, maxLength: 64, pattern: "^[a-z]+$" },
        tags: { type: "array", items: { $ref: "#/$defs/Tag" }, minItems: 1, maxItems: 5, uniqueItems: true },
        either: { anyOf: [{ type: "string" }, { type: "number" }, { type: "null" }] },
        one: { oneOf: [{ const: 1 }, { const: "one" }] },
        both: { allOf: [{ type: "object", properties: { a: { type: "string" } } }, { type: "object", properties: { b: { type: "number" } } }] },
        multi: { type: ["string", "null"] },
        map: { type: "object", additionalProperties: { type: "number", description: "A count" } },
        mixed: { type: "object", properties: { k: { type: "string" } }, additionalProperties: { type: "boolean" } },
        "kebab-key": { type: "boolean" },
        nested: {
          type: "object",
          description:
            "A deeply nested value whose documentation is long enough that it cannot fit on the same line as its tags at all",
          properties: { deeper: { type: "object", properties: { deepest: { type: "array", items: { type: "object", properties: { x: { type: "number" } } } } } } },
        },
        anything: {},
        missing: { $ref: "#/$defs/Missing" },
      },
      required: ["count", "kebab-key"],
    },
    output: { $ref: "#/definitions/Out", definitions: { Out: { type: "object", properties: { ok: { type: "boolean" } } } } },
  },
  {
    path: "issues",
    description: "All issues",
    input: { type: "object" },
    output: { type: "string" },
  },
  { path: "issues.list", description: "List issues", input: { type: "object" }, output: { type: "string" } },
  { path: "issues.archive", description: "Archive an issue", input: { type: "object" }, output: { type: "string" } },
  { path: "issues.create", description: "Create an issue", input: { type: "object" }, output: { type: "string" } },
  { path: "issues.get", description: "Get one issue", input: { type: "object" }, output: { type: "string" } },
  { path: "issues.close", description: "Close an issue", input: { type: "object" }, output: { type: "string" } },
  ...[
    ["gmail.list_labels", "List the labels in the mailbox"],
    ["gmail.list_messages", "List messages"],
    ["slack.list_channels", "List channels"],
    ["slack.list_users", "List users"],
    ["slack.list_user_groups", "List user groups"],
    ["slack.get_schedules", "Get scheduled messages"],
    ["slack.admin.users.list", "List workspace administrators"],
    ["cloud.describe_vm", "Describe a virtual machine"],
    ["cloud.list_all_issues", "List issues"],
    ["cloudflare.get_timezones", "List timezones"],
    ["cloudflare.get_zones", "List zones"],
    ["tracker.fetch_all", "Fetch every open issue in the project"],
    ["k8s.getCronJob", "Read a CronJob in the cluster"],
    ["mail.send", "Send an email"],
    ["mail.archive", "Archive a thread"],
    ["thread.uploadFile", "Upload one readable local file to the current Discord thread"],
    ["thread.generateImage", "Generate an image and upload it to the current Discord thread"],
    ["unicode.émoji", "Résumé café naïve 🎉 tools"],
  ].map(([path, description]) => ({ path, description, input: { type: "object" }, output: { type: "string" } })),
]

const namespaces: Array<{ path: string; description: string }> = [
  { path: "orders", description: "Purchases, fulfillment, and shipment tracking" },
  { path: "slack.admin", description: "Directory and account administration" },
]

const specs: Array<Spec> = [
  ...Object.entries(effect).map(([path, t]) => ({
    path,
    description: t.description,
    input: { validated: true, schema: document(t.input) },
    ...(t.output === undefined ? {} : { output: { validated: true, schema: document(t.output, true) } }),
    ...("freeform" in t ? { freeform: true } : {}),
  })),
  ...json.map((t) => ({
    ...t,
    input: { validated: false, schema: t.input },
    ...(t.output === undefined ? {} : { output: { validated: false, schema: t.output } }),
  })),
]

// The reference tools: Effect Schema ones as declared, JSON Schema ones as given. Each returns a fixed value.
const tools: Record<string, unknown> = {}
const results: Record<string, unknown> = {
  "orders.lookup": { id: "o1", status: "open" },
  "orders.list": [{ id: "o1", total: 3 }],
  "util.now": null,
  fetchPage: "page",
  "context7.resolve-library-id": "/lib",
}
for (const [path, t] of Object.entries(effect)) {
  tools[path] = Tool.make({ ...t, execute: (input: unknown) => Effect.succeed(path in results ? results[path] : input) })
}
for (const t of json) {
  tools[t.path] = Tool.make({ ...t, execute: (input: unknown) => Effect.succeed(t.path in results ? results[t.path] : input) })
}
// Each described namespace wraps its tools in `Namespace.make`, in the place its first tool had.
const nested: Record<string, unknown> = {}
for (const [path, tool] of Object.entries(tools)) {
  const ns = namespaces.find((n) => path.startsWith(`${n.path}.`))
  if (ns === undefined) {
    nested[path] = tool
    continue
  }
  if (nested[ns.path] !== undefined) continue
  const under = Object.keys(tools).filter((p) => p.startsWith(`${ns.path}.`))
  nested[ns.path] = Namespace.make({
    description: ns.description,
    tools: Object.fromEntries(under.map((p) => [p.slice(ns.path.length + 1), tools[p]])),
  })
}
const runtime = CodeMode.make({ tools: nested })

const programs = [
  ...[
    `search({})`,
    `search({ limit: 3 })`,
    `search({ limit: 2, offset: 4 })`,
    `search({ offset: 100 })`,
    `search("issues")`,
    `search("users")`,
    `search({ query: "users", namespace: "slack" })`,
    `search({ query: "", namespace: "slack.admin" })`,
    `search({ query: "", namespace: "tools.issues" })`,
    `search({ query: "account administration" })`,
    `search({ query: "purchases" })`,
    `search({ query: "list gmail labels" })`,
    `search({ query: "schedu" })`,
    `search({ query: "vms" })`,
    `search({ query: "all" })`,
    `search({ query: "zones" })`,
    `search({ query: "cronjob" })`,
    `search({ query: "attachment" })`,
    `search({ query: "docum" })`,
    `search({ query: "email" })`,
    `search({ query: "archive thread" })`,
    `search({ query: "send message attachment upload file to current Discord thread", limit: 2 })`,
    `search({ query: "resume cafe" })`,
    `search({ query: "tools.orders.lookup" })`,
    `search({ query: "orders.lookup" })`,
    `search({ query: 'tools.context7["resolve-library-id"]' })`,
    `search({ query: "issues", namespace: "tracker" })`,
    `search({ query: "labels", namespace: "slack" })`,
    `search({ query: "  order  " })`,
    `search({ query: "order", limit: 0.5 })`,
    `search({ query: "order", offset: -1 })`,
    `search({ query: "order", namespace: 7 })`,
    `search(42)`,
    `search("notes", {})`,
    `tools.search({ query: "order" })`,
  ].map((call) => `return ${call}`),
  `return await tools.issues.missing({})`,
  `return await tools.issues["get-list"]({})`,
  `return await tools.orders({})`,
  `return await tools.slack({})`,
  `return await tools.nothing.here({})`,
  `return await tools.orders.lookup({ id: 1 })`,
  `return await tools.orders.lookup({})`,
  `return await tools.orders.lookup("o1")`,
  `return await tools.orders.lookup({ id: "o1" }, {})`,
  `return await tools.orders.lookup({ id: "o1", extra: true })`,
  `return await tools.orders.list({ status: "pending" })`,
  `return await tools.orders.list({ limit: 0 })`,
  `return await tools.orders.list({ limit: 1.5 })`,
  `return await tools.orders.list({ status: "open", limit: 5, extra: 1 })`,
  `return await tools.fetchPage("https://a.test/")`,
  `return await tools.net.ping({ host: "a" })`,
  `return await tools.util.now()`,
  `return await tools.context7["resolve-library-id"]({ libraryName: "ts" })`,
  `return await tools.adapter.call({ id: 42 })`,
  `return [Object.keys(tools), Object.keys(tools.slack), Object.keys(tools.issues)]`,
  `Promise.reject(new Error("x")); return 1`,
  `const p = Promise.reject(1); await null; p.catch(() => 0); return 2`,
  `tools.orders.lookup({ id: 1 }); return 3`,
  `async function f() { throw new TypeError("bad") }\nf(); f(); return 4`,
  `tools.orders.lookup({ id: "o" }); return 5`,
  `Promise.reject("plain"); Promise.reject({ a: [1] }); return 6`,
  `Promise.reject(new Error("unseen")); throw new Error("seen")`,
  `async function g() { null.x }\ng(); return 7`,
  `tools.issues.missing({}); return 8`,
]

const outcome = async (code: string) => {
  const result = await Effect.runPromise(runtime.execute(code))
  return result.ok
    ? {
        ok: true,
        value: result.value,
        toolCalls: result.toolCalls.length,
        ...(result.warnings === undefined ? {} : { warnings: result.warnings }),
      }
    : { ok: false, error: result.error, toolCalls: result.toolCalls.length }
}

// OpenAPI: each case's generated tools under `api`, what was skipped, and its calls through a recording client.
const sorted = (record: Record<string, string>) =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))

const openapi: Array<unknown> = []
for (const item of cases(pkg)) {
  openapi.push(await (async () => {
    let resolutions: Array<unknown> = []
    const spec = item.specText === undefined ? item.spec : JSON.parse(item.specText)
    const build = () =>
      OpenAPI.fromSpec({
        spec,
        ...(item.baseUrl === undefined ? {} : { baseUrl: item.baseUrl }),
        ...(item.headers === undefined ? {} : { headers: item.headers }),
        auth: {
          resolve: (context: { name: string }) => {
            resolutions.push(JSON.parse(JSON.stringify(context)))
            return Effect.succeed(item.auth?.[context.name])
          },
        },
      })
    let api
    try {
      api = build()
    } catch (error) {
      return { name: item.name, spec, specText: item.specText ?? null, baseUrl: item.baseUrl ?? null, error: String((error as Error).message) }
    }
    const runtime = CodeMode.make({ tools: { api: api.tools } })
    const schemas: Array<unknown> = []
    const walk = (node: Record<string, unknown>, prefix: string) => {
      for (const [name, value] of Object.entries(node)) {
        const path = prefix === "" ? name : `${prefix}.${name}`
        if (Tool.isTool(value)) schemas.push({ path, input: value.input, output: value.output ?? null })
        else walk(value as Record<string, unknown>, path)
      }
    }
    walk(api.tools, "")
    schemas.sort((a: any, b: any) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    const calls = []
    for (const call of item.calls ?? []) {
      resolutions = []
      const requests: Array<unknown> = []
      const reply = call.reply ?? {}
      const layer = Layer.succeed(HttpClient.HttpClient)(
        HttpClient.make((request: any) =>
          Effect.sync(() => {
            const body =
              request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : null
            requests.push({
              method: request.method,
              url: HttpClientRequest.toUrl(request).pipe((o: any) => (o._tag === "Some" ? o.value.toString() : request.url)),
              // Tracing and framing headers come from Effect's client, not from the OpenAPI tools.
              headers: sorted(
                Object.fromEntries(
                  Object.entries(request.headers).filter(
                    ([name]) => !["b3", "traceparent", "content-length"].includes(name),
                  ),
                ) as Record<string, string>,
              ),
              body,
            })
            const headers: Record<string, string> = {}
            if (reply.contentType !== undefined) headers["content-type"] = reply.contentType
            if (reply.contentLength !== undefined) headers["content-length"] = reply.contentLength
            return HttpClientResponse.fromWeb(
              request,
              new Response(reply.body ?? null, { status: reply.status ?? 200, headers }),
            )
          }),
        ),
      )
      const code = `return await ${toolExpression(`api.${call.tool}`)}(${JSON.stringify(call.input)})`
      const result = await Effect.runPromise(runtime.execute(code).pipe(Effect.provide(layer)))
      calls.push({
        ...call,
        outcome: result.ok
          ? { ok: true, value: result.value }
          : { ok: false, kind: result.error.kind, message: result.error.message },
        requests,
        resolutions,
      })
    }
    return {
      name: item.name,
      spec,
      specText: item.specText ?? null,
      baseUrl: item.baseUrl ?? null,
      auth: item.auth ?? {},
      headers: item.headers ?? {},
      catalog:
        item.render === false
          ? null
          : runtime.catalog.map((tool: { path: string; description: string; signature: string }) => ({
              path: tool.path,
              description: tool.description,
              signature: tool.signature,
            })),
      schemas,
      skipped: api.skipped,
      calls,
    }
  })())
}

// Extension boundary: host values of every type crossing into programs and program values crossing out, described as
// data. `make(kind)` hands the program one of `samples`; `keep(value)` records what the host received and returns it.
const describe = (v: unknown): unknown => {
  if (v === undefined) return { undefined: true }
  if (typeof v === "number" && !Number.isFinite(v)) return { number: String(v) }
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v
  if (typeof v === "function") return { function: v.name }
  if (v instanceof Date) return { date: Number.isNaN(v.getTime()) ? "NaN" : v.getTime() }
  if (v instanceof RegExp) return { regexp: [v.source, v.flags] }
  if (v instanceof URL) return { url: v.href }
  if (v instanceof URLSearchParams) return { params: [...v] }
  if (v instanceof Headers) return { headers: [...v] }
  if (Buffer.isBuffer(v)) return { buffer: [...v] }
  if (v instanceof Uint8Array) return { bytes: [...v] }
  if (v instanceof ArrayBuffer) return { arrayBuffer: [...new Uint8Array(v)] }
  if (v instanceof Map) return { map: [...v].map(([k, x]) => [describe(k), describe(x)]) }
  if (v instanceof Set) return { set: [...v].map(describe) }
  if (Array.isArray(v)) return { array: Array.from({ length: v.length }, (_, i) => (i in v ? describe(v[i]) : { hole: true })) }
  if (v instanceof Error) {
    const fields = v as unknown as Record<string, unknown>
    return {
      error: {
        name: v.name,
        message: v.message,
        ...("cause" in v ? { cause: describe(v.cause) } : {}),
        fields: Object.keys(v).map((k) => [k, describe(fields[k])]),
      },
    }
  }
  return { object: Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, describe(x)]) }
}
const samples: Record<string, unknown> = {
  date: new Date(0),
  invalidDate: new Date(Number.NaN),
  regexp: /a+\/b/gi,
  url: new URL("https://user@a.test:8080/p a?q=1&r=%20#h"),
  params: new URLSearchParams("a=1&b=2&a=3"),
  headers: new Headers([["X-B", "2"], ["x-a", "1"], ["X-A", " 3 "]]),
  bytes: new Uint8Array([1, 2, 3]),
  buffer: Buffer.from("hi"),
  arrayBuffer: new Uint8Array([4, 5]).buffer,
  nested: {
    when: new Date(1e12),
    links: [new URL("https://b.test/x")],
    table: new Map<unknown, unknown>([[new Date(5), new Headers({ k: "v" })]]),
    tags: new Set([new Uint8Array([9])]),
    failure: Object.assign(new RangeError("bad", { cause: new Date(7) }), { at: new URL("https://c.test/") }),
  },
}
const boundaryPrograms = [
  `const o = { n: 1, list: [1], d: new Date(0), u: new URL("https://a.test/") }; keep(o); o.n = 2; o.list.push(2); return o.n`,
  `const h = make("headers"); h.set("x-a", "2"); const back = keep(h); back.set("x-a", "3"); return [h instanceof Headers, h.get("x-a"), back === h, back.get("x-a"), [...back], [...make("headers")]]`,
  `const b = make("bytes"); b[0] = 42; const mine = new Uint8Array([5]); const name = kind(mine); return [[...b], [...make("bytes")], [...make("arrayBuffer")], b instanceof Uint8Array, name, mine[0], kind(make("arrayBuffer"))]`,
  `const d = make("date"); return [d instanceof Date, d.getTime(), d.toISOString(), make("invalidDate").getTime(), keep(new Date(86400000)).getTime(), keep(new Date(NaN)).getTime()]`,
  `const r = make("regexp"); return [r instanceof RegExp, r.source, r.flags, r.test("aa/b"), keep(/x(y)\\//m).source]`,
  `const u = make("url"); return [u instanceof URL, u.href, u.pathname, u.port, u.searchParams.get("r"), keep(u).href, keep(u.searchParams).toString()]`,
  `const p = make("params"); return [p instanceof URLSearchParams, p.getAll("a"), p.toString(), keep(new URLSearchParams("x=1&x=2")).toString()]`,
  `const b = make("buffer"); return [Buffer.isBuffer(b), b.toString(), keep(Buffer.from("yo")).length, keep(new Uint8Array([7]))[0], kind(Buffer.from("z")), kind(new Uint8Array(1))]`,
  `return make("nested")`,
  `const n = make("nested"); return [n.when instanceof Date, n.links[0].host, [...n.table.keys()][0].getTime(), [...n.table.values()][0].get("k"), [...[...n.tags][0]], n.failure instanceof RangeError, n.failure.cause.getTime(), n.failure.at.href]`,
  `keep(make("nested")); return 1`,
  `keep(new Map([[new Date(1), new Set([new URL("https://m.test/")])]])); return 1`,
  `keep([new Headers({ "X-Y": "1" }), new URLSearchParams("z=9"), /q/]); return 1`,
  `function f() { return keep(arguments) }\nf(1, "two"); keep(new WeakMap()); keep(new TextDecoder()); return 1`,
  `try { keep((function* () {})()) } catch (e) { return e.message }`,
  `try { keep(new Map().entries()) } catch (e) { return e.message }`,
  `try { keep({ p: Promise.resolve(1) }) } catch (e) { return e.message }`,
  `return JSON.stringify([make("date"), make("url"), make("params"), make("headers"), make("bytes"), make("buffer"), make("regexp")])`,
]
const probe = (kept: Array<unknown>) =>
  Extension.make({
    name: "probe",
    globals: {
      keep: (value: unknown) => {
        kept.push(describe(value))
        return value
      },
      make: (name: string) => samples[name],
      kind: (value: unknown) => (value as { constructor: { name: string } }).constructor.name,
    },
  })
const boundary = {
  samples: Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, describe(v)])),
  programs: [] as Array<unknown>,
}
for (const code of boundaryPrograms) {
  const kept: Array<unknown> = []
  const result = await Effect.runPromise(CodeMode.make({ extensions: [probe(kept)] }).execute(code))
  boundary.programs.push({
    code,
    outcome: result.ok
      ? { ok: true, value: result.value }
      : { ok: false, kind: result.error.kind, message: result.error.message },
    kept,
  })
}

const expected = {
  tools: specs,
  namespaces,
  catalog: runtime.catalog.map((tool: { path: string; description: string; signature: string }) => ({
    path: tool.path,
    description: tool.description,
    signature: tool.signature,
  })),
  searchSignature,
  expressions: ["a", "a.b", "context7.resolve-library-id", "x.1st", "$ok._fine", "naïve"].map((path) => [
    path,
    toolExpression(path),
  ]),
  programs: await Promise.all(programs.map(async (code) => ({ code, ...(await outcome(code)) }))),
  openapi,
  boundary,
}
writeRecording(join(import.meta.dir, "catalog.json"), expected)
console.log(
  `${expected.catalog.length} tools, ${expected.programs.length} programs, ${openapi.length} OpenAPI documents`,
)
