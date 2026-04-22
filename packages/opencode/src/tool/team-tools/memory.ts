import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { Effect } from "effect"
import z from "zod"
import { Tool } from "../shared/tool"
import { TeamMemory } from "@/team/memory"
import { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import fs from "node:fs"
import path from "node:path"

const DESCRIPTION = `Use persistent project memory for durable repo knowledge that should survive sessions, plans, and handoffs.

Memory is not a scratchpad. Do not use it for live coordination, ephemeral execution state, or one-off task notes.

Areas:
- \`project_rules\`: prompt-safe reusable project rules
- \`feature_memory\`: Atlas-curated validated feature-purpose and behavior notes keyed by stable \`scope\`
- \`atlas_private\`: ATLAS-only private memory that must not leak to subagents
- \`lessons\`: shared durable knowledge, evidence, measurements, and artifacts

Dimensions:
- \`class\`: high-level purpose such as \`rule\`, \`knowledge\`, \`evidence\`, or \`artifact\`
- \`kind\`: more specific record type such as \`validation\`, \`finding\`, \`measurement\`, or \`lesson\`
- \`domain\`: concern area such as \`general\`, \`security\`, \`performance\`, \`data\`, or \`frontend\`

Actions:
- \`list\`: list entries; defaults to \`status=active\`
- \`get\`: read one entry by \`id\`
- \`search\`: search entries by query text; defaults to \`status=active\`
- \`stats\`: summarize counts across areas, classes, kinds, domains, statuses, tags, and scopes
- \`audit\`: scan entries for duplicate candidates, suspicious shapes, missing sources, and missing repo paths
- \`write\`: create or update one entry; optional structured \`payload\` stores durable evidence or artifacts
- \`promote\`: create a \`project_rules\` entry from an active \`lessons\` source entry
- \`archive\`: archive one existing entry without deleting history
- \`remove\`: hard-delete one entry and write a tombstone
- \`bulk_remove\`: hard-delete multiple entries and write tombstones

Strict rules:
1. Retrieve before you write: read \`project_rules\` first, then pull \`lessons\` or \`feature_memory\` when prior evidence or validated feature behavior matters.
2. Write only durable knowledge. Keep \`content\` concise and put bulky structured evidence in \`payload\`.
3. \`write\` creates when \`id\` is omitted and updates when \`id\` is provided. Without \`id\`, \`project_rules\` and \`lessons\` may merge into an existing active near-duplicate, while \`feature_memory\` reuses the active entry with the same stable \`scope\`.
4. \`promote\` only promotes an active \`lessons\` entry into \`project_rules\`. It is not a general cross-area copy tool.
5. \`remove\` and \`bulk_remove\` require \`reason\`. Unless \`sensitive=true\`, archive first.
6. \`bulk_remove\` is all-or-nothing at the tool layer: if any requested \`id\` is missing or not permitted, nothing is removed.
7. \`feature_memory\` writes are Atlas-only and require \`scope\`, \`class=knowledge\`, and \`kind=package_behavior\` or \`kind=runtime_behavior\`.
8. Security \`finding\`/\`remediation\`/\`verification\` entries and performance \`baseline\`/\`measurement\`/\`optimization\` entries require structured \`payload\` evidence.
9. Archive superseded entries; remove only junk, duplicates, or sensitive cleanup.`

const id = "memory"
const Action = z.enum([
  "list",
  "get",
  "search",
  "stats",
  "audit",
  "write",
  "promote",
  "archive",
  "remove",
  "bulk_remove",
])

const parameters = z
  .object({
    action: Action.describe("Memory action to perform."),
    id: z
      .string()
      .optional()
      .describe(
        "Entry id. Required for `get`, `promote`, `archive`, or `remove`. Optional for `write`, where it updates that entry.",
      ),
    ids: z
      .array(z.string())
      .optional()
      .describe("Entry ids for `bulk_remove`. Every requested id must resolve and be permitted or nothing is removed."),
    area: TeamMemory.Area.optional().describe("Area to filter for reads or to target for `write`."),
    class: TeamMemory.Class.optional().describe("Class filter for reads, or explicit class for `write`."),
    kind: TeamMemory.Kind.optional().describe(
      "Kind filter for reads, explicit kind for `write`, or promoted rule kind override.",
    ),
    domain: TeamMemory.Domain.optional().describe(
      "Domain filter for reads, or explicit domain for `write` when permitted.",
    ),
    status: TeamMemory.Status.optional().describe("Status filter. Defaults to `active` for `list` and `search`."),
    title: z.string().optional().describe("Title for `write`, or optional override title for `promote`."),
    content: z.string().optional().describe("Content for `write`, or optional override content for `promote`."),
    scope: z
      .string()
      .optional()
      .describe("Optional subsystem, feature, or file scope. Required for `feature_memory` writes."),
    tags: z.array(z.string()).optional().describe("Optional tags stored on the entry."),
    payload: TeamMemory.Entry.shape.payload.describe(
      "Optional structured payload for durable evidence or artifacts. Required for some security and performance kinds.",
    ),
    query: z.string().optional().describe("Search query for `search`."),
    reason: z.string().optional().describe("Required reason for `remove` or `bulk_remove`."),
    sensitive: z
      .boolean()
      .optional()
      .describe(
        "For `remove` or `bulk_remove`, bypass archive-first and redact tombstone snapshots for sensitive cleanup.",
      ),
    limit: z
      .number()
      .int()
      .positive()
      .max(100)
      .optional()
      .describe("Optional result limit for list, search, or audit findings."),
  })
  .superRefine((value, ctx) => {
    if (["get", "promote", "archive", "remove"].includes(value.action) && !value.id) {
      ctx.addIssue({ code: "custom", path: ["id"], message: `id is required when action=${value.action}` })
    }
    if (value.action === "bulk_remove" && (value.ids?.length ?? 0) === 0) {
      ctx.addIssue({ code: "custom", path: ["ids"], message: "ids is required when action=bulk_remove" })
    }
    if (value.action === "search" && !value.query?.trim()) {
      ctx.addIssue({ code: "custom", path: ["query"], message: "query is required when action=search" })
    }
    if (value.action === "write") {
      if (!value.area) {
        ctx.addIssue({ code: "custom", path: ["area"], message: "area is required when action=write" })
      }
      if (!value.title?.trim()) {
        ctx.addIssue({ code: "custom", path: ["title"], message: "title is required when action=write" })
      }
      if (!value.content?.trim()) {
        ctx.addIssue({ code: "custom", path: ["content"], message: "content is required when action=write" })
      }
    }
    if (["remove", "bulk_remove"].includes(value.action) && !value.reason?.trim()) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: `reason is required when action=${value.action}` })
    }
  })

