import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import { Effect } from "effect"
import { Global } from "@bolt-ai/core/global"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"
import { Tail } from "@/util/tail"

const DIR = path.join(Global.Path.state, "jobs")

export type Restart = {
  at: number
  reason: string
}

export type Job = {
  id: string
  pid: number
  command: string
  argv?: string[]
  log: string
  cwd: string
  started: number
  restarts?: Restart[]
}

export function alive(pid: number) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function stop(pid: number) {
  try {
    process.kill(pid)
    return true
  } catch {
    return false
  }
}

/**
 * Decide what the supervisor should do after one poll. `failures` counts
 * consecutive failed health checks before this poll; a dead process restarts
 * immediately, an unhealthy one only after `retries` consecutive failures.
 */
export function verdict(
  check: { alive: boolean; healthy: boolean },
  failures: number,
  retries: number,
): { action: "ok" | "wait" | "restart"; failures: number; reason?: "dead" | "unhealthy" } {
  if (!check.alive) return { action: "restart", failures: 0, reason: "dead" }
  if (check.healthy) return { action: "ok", failures: 0 }
  const next = failures + 1
  if (next >= retries) return { action: "restart", failures: 0, reason: "unhealthy" }
  return { action: "wait", failures: next }
}

/** Delay in ms before polling again after the nth restart: exponential, capped at 60s. */
export function backoff(restart: number, interval: number): number {
  return Math.min(interval * 2 ** restart, 60_000)
}

/** Classify a health target as an http(s) URL to fetch or a command to run. */
export function probe(target: string): "url" | "command" {
  return /^https?:\/\//i.test(target.trim()) ? "url" : "command"
}

/**
 * Kill a detached job and its descendants. Jobs are spawned as their own
 * process-group leader (see spawnJob), and `bolt run` spawns tool subprocesses
 * (sh -c ...) into that group, so signal the whole group. Falls back to the
 * lone pid when the group signal is unsupported (Windows) or already gone.
 */
export function killJob(pid: number, signal: NodeJS.Signals | number = "SIGTERM") {
  if (process.platform === "win32") {
    process.kill(pid, signal)
    return
  }
  try {
    process.kill(-pid, signal)
  } catch {
    process.kill(pid, signal)
  }
}

/**
 * Spawn a detached background job that re-runs this CLI with the given argv,
 * appending output to a log file under the global state directory. Pass `meta`
 * to respawn an existing job in place, keeping its id, log, and restart history.
 */
export function spawnJob(argv: string[], cwd: string, meta?: { id: string; restarts: Restart[] }): Job {
  fs.mkdirSync(DIR, { recursive: true })
  const id = meta?.id ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const log = path.join(DIR, `${id}.log`)
  const fd = fs.openSync(log, "a")
  // In dev, argv[1] is a real script path that must be forwarded to the
  // runtime; in a compiled binary it is a virtual bundle path that must not.
  const entry = process.argv[1] && fs.existsSync(process.argv[1]) ? [process.argv[1]] : []
  const child = spawn(process.execPath, [...entry, ...argv], {
    cwd,
    detached: true,
    stdio: ["ignore", fd, fd],
  })
  fs.closeSync(fd)
  child.unref()
  const job: Job = {
    id,
    pid: child.pid ?? 0,
    command: argv.join(" "),
    argv,
    log,
    cwd,
    started: Date.now(),
    ...(meta ? { restarts: meta.restarts } : {}),
  }
  fs.writeFileSync(path.join(DIR, `${id}.json`), JSON.stringify(job, null, 2))
  return job
}

export function jobs(): Job[] {
  if (!fs.existsSync(DIR)) return []
  return fs
    .readdirSync(DIR)
    .filter((file) => file.endsWith(".json"))
    .flatMap((file) => {
      const parsed = (() => {
        try {
          return JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8")) as Job
        } catch {
          return undefined
        }
      })()
      return parsed ? [parsed] : []
    })
    .sort((a, b) => b.started - a.started)
}

function find(id: string) {
  return jobs().find((job) => job.id === id || job.id.startsWith(id))
}

