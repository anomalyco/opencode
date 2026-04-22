import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { makeRuntime } from "@/effect/run-service"
import { InstanceState } from "@/effect/instance-state"
import { Global } from "@/global"
import { Identifier } from "@/id/id"
import { ProjectID } from "@/project/schema"
import { SessionID } from "@/session/schema"
import { Flock } from "@/util/flock"
import { Context, Effect, Layer } from "effect"
import { mkdir, readdir, unlink } from "node:fs/promises"
import path from "path"
import z from "zod"

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }
type Payload = Record<string, Json>
type Meta = Record<string, string | number | boolean | null>

const ui_title = "title_ui"
const ui_content = "content_ui"
const ui_locale = "ui_locale"
const translate_flag = "is_translate"
const translate_status = "translate_status"
const translate_done = "translate_done"
const translate_total = "translate_total"
const translate_updated = "translate_updated"

const Json: z.ZodType<Json> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(Json), z.record(z.string(), Json)]),
)

const Payload = z.record(z.string(), Json)

function text(value?: string) {
  const next = value?.trim()
  return next ? next : undefined
}

function uniq(list?: string[]) {
  if (!list) return []
  return Array.from(new Set(list.map((item) => item.trim()).filter(Boolean)))
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

function like(input: { title: string; content: string; entry: TeamMemory.Entry }) {
  const at = norm(input.title)
  const bt = norm(input.entry.title)
  if (!at || !bt) return false
  if (at === bt) return true
  if ((at.includes(bt) || bt.includes(at)) && Math.min(at.length, bt.length) >= 12) return true
  if (pct(tok(at), tok(bt)) >= 0.8) return true

  const ac = norm(input.content)
  const bc = norm(input.entry.content)
  if (!ac || !bc) return false
  if (ac === bc) return true
  if ((ac.includes(bc) || bc.includes(ac)) && Math.min(ac.length, bc.length) >= 24) return true
  return false
}

function wide(prev: string, next: string) {
  const a = text(prev) ?? ""
  const b = text(next) ?? ""
  if (!a) return b
  if (!b) return a
  if (a === b) return a
  if (a.includes(b)) return a
  if (b.includes(a)) return b
  if (b.length > a.length) return b
  return a
}

function grow(prev: string, next: string) {
  const a = text(prev) ?? ""
  const b = text(next) ?? ""
  if (!a) return b
  if (!b) return a
  if (a === b) return a
  if (a.includes(b)) return a
  if (b.includes(a)) return b
  return `${a}\n\n${b}`
}

function vals(payload?: Record<string, unknown>) {
  if (!payload) return []
  const out: string[] = []
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      out.push(value)
      return
    }
    if (typeof value === "number" || typeof value === "boolean") {
      out.push(String(value))
      return
    }
    if (!value || typeof value !== "object") return
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    Object.values(value).forEach(visit)
  }
  visit(payload)
  return out
}

function behaviorKind(kind: TeamMemory.Kind) {
  return kind === TeamMemory.Kind.enum.package_behavior || kind === TeamMemory.Kind.enum.runtime_behavior
}

function featureArea(area: TeamMemory.Area) {
  return area === TeamMemory.Area.enum.feature_memory
}

function mergeArea(area: TeamMemory.Area) {
  return area === TeamMemory.Area.enum.project_rules || area === TeamMemory.Area.enum.lessons
}

function seed(area: TeamMemory.Area): Pick<TeamMemory.Entry, "class" | "kind" | "domain"> {
  if (area === TeamMemory.Area.enum.project_rules) {
    return {
      class: TeamMemory.Class.enum.rule,
      kind: TeamMemory.Kind.enum.repo_convention,
      domain: TeamMemory.Domain.enum.general,
    }
  }
  if (area === TeamMemory.Area.enum.atlas_private) {
    return {
      class: TeamMemory.Class.enum.knowledge,
      kind: TeamMemory.Kind.enum.note,
      domain: TeamMemory.Domain.enum.general,
    }
  }
  if (area === TeamMemory.Area.enum.feature_memory) {
    return {
      class: TeamMemory.Class.enum.knowledge,
      kind: TeamMemory.Kind.enum.package_behavior,
      domain: TeamMemory.Domain.enum.general,
    }
  }
  return {
    class: TeamMemory.Class.enum.knowledge,
    kind: TeamMemory.Kind.enum.lesson,
    domain: TeamMemory.Domain.enum.general,
  }
}

function pick(payload?: Record<string, unknown>) {
  if (!payload) return
  const out = Payload.parse(payload)
  if (JSON.stringify(out).length > 4000) throw new Error("payload is too large")
  return out
}

