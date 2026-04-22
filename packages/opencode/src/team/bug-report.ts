import { Global } from "@/global"
import { Project } from "@/project/project"
import { Flock } from "@/util/flock"
import { BusEvent } from "@/bus/bus-event"
import { ProjectID } from "@/project/schema"
import { MessageID, SessionID } from "@/session/schema"
import { mkdir } from "node:fs/promises"
import path from "path"
import z from "zod"

export namespace TeamBugReport {
  export const TranslateStatus = z.enum(["idle", "waiting", "started", "finished"])
  export type TranslateStatus = z.infer<typeof TranslateStatus>

  export const file = path.join(Global.Path.config, "bug-report.json")
  export const global_legacy = path.join(Global.Path.data, "bug-report", "reports.jsonl")
  export const legacy = ".opencode/bug-report/reports.jsonl"
  export const Entry = z
    .object({
      id: z.string(),
      project_id: ProjectID.zod,
      project_name: z.string(),
      session_id: SessionID.zod,
      message_id: MessageID.zod,
      call_id: z.string().optional(),
      agent: z.string(),
      worktree: z.string(),
      cwd: z.string(),
      kind: z.enum(["bug", "suggestion", "feature"]).default("bug"),
      title: z.string(),
      summary: z.string(),
      title_ui: z.string().optional(),
      summary_ui: z.string().optional(),
      area: z.string().optional(),
      tool_name: z.string().optional(),
      impact: z.string().optional(),
      impact_ui: z.string().optional(),
      repro: z.string().optional(),
      repro_ui: z.string().optional(),
      expected: z.string().optional(),
      expected_ui: z.string().optional(),
      actual: z.string().optional(),
      actual_ui: z.string().optional(),
      suggestion: z.string().optional(),
      suggestion_ui: z.string().optional(),
      ui_locale: z.string().optional(),
      is_translate: z.boolean().optional(),
      translate_status: TranslateStatus.optional(),
      translate_done: z.number().int().nonnegative().optional(),
      translate_total: z.number().int().nonnegative().optional(),
      translate_updated: z.number().optional(),
      time: z.number(),
      created_at: z.string(),
    })
    .meta({ ref: "TeamBugReportEntry" })
  export type Entry = z.infer<typeof Entry>
  export const Filter = z
    .object({
      ids: z.array(z.string()).min(1).optional(),
      kind: z.enum(["bug", "suggestion", "feature"]).optional(),
      agent: z.string().optional(),
      project_id: z.string().optional(),
      project_name: z.string().optional(),
      worktree: z.string().optional(),
      cwd: z.string().optional(),
      area: z.string().optional(),
      tool_name: z.string().optional(),
    })
    .meta({ ref: "TeamBugReportFilter" })
  export type Filter = z.infer<typeof Filter>
  export const Patch = Entry.pick({
    kind: true,
    title: true,
    summary: true,
    title_ui: true,
    summary_ui: true,
    area: true,
    tool_name: true,
    impact: true,
    impact_ui: true,
    repro: true,
    repro_ui: true,
    expected: true,
    expected_ui: true,
    actual: true,
    actual_ui: true,
    suggestion: true,
    suggestion_ui: true,
    ui_locale: true,
  }).partial()
  export type Patch = z.infer<typeof Patch>

  function stale(patch: Patch) {
    return (
      "title" in patch ||
      "summary" in patch ||
      "impact" in patch ||
      "repro" in patch ||
      "expected" in patch ||
      "actual" in patch ||
      "suggestion" in patch
    )
  }

  function reset() {
    return {
      title_ui: undefined,
      summary_ui: undefined,
      impact_ui: undefined,
      repro_ui: undefined,
      expected_ui: undefined,
      actual_ui: undefined,
      suggestion_ui: undefined,
      ui_locale: undefined,
      is_translate: false,
      translate_status: TranslateStatus.enum.idle,
      translate_done: 0,
      translate_total: 0,
      translate_updated: Date.now(),
    }
  }