export const JobsCommand = effectCmd({
  command: "jobs <action> [id]",
  describe: "manage background jobs started with run --background",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("action", {
        type: "string",
        choices: ["list", "tail", "kill", "supervise"] as const,
        demandOption: true,
        describe: "list jobs, tail a job's output, kill a running job, or supervise one with restarts",
      })
      .positional("id", {
        type: "string",
        describe: "job id (prefix match)",
      })
      .option("follow", {
        alias: "f",
        type: "boolean",
        default: false,
        describe: "with tail, stream new output as it is written",
      })
      .option("health", {
        type: "string",
        describe: "with supervise, an http(s) URL to poll or a command whose exit code marks the job healthy",
      })
      .option("interval", {
        type: "number",
        default: 5,
        describe: "with supervise, seconds between health polls",
      })
      .option("retries", {
        type: "number",
        default: 3,
        describe: "with supervise, consecutive health failures before a restart",
      })
      .option("limit", {
        type: "number",
        default: 5,
        describe: "with supervise, maximum restarts before giving up",
      }),
  handler: Effect.fn("Cli.jobs")(function* (args) {
    if (args.action === "list") {
      const all = jobs()
      if (all.length === 0) {
        UI.println('No background jobs. Start one with: bolt run --background "..."')
        return
      }
      for (const job of all) {
        const status = alive(job.pid) ? "running" : "stopped"
        const when = new Date(job.started).toLocaleString()
        const restarts = job.restarts?.length ? `  restarts ${job.restarts.length}` : ""
        UI.println(
          `${job.id}  ${status.padEnd(7)}  pid ${String(job.pid).padEnd(6)}  ${when}  ${job.command}${restarts}`,
        )
      }
      return
    }

    if (!args.id) return yield* fail(`pass a job id: bolt jobs ${args.action} <id>`)
    const job = find(args.id)
    if (!job) return yield* fail(`no job matching "${args.id}". Run: bolt jobs list`)

    if (args.action === "supervise") {
      const interval = Math.max(args.interval, 0.2) * 1000
      const retries = Math.max(Math.floor(args.retries), 1)
      const limit = Math.max(Math.floor(args.limit), 1)
      const target = args.health
      const health = Effect.fnUntraced(function* (check: string) {
        if (probe(check) === "url") {
          return yield* Effect.promise(() =>
            fetch(check, { signal: AbortSignal.timeout(Math.min(interval, 10_000)) })
              .then((res) => res.ok)
              .catch(() => false),
          )
        }
        const proc = Bun.spawn(["sh", "-c", check], { stdout: "ignore", stderr: "ignore" })
        return (yield* Effect.promise(() => proc.exited)) === 0
      })
      UI.println(
        `Supervising job ${job.id} every ${interval / 1000}s` +
          (target ? ` (health: ${target}, ${retries} retries)` : "") +
          `, restart cap ${limit}. Press ctrl+c to stop.`,
      )
      let failures = 0
      let restarted = 0
      while (true) {
        const current = find(job.id)
        if (!current) return yield* fail(`job ${job.id} metadata disappeared`)
        const up = alive(current.pid)
        const healthy = up && (target ? yield* health(target) : true)
        const result = verdict({ alive: up, healthy }, failures, retries)
        failures = result.failures
        if (result.action !== "restart") {
          yield* Effect.sleep(`${interval} millis`)
          continue
        }
        if (restarted >= limit) {
          return yield* fail(
            `Job ${job.id} hit the restart cap (${limit}); giving up to avoid a crash loop. Check: bolt jobs tail ${job.id}`,
          )
        }
        const reason = result.reason === "dead" ? "process died" : `health check failed ${retries} times`
        if (up) stop(current.pid)
        // Legacy job records predate the argv field; splitting the joined
        // command is lossy for quoted arguments but the best available.
        const argv = current.argv ?? current.command.split(/\s+/)
        const next = spawnJob(argv, current.cwd, {
          id: current.id,
          restarts: [...(current.restarts ?? []), { at: Date.now(), reason }],
        })
        restarted += 1
        UI.println(`Restarted job ${next.id} (pid ${next.pid}): ${reason}. Restart ${restarted}/${limit}.`)
        yield* Effect.sleep(`${backoff(restarted, interval)} millis`)
      }
    }

    if (args.action === "kill") {
      if (!alive(job.pid)) {
        UI.println(`Job ${job.id} is not running.`)
        return
      }
      killJob(job.pid)
      UI.println(`Killed job ${job.id} (pid ${job.pid}).`)
      return
    }

    if (!fs.existsSync(job.log)) return yield* fail(`no log file for job ${job.id}`)
    const text = yield* Effect.promise(() => Bun.file(job.log).text())
    if (text) process.stdout.write(text.endsWith("\n") ? text : `${text}\n`)
    if (!args.follow) return
    yield* Effect.callback<void>(() => {
      const close = Tail.follow(job.log, Buffer.byteLength(text))
      return Effect.sync(close)
    })
  }),
})