function need(input: { domain: TeamMemory.Domain; kind: TeamMemory.Kind; payload?: Record<string, unknown> }) {
  const payload = pick(input.payload)
  if (input.domain === "security" && ["finding", "remediation", "verification"].includes(input.kind)) {
    if (!payload) throw new Error(`payload is required for ${input.domain} ${input.kind}`)
    if (
      [
        payload.severity,
        payload.category,
        payload.affected,
        payload.evidence,
        payload.remediation,
        payload.verified,
      ].every((item) => item === undefined)
    ) {
      throw new Error(`payload is missing security fields for ${input.kind}`)
    }
  }
  if (input.domain === "performance" && ["baseline", "measurement", "optimization"].includes(input.kind)) {
    if (!payload) throw new Error(`payload is required for ${input.domain} ${input.kind}`)
    if (payload.metric === undefined && payload.command === undefined) {
      throw new Error(`payload is missing performance fields for ${input.kind}`)
    }
  }
  return payload
}

function splitMeta(meta?: Meta) {
  if (!meta) return {}
  const title = typeof meta[ui_title] === "string" ? meta[ui_title] : undefined
  const content = typeof meta[ui_content] === "string" ? meta[ui_content] : undefined
  const locale = typeof meta[ui_locale] === "string" ? meta[ui_locale] : undefined
  const is_translate = typeof meta[translate_flag] === "boolean" ? meta[translate_flag] : undefined
  const status = TeamMemory.TranslateStatus.safeParse(meta[translate_status]).data
  const done = typeof meta[translate_done] === "number" ? meta[translate_done] : undefined
  const total = typeof meta[translate_total] === "number" ? meta[translate_total] : undefined
  const updated = typeof meta[translate_updated] === "number" ? meta[translate_updated] : undefined
  const next = Object.fromEntries(
    Object.entries(meta).filter(
      ([key]) =>
        ![
          ui_title,
          ui_content,
          ui_locale,
          translate_flag,
          translate_status,
          translate_done,
          translate_total,
          translate_updated,
        ].includes(key),
    ),
  ) as Meta
  return {
    meta: Object.keys(next).length > 0 ? next : undefined,
    title_ui: title,
    content_ui: content,
    ui_locale: locale,
    is_translate,
    translate_status: status,
    translate_done: done,
    translate_total: total,
    translate_updated: updated,
  }
}

export function packMeta(
  meta?: Meta,
  ui?: { title_ui?: string; content_ui?: string; ui_locale?: string },
  translate?: {
    is_translate?: boolean
    translate_status?: TeamMemory.TranslateStatus
    translate_done?: number
    translate_total?: number
    translate_updated?: number
  },
) {
  return {
    ...(meta ?? {}),
    ...(ui?.title_ui === undefined ? {} : { [ui_title]: ui.title_ui }),
    ...(ui?.content_ui === undefined ? {} : { [ui_content]: ui.content_ui }),
    ...(ui?.ui_locale === undefined ? {} : { [ui_locale]: ui.ui_locale }),
    ...(translate?.is_translate === undefined ? {} : { [translate_flag]: translate.is_translate }),
    ...(translate?.translate_status === undefined ? {} : { [translate_status]: translate.translate_status }),
    ...(translate?.translate_done === undefined ? {} : { [translate_done]: translate.translate_done }),
    ...(translate?.translate_total === undefined ? {} : { [translate_total]: translate.translate_total }),
    ...(translate?.translate_updated === undefined ? {} : { [translate_updated]: translate.translate_updated }),
  }
}

function line(item: TeamMemory.Entry) {
  const body = `${item.title}: ${item.content}`
  const head = item.domain === "general" ? body : `[${item.domain}] ${body}`
  return `- ${head}`
}

function fmt(title: string, list: TeamMemory.Entry[], input?: { limit?: number; size?: number }) {
  const lines = list.map(line)
  const out: string[] = []
  const limit = input?.limit ?? 12
  const cap = input?.size ?? 2000
  let size = 0
  for (const item of lines) {
    if (out.length >= limit) break
    if (size + item.length > cap) break
    out.push(item)
    size += item.length
  }
  if (out.length === 0) return
  return [title, ...out].join("\n")
}

function score(input: { query: string; entry: TeamMemory.Entry }) {
  const q = norm(input.query)
  if (!q) return 0
  const list = tok(q)
  const hit = (value?: string, whole = 0, part = 0) => {
    const x = norm(value ?? "")
    if (!x) return 0
    const base = x.includes(q) ? whole : 0
    if (list.length === 0 || part === 0) return base
    return base + pct(list, tok(x)) * part
  }
  const many = (list: string[], whole = 0, part = 0) => Math.max(0, ...list.map((item) => hit(item, whole, part)))
  return (
    hit(input.entry.title, 8, 6) +
    hit(input.entry.scope, 6, 4) +
    (norm(input.entry.kind) === q || norm(input.entry.domain) === q ? 5 : 0) +
    hit(input.entry.kind, 4, 3) +
    hit(input.entry.domain, 4, 3) +
    many(input.entry.tags, 3, 2) +
    hit(input.entry.content, 2, 2) +
    many(vals(input.entry.payload), 1, 1)
  )
}