  function translated(item: Entry) {
    if (item.ui_locale === undefined) return false
    if (!item.title_ui || !item.summary_ui) return false
    if (item.impact && !item.impact_ui) return false
    if (item.repro && !item.repro_ui) return false
    if (item.expected && !item.expected_ui) return false
    if (item.actual && !item.actual_ui) return false
    if (item.suggestion && !item.suggestion_ui) return false
    return true
  }

  function full(item: Entry): Entry {
    const is_translate = item.is_translate ?? translated(item)
    return {
      ...item,
      is_translate,
      translate_status:
        item.translate_status ?? (is_translate ? TranslateStatus.enum.finished : TranslateStatus.enum.idle),
      translate_done: item.translate_done,
      translate_total: item.translate_total,
      translate_updated: item.translate_updated,
    }
  }

  function uniq(list: Entry[]) {
    return [...new Map(list.map((item) => [item.id, item])).values()]
  }

  function match(item: Entry, filter?: Filter) {
    if (!filter) return true
    if (filter.ids && !filter.ids.includes(item.id)) return false
    if (filter.kind && item.kind !== filter.kind) return false
    if (filter.agent && item.agent !== filter.agent) return false
    if (filter.project_id && item.project_id !== filter.project_id) return false
    if (filter.project_name && item.project_name !== filter.project_name) return false
    if (filter.worktree && item.worktree !== filter.worktree) return false
    if (filter.cwd && item.cwd !== filter.cwd) return false
    if (filter.area && item.area !== filter.area) return false
    if (filter.tool_name && item.tool_name !== filter.tool_name) return false
    return true
  }

  function text(input?: string) {
    const value = input?.trim()
    if (!value) return
    const low = value.toLowerCase()
    if (low === "x" || low === "dummy" || low === "placeholder" || low === "__none__") return
    return value
  }

  function clean(filter?: Filter): Filter | undefined {
    if (!filter) return
    const next: Filter = {}
    const ids =
      filter.ids?.map((item) => text(item)).filter((item): item is string => !!item && item.startsWith("tool_")) ?? []
    if (ids.length > 0) next.ids = ids
    if (filter.kind) next.kind = filter.kind

    const agent = text(filter.agent)
    if (agent) next.agent = agent
    const project_id = text(filter.project_id)
    if (project_id) next.project_id = project_id
    const project_name = text(filter.project_name)
    if (project_name) next.project_name = project_name
    const worktree = text(filter.worktree)
    if (worktree) next.worktree = worktree
    const cwd = text(filter.cwd)
    if (cwd) next.cwd = cwd
    const area = text(filter.area)
    if (area) next.area = area
    const tool_name = text(filter.tool_name)
    if (tool_name) next.tool_name = tool_name

    return Object.keys(next).length > 0 ? next : undefined
  }

