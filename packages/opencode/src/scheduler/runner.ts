import { Cron } from "croner"
import * as Log from "@opencode-ai/core/util/log"
import { AppRuntime } from "@/effect/app-runtime"
import { Instance, type InstanceContext } from "@/project/instance"
import { InstanceRuntime } from "@/project/instance-runtime"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { SessionPrompt } from "@/session/prompt"
import * as Session from "@/session/session"
import type { SessionID } from "@/session/schema"
import { SchedulerStore, type Job } from "./store"

const log = Log.create({ service: "scheduler.runner" })

type State = {
  timer?: ReturnType<typeof setTimeout>
  active: number
  running: boolean
  dirty: boolean
  waking: boolean
  queue: Job[]
  next: Map<string, number>
  sessions: Map<string, SessionID>
  jobs: Map<string, Job>
  inflight: Set<Promise<void>>
  context?: InstanceContext
}

const state: State = {
  active: 0,
  running: false,
  dirty: false,
  waking: false,
  queue: [],
  next: new Map(),
  sessions: new Map(),
  jobs: new Map(),
  inflight: new Set(),
}

function nextRun(job: Job, from = Date.now()) {
  try {
    const cron = new Cron(job.schedule, { paused: true })
    const date = cron.nextRun(new Date(from))
    return date ? date.getTime() : undefined
  } catch {
    return undefined
  }
}

async function inCtx<T>(ctx: InstanceContext, task: () => Promise<T>) {
  return Instance.restore(ctx, task)
}

async function fx<T>(task: () => Promise<T>) {
  if (!state.context) throw new Error("scheduler runner is not initialized")
  return inCtx(state.context, task)
}

async function limit() {
  return fx(async () => {
    const cfg = await AppRuntime.runPromise(Config.Service.use((svc) => svc.get()))
    const max = cfg.scheduler?.maxConcurrent ?? 1
    if (!Number.isFinite(max) || max < 1) return 1
    return Math.floor(max)
  })
}

async function run(job: Job, ctx?: InstanceContext) {
  const model =
    job.model ??
    (await (ctx
      ? inCtx(ctx, () => AppRuntime.runPromise(Provider.Service.use((svc) => svc.defaultModel())))
      : fx(() => AppRuntime.runPromise(Provider.Service.use((svc) => svc.defaultModel())))))

  let sessionID = state.sessions.get(job.id)
  if (!sessionID) {
    const created = await (ctx
      ? inCtx(ctx, () => AppRuntime.runPromise(Session.Service.use((svc) => svc.create({ title: `Scheduler ${job.id}` }))))
      : fx(() => AppRuntime.runPromise(Session.Service.use((svc) => svc.create({ title: `Scheduler ${job.id}` })))))
    sessionID = created.id
    state.sessions.set(job.id, sessionID)
  }

  const msg = await (ctx
    ? inCtx(ctx, () =>
        AppRuntime.runPromise(
          SessionPrompt.Service.use((svc) =>
            svc.prompt({
              sessionID,
              agent: job.agent,
              model,
              variant: job.variant,
              parts: [{ type: "text", text: job.prompt }],
            }),
          ),
        ),
      )
    : fx(() =>
        AppRuntime.runPromise(
          SessionPrompt.Service.use((svc) =>
            svc.prompt({
              sessionID,
              agent: job.agent,
              model,
              variant: job.variant,
              parts: [{ type: "text", text: job.prompt }],
            }),
          ),
        ),
      ))

  const text = msg.parts.findLast((item) => item.type === "text")?.text?.trim()
  if (text !== "HEARTBEAT_OK") {
    log.info("job completed", { id: job.id, sessionID })
  }
  await SchedulerStore.touch(job.id, Date.now())
}

async function drain() {
  if (!state.running) return
  const max = await limit()
  while (state.active < max && state.queue.length > 0) {
    const item = state.queue.shift()
    if (!item) return
    const job = await SchedulerStore.get(item.id)
    if (!job?.enabled) continue
    state.active += 1
    const task = run(job)
      .catch((error) => {
        log.error("job run failed", { id: job.id, error })
      })
      .finally(() => {
        state.active -= 1
        state.inflight.delete(task)
        void drain()
      })
    state.inflight.add(task)
  }
}

async function refresh() {
  const now = Date.now()
  const list = await SchedulerStore.list()
  state.jobs = new Map(list.map((item) => [item.id, item]))
  state.queue = state.queue.flatMap((item) => {
    const job = state.jobs.get(item.id)
    if (!job?.enabled) return []
    return [job]
  })

  for (const [id] of state.next) {
    if (!state.jobs.has(id)) state.next.delete(id)
  }

  for (const job of list) {
    if (!job.enabled) {
      state.next.delete(job.id)
      continue
    }

    const at = state.next.get(job.id)
    if (at === undefined) {
      const next = nextRun(job, now)
      if (next !== undefined) state.next.set(job.id, next)
      continue
    }

    if (at > now) continue
    state.queue.push(job)
    const next = nextRun(job, now + 1)
    if (next === undefined) state.next.delete(job.id)
    else state.next.set(job.id, next)
  }
}

function arm(ms?: number) {
  if (!state.running) return
  if (state.timer) {
    clearTimeout(state.timer)
    state.timer = undefined
  }
  let delay = ms
  if (delay === undefined) {
    const times = [...state.next.values()].sort((a, b) => a - b)
    if (times.length === 0) return
    delay = Math.min(2_147_483_647, Math.max(0, times[0] - Date.now()))
  }
  state.timer = setTimeout(() => {
    state.timer = undefined
    void wake()
  }, delay)
  state.timer.unref?.()
}

async function wake() {
  if (!state.running || state.waking) return
  state.waking = true
  try {
    while (state.running) {
      const dirty = state.dirty
      state.dirty = false
      await refresh()
      await drain()
      if (!dirty && !state.dirty) break
    }
  } finally {
    state.waking = false
  }
  arm()
}

async function start(ctx: InstanceContext) {
  if (state.running) return
  state.context = ctx
  state.running = true
  state.dirty = true
  log.info("scheduler runner started")
  await wake()
}

async function stop() {
  if (!state.running) return
  state.running = false
  if (state.timer) {
    clearTimeout(state.timer)
    state.timer = undefined
  }
  await Promise.allSettled([...state.inflight])
  state.inflight.clear()
  state.queue.length = 0
  state.next.clear()
  state.jobs.clear()
  state.sessions.clear()
  state.dirty = false
  state.waking = false
  state.context = undefined
  log.info("scheduler runner stopped")
}

async function runNow(id: string, directory = process.cwd()) {
  const job = await SchedulerStore.get(id)
  if (!job) return false
  if (state.context) {
    await run(job)
    return true
  }
  const ctx = await InstanceRuntime.load({ directory })
  try {
    await run(job, ctx)
    return true
  } finally {
    await InstanceRuntime.disposeInstance(ctx)
  }
}

function notify() {
  if (!state.running || state.dirty) return
  state.dirty = true
  if (state.waking) return
  arm(0)
}

export const SchedulerRunner = { start, stop, notify, runNow }