function snap(item: TeamMemory.Entry, sensitive: boolean) {
  if (sensitive) {
    return {
      id: item.id,
      area: item.area,
      class: item.class,
      kind: item.kind,
      domain: item.domain,
      status: item.status,
      redacted: true,
    }
  }
  return JSON.parse(JSON.stringify(item)) as Payload
}

export namespace TeamMemory {
  export const Area = z.enum(["project_rules", "feature_memory", "atlas_private", "lessons"]).meta({
    ref: "TeamMemoryArea",
  })
  export type Area = z.infer<typeof Area>

  export const Class = z.enum(["rule", "knowledge", "evidence", "artifact"]).meta({ ref: "TeamMemoryClass" })
  export type Class = z.infer<typeof Class>

  export const Kind = z
    .enum([
      "repo_convention",
      "package_behavior",
      "runtime_behavior",
      "validation",
      "migration_gotcha",
      "finding",
      "remediation",
      "verification",
      "measurement",
      "baseline",
      "optimization",
      "lesson",
      "note",
    ])
    .meta({ ref: "TeamMemoryKind" })
  export type Kind = z.infer<typeof Kind>

  export const Domain = z
    .enum(["general", "security", "performance", "data", "frontend"])
    .meta({ ref: "TeamMemoryDomain" })
  export type Domain = z.infer<typeof Domain>

  export const Status = z.enum(["active", "archived"]).meta({ ref: "TeamMemoryStatus" })
  export type Status = z.infer<typeof Status>

  export const TranslateStatus = z
    .enum(["idle", "waiting", "started", "finished"])
    .meta({ ref: "TeamMemoryTranslateStatus" })
  export type TranslateStatus = z.infer<typeof TranslateStatus>