  function json(text: string) {
    const value = text.trim()
    if (!value) return undefined
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed))
        return parsed.flatMap((item) => {
          const row = Entry.safeParse(item)
          return row.success ? [full(row.data)] : []
        })
      const row = Entry.safeParse(parsed)
      return row.success ? [full(row.data)] : []
    } catch {
      return undefined
    }
  }

  function parse(text: string) {
    const value = json(text)
    if (value) return value
    return text
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const parsed = Entry.safeParse(JSON.parse(line))
          return parsed.success ? [full(parsed.data)] : []
        } catch {
          return []
        }
      })
  }

  async function read(file: string) {
    return parse(
      await Bun.file(file)
        .text()
        .catch(() => ""),
    )
  }

  async function write(file: string, list: Entry[]) {
    await mkdir(path.dirname(file), { recursive: true })
    await Bun.write(file, list.length ? list.map((item) => JSON.stringify(item)).join("\n") + "\n" : "")
  }

  async function dirs(root?: string) {
    const list = await Project.list()
    return Array.from(new Set([root, ...list.flatMap((item) => [item.worktree, ...item.sandboxes])])).filter(
      (item): item is string => !!item && item !== "/",
    )
  }

  function local(dir: string) {
    return path.join(dir, legacy)
  }

  async function legacy_files(root?: string) {
    return Array.from(new Set([global_legacy, ...(await dirs(root)).map((dir) => local(dir))]))
  }

  async function files(root?: string) {
    return [file, ...(await legacy_files(root))]
  }

  async function syncer(root?: string) {
    const rows = await read(file)
    const seen = new Set(rows.map((item) => item.id))
    const next = (await Promise.all((await legacy_files(root)).map((name) => read(name)))).flat().filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
    if (!next.length) return []
    await write(file, [...rows, ...next])
    return next
  }

  export async function sync(root?: string) {
    return Flock.withLock("team-bug-report", async () => syncer(root))
  }

  export async function list(root?: string, filter?: Filter) {
    await sync(root)
    const next = clean(filter)
    return (await read(file)).filter((item) => match(item, next))
  }

  export async function create(input: { root?: string; entry: Entry }) {
    return Flock.withLock("team-bug-report", async () => {
      await syncer(input.root)
      const entry = full(input.entry)
      await write(file, [...(await read(file)), entry])
      return entry
    })
  }

  export async function update(input: { root?: string; id: string; patch: Patch }) {
    return Flock.withLock("team-bug-report", async () => {
      await syncer(input.root)
      const list = await Promise.all(
        (await files(input.root)).map(async (name) => {
          const rows = await read(name)
          const row = rows.find((item) => item.id === input.id)
          if (!row) return { name, next: rows, item: undefined, changed: false }
          const item = full(
            Entry.parse({
              ...row,
              ...(stale(input.patch) ? reset() : {}),
              ...input.patch,
            }),
          )
          return {
            name,
            next: rows.map((entry) => (entry.id === input.id ? item : entry)),
            item,
            changed: true,
          }
        }),
      )
      await Promise.all(list.filter((item) => item.changed).map((item) => write(item.name, item.next)))
      return list.flatMap((item) => (item.item ? [item.item] : [])).at(0)
    })
  }

  export async function remove(input: { root?: string; ids: string[] }) {
    const ids = new Set(input.ids)
    return Flock.withLock("team-bug-report", async () => {
      await syncer(input.root)
      const list = await Promise.all(
        (await files(input.root)).map(async (name) => {
          const rows = await read(name)
          return {
            name,
            keep: rows.filter((item) => !ids.has(item.id)),
            drop: rows.filter((item) => ids.has(item.id)),
          }
        }),
      )
      await Promise.all(list.filter((item) => item.drop.length).map((item) => write(item.name, item.keep)))
      return uniq(list.flatMap((item) => item.drop))
    })
  }

  export async function clear(input?: { root?: string; filter?: Filter }) {
    return Flock.withLock("team-bug-report", async () => {
      await syncer(input?.root)
      const filter = clean(input?.filter)
      if (input?.filter && !filter) return []
      const list = await Promise.all(
        (await files(input?.root)).map(async (name) => {
          const rows = await read(name)
          return {
            name,
            keep: rows.filter((item) => !match(item, filter)),
            drop: rows.filter((item) => match(item, filter)),
          }
        }),
      )
      await Promise.all(list.filter((item) => item.drop.length).map((item) => write(item.name, item.keep)))
      return uniq(list.flatMap((item) => item.drop))
    })
  }

  export const Event = {
    Created: BusEvent.define(
      "bug_report.created",
      z.object({
        projectID: ProjectID.zod,
        entry: Entry,
        file: z.string(),
      }),
    ),
    Updated: BusEvent.define(
      "bug_report.updated",
      z.object({
        projectID: ProjectID.zod,
        entry: Entry,
        file: z.string(),
      }),
    ),
    Removed: BusEvent.define(
      "bug_report.removed",
      z.object({
        report_ids: z.array(z.string()).min(1),
        file: z.string(),
      }),
    ),
  }
}
