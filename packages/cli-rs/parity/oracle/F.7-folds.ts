// P-ORACLE for the event fold of crates/store (models step 7, O-91, O-92 Q6 (a)): runs every V2Event variant
// through TypeScript's createData, once on an empty store and once on a loaded one, and records what the store holds
// afterwards and which reads the event started. Writes parity/fixtures/F.7/folds.json; crates/store/tests/
// fold_oracle.rs folds the same events with `Data::apply` against the same routes and compares field by field.
//
// Each event is sampled from its schema in packages/protocol/openapi.json, so a new variant is covered when the
// fixture is regenerated, then given the IDs of the loaded state. A difference that is a recorded deviation is
// listed in `allow` below with its deviation file; any other difference fails the Rust test.
//
// The TUI uses Solid's browser build, whose effects and stores react; the script runs itself again under
// `bun --conditions=browser` when started without it.
import type { CreateDataInput } from "@opencode/client/solid"
import type { OpenCodeEvent, SessionMessageInfo } from "@opencode/client/promise"

if (process.env.F7_BROWSER !== "1") {
  const proc = Bun.spawnSync(["bun", "--conditions=browser", "run", import.meta.path], {
    env: { ...process.env, F7_BROWSER: "1" },
    stdout: "inherit",
    stderr: "inherit",
  })
  process.exit(proc.exitCode ?? 1)
}

const { createRoot } = await import("solid-js")
const { createData } = await import("@opencode/client/solid")
const { OpenCode } = await import("@opencode/client/promise")

type Schema = Record<string, unknown> & {
  $ref?: string
  const?: unknown
  enum?: unknown[]
  anyOf?: Schema[]
  oneOf?: Schema[]
  allOf?: Schema[]
  type?: string
  properties?: Record<string, Schema>
  required?: string[]
  prefixItems?: Schema[]
  items?: Schema
  minItems?: number
  minimum?: number
  pattern?: string
  not?: Schema
}

// Differences that are recorded deviations: `case` is `<event>@<state>`, `field` a top-level observation field
// with its first key (`messages.ses_a`).
const allow: { case: string; field: string; deviation: string }[] = [
  { case: "server.connected@loaded", field: "requests", deviation: "D01a-store-core.md" },
  {
    case: "session.model.selected#no-previous@loaded",
    field: "messages.ses_a",
    deviation: "O89-model-switch-previous.md",
  },
]

const SESSIONS = ["ses_a", "ses_b"]
const DIRECTORY = "/project"
const location = { directory: DIRECTORY }

const openapi = await Bun.file(new URL("../../../protocol/openapi.json", import.meta.url)).json()
const schemas = openapi.components.schemas as Record<string, Schema>

// A minimal value of `schema`: required properties only, the first enum value and union branch.
function sample(schema: Schema): unknown {
  if (schema.$ref) return sample(schemas[schema.$ref.slice("#/components/schemas/".length)]!)
  if ("const" in schema) return schema.const
  if (schema.enum) return schema.enum[0]
  const union = schema.anyOf ?? schema.oneOf
  if (union) return sample(union.find((branch) => branch.type !== "null") ?? union[0]!)
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map(sample))
  if (schema.not) return {}
  if (schema.type === "object" || schema.properties)
    return Object.fromEntries((schema.required ?? []).map((key) => [key, sample(schema.properties![key]!)]))
  if (schema.type === "array") {
    if (!schema.minItems) return []
    return Array.from({ length: schema.minItems }, (_, index) => sample(schema.prefixItems?.[index] ?? schema.items!))
  }
  if (schema.type === "string") return text(schema.pattern)
  if (schema.type === "number" || schema.type === "integer") return schema.minimum ?? 0
  if (schema.type === "boolean") return false
  return {}
}

