import path from "path"
import { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { AppRuntime } from "@/effect/app-runtime"
import { Instance, type InstanceContext } from "@/project/instance"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { SessionPrompt } from "@/session/prompt"
import * as Session from "@/session/session"
import type { SessionID } from "@/session/schema"

const log = Log.create({ service: "scheduler.heartbeat" })

const state: {
  timer?: ReturnType<typeof setTimeout>
  running: boolean
  sessionID?: SessionID
  context?: InstanceContext
} = {
  running: false,
}

function parse(input: string) {
  const text = input.trim()
  if (!text) return 30 * 60 * 1000
  const num = Number(text.replace(/[a-zA-Z]+$/, ""))
  const unit = text.slice(String(num).length).toLowerCase()
  if (!Number.isFinite(num) || num <= 0) return 30 * 60 * 1000
  if (unit === "ms") return Math.floor(num)
  if (unit === "s") return Math.floor(num * 1000)
  if (unit === "m" || unit === "") return Math.floor(num * 60 * 1000)
  if (unit === "h") return Math.floor(num * 60 * 60 * 1000)
  if (unit === "d") return Math.floor(num * 24 * 60 * 60 * 1000)
  return 30 * 60 * 1000
}

async function fx<T>(task: () => Promise<T>) {
  if (!state.context) throw new Error("scheduler heartbeat is not initialized")
  return Instance.restore(state.context, task)
}

async function ensureSession() {
  if (state.sessionID) return state.sessionID
  const created = await fx(() =>
    AppRuntime.runPromise(Session.Service.use((svc) => svc.create({ title: "Heartbeat" }))),
  )
  state.sessionID = created.id
  return created.id
}

async function run() {
  const text = await fx(() =>
    AppRuntime.runPromise(
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const file = path.join(Instance.worktree, "HEARTBEAT.md")
        return yield* fs.readFileString(file).pipe(
          Effect.catchIf(
            (err) => err.reason._tag === "NotFound",
            () => Effect.succeed(""),
          ),
        )
      }),
    ),
  )
  const prompt = text.trim()
  if (!prompt) return

  const sessionID = await ensureSession()
  const model = await fx(() => AppRuntime.runPromise(Provider.Service.use((svc) => svc.defaultModel())))
  const msg = await fx(() =>
    AppRuntime.runPromise(
      SessionPrompt.Service.use((svc) =>
        svc.prompt({
          sessionID,
          model,
          parts: [{ type: "text", text: prompt }],
        }),
      ),
    ),
  )

  const output = msg.parts.findLast((item) => item.type === "text")?.text?.trim()
  if (output === "HEARTBEAT_OK") return
  log.info("heartbeat prompt completed", { sessionID })
}

async function tick() {
  if (!state.running) return
  const ms = await fx(async () => {
    const cfg = await AppRuntime.runPromise(Config.Service.use((svc) => svc.get()))
    return parse(cfg.scheduler?.heartbeat?.interval ?? "30m")
  })
  await run().catch((error) => {
    log.error("heartbeat run failed", { error })
  })
  if (!state.running) return
  state.timer = setTimeout(() => {
    void tick()
  }, ms)
  state.timer.unref?.()
}

async function start(ctx: InstanceContext) {
  if (state.running) return
  state.context = ctx
  const enabled = await fx(async () => {
    const cfg = await AppRuntime.runPromise(Config.Service.use((svc) => svc.get()))
    return (cfg.scheduler?.heartbeat?.enabled ?? true) !== false
  })
  if (!enabled) {
    state.context = undefined
    return
  }
  state.running = true
  await tick()
}

async function stop() {
  state.running = false
  if (state.timer) {
    clearTimeout(state.timer)
    state.timer = undefined
  }
  state.sessionID = undefined
  state.context = undefined
}

export const SchedulerHeartbeat = { start, stop, run }