  export const Entry = z
    .object({
      id: z.string(),
      project_id: ProjectID.zod,
      session_id: SessionID.zod,
      area: Area,
      class: Class,
      kind: Kind,
      domain: Domain,
      title: z.string(),
      content: z.string(),
      scope: z.string().optional(),
      tags: z.array(z.string()),
      status: Status,
      created_by: z.string(),
      updated_by: z.string(),
      source_id: z.string().optional(),
      payload: z.record(z.string(), z.unknown()).optional(),
      meta: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
      title_ui: z.string().optional(),
      content_ui: z.string().optional(),
      ui_locale: z.string().optional(),
      is_translate: z.boolean(),
      translate_status: TranslateStatus,
      translate_done: z.number().int().nonnegative().optional(),
      translate_total: z.number().int().nonnegative().optional(),
      translate_updated: z.number().optional(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
      }),
    })
    .meta({ ref: "TeamMemoryEntry" })
  export type Entry = z.infer<typeof Entry>

  export const ActivityAction = z
    .enum(["read", "write", "validate", "promote", "archive", "remove"])
    .meta({ ref: "TeamMemoryActivityAction" })
  export type ActivityAction = z.infer<typeof ActivityAction>

  export const ActivityEffect = z.enum(["added", "updated", "removed", "read"]).meta({
    ref: "TeamMemoryActivityEffect",
  })
  export type ActivityEffect = z.infer<typeof ActivityEffect>

  export const Activity = z
    .object({
      id: z.string(),
      project_id: ProjectID.zod,
      session_id: SessionID.zod.optional(),
      memory_id: z.string().optional(),
      action: ActivityAction,
      effect: ActivityEffect,
      area: Area.optional(),
      class: Class.optional(),
      kind: Kind.optional(),
      domain: Domain.optional(),
      actor: z.string(),
      title: z.string().optional(),
      query: z.string().optional(),
      count: z.number().optional(),
      time: z.number(),
    })
    .meta({ ref: "TeamMemoryActivity" })
  export type Activity = z.infer<typeof Activity>

  export const Event = {
    Updated: BusEvent.define(
      "memory.updated",
      z.object({
        projectID: ProjectID.zod,
        entry: Entry,
      }),
    ),
    Removed: BusEvent.define(
      "memory.removed",
      z.object({
        projectID: ProjectID.zod,
        memory_id: z.string(),
      }),
    ),
    Activity: BusEvent.define(
      "memory.activity",
      z.object({
        projectID: ProjectID.zod,
        activity: Activity,
      }),
    ),
  }

  export interface Interface {
    readonly list: (input?: {
      area?: Area
      areas?: Area[]
      class?: Class
      classes?: Class[]
      kind?: Kind
      kinds?: Kind[]
      domain?: Domain
      domains?: Domain[]
      status?: Status
      scope?: string
      tag?: string
      limit?: number
    }) => Effect.Effect<Entry[]>
    readonly get: (input: { id: string; areas?: Area[]; domains?: Domain[] }) => Effect.Effect<Entry | undefined>
    readonly search: (input: {
      query: string
      area?: Area
      areas?: Area[]
      class?: Class
      classes?: Class[]
      kind?: Kind
      kinds?: Kind[]
      domain?: Domain
      domains?: Domain[]
      status?: Status
      scope?: string
      tag?: string
      limit?: number
    }) => Effect.Effect<Entry[]>
    readonly write: (input: {
      id?: string
      area: Area
      class?: Class
      kind?: Kind
      domain?: Domain
      title: string
      content: string
      scope?: string
      tags?: string[]
      status?: Status
      source_id?: string
      payload?: Record<string, unknown>
      meta?: Meta
      title_ui?: string
      content_ui?: string
      ui_locale?: string
      is_translate?: boolean
      translate_status?: TranslateStatus
      translate_done?: number
      translate_total?: number
      translate_updated?: number
      sessionID: SessionID
      actor: string
    }) => Effect.Effect<Entry>
    readonly updateIf: (input: {
      id: string
      when: (item: Entry) => boolean
      patch: Partial<Entry>
    }) => Effect.Effect<Entry | undefined>
    readonly promote: (input: {
      id: string
      title?: string
      content?: string
      scope?: string
      tags?: string[]
      kind?: Kind
      sessionID: SessionID
      actor: string
      domains?: Domain[]
    }) => Effect.Effect<Entry | undefined>
    readonly archive: (input: {
      id: string
      sessionID: SessionID
      actor: string
      areas?: Area[]
      domains?: Domain[]
    }) => Effect.Effect<Entry | undefined>
    readonly remove: (input: {
      id: string
      reason: string
      sensitive?: boolean
      sessionID: SessionID
      actor: string
      areas?: Area[]
      domains?: Domain[]
    }) => Effect.Effect<Entry | undefined>
    readonly bulkRemove: (input: {
      ids: string[]
      reason: string
      sensitive?: boolean
      sessionID: SessionID
      actor: string
    }) => Effect.Effect<Entry[]>
    readonly system: (agent: string) => Effect.Effect<string[]>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/TeamMemory") {}

  function root(projectID: string) {
    return path.join(Global.Path.config, "projects", projectID, "memory")
  }

  function entries(projectID: string) {
    return path.join(root(projectID), "entries")
  }

  function tombstones(projectID: string) {
    return path.join(root(projectID), "tombstones")
  }

  function file(projectID: string, id: string) {
    return path.join(entries(projectID), `${id}.json`)
  }

  function tombstone(projectID: string, id: string) {
    return path.join(tombstones(projectID), `${id}.json`)
  }

  function lock(projectID: string, id?: string) {
    return id ? `memory:${projectID}:${id}` : `memory:${projectID}`
  }

  function translationDefaults() {
    return {
      title_ui: undefined as string | undefined,
      content_ui: undefined as string | undefined,
      ui_locale: undefined as string | undefined,
      is_translate: false,
      translate_status: TranslateStatus.enum.idle,
      translate_done: 0,
      translate_total: 0,
      translate_updated: undefined as number | undefined,
    }
  }

  function sameScopeEntry(item: Entry, area: Area, scope?: string) {
    const next = text(scope)
    if (!next) return false
    return item.status === Status.enum.active && item.area === area && item.scope === next
  }

  function match(
    item: Entry,
    input?: {
      area?: Area
      areas?: Area[]
      class?: Class
      classes?: Class[]
      kind?: Kind
      kinds?: Kind[]
      domain?: Domain
      domains?: Domain[]
      status?: Status
      scope?: string
      tag?: string
    },
  ) {
    if (input?.area && item.area !== input.area) return false
    if (input?.areas?.length && !input.areas.includes(item.area)) return false
    if (input?.class && item.class !== input.class) return false
    if (input?.classes?.length && !input.classes.includes(item.class)) return false
    if (input?.kind && item.kind !== input.kind) return false
    if (input?.kinds?.length && !input.kinds.includes(item.kind)) return false
    if (input?.domain && item.domain !== input.domain) return false
    if (input?.domains?.length && !input.domains.includes(item.domain)) return false
    if (input?.status && item.status !== input.status) return false
    if (input?.scope && item.scope !== input.scope) return false
    if (input?.tag && !item.tags.includes(input.tag)) return false
    return true
  }

  async function ensure(projectID: string) {
    await Promise.all([mkdir(entries(projectID), { recursive: true }), mkdir(tombstones(projectID), { recursive: true })])
  }

  async function readEntry(projectID: string, id: string) {
    const item = Bun.file(file(projectID, id))
    if (!(await item.exists())) return
    const raw = await item.json()
    const ui = splitMeta(typeof raw === "object" && raw && "meta" in raw ? ((raw as { meta?: Meta }).meta ?? undefined) : undefined)
    return Entry.parse({
      ...(raw as Record<string, unknown>),
      meta: (raw as { meta?: Meta }).meta ? (ui.meta ?? (raw as { meta?: Meta }).meta) : undefined,
      title_ui: (raw as { title_ui?: string }).title_ui ?? ui.title_ui,
      content_ui: (raw as { content_ui?: string }).content_ui ?? ui.content_ui,
      ui_locale: (raw as { ui_locale?: string }).ui_locale ?? ui.ui_locale,
      is_translate: (raw as { is_translate?: boolean }).is_translate ?? ui.is_translate ?? false,
      translate_status:
        (raw as { translate_status?: TranslateStatus }).translate_status ??
        ui.translate_status ??
        TranslateStatus.enum.idle,
      translate_done: (raw as { translate_done?: number }).translate_done ?? ui.translate_done,
      translate_total: (raw as { translate_total?: number }).translate_total ?? ui.translate_total,
      translate_updated: (raw as { translate_updated?: number }).translate_updated ?? ui.translate_updated,
    })
  }

  async function writeEntry(projectID: string, entry: Entry) {
    await ensure(projectID)
    await Bun.write(file(projectID, entry.id), `${JSON.stringify(entry, null, 2)}\n`)
    const saved = await readEntry(projectID, entry.id)
    if (!saved) throw new Error(`Memory entry ${entry.id} could not be read back after write`)
    return saved
  }

  async function readAll(projectID: string) {
    await ensure(projectID)
    const names = await readdir(entries(projectID)).catch(() => [] as string[])
    const items = await Promise.all(
      names
        .filter((item) => item.endsWith(".json"))
        .map((item) => readEntry(projectID, path.basename(item, ".json"))),
    )
    return items
      .filter((item): item is Entry => !!item)
      .toSorted((a, b) => b.time.updated - a.time.updated || a.id.localeCompare(b.id))
  }

  async function writeTombstone(input: {
    projectID: string
    entry: Entry
    reason: string
    sessionID: SessionID
    actor: string
    sensitive?: boolean
  }) {
    await ensure(input.projectID)
    const body = {
      id: input.entry.id,
      project_id: input.projectID,
      session_id: input.sessionID,
      actor: input.actor,
      reason: input.reason,
      sensitive: !!input.sensitive,
      time: Date.now(),
      snapshot: snap(input.entry, !!input.sensitive),
    }
    await Bun.write(tombstone(input.projectID, input.entry.id), `${JSON.stringify(body, null, 2)}\n`)
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service

      const projectID = Effect.fn("TeamMemory.projectID")(function* () {
        return (yield* InstanceState.context).project.id
      })

      const list = Effect.fn("TeamMemory.list")(function* (input?: {
        area?: Area
        areas?: Area[]
        class?: Class
        classes?: Class[]
        kind?: Kind
        kinds?: Kind[]
        domain?: Domain
        domains?: Domain[]
        status?: Status
        scope?: string
        tag?: string
        limit?: number
      }) {
        const project = yield* projectID()
        const items = yield* Effect.promise(() => readAll(project))
        const filtered = items.filter((item) => match(item, input))
        return filtered.slice(0, input?.limit ?? filtered.length)
      })

      const get = Effect.fn("TeamMemory.get")(function* (input: { id: string; areas?: Area[]; domains?: Domain[] }) {
        const project = yield* projectID()
        const item = yield* Effect.promise(() => readEntry(project, input.id))
        if (!item) return
        if (input.areas?.length && !input.areas.includes(item.area)) return
        if (input.domains?.length && !input.domains.includes(item.domain)) return
        return item
      })

      const search = Effect.fn("TeamMemory.search")(function* (input: {
        query: string
        area?: Area
        areas?: Area[]
        class?: Class
        classes?: Class[]
        kind?: Kind
        kinds?: Kind[]
        domain?: Domain
        domains?: Domain[]
        status?: Status
        scope?: string
        tag?: string
        limit?: number
      }) {
        const items = yield* list(input)
        return items
          .map((entry) => ({ entry, score: score({ query: input.query, entry }) }))
          .filter((item) => item.score > 0)
          .toSorted((a, b) => b.score - a.score || b.entry.time.updated - a.entry.time.updated)
          .slice(0, input.limit ?? 20)
          .map((item) => item.entry)
      })

      const write = Effect.fn("TeamMemory.write")(function* (input: {
        id?: string
        area: Area
        class?: Class
        kind?: Kind
        domain?: Domain
        title: string
        content: string
        scope?: string
        tags?: string[]
        status?: Status
        source_id?: string
        payload?: Record<string, unknown>
        meta?: Meta
        title_ui?: string
        content_ui?: string
        ui_locale?: string
        is_translate?: boolean
        translate_status?: TranslateStatus
        translate_done?: number
        translate_total?: number
        translate_updated?: number
        sessionID: SessionID
        actor: string
      }) {
        const project = yield* projectID()
        const area = Area.parse(input.area)
        const scope = text(input.scope)
        const title = text(input.title)
        const content = text(input.content)
        if (!title) throw new Error("title is required")
        if (!content) throw new Error("content is required")
        if (area === Area.enum.atlas_private && input.actor !== "atlas") {
          throw new Error("atlas_private must be curated by atlas")
        }
        if (featureArea(area)) {
          if (input.actor !== "atlas") throw new Error("feature_memory must be curated by atlas")
          if (!scope) throw new Error("scope is required for feature_memory")
          if ((input.class ?? Class.enum.knowledge) !== Class.enum.knowledge) {
            throw new Error("feature_memory must use class=knowledge")
          }
          if (!behaviorKind(input.kind ?? Kind.enum.package_behavior)) {
            throw new Error("feature_memory kind must be package_behavior or runtime_behavior")
          }
        }

        return yield* Effect.promise(() =>
          Flock.withLock(lock(project, input.id), async () => {
            const items = await readAll(project)
            const previous =
              (input.id ? items.find((item) => item.id === input.id) : undefined) ??
              (featureArea(area)
                ? items.find((item) => sameScopeEntry(item, area, scope))
                : mergeArea(area)
                  ? items.find(
                      (item) =>
                        item.status === Status.enum.active &&
                        item.area === area &&
                        like({ title, content, entry: item }),
                    )
                  : undefined)

            const base = seed(area)
            const payload = need({
              domain: input.domain ?? previous?.domain ?? base.domain,
              kind: input.kind ?? previous?.kind ?? base.kind,
              payload: input.payload,
            })
            const now = Date.now()
            const created = previous?.time.created ?? now
            const merging = mergeArea(area) && previous !== undefined && !input.id
            const sourceChanged =
              previous !== undefined && (previous.title !== title || previous.content !== content)
            const translation = sourceChanged
              ? {
                  ...translationDefaults(),
                  translate_updated: now,
                }
              : {
                  title_ui: input.title_ui ?? previous?.title_ui,
                  content_ui: input.content_ui ?? previous?.content_ui,
                  ui_locale: input.ui_locale ?? previous?.ui_locale,
                  is_translate: input.is_translate ?? previous?.is_translate ?? false,
                  translate_status: input.translate_status ?? previous?.translate_status ?? TranslateStatus.enum.idle,
                  translate_done: input.translate_done ?? previous?.translate_done,
                  translate_total: input.translate_total ?? previous?.translate_total,
                  translate_updated: input.translate_updated ?? previous?.translate_updated,
                }

            const next = Entry.parse({
              id: previous?.id ?? input.id ?? Identifier.ascending("memory"),
              project_id: project,
              session_id: input.sessionID,
              area,
              class: input.class ?? previous?.class ?? base.class,
              kind: input.kind ?? previous?.kind ?? base.kind,
              domain: input.domain ?? previous?.domain ?? base.domain,
              title: merging ? wide(previous.title, title) : title,
              content: merging ? grow(previous.content, content) : content,
              scope: scope ?? previous?.scope,
              tags: merging ? uniq([...(previous?.tags ?? []), ...(input.tags ?? [])]) : (input.tags ?? previous?.tags),
              status: input.status ?? previous?.status ?? Status.enum.active,
              created_by: previous?.created_by ?? input.actor,
              updated_by: input.actor,
              source_id: input.source_id ?? previous?.source_id,
              payload: payload ?? previous?.payload,
              meta: input.meta ?? previous?.meta,
              ...translation,
              time: {
                created,
                updated: now,
              },
            })

            const saved = await writeEntry(project, next)
            await Bus.publish(Event.Updated, {
              projectID: project,
              entry: saved,
            })
            return saved
          }),
        )
      })

      const updateIf = Effect.fn("TeamMemory.updateIf")(function* (input: {
        id: string
        when: (item: Entry) => boolean
        patch: Partial<Entry>
      }) {
        const project = yield* projectID()
        const saved = yield* Effect.promise(() =>
          Flock.withLock(lock(project, input.id), async () => {
            const current = await readEntry(project, input.id)
            if (!current) return
            if (!input.when(current)) return
            const next = Entry.parse({
              ...current,
              ...input.patch,
              time: {
                ...current.time,
                updated: Date.now(),
              },
            })
            return writeEntry(project, next)
          }),
        )
        if (!saved) return
        yield* bus.publish(Event.Updated, {
          projectID: project,
          entry: saved,
        })
        return saved
      })

      const promote = Effect.fn("TeamMemory.promote")(function* (input: {
        id: string
        title?: string
        content?: string
        scope?: string
        tags?: string[]
        kind?: Kind
        sessionID: SessionID
        actor: string
        domains?: Domain[]
      }) {
        const item = yield* get({ id: input.id, areas: [Area.enum.lessons], domains: input.domains })
        if (!item || item.status !== Status.enum.active) return
        return yield* write({
          area: Area.enum.project_rules,
          class: Class.enum.rule,
          kind: input.kind ?? Kind.enum.repo_convention,
          domain: item.domain,
          title: input.title ?? item.title,
          content: input.content ?? item.content,
          scope: input.scope ?? item.scope,
          tags: uniq([...(item.tags ?? []), ...(input.tags ?? [])]),
          source_id: item.id,
          sessionID: input.sessionID,
          actor: input.actor,
        })
      })

      const archive = Effect.fn("TeamMemory.archive")(function* (input: {
        id: string
        sessionID: SessionID
        actor: string
        areas?: Area[]
        domains?: Domain[]
      }) {
        const item = yield* get({ id: input.id, areas: input.areas, domains: input.domains })
        if (!item) return
        if (item.status === Status.enum.archived) return item
        return yield* write({
          id: item.id,
          area: item.area,
          class: item.class,
          kind: item.kind,
          domain: item.domain,
          title: item.title,
          content: item.content,
          scope: item.scope,
          tags: item.tags,
          status: Status.enum.archived,
          source_id: item.source_id,
          payload: item.payload,
          meta: item.meta,
          title_ui: item.title_ui,
          content_ui: item.content_ui,
          ui_locale: item.ui_locale,
          is_translate: item.is_translate,
          translate_status: item.translate_status,
          translate_done: item.translate_done,
          translate_total: item.translate_total,
          translate_updated: item.translate_updated,
          sessionID: input.sessionID,
          actor: input.actor,
        })
      })

      const remove = Effect.fn("TeamMemory.remove")(function* (input: {
        id: string
        reason: string
        sensitive?: boolean
        sessionID: SessionID
        actor: string
        areas?: Area[]
        domains?: Domain[]
      }) {
        const project = yield* projectID()
        const item = yield* get({ id: input.id, areas: input.areas, domains: input.domains })
        if (!item) return
        yield* Effect.promise(() =>
          Flock.withLock(lock(project, item.id), async () => {
            await writeTombstone({
              projectID: project,
              entry: item,
              reason: input.reason,
              sessionID: input.sessionID,
              actor: input.actor,
              sensitive: input.sensitive,
            })
            await unlink(file(project, item.id)).catch(() => undefined)
          }),
        )
        yield* bus.publish(Event.Removed, {
          projectID: project,
          memory_id: item.id,
        })
        return item
      })

      const bulkRemove = Effect.fn("TeamMemory.bulkRemove")(function* (input: {
        ids: string[]
        reason: string
        sensitive?: boolean
        sessionID: SessionID
        actor: string
      }) {
        const found = yield* Effect.forEach(uniq(input.ids), (id) => get({ id }), { concurrency: 8 })
        const items = found.filter((item): item is Entry => !!item)
        if (items.length !== uniq(input.ids).length) {
          throw new Error("bulkRemove requires every requested id to resolve")
        }
        for (const item of items) {
          yield* remove({
            id: item.id,
            reason: input.reason,
            sensitive: input.sensitive,
            sessionID: input.sessionID,
            actor: input.actor,
          })
        }
        return items
      })

      const system = Effect.fn("TeamMemory.system")(function* (agent: string) {
        const rules = yield* list({
          area: Area.enum.project_rules,
          class: Class.enum.rule,
          status: Status.enum.active,
          limit: 20,
        })
        const out = [
          fmt(
            [
              "DİKKAT PROJE KURALLARI",
              "The following active project rules are mandatory constraints.",
              "Follow them when they apply. Do not bypass, ignore, weaken, or override them.",
            ].join("\n"),
            rules,
          ),
        ]
        if (agent === "atlas") {
          const [notes, lessons] = yield* Effect.all([
            list({
              area: Area.enum.atlas_private,
              status: Status.enum.active,
              limit: 16,
            }),
            list({
              area: Area.enum.lessons,
              status: Status.enum.active,
              limit: 24,
            }),
          ])
          out.push(fmt("ATLAS private memory (keep private):", notes, { limit: 8, size: 1200 }))
          out.push(fmt("Lessons (evidence, not rules):", lessons, { limit: 10, size: 1600 }))
        }
        return out.filter((item): item is string => !!item)
      })

      return Service.of({ list, get, search, write, updateIf, promote, archive, remove, bulkRemove, system })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(Bus.layer))
}