type Act = "read" | "write" | "promote" | "archive" | "remove"

function perm(action: z.infer<typeof Action>) {
  if (["list", "get", "search", "stats", "audit"].includes(action)) return "read" as const
  if (action === "write") return "write" as const
  if (action === "promote") return "promote" as const
  if (action === "archive") return "archive" as const
  return "remove" as const
}

function keys(act: Act, area: TeamMemory.Area, domain?: TeamMemory.Domain) {
  if (area !== "lessons") return [`${act}:${area}`]
  if (!domain) return [`${act}:lessons`]
  return [`${act}:lessons:${domain}`, `${act}:lessons`]
}

function best(agent: Agent.Info, act: Act, area: TeamMemory.Area, domain?: TeamMemory.Domain) {
  const list = keys(act, area, domain).map((pattern) => ({
    pattern,
    action: Permission.evaluate("memory", pattern, agent.permission).action,
  }))
  const allow = list.find((item) => item.action === "allow")
  if (allow) return allow
  return list.find((item) => item.action === "ask")
}

function uniq(list: string[]) {
  return Array.from(new Set(list))
}

function allow(agent: Agent.Info, act: Act, area?: TeamMemory.Area, domain?: TeamMemory.Domain) {
  if (!area) {
    const out: string[] = []
    for (const item of TeamMemory.Area.options) {
      if (item !== "lessons") {
        const hit = best(agent, act, item)
        if (hit) out.push(hit.pattern)
        continue
      }
      const broad = best(agent, act, item)
      if (broad) {
        out.push(broad.pattern)
        continue
      }
      for (const name of TeamMemory.Domain.options) {
        const hit = best(agent, act, item, name)
        if (hit) out.push(hit.pattern)
      }
    }
    if (out.length === 0) throw new Error(`memory ${act} is not available to agent: ${agent.name}`)
    return uniq(out)
  }
  if (area && area !== "lessons") {
    const hit = best(agent, act, area)
    if (!hit) throw new Error(`memory ${act} is not available to agent: ${agent.name}`)
    return [hit.pattern]
  }
  if (area === "lessons" && domain) {
    const hit = best(agent, act, area, domain)
    if (!hit) throw new Error(`memory ${act} is not available to agent: ${agent.name}`)
    return [hit.pattern]
  }
  if (area === "lessons") {
    const broad = best(agent, act, area)
    if (broad) return [broad.pattern]
    const hits = TeamMemory.Domain.options
      .map((item) => best(agent, act, area, item)?.pattern)
      .filter((item): item is string => !!item)
    if (hits.length === 0) throw new Error(`memory ${act} is not available to agent: ${agent.name}`)
    return uniq(hits)
  }
  throw new Error(`memory ${act} is not available to agent: ${agent.name}`)
}

