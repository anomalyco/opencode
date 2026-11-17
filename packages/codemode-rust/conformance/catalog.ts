#!/usr/bin/env bun

// Regenerates conformance/catalog.json from the reference CodeMode: a set of tools as JSON Schema documents, and what
// the reference makes of them: the catalog with its generated signatures, `searchSignature`, `toolExpression`, and
// the results of programs that search, call unknown tools, and pass invalid input.
// Usage: bun conformance/catalog.ts [reference] — the reference CodeMode package directory, from the argument,
// CODEMODE_REF, or by default ../codemode relative to this workspace.
//
// Effect Schema tools are written out as the JSON Schema document the reference renders them from (with
// `validated: true`); the Rust side declares them with `Schema::validated`.

import { writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const override = process.argv[2] ?? process.env.CODEMODE_REF
const pkg = override === undefined ? resolve(import.meta.dir, "../../codemode") : resolve(override)
const { Effect, Schema } = await import(Bun.resolveSync("effect", join(pkg, "src")))
const { CodeMode, Namespace, Tool, searchSignature, toolExpression } = await import(join(pkg, "src/index.ts"))

type Spec = {
  path: string
  description: string
  input: unknown
  output?: unknown
  freeform?: boolean
  result?: unknown
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

const json: Array<Spec> = [
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
]

const outcome = async (code: string) => {
  const result = await Effect.runPromise(runtime.execute(code))
  return result.ok
    ? { ok: true, value: result.value, toolCalls: result.toolCalls.length }
    : { ok: false, error: result.error, toolCalls: result.toolCalls.length }
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
}
writeFileSync(join(import.meta.dir, "catalog.json"), JSON.stringify(expected, null, 2) + "\n")
console.log(`${expected.catalog.length} tools, ${expected.programs.length} programs`)