const runtime = makeRuntime(TeamMemory.Service, TeamMemory.defaultLayer)

export async function list(input?: {
  area?: TeamMemory.Area
  areas?: TeamMemory.Area[]
  class?: TeamMemory.Class
  classes?: TeamMemory.Class[]
  kind?: TeamMemory.Kind
  kinds?: TeamMemory.Kind[]
  domain?: TeamMemory.Domain
  domains?: TeamMemory.Domain[]
  status?: TeamMemory.Status
  scope?: string
  tag?: string
  limit?: number
}) {
  return runtime.runPromise((svc) => svc.list(input))
}

export async function get(input: {
  id: string
  areas?: TeamMemory.Area[]
  domains?: TeamMemory.Domain[]
}) {
  return runtime.runPromise((svc) => svc.get(input))
}

export async function search(input: {
  query: string
  area?: TeamMemory.Area
  areas?: TeamMemory.Area[]
  class?: TeamMemory.Class
  classes?: TeamMemory.Class[]
  kind?: TeamMemory.Kind
  kinds?: TeamMemory.Kind[]
  domain?: TeamMemory.Domain
  domains?: TeamMemory.Domain[]
  status?: TeamMemory.Status
  scope?: string
  tag?: string
  limit?: number
}) {
  return runtime.runPromise((svc) => svc.search(input))
}