function ok(agent: Agent.Info, act: Act, item: TeamMemory.Entry) {
  return !!best(agent, act, item.area, item.domain)
}

function pick(agent: Agent.Info, act: Act, item: TeamMemory.Entry) {
  const hit = best(agent, act, item.area, item.domain)
  if (!hit) throw new Error(`memory ${act} is not available to agent: ${agent.name}`)
  return hit.pattern
}

function dom(list: string[], domain?: TeamMemory.Domain) {
  if (domain) return domain
  const hits = uniq(
    list.flatMap((item) => (item.startsWith("write:lessons:") ? [item.slice("write:lessons:".length)] : [])),
  )
  if (hits.length === 1) return TeamMemory.Domain.parse(hits[0])
  return domain
}

function line(list: string[]) {
  if (list.length === 0) return "-"
  return list.join(", ")
}

function fmt(list: TeamMemory.Entry[]) {
  if (list.length === 0) return "No memory entries found."
  return list
    .map((item) =>
      [
        `- id: ${item.id}`,
        `  area: ${item.area}`,
        `  class: ${item.class}`,
        `  kind: ${item.kind}`,
        `  domain: ${item.domain}`,
        `  status: ${item.status}`,
        `  title: ${item.title}`,
        item.scope ? `  scope: ${item.scope}` : undefined,
        item.tags.length ? `  tags: ${line(item.tags)}` : undefined,
        item.source_id ? `  source_id: ${item.source_id}` : undefined,
        `  created_by: ${item.created_by}`,
        `  updated_by: ${item.updated_by}`,
        item.meta ? `  meta: ${JSON.stringify(item.meta)}` : undefined,
        item.payload ? `  payload: ${JSON.stringify(item.payload)}` : undefined,
        `  content: ${item.content}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n")
}

type Row = {
  name: string
  count: number
}

type Summary = {
  total: number
  by_area: Row[]
  by_class: Row[]
  by_kind: Row[]
  by_domain: Row[]
  by_status: Row[]
  top_tags: Row[]
  top_scopes: Row[]
}

type Finding = {
  type: "duplicate" | "shape" | "source" | "path"
  ids: string[]
  summary: string
  evidence: string
}

function rows(list: string[], limit = 8) {
  const map = new Map<string, number>()
  list.forEach((item) => {
    map.set(item, (map.get(item) ?? 0) + 1)
  })
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      return a.name.localeCompare(b.name)
    })
    .slice(0, limit)
}

function show(list: Row[]) {
  if (list.length === 0) return "-"
  return list.map((item) => `${item.name}=${item.count}`).join(", ")
}

function stat(list: TeamMemory.Entry[]): Summary {
  return {
    total: list.length,
    by_area: rows(list.map((item) => item.area)),
    by_class: rows(list.map((item) => item.class)),
    by_kind: rows(list.map((item) => item.kind)),
    by_domain: rows(list.map((item) => item.domain)),
    by_status: rows(list.map((item) => item.status)),
    top_tags: rows(list.flatMap((item) => item.tags)),
    top_scopes: rows(list.flatMap((item) => (item.scope ? [item.scope] : []))),
  }
}

function statText(item: Summary) {
  return [
    `- total: ${item.total}`,
    `- areas: ${show(item.by_area)}`,
    `- classes: ${show(item.by_class)}`,
    `- kinds: ${show(item.by_kind)}`,
    `- domains: ${show(item.by_domain)}`,
    `- statuses: ${show(item.by_status)}`,
    `- top tags: ${show(item.top_tags)}`,
    `- top scopes: ${show(item.top_scopes)}`,
  ].join("\n")
}

function norm(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function tok(value: string) {
  return norm(value)
    .split(" ")
    .filter((item) => item.length > 2)
}

function pct(a: string[], b: string[]) {
  if (a.length === 0 || b.length === 0) return 0
  const set = new Set(b)
  const hit = a.filter((item) => set.has(item)).length
  return hit / Math.min(a.length, b.length)
}

function close(a: string, b: string, size: number, cut: number) {
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return false
  if (x === y) return true
  if ((x.includes(y) || y.includes(x)) && Math.min(x.length, y.length) >= size) return true
  return pct(tok(x), tok(y)) >= cut
}

function feature(item: TeamMemory.Entry) {
  return (
    item.area === "lessons" &&
    ["package_behavior", "runtime_behavior"].includes(item.kind) &&
    !!item.scope &&
    item.tags.includes("feature")
  )
}

function alike(a: TeamMemory.Entry, b: TeamMemory.Entry) {
  if (a.area !== b.area) return false
  if (a.class !== b.class) return false
  if (a.kind !== b.kind) return false
  if (a.domain !== b.domain) return false
  if (a.status !== b.status) return false
  if (feature(a) && feature(b) && a.scope === b.scope) return true
  return close(a.title, b.title, 12, 0.8) || close(a.content, b.content, 24, 0.85)
}

const ext = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "json",
  "jsonc",
  "toml",
  "md",
  "txt",
  "yml",
  "yaml",
  "cs",
  "sql",
])

function clean(value: string) {
  const base = value.trim().replace(/^`+|`+$/g, "")
  const line = base.match(/^(.*?)(:\d+)+$/)?.[1] ?? base
  const hash = line.split("#")[0]
  if (!hash) return ""
  if (hash.startsWith("file://")) return hash.slice("file://".length)
  return hash
}

function filey(value: string) {
  if (!value) return false
  if (value.startsWith("http://") || value.startsWith("https://")) return false
  if (value.startsWith("@/")) return false
  if (value.includes("*")) return false
  if (value.includes(" ")) return false
  if (value.includes("/") || value.includes("\\") || value.startsWith(".")) return true
  return ext.has(path.extname(value).slice(1).toLowerCase())
}

function refs(item: TeamMemory.Entry) {
  const out: string[] = []
  const push = (value: unknown) => {
    if (typeof value !== "string") return
    const ref = clean(value)
    if (!filey(ref)) return
    out.push(ref)
  }
  const walk = (value: unknown, key?: string) => {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        walk(item, key)
      })
      return
    }
    if (value && typeof value === "object") {
      Object.entries(value).forEach(([name, item]) => {
        walk(item, name)
      })
      return
    }
    if (!["affected", "target", "refs"].includes(key ?? "")) return
    push(value)
  }
  push(item.scope)
  walk(item.payload)
  return uniq(out)
}

function within(root: string, file: string) {
  const rel = path.relative(root, file)
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

function dups(list: TeamMemory.Entry[]) {
  const out: Finding[] = []
  for (let i = 0; i < list.length; i++) {
    const a = list[i]
    if (!a) continue
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j]
      if (!b || !alike(a, b)) continue
      const scoped = feature(a) && feature(b) && a.scope === b.scope
      out.push({
        type: "duplicate",
        ids: [a.id, b.id],
        summary: scoped ? `${a.scope} feature note appears more than once` : `${a.title} <> ${b.title}`,
        evidence: scoped
          ? `${a.area}/${a.kind}/${a.domain} feature entries share the same stable scope`
          : `${a.area}/${a.kind}/${a.domain} entries overlap strongly in title or content`,
      })
    }
  }
  return out
}

function shapes(list: TeamMemory.Entry[]) {
  const out: Finding[] = []
  list.forEach((item) => {
    if (item.area === "project_rules" && item.class !== "rule") {
      out.push({
        type: "shape",
        ids: [item.id],
        summary: `${item.title} uses a non-standard project_rules shape`,
        evidence: `expected class=rule; found class=${item.class}`,
      })
    }
  })
  return out
}

async function sources(list: TeamMemory.Entry[]) {
  const out = await Promise.all(
    list
      .filter((item) => !!item.source_id)
      .map(async (item) => {
        const ref = item.source_id!
        const src = await TeamMemory.get({ id: ref })
        if (!src) {
          return {
            type: "source" as const,
            ids: [item.id],
            summary: `${item.title} points to a missing source entry`,
            evidence: `source_id=${ref} no longer exists`,
          }
        }
        if (item.area === "project_rules" && src.area !== "lessons") {
          return {
            type: "source" as const,
            ids: [item.id, src.id],
            summary: `${item.title} points to an unexpected source area`,
            evidence: `project_rules should usually point to lessons; source area=${src.area}`,
          }
        }
      }),
  )
  return out.flatMap((item) => (item ? [item] : []))
}

function paths(list: TeamMemory.Entry[]) {
  const root = Instance.worktree
  return list.flatMap((item) => {
    const miss = refs(item).filter((ref) => {
      const file = path.isAbsolute(ref) ? ref : path.join(root, ref)
      if (!within(root, file)) return false
      return !fs.existsSync(file)
    })
    if (miss.length === 0) return []
    return [
      {
        type: "path" as const,
        ids: [item.id],
        summary: `${item.title} references missing repo path${miss.length > 1 ? "s" : ""}`,
        evidence: miss.join(", "),
      },
    ]
  })
}

async function audit(list: TeamMemory.Entry[], limit = 20) {
  const hits = [...dups(list), ...shapes(list), ...(await sources(list)), ...paths(list)]
  return {
    total: hits.length,
    findings: hits.slice(0, limit),
  }
}

function finds(list: Finding[]) {
  if (list.length === 0) return "- No issues detected."
  return list.map((item) => `- [${item.type}] ${item.ids.join(", ")} — ${item.summary} (${item.evidence})`).join("\n")
}

type Meta = {
  count?: number
  memoryId?: string
  entry?: TeamMemory.Entry
  entries?: TeamMemory.Entry[]
  empty?: "not_found"
  summary?: Summary
  findings?: Finding[]
}

function meta(input: {
  entry?: TeamMemory.Entry
  entries?: TeamMemory.Entry[]
  empty?: "not_found"
  summary?: Summary
  findings?: Finding[]
}): Meta {
  return {
    count: input.entries?.length,
    memoryId: input.entry?.id,
    entry: input.entry,
    entries: input.entries,
    empty: input.empty,
    summary: input.summary,
    findings: input.findings,
  }
}

function out(title: string, output: string, metadata: Meta) {
  return { title, output, metadata }
}

function note(area: TeamMemory.Area) {
  if (area === "project_rules") return "prompt-safe reusable project rules"
  if (area === "feature_memory") return "Atlas-curated validated feature-purpose and behavior notes"
  if (area === "atlas_private") return "ATLAS-only private memory"
  return "shared durable knowledge, evidence, measurements, and artifacts"
}

function state(agent: Agent.Info, pattern: string) {
  return Permission.evaluate("memory", pattern, agent.permission).action
}

function labels(agent: Agent.Info, act: Act, areas?: TeamMemory.Area[]) {
  const picked = areas ?? [...TeamMemory.Area.options]
  return picked.flatMap((area) => {
    if (area !== "lessons") {
      return [
        {
          label: `${area} (${note(area)})`,
          state: state(agent, `${act}:${area}`),
        },
      ]
    }
    const broad = state(agent, `${act}:lessons`)
    if (broad !== "deny") {
      return [
        {
          label: `lessons (${note("lessons")})`,
          state: broad,
        },
      ]
    }
    return TeamMemory.Domain.options.map((domain) => ({
      label: `lessons:${domain}`,
      state: state(agent, `${act}:lessons:${domain}`),
    }))
  })
}

function access(agent: Agent.Info, act: Act, areas?: TeamMemory.Area[]) {
  const rows = labels(agent, act, areas)
  const fmt = (name: "allow" | "ask" | "deny", label: string) => {
    const list = rows.filter((item) => item.state === name).map((item) => item.label)
    return list.length > 0 ? `${label}: ${list.join(", ")}` : undefined
  }
  return [fmt("allow", "allow"), fmt("ask", "ask"), fmt("deny", "unavailable")].filter(Boolean).join("; ")
}

export const MemoryDescription: Tool.DynamicDescription = (agent) =>
  Effect.succeed(
    [
      "Permission view for this caller:",
      `- read (\`list\`, \`get\`, \`search\`, \`stats\`, \`audit\`): ${access(agent, "read")}`,
      `- write (\`write\`): ${access(agent, "write")}`,
      `- promote (\`promote\` into \`project_rules\` from an active \`lessons\` source): ${access(agent, "promote", ["project_rules"])}`,
      `- archive (\`archive\`): ${access(agent, "archive")}`,
      `- remove (\`remove\`, \`bulk_remove\`): ${access(agent, "remove")}`,
      "",
      "Use only the actions and areas shown as allow or ask above. If lessons access is split by domain, stay inside those exact `lessons:<domain>` subchannels.",
    ].join("\n"),
  )

export const MemoryTool = Tool.define<typeof parameters, Meta>(id, {
  description: DESCRIPTION,
  parameters,
  async execute(params: z.infer<typeof parameters>, ctx) {
    const agent = await Agent.get(ctx.agent)
    const act = perm(params.action)

    if (params.action === "list") {
      const patterns = allow(agent, act, params.area, params.domain)
      await ctx.ask({
        permission: id,
        patterns,
        always: patterns,
        metadata: {
          action: params.action,
          area: params.area,
          class: params.class,
          kind: params.kind,
          domain: params.domain,
          status: params.status ?? "active",
        },
      })
      const list = (
        await TeamMemory.list({
          area: params.area,
          class: params.class,
          kind: params.kind,
          domain: params.domain,
          status: params.status ?? "active",
          scope: params.scope,
          tag: params.tags?.[0],
          limit: params.limit,
        })
      ).filter((item) => ok(agent, act, item))
      if (list[0]) {
        await Bus.publish(TeamMemory.Event.Activity, {
          projectID: list[0].project_id,
          activity: {
            id: `${ctx.messageID}:${Date.now()}`,
            project_id: list[0].project_id,
            session_id: ctx.sessionID,
            action: "read",
            effect: "read",
            area: params.area,
            class: params.class,
            kind: params.kind,
            domain: params.domain,
            actor: ctx.agent,
            count: list.length,
            time: Date.now(),
          },
        }).catch(() => undefined)
      }
      return out(`${list.length} memory entries`, fmt(list), meta({ entries: list }))
    }

    if (params.action === "search") {
      const patterns = allow(agent, act, params.area, params.domain)
      await ctx.ask({
        permission: id,
        patterns,
        always: patterns,
        metadata: {
          action: params.action,
          area: params.area,
          class: params.class,
          kind: params.kind,
          domain: params.domain,
          status: params.status ?? "active",
          query: params.query,
        },
      })
      const list = (
        await TeamMemory.search({
          query: params.query!,
          area: params.area,
          class: params.class,
          kind: params.kind,
          domain: params.domain,
          status: params.status ?? "active",
          scope: params.scope,
          tag: params.tags?.[0],
          limit: params.limit,
        })
      ).filter((item) => ok(agent, act, item))
      if (list[0]) {
        await Bus.publish(TeamMemory.Event.Activity, {
          projectID: list[0].project_id,
          activity: {
            id: `${ctx.messageID}:${Date.now()}`,
            project_id: list[0].project_id,
            session_id: ctx.sessionID,
            action: "read",
            effect: "read",
            area: params.area,
            class: params.class,
            kind: params.kind,
            domain: params.domain,
            actor: ctx.agent,
            query: params.query,
            count: list.length,
            time: Date.now(),
          },
        }).catch(() => undefined)
      }
      return out(`${list.length} memory matches`, fmt(list), meta({ entries: list }))
    }

    if (params.action === "stats") {
      const patterns = allow(agent, act, params.area, params.domain)
      await ctx.ask({
        permission: id,
        patterns,
        always: patterns,
        metadata: {
          action: params.action,
          area: params.area,
          class: params.class,
          kind: params.kind,
          domain: params.domain,
          status: params.status,
        },
      })
      const list = (
        await TeamMemory.list({
          area: params.area,
          class: params.class,
          kind: params.kind,
          domain: params.domain,
          status: params.status,
          scope: params.scope,
          tag: params.tags?.[0],
          limit: 5000,
        })
      ).filter((item) => ok(agent, act, item))
      if (list[0]) {
        await Bus.publish(TeamMemory.Event.Activity, {
          projectID: list[0].project_id,
          activity: {
            id: `${ctx.messageID}:${Date.now()}`,
            project_id: list[0].project_id,
            session_id: ctx.sessionID,
            action: "read",
            effect: "read",
            area: params.area,
            class: params.class,
            kind: params.kind,
            domain: params.domain,
            actor: ctx.agent,
            count: list.length,
            time: Date.now(),
          },
        }).catch(() => undefined)
      }
      const summary = stat(list)
      return out(`${summary.total} memory entries`, statText(summary), meta({ entries: list, summary }))
    }

    if (params.action === "audit") {
      const patterns = allow(agent, act, params.area, params.domain)
      await ctx.ask({
        permission: id,
        patterns,
        always: patterns,
        metadata: {
          action: params.action,
          area: params.area,
          class: params.class,
          kind: params.kind,
          domain: params.domain,
          status: params.status,
        },
      })
      const list = (
        await TeamMemory.list({
          area: params.area,
          class: params.class,
          kind: params.kind,
          domain: params.domain,
          status: params.status,
          scope: params.scope,
          tag: params.tags?.[0],
          limit: 5000,
        })
      ).filter((item) => ok(agent, act, item))
      if (list[0]) {
        await Bus.publish(TeamMemory.Event.Activity, {
          projectID: list[0].project_id,
          activity: {
            id: `${ctx.messageID}:${Date.now()}`,
            project_id: list[0].project_id,
            session_id: ctx.sessionID,
            action: "read",
            effect: "read",
            area: params.area,
            class: params.class,
            kind: params.kind,
            domain: params.domain,
            actor: ctx.agent,
            count: list.length,
            time: Date.now(),
          },
        }).catch(() => undefined)
      }
      const summary = stat(list)
      const hit = await audit(list, params.limit ?? 20)
      return out(
        `${hit.total} memory audit findings`,
        ["Memory stats:", statText(summary), "", "Findings:", finds(hit.findings)].join("\n"),
        meta({ entries: list, summary, findings: hit.findings }),
      )
    }

    if (params.action === "get") {
      const hit = await TeamMemory.get({ id: params.id! })
      if (!hit || !ok(agent, act, hit)) {
        return out("Memory entry not found", `Memory entry not found: ${params.id}`, meta({ empty: "not_found" }))
      }
      const pattern = pick(agent, act, hit)
      await ctx.ask({
        permission: id,
        patterns: [pattern],
        always: [pattern],
        metadata: { action: params.action, id: params.id, area: hit.area, domain: hit.domain },
      })
      await Bus.publish(TeamMemory.Event.Activity, {
        projectID: hit.project_id,
        activity: {
          id: `${ctx.messageID}:${Date.now()}`,
          project_id: hit.project_id,
          session_id: ctx.sessionID,
          memory_id: hit.id,
          action: "read",
          effect: "read",
          area: hit.area,
          class: hit.class,
          kind: hit.kind,
          domain: hit.domain,
          actor: ctx.agent,
          title: hit.title,
          count: 1,
          time: Date.now(),
        },
      }).catch(() => undefined)
      return out(hit.title, fmt([hit]), meta({ entry: hit }))
    }

    if (params.action === "promote") {
      const hit = await TeamMemory.get({ id: params.id! })
      if (!hit || !ok(agent, "read", hit)) {
        return out("Memory entry not found", `Memory entry not found: ${params.id}`, meta({ empty: "not_found" }))
      }
      const read = pick(agent, "read", hit)
      const promote = allow(agent, act, TeamMemory.Area.enum.project_rules)[0]
      await ctx.ask({
        permission: id,
        patterns: [read, promote],
        always: [read, promote],
        metadata: { action: params.action, id: params.id, area: hit.area, domain: hit.domain, title: params.title },
      })
      const item = await TeamMemory.promote({
        id: params.id!,
        title: params.title,
        content: params.content,
        scope: params.scope,
        tags: params.tags,
        kind: params.kind,
        sessionID: ctx.sessionID,
        actor: ctx.agent,
        domains: [hit.domain],
      })
      if (!item) {
        return out("Memory entry not found", `Memory entry not found: ${params.id}`, meta({ empty: "not_found" }))
      }
      return out(`Promoted ${item.title}`, fmt([item]), meta({ entry: item }))
    }

    if (params.action === "archive") {
      const hit = await TeamMemory.get({ id: params.id! })
      if (!hit || !ok(agent, act, hit)) {
        return out("Memory entry not found", `Memory entry not found: ${params.id}`, meta({ empty: "not_found" }))
      }
      const pattern = pick(agent, act, hit)
      await ctx.ask({
        permission: id,
        patterns: [pattern],
        always: [pattern],
        metadata: { action: params.action, id: params.id, area: hit.area, domain: hit.domain },
      })
      const item = await TeamMemory.archive({
        id: params.id!,
        sessionID: ctx.sessionID,
        actor: ctx.agent,
        areas: [hit.area],
        domains: hit.area === "lessons" ? [hit.domain] : undefined,
      })
      if (!item) {
        return out("Memory entry not found", `Memory entry not found: ${params.id}`, meta({ empty: "not_found" }))
      }
      return out(`Archived ${item.title}`, fmt([item]), meta({ entry: item }))
    }

    if (params.action === "remove") {
      const hit = await TeamMemory.get({ id: params.id! })
      if (!hit || !ok(agent, act, hit)) {
        return out("Memory entry not found", `Memory entry not found: ${params.id}`, meta({ empty: "not_found" }))
      }
      const pattern = pick(agent, act, hit)
      await ctx.ask({
        permission: id,
        patterns: [pattern],
        always: [pattern],
        metadata: {
          action: params.action,
          id: params.id,
          area: hit.area,
          domain: hit.domain,
          reason: params.reason,
          sensitive: params.sensitive,
        },
      })
      const item = await TeamMemory.remove({
        id: params.id!,
        reason: params.reason!,
        sensitive: params.sensitive,
        sessionID: ctx.sessionID,
        actor: ctx.agent,
        areas: [hit.area],
        domains: hit.area === "lessons" ? [hit.domain] : undefined,
      })
      if (!item) {
        return out("Memory entry not found", `Memory entry not found: ${params.id}`, meta({ empty: "not_found" }))
      }
      return out(`Removed ${item.title}`, fmt([item]), meta({ entry: item }))
    }

    if (params.action === "bulk_remove") {
      const ids = uniq((params.ids ?? []).map((item) => item.trim()).filter(Boolean))
      const found = (await Promise.all(ids.map((item) => TeamMemory.get({ id: item })))).filter(
        (item): item is TeamMemory.Entry => !!item,
      )
      const missing = ids.filter((item) => !found.some((entry) => entry.id === item))
      const denied = found.filter((item) => !ok(agent, act, item))
      if (found.length === 0) {
        return out(
          "Memory entries not found",
          `Memory entries not found: ${ids.join(", ")}`,
          meta({ empty: "not_found" }),
        )
      }
      if (missing.length > 0 || denied.length > 0) {
        const lines = [
          missing.length > 0 ? `Missing ids: ${missing.join(", ")}` : undefined,
          denied.length > 0 ? `Denied ids: ${denied.map((item) => item.id).join(", ")}` : undefined,
          "No entries were removed.",
        ].filter(Boolean)
        return out("Memory bulk remove blocked", lines.join("\n"), meta({ entries: found }))
      }
      const patterns = uniq(found.map((item) => pick(agent, act, item)))
      await ctx.ask({
        permission: id,
        patterns,
        always: patterns,
        metadata: {
          action: params.action,
          ids,
          reason: params.reason,
          sensitive: params.sensitive,
        },
      })
      const items = await TeamMemory.bulkRemove({
        ids,
        reason: params.reason!,
        sensitive: params.sensitive,
        sessionID: ctx.sessionID,
        actor: ctx.agent,
      })
      return out(`Removed ${items.length} memory entries`, fmt(items), meta({ entries: items }))
    }

    const patterns = allow(agent, act, params.area, params.domain)
    const pattern = patterns[0]
    const domain = params.area === "lessons" ? dom(patterns, params.domain) : params.domain
    await ctx.ask({
      permission: id,
      patterns: [pattern],
      always: [pattern],
      metadata: {
        action: params.action,
        id: params.id,
        area: params.area,
        class: params.class,
        kind: params.kind,
        domain,
        title: params.title,
      },
    })
    const item = await TeamMemory.write({
      id: params.id,
      area: params.area!,
      class: params.class,
      kind: params.kind,
      domain,
      title: params.title!,
      content: params.content!,
      scope: params.scope,
      tags: params.tags,
      status: params.status,
      payload: params.payload,
      sessionID: ctx.sessionID,
      actor: ctx.agent,
    })
    return out(item.title, fmt([item]), meta({ entry: item }))
  },
})