function text(pattern?: string) {
  if (!pattern) return "x"
  if (pattern.startsWith("^rpc")) return "rpc.x"
  const prefix = pattern.match(/^\^([a-z]+_?)(?:$|[^a-z_{[(])/)
  if (prefix) return prefix[1]!.endsWith("_") ? `${prefix[1]}x` : `${prefix[1]}_x`
  if (pattern.startsWith("^#")) return "#000000"
  if (pattern.includes("%")) return "50%"
  if (pattern.includes("\\d{4}")) return "2026-01"
  if (pattern.includes("{64}")) return "0".repeat(64)
  if (pattern.includes("(?:ms|s|m|h|d)")) return "1s"
  if (pattern.includes("[Ee]") && pattern.includes(":")) return "0:0"
  if (pattern.includes("[Ee]")) return "0"
  if (pattern.includes("\\/")) return "a/b"
  if (pattern.includes("[A-Za-z0-9+/]")) return ""
  return "a"
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

// Objects merge, everything else replaces, and so does an object of another union branch (`type`).
function merge(base: unknown, patch: unknown): unknown {
  if (!isObject(base) || !isObject(patch)) return patch
  if ("type" in patch && patch.type !== base.type) return patch
  const next: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) next[key] = key in base ? merge(base[key], value) : value
  return next
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// The loaded state, as the scripted server answers it.
const tokens = { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }
const sessionInfo = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  projectID: "project",
  agent: "build",
  model: { providerID: "p", id: "m" },
  title: `Title ${id}`,
  cost: 0.5,
  tokens,
  time: { created: 1, updated: 2 },
  location,
  ...extra,
})
const messages: SessionMessageInfo[] = [
  { id: "msg_0001", type: "user", text: "hello", time: { created: 10 } },
  {
    id: "msg_0002",
    type: "assistant",
    agent: "build",
    model: { providerID: "p", id: "m" },
    content: [{ type: "text", text: "done" }],
    time: { created: 11, completed: 12 },
  },
  { id: "msg_0003", type: "shell", shellID: "sh_1", command: "ls", status: "running", time: { created: 13 } },
  { id: "msg_0004", type: "compaction", status: "running", reason: "auto", summary: "sum", time: { created: 14 } },
  {
    id: "msg_0005",
    type: "assistant",
    agent: "build",
    model: { providerID: "p", id: "m" },
    content: [
      { type: "text", text: "hel" },
      { type: "reasoning", text: "th", time: { created: 15 } },
      { type: "tool", id: "call_1", name: "bash", state: { status: "streaming", input: "{" }, time: { created: 16 } },
      {
        type: "tool",
        id: "call_2",
        name: "read",
        state: { status: "running", input: { path: "a" }, metadata: {} },
        time: { created: 17, ran: 17 },
      },
    ],
    time: { created: 15 },
  },
]
const shell = {
  id: "sh_1",
  status: "running",
  command: "ls",
  cwd: DIRECTORY,
  shell: "bash",
  file: "/tmp/sh_1",
  metadata: { sessionID: "ses_a" },
  time: { started: 13 },
}
const credential = (id: string) => ({ type: "credential", id, label: id, method: "key" })
const listed = (data: unknown) => ({ status: 200, body: { location, data } })
const routes: Record<string, { status: number; body: unknown }> = {
  "/api/session/active": { status: 200, body: { data: {} } },
  "/api/location": { status: 200, body: { directory: DIRECTORY, project: { id: "project", directory: DIRECTORY, canonical: DIRECTORY } } },
  "/api/project": {
    status: 200,
    body: [{ id: "project", canonical: DIRECTORY, time: { created: 1, updated: 1, active: 1 }, sandboxes: [] }],
  },
  "/api/vcs": listed({ branch: { current: "main", default: "main" } }),
  "/api/session/ses_a": { status: 200, body: { data: sessionInfo("ses_a") } },
  "/api/session/ses_b": { status: 200, body: { data: sessionInfo("ses_b", { parentID: "ses_a" }) } },
  "/api/session/ses_a/message": {
    status: 200,
    body: { data: messages.toReversed(), cursor: { next: "msg_0001" } },
  },
  "/api/session/ses_a/permission": {
    status: 200,
    body: { data: [{ id: "per_1", sessionID: "ses_a", action: "bash", resources: [] }] },
  },
  "/api/session/ses_a/form": {
    status: 200,
    body: { data: [{ id: "frm_1", sessionID: "ses_a", title: "Ask", fields: [sample({ $ref: "#/components/schemas/Form.Field" })] }] },
  },
  "/api/session/ses_a/inbox": {
    status: 200,
    body: {
      data: [
        {
          id: "msg_0006",
          sessionID: "ses_a",
          time: { created: 18 },
          type: "user",
          delivery: "steer",
          payload: { text: "next" },
        },
      ],
    },
  },
  "/api/agent": listed([]),
  "/api/command": listed([]),
  "/api/config": { status: 200, body: [] },
  "/api/integration": listed([
    { id: "openai", name: "OpenAI", methods: [], connections: [credential("crd_1"), credential("crd_2")] },
  ]),
  "/api/mcp": listed([]),
  "/api/mcp/resource": { status: 200, body: { location, data: { resources: [], templates: [] } } },
  "/api/model": listed([]),
  "/api/provider": listed([]),
  "/api/reference": listed([]),
  "/api/skill": listed([]),
  "/api/shell": listed([shell]),
  "/api/form": listed([]),
  "/api/websearch/provider": listed([]),
  "/api/experimental/usage/limits": listed(null),
}

// Per event type: the IDs of the loaded state, and fields the minimal sample leaves out.
const overrides: Record<string, unknown> = {
  "credential.switched": { data: { integrationID: "openai", credentialID: "crd_2" } },
  "session.created": { data: { sessionID: "ses_b", info: sessionInfo("ses_b", { parentID: "ses_a" }) } },
  "session.agent.selected": { data: { agent: "plan", previous: "build" } },
  "session.model.selected": { data: { model: { providerID: "p", id: "n" }, previous: { providerID: "p", id: "m" } } },
  "session.moved": { data: { location: { directory: "/other" }, projectID: "other", subpath: "sub" } },
  "session.renamed": { data: { title: "Renamed" } },
  "session.metadata.updated": { data: { metadata: { key: "value" } } },
  "session.usage.updated": { data: { cost: 2, tokens: { ...tokens, input: 9 } } },
  "session.inbox.delivered": { data: { inboxID: "msg_0006" } },
  "session.inbox.enqueued": {
    data: { inboxID: "msg_0007", item: { type: "user", delivery: "queue", payload: { text: "queued" } } },
  },
  "session.inbox.cancelled": { data: { inboxID: "msg_0006" } },
  "session.inbox.delivery.changed": { data: { inboxID: "msg_0006", delivery: "queue" } },
  "session.instructions.updated": { data: { text: "Use tabs", delta: { "AGENTS.md": "Use tabs" } } },
  "session.synthetic": { data: { text: "note", description: "Note" } },
  "session.shell.started": { data: { shell: { ...shell, id: "sh_2", metadata: { sessionID: "ses_a" } } } },
  "session.shell.ended": {
    data: { shell: { ...shell, status: "exited", exit: 0 }, output: { output: "out", cursor: 3, size: 3, truncated: false } },
  },
  "session.step.started": { data: { assistantMessageID: "msg_0008", agent: "build", model: { providerID: "p", id: "m" }, started: 30 } },
  "session.step.ended": { data: { finish: "stop", cost: 1, tokens } },
  "session.step.failed": { data: { error: { type: "provider.error", message: "boom" } } },
  "session.text.delta": { data: { delta: "lo" } },
  "session.text.ended": { data: { text: "hello" } },
  "session.reasoning.delta": { data: { delta: "ink" } },
  "session.reasoning.ended": { data: { text: "think" } },
  "session.tool.input.started": { data: { id: "call_3", name: "edit" } },
  "session.tool.input.delta": { data: { id: "call_1", delta: "}" } },
  "session.tool.input.ended": { data: { id: "call_1", text: "{}" } },
  "session.tool.called": { data: { id: "call_1", input: { command: "ls" } } },
  "session.tool.progress": { data: { id: "call_2", metadata: { lines: 3 } } },
  "session.tool.success": { data: { id: "call_2", content: [{ type: "text", text: "ok" }], executed: true } },
  "session.tool.failed": { data: { id: "call_1", error: { type: "tool.error", message: "no" }, executed: false } },
  "session.retry.scheduled": { data: { attempt: 2, at: 99, error: { type: "provider.error", message: "busy" } } },
  "session.compaction.started": { data: { inputID: "msg_0009", reason: "manual" } },
  "session.compaction.delta": { data: { text: "mary" } },
  "session.compaction.ended": { data: { text: "summary", reason: "auto", cost: 1, tokens } },
  "session.compaction.failed": { data: { error: { type: "compaction.error", message: "no" }, reason: "auto" } },
  "session.revert.staged": { data: { revert: { messageID: "msg_0004" } } },
  "session.revert.committed": { data: { to: "msg_0004" } },
  "permission.asked": { data: { id: "per_2", action: "edit", resources: ["a"] } },
  "permission.replied": { data: { requestID: "per_1", reply: "once" } },
  "project.updated": { data: { id: "project", name: "Renamed", canonical: DIRECTORY } },
  "worktree.resolved": { data: { adopted: ["project"] } },
  "shell.created": { data: { info: { ...shell, id: "sh_3" } } },
  "shell.exited": { data: { id: "sh_1" } },
  "shell.deleted": { data: { id: "sh_1" } },
  "form.created": { data: { form: { id: "frm_2", sessionID: "ses_a", title: "Pick" } } },
  "form.replied": { data: { id: "frm_1" } },
  "form.cancelled": { data: { id: "frm_1" } },
}

// More cases for arms that branch on the event: name suffix, type, and the patch used instead of `overrides`.
const extra: [string, string, unknown][] = [
  ["shutdown", "session.execution.interrupted", { data: { reason: "shutdown" } }],
  ["budget", "session.step.failed", { data: { error: { type: "provider.budget-limit", message: "budget" } } }],
  ["existing", "session.step.started", { data: { assistantMessageID: "msg_0005", started: 31 } }],
  ["baseline", "session.instructions.updated", {}],
  // The server always names the previous model; an event without it reads the store's.
  ["no-previous", "session.model.selected", { data: { model: { providerID: "p", id: "n" } } }],
  ["compaction", "session.inbox.enqueued", { data: { inboxID: "msg_0010", item: { type: "compaction", delivery: "steer", payload: {} } } }],
  ["global", "form.created", { data: { form: { id: "frm_3", sessionID: "global", title: "Elicit" } } }],
]

// The variants in V2Event's order, each with its type name.
const variants = (schemas.V2Event!.anyOf ?? []).map((branch) => {
  const schema = schemas[branch.$ref!.slice("#/components/schemas/".length)]!
  const type = schema.properties!.type!
  return { type: type.enum ? String(type.enum[0]) : String(sample(type)), schema }
})

let serial = 0
function eventOf(variant: { type: string; schema: Schema }, patch: unknown) {
  serial++
  const base = sample(variant.schema) as Record<string, unknown>
  const data = isObject(base.data) ? base.data : {}
  const ids: Record<string, unknown> = {}
  if ("sessionID" in data) ids.sessionID = "ses_a"
  if ("assistantMessageID" in data) ids.assistantMessageID = "msg_0005"
  const common = {
    id: `evt_${String(9000 + serial)}`,
    created: 1000 + serial,
    ...(variant.schema.properties?.location ? { location } : {}),
    data: ids,
  }
  return merge(merge(base, common), patch) as OpenCodeEvent
}

const cases = [
  ...variants.map((variant) => ({ name: variant.type, event: eventOf(variant, overrides[variant.type] ?? {}) })),
  ...extra.map(([suffix, type, patch]) => ({
    name: `${type}#${suffix}`,
    event: eventOf(variants.find((variant) => variant.type === type)!, patch),
  })),
]

async function run(event: OpenCodeEvent, loaded: boolean) {
  const requests: string[] = []
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      const query = [...url.searchParams.entries()]
        .toSorted()
        .map(([key, value]) => `${key}=${value}`)
        .join("&")
      requests.push(`${request.method} ${url.pathname}${query ? `?${query}` : ""}`)
      const route = request.method === "GET" ? routes[url.pathname] : undefined
      if (!route) return new Response(`no route for ${request.method} ${url.pathname}`, { status: 599 })
      return Response.json(route.body, { status: route.status })
    },
  })
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: DIRECTORY,
      onError: () => {},
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
    }),
    dispose,
  }))
  const data = setup.data
  const apply = (event: OpenCodeEvent) => listeners.forEach((listener) => listener({ name: event.type, details: event }))
  const quiet = (promise: Promise<unknown>) => void promise.catch(() => {})
  const strip = (value: unknown) => JSON.parse(JSON.stringify(value ?? null)) as Json

  const observe = () => {
    const each = (read: (id: string) => unknown) =>
      Object.fromEntries(SESSIONS.flatMap((id) => (read(id) === undefined ? [] : [[id, read(id)]])))
    return strip({
      sessions: Object.fromEntries(data.session.list().map((info) => [info.id, info])),
      missing: SESSIONS.filter((id) => data.session.missing(id)),
      family: each((id) => data.session.family(id)),
      status: each((id) => data.session.status(id)),
      messages: each((id) => data.session.message.list(id)),
      more: each((id) => data.session.message.more(id)),
      pending: each((id) => data.session.pending.list(id)),
      permissions: each((id) => data.session.permission.list(id)),
      forms: { ...each((id) => data.session.form.list(id)), global: data.session.form.list("global", location) },
      projects: Object.fromEntries(data.project.list().map((project) => [project.id, project])),
      location: {
        info: data.location.info(location),
        vcs: data.location.vcs.info(location),
        agent: data.location.agent.list(location),
        command: data.location.command.list(location),
        config: data.location.config.list(location),
        integration: data.location.integration.list(location),
        mcpServer: data.location.mcp.server.list(location),
        mcpResource: data.location.mcp.resource.list(location),
        model: data.location.model.list(location),
        provider: data.location.provider.list(location),
        reference: data.location.reference.list(location),
        skill: data.location.skill.list(location),
        websearch: data.location.websearch.list(location),
        usageLimits: data.location.usage.limits(location),
        shell: data.shell.list(location),
      },
    })
  }
  // A fixed point: no request and no visible change for eight turns of the event loop.
  const settle = async () => {
    let last = ""
    let quietTurns = 0
    for (let i = 0; i < 10_000; i++) {
      await new Promise((resolve) => setImmediate(resolve))
      const key = JSON.stringify([requests.length, observe()])
      if (key === last) {
        if (++quietTurns === 8) return
        continue
      }
      quietTurns = 0
      last = key
    }
    throw new Error("no fixed point")
  }

  if (loaded) {
    apply({ id: "evt_connected", type: "server.connected", data: {} } as unknown as OpenCodeEvent)
    await settle()
    quiet(data.session.sync("ses_a"))
    quiet(data.session.message.sync("ses_a"))
    quiet(data.session.permission.sync("ses_a"))
    quiet(data.session.form.sync("ses_a"))
    quiet(data.session.pending.sync("ses_a"))
    quiet(data.location.sync())
    quiet(data.location.config.sync())
    quiet(data.location.usage.sync())
    quiet(data.location.websearch.refresh())
    await settle()
  }
  const before = requests.length
  apply(event)
  await settle()
  // `mcp.status.changed` reads once its burst has been quiet for `settleMs`.
  if (event.type === "mcp.status.changed") {
    await Bun.sleep(200)
    await settle()
  }
  const observed = { ...(observe() as Record<string, Json>), requests: requests.slice(before).toSorted() }
  setup.dispose()
  return observed
}

const results = []
for (const item of cases)
  for (const state of ["empty", "loaded"] as const)
    results.push({ name: item.name, state, event: item.event, expected: await run(item.event, state === "loaded") })

const file = new URL("../fixtures/F.7/folds.json", import.meta.url).pathname
await Bun.write(
  file,
  JSON.stringify({ variants: variants.map((variant) => variant.type), routes, allow, cases: results }, null, 2) + "\n",
)
console.log(`folds: ${variants.length} variants, ${results.length} cases`)