export async function write(input: {
  id?: string
  area: TeamMemory.Area
  class?: TeamMemory.Class
  kind?: TeamMemory.Kind
  domain?: TeamMemory.Domain
  title: string
  content: string
  scope?: string
  tags?: string[]
  status?: TeamMemory.Status
  source_id?: string
  payload?: Record<string, unknown>
  meta?: Meta
  title_ui?: string
  content_ui?: string
  ui_locale?: string
  is_translate?: boolean
  translate_status?: TeamMemory.TranslateStatus
  translate_done?: number
  translate_total?: number
  translate_updated?: number
  sessionID: SessionID
  actor: string
}) {
  return runtime.runPromise((svc) => svc.write(input))
}

export async function promote(input: {
  id: string
  title?: string
  content?: string
  scope?: string
  tags?: string[]
  kind?: TeamMemory.Kind
  sessionID: SessionID
  actor: string
  domains?: TeamMemory.Domain[]
}) {
  return runtime.runPromise((svc) => svc.promote(input))
}

export async function archive(input: {
  id: string
  sessionID: SessionID
  actor: string
  areas?: TeamMemory.Area[]
  domains?: TeamMemory.Domain[]
}) {
  return runtime.runPromise((svc) => svc.archive(input))
}

export async function remove(input: {
  id: string
  reason: string
  sensitive?: boolean
  sessionID: SessionID
  actor: string
  areas?: TeamMemory.Area[]
  domains?: TeamMemory.Domain[]
}) {
  return runtime.runPromise((svc) => svc.remove(input))
}

