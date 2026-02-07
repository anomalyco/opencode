import { parseExpression } from "cron-parser"
import z from "zod"
import { BusEvent } from "../bus/bus-event"
import { GlobalBus } from "../bus/global"
import { Identifier } from "../id/id"
import { Instance } from "../project/instance"
import { InstanceBootstrap } from "../project/bootstrap"
import { Scheduler } from "../scheduler"
import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { Storage } from "../storage/storage"
import { Log } from "../util/log"
import { fn } from "../util/fn"
import { getFilename } from "@opencode-ai/util/path"
import { Config } from "../config/config"

export namespace Automation {
  const log = Log.create({ service: "automation" })
  const running = new Set<string>()
  const interval = 60 * 1000

  export const Info = z
    .object({
      id: Identifier.schema("automation"),
      name: z.string(),
      projects: z.array(z.string()),
      prompt: z.string(),
      schedule: z.string().nullable(),
      enabled: z.boolean(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
      }),
      lastRun: z.number().optional(),
      nextRun: z.number().optional(),
      lastSession: z
        .object({
          id: Identifier.schema("session"),
          directory: z.string(),
        })
        .optional(),
      createdBy: z.string().optional(),
      updatedBy: z.string().optional(),
    })
    .meta({
      ref: "Automation",
    })
  export type Info = z.output<typeof Info>

  export const Preview = z
    .object({
      valid: z.boolean(),
      nextRun: z.number().optional(),
      error: z.string().optional(),
    })
    .meta({
      ref: "AutomationPreview",
    })
  export type Preview = z.output<typeof Preview>

  export const Run = z
    .object({
      id: Identifier.schema("automation_run"),
      automationID: Identifier.schema("automation"),
      directory: z.string(),
      sessionID: Identifier.schema("session").optional(),
      status: z.enum(["success", "failed"]),
      error: z.string().optional(),
      time: z.number(),
    })
    .meta({
      ref: "AutomationRun",
    })
  export type Run = z.output<typeof Run>

  export const HistoryClear = z
    .object({
      cleared: z.number(),
    })
    .meta({
      ref: "AutomationHistoryClear",
    })
  export type HistoryClear = z.output<typeof HistoryClear>

  export const Event = {
    Created: BusEvent.define("automation.created", Info),
    Updated: BusEvent.define("automation.updated", Info),
    Deleted: BusEvent.define("automation.deleted", Info),
    Run: BusEvent.define("automation.run", Run),
  }

  const ScheduleInput = z
    .string()
    .optional()
    .nullable()
    .superRefine((value, ctx) => {
      const schedule = normalizeSchedule(value)
      if (!schedule) return
      const preview = previewSchedule(schedule, Date.now())
      if (preview.valid) return
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: preview.error ?? "Invalid schedule",
      })
    })

  const NonEmptyInput = z.string().refine((value) => value.trim().length > 0, "Required")

  const CreateInput = z.object({
    name: NonEmptyInput,
    projects: z
      .array(z.string())
      .min(1)
      .transform((input) => [...new Set(input.map((item) => item.trim()).filter(Boolean))])
      .refine((input) => input.length > 0, "At least one project is required"),
    prompt: NonEmptyInput,
    schedule: ScheduleInput,
    enabled: z.boolean().optional(),
  })

  const UpdateInput = z.object({
    id: Identifier.schema("automation"),
    name: NonEmptyInput.optional(),
    projects: z
      .array(z.string())
      .min(1)
      .transform((input) => [...new Set(input.map((item) => item.trim()).filter(Boolean))])
      .refine((input) => input.length > 0, "At least one project is required")
      .optional(),
    prompt: NonEmptyInput.optional(),
    schedule: ScheduleInput,
    enabled: z.boolean().optional(),
  })

  export const create = fn(CreateInput, async (input) => {
    const now = Date.now()
    const user = (await Config.getGlobal()).username?.trim()
    const schedule = normalizeSchedule(input.schedule) ?? null
    const enabled = input.enabled ?? !!schedule
    const info: Info = {
      id: Identifier.descending("automation"),
      name: input.name.trim(),
      projects: input.projects,
      prompt: input.prompt,
      schedule,
      enabled,
      time: {
        created: now,
        updated: now,
      },
      nextRun: enabled ? nextRun(schedule, now) : undefined,
      ...(user ? { createdBy: user, updatedBy: user } : {}),
    }
    await Storage.write(["automation", info.id], info)
    emit(Event.Created, info)
    return info
  })

  export const update = fn(UpdateInput, async (input) => {
    const now = Date.now()
    const user = (await Config.getGlobal()).username?.trim()
    const schedule = normalizeSchedule(input.schedule)
    const result = await Storage.update<Info>(["automation", input.id], (draft) => {
      if (input.name !== undefined) draft.name = input.name.trim()
      if (input.projects !== undefined) draft.projects = input.projects
      if (input.prompt !== undefined) draft.prompt = input.prompt
      if (schedule !== undefined) draft.schedule = schedule
      if (input.enabled !== undefined) draft.enabled = input.enabled
      if (schedule !== undefined || input.enabled !== undefined) {
        draft.nextRun = shouldSchedule(draft) ? nextRun(draft.schedule, now) : undefined
      }
      draft.time.updated = now
      if (user) draft.updatedBy = user
    })
    emit(Event.Updated, result)
    return result
  })

  export const preview = fn(
    z.object({
      schedule: ScheduleInput,
    }),
    async (input) => {
      const schedule = normalizeSchedule(input.schedule)
      if (!schedule) return { valid: true }
      return previewSchedule(schedule, Date.now())
    },
  )

  export async function list() {
    const keys = await Storage.list(["automation"])
    const rootKeys = keys.filter((key) => key.length === 2)
    const items = await Promise.all(rootKeys.map((key) => Storage.read<Info>(key).catch(() => undefined)))

    return items.filter((item): item is Info => !!item).sort((a, b) => (b.time.updated ?? 0) - (a.time.updated ?? 0))
  }

  export async function get(id: string) {
    return Storage.read<Info>(["automation", id])
  }

  export const history = fn(
    z.object({
      id: Identifier.schema("automation"),
      limit: z.number().int().positive().optional(),
    }),
    async (input) => {
      await get(input.id)
      const keys = await Storage.list(["automation", input.id, "run"])
      const items = await Promise.all(keys.map((key) => Storage.read<Run>(key).catch(() => undefined)))
      const runs = items
        .filter((item): item is Run => !!item)
        .map((run) => {
          const time = Number.isFinite(run.time) && run.time > 0 ? run.time : Identifier.timestampDescending(run.id)
          return { ...run, time }
        })
        .filter((run) => Number.isFinite(run.time) && run.time > 0)
        .sort((a, b) => b.time - a.time)
      if (input.limit) return runs.slice(0, input.limit)
      return runs
    },
  )

  export const clearHistory = fn(
    z.object({
      id: Identifier.schema("automation").optional(),
    }),
    async (input) => {
      const ids = input.id ? [input.id] : (await list()).map((info) => info.id)
      const runs = input.id
        ? await Storage.list(["automation", input.id, "run"])
        : (await Storage.list(["automation"])).filter((key) => key.length > 2 && key[2] === "run")

      if (runs.length === 0 && ids.length === 0) return { cleared: 0 }

      await Promise.all(runs.map((key) => Storage.remove(key)))
      await Promise.all(
        ids.map((id) =>
          Storage.update<Info>(["automation", id], (draft) => {
            draft.lastRun = undefined
            draft.lastSession = undefined
          })
            .then((updated) => {
              emit(Event.Updated, updated)
              return updated
            })
            .catch(() => undefined),
        ),
      )

      return { cleared: runs.length }
    },
  )

  export const remove = fn(Identifier.schema("automation"), async (id) => {
    const info = await get(id)
    const runs = await Storage.list(["automation", id, "run"])
    await Promise.all(runs.map((key) => Storage.remove(key)))
    await Storage.remove(["automation", id])
    emit(Event.Deleted, info)
    return info
  })

  export async function init() {
    Scheduler.register({
      id: "automation.schedule",
      interval,
      run: tick,
      scope: "global",
    })
  }

  export const run = fn(
    z.object({
      id: Identifier.schema("automation"),
    }),
    async (input) => {
      const info = await get(input.id)
      void execute(info).catch((error) => {
        log.error("automation manual run failed", {
          id: info.id,
          error: error instanceof Error ? error.message : String(error),
        })
      })
      return info
    },
  )

  async function tick() {
    const now = Date.now()
    const automations = await list()

    const due = automations.filter((info) => {
      if (!shouldSchedule(info)) return false

      const next = info.nextRun ?? nextRun(info.schedule, now)
      if (!next) return false

      return next <= now
    })
    if (due.length === 0) return

    await Promise.allSettled(due.map((info) => execute(info)))
  }

  async function execute(info: Info) {
    if (running.has(info.id)) return info
    running.add(info.id)
    try {
      const started = Date.now()
      const rawPrompt = info.prompt.trim()
      if (!rawPrompt) {
        const completed = Date.now()
        const updated = await Storage.update<Info>(["automation", info.id], (draft) => {
          draft.lastRun = completed
          draft.nextRun = shouldSchedule(draft) ? nextRun(draft.schedule, completed) : undefined
          draft.time.updated = completed
        })
        emit(Event.Updated, updated)
        return updated
      }

      const projects = info.projects.map((item) => item.trim()).filter(Boolean)
      const targets = [...new Set(projects)]
      const runs = await Promise.all(
        targets.map((directory) => {
          let sessionID: string | undefined
          return Instance.provide({
            directory,
            init: InstanceBootstrap,
            fn: async () => {
              const prompt = await renderPrompt(rawPrompt, started)
              const session = await Session.create({
                title: info.name,
                automation: { id: info.id, name: info.name },
              })
              sessionID = session.id

              if (prompt.startsWith("/")) {
                const match = prompt.slice(1).match(/^(\S+)\s*(.*)$/s)
                const command = match?.[1]
                if (!command) return
                const args = match?.[2] ?? ""
                const parts = await SessionPrompt.resolvePromptParts(args)
                const files = parts.filter((part) => part.type === "file")
                await SessionPrompt.command({
                  sessionID: session.id,
                  command,
                  arguments: args,
                  parts: files,
                })
                return
              }

              const parts = await SessionPrompt.resolvePromptParts(prompt)
              await SessionPrompt.prompt({ sessionID: session.id, parts })
            },
          })
            .then(() => ({ directory, sessionID, status: "success" as const }))
            .catch((error) => ({
              directory,
              sessionID,
              status: "failed" as const,
              error: error instanceof Error ? error.message : String(error),
            }))
        }),
      )

      const failed = runs.filter((result) => result.status === "failed")
      if (failed.length > 0) {
        log.warn("automation run failed", {
          id: info.id,
          count: failed.length,
          errors: failed.map((result) => result.error),
        })
      }

      const entries = runs.map((result) => ({
        id: Identifier.descending("automation_run"),
        automationID: info.id,
        directory: result.directory,
        sessionID: result.sessionID,
        status: result.status,
        error: result.status === "failed" ? result.error : undefined,
        time: started,
      }))

      await Promise.all(entries.map((entry) => Storage.write(["automation", info.id, "run", entry.id], entry)))
      for (const entry of entries) {
        GlobalBus.emit("event", {
          directory: "global",
          payload: {
            type: Event.Run.type,
            properties: entry,
          },
        })
      }

      const reversed = [...entries].reverse()
      const lastSuccess = reversed.find((entry) => entry.sessionID && entry.status === "success")
      const lastAny = lastSuccess ?? reversed.find((entry) => entry.sessionID)
      const lastSession = lastAny?.sessionID ? { id: lastAny.sessionID, directory: lastAny.directory } : undefined
      const completed = Date.now()

      const updated = await Storage.update<Info>(["automation", info.id], (draft) => {
        draft.lastRun = completed
        draft.nextRun = shouldSchedule(draft) ? nextRun(draft.schedule, completed) : undefined
        draft.time.updated = completed
        draft.lastSession = lastSession
      })
      emit(Event.Updated, updated)
      return updated
    } finally {
      running.delete(info.id)
    }
  }

  function shouldSchedule(info: Info) {
    if (!info.enabled) return false
    if (!info.schedule) return false

    return true
  }

  async function renderPrompt(value: string, now: number) {
    const project = Instance.project
    const name = project.name?.trim() || getFilename(project.worktree)
    const date = new Date(now).toLocaleDateString()

    let result = value.replace(/{{\s*date\s*}}/gi, date)
    result = result.replace(/{{\s*project\.name\s*}}/gi, name)

    if (!/{{\s*session\./i.test(result)) return result

    const sessions: Session.Info[] = []
    for await (const session of Session.list()) {
      sessions.push(session)
    }
    sessions.sort((a, b) => b.time.updated - a.time.updated)

    const latest = sessions[0]
    const latestLabel = latest ? `Latest session: ${latest.title} (${latest.id})` : "Latest session: none"

    result = result.replace(/{{\s*session\.latest\s*}}/gi, latestLabel)
    result = result.replace(/{{\s*session\.query\s*:\s*([^}]+)\s*}}/gi, (_, query: string) => {
      const term = query.trim().toLowerCase()
      if (!term) return ""
      const matches = sessions.filter((session) => session.title.toLowerCase().includes(term))
      const limited = matches.slice(0, 3)
      if (limited.length === 0) return "No matching sessions"
      return limited.map((session) => `- ${session.title} (${session.id})`).join("\n")
    })

    return result
  }

  function normalizeSchedule(value: string | null | undefined) {
    if (value === undefined) return undefined
    if (value === null) return null
    const trimmed = value.trim()
    if (!trimmed) return null

    return trimmed
  }

  function previewSchedule(schedule: string, now: number): Preview {
    const result = parseNexts(schedule, now)
    if (result.error) return { valid: false, error: result.error }

    return { valid: true, nextRun: Math.min(...result.nexts) }
  }

  function nextRun(schedule: string | null, now: number) {
    if (!schedule) return

    const result = parseNexts(schedule, now)
    if (result.error) {
      log.warn("invalid schedule", { schedule, error: result.error })
      return
    }

    return Math.min(...result.nexts)
  }

  function parseNexts(schedule: string, now: number) {
    const items = schedule
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
    if (items.length === 0) return { nexts: [], error: "Schedule is empty" }

    const parsed = items.map((item) => parseNext(item, now))
    const error = parsed.find((result) => result.error)?.error
    if (error) return { nexts: [], error }

    const values = parsed.map((result) => result.next)
    const nexts = values.filter((value): value is number => typeof value === "number")
    if (nexts.length === 0) return { nexts: [], error: "No future runs found" }

    return { nexts }
  }

  function parseNext(item: string, now: number) {
    // cron-parser throws on invalid expressions; centralize the catch here.
    try {
      const parsed = parseExpression(item, { currentDate: new Date(now) })
      const next = parsed.next()
      if (next instanceof Date) return { next: next.getTime() }
      if (typeof next.toDate === "function") return { next: next.toDate().getTime() }
      if (typeof next.getTime === "function") return { next: next.getTime() }

      return { next: undefined }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid schedule"
      return { error: message }
    }
  }

  function emit(event: (typeof Event)[keyof typeof Event], info: Info) {
    GlobalBus.emit("event", {
      payload: {
        type: event.type,
        properties: info,
      },
    })
  }
}