export async function bulkRemove(input: {
  ids: string[]
  reason: string
  sensitive?: boolean
  sessionID: SessionID
  actor: string
}) {
  return runtime.runPromise((svc) => svc.bulkRemove(input))
}

export async function system(agent: string) {
  return runtime.runPromise((svc) => svc.system(agent))
}

const teamMemoryRuntime = {
  list,
  get,
  search,
  write,
  promote,
  archive,
  remove,
  bulkRemove,
  system,
}

export namespace TeamMemory {
  export const list = (...args: Parameters<typeof import("./memory").list>) => teamMemoryRuntime.list(...args)
  export const get = (...args: Parameters<typeof import("./memory").get>) => teamMemoryRuntime.get(...args)
  export const search = (...args: Parameters<typeof import("./memory").search>) => teamMemoryRuntime.search(...args)
  export const write = (...args: Parameters<typeof import("./memory").write>) => teamMemoryRuntime.write(...args)
  export const promote = (...args: Parameters<typeof import("./memory").promote>) => teamMemoryRuntime.promote(...args)
  export const archive = (...args: Parameters<typeof import("./memory").archive>) => teamMemoryRuntime.archive(...args)
  export const remove = (...args: Parameters<typeof import("./memory").remove>) => teamMemoryRuntime.remove(...args)
  export const bulkRemove = (...args: Parameters<typeof import("./memory").bulkRemove>) =>
    teamMemoryRuntime.bulkRemove(...args)
  export const system = (...args: Parameters<typeof import("./memory").system>) => teamMemoryRuntime.system(...args)
}
