import { Context, Effect, Layer, Schema, Stream } from "effect"
import { which } from "@/util/which"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Stream as StreamModule } from "effect"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "beads" })

export class BeadsDownError extends Schema.TaggedErrorClass<BeadsDownError>()("BeadsDownError", {
  cause: Schema.String,
}) {}

export interface BriefBead {
  readonly id: string
  readonly title: string
  readonly status: string
  readonly priority: number
  readonly type: string
}

export interface BeadDetail {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly status: string
  readonly priority: number
  readonly type: string
  readonly owner: string
  readonly created_at: string
  readonly updated_at: string
  readonly external_ref: string
  readonly labels: readonly string[]
}

export interface BeadsClient {
  readonly available: () => Effect.Effect<boolean>
  readonly list: () => Effect.Effect<BriefBead[]>
  readonly show: (id: string) => Effect.Effect<BeadDetail | null>
  readonly create: (input: { title: string; description: string; priority: number }) => Effect.Effect<string>
  readonly close: (id: string) => Effect.Effect<void>
  readonly updateStatus: (id: string, status: string) => Effect.Effect<void>
}

function execBd(args: string[]): Effect.Effect<{ code: number; text: string; stderr: string }> {
  return Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const handle = yield* spawner.spawn(
      ChildProcess.make("bd", args, {
        cwd: process.cwd(),
        extendEnv: true,
        stdin: "ignore",
      }),
    )
    const [text, stderr] = yield* Effect.all(
      [StreamModule.mkString(StreamModule.decodeText(handle.stdout)), StreamModule.mkString(StreamModule.decodeText(handle.stderr))],
      { concurrency: 2 },
    )
    const code = yield* handle.exitCode
    return { code: Number(code), text, stderr }
  }).pipe(Effect.catch(() => Effect.succeed({ code: 1, text: "", stderr: "" }))) as Effect.Effect<
    { code: number; text: string; stderr: string },
    never,
    never
  >
}

function parseBeadIdFromOutput(output: string): string | null {
  const match = output.match(/Created issue: (\S+)/)
  return match ? match[1] : null
}

function parseBriefBead(raw: Record<string, unknown>): BriefBead | null {
  const id = String(raw.id ?? "")
  if (!id) return null
  return {
    id,
    title: String(raw.title ?? ""),
    status: String(raw.status ?? ""),
    priority: Number(raw.priority ?? 0),
    type: String(raw.issue_type ?? String(raw.type ?? "")),
  }
}

function parseBeadDetail(raw: Record<string, unknown>): BeadDetail {
  return {
    id: String(raw.id ?? ""),
    title: String(raw.title ?? ""),
    description: String(raw.description ?? ""),
    status: String(raw.status ?? ""),
    priority: Number(raw.priority ?? 0),
    type: String(raw.issue_type ?? String(raw.type ?? "")),
    owner: String(raw.owner ?? ""),
    created_at: String(raw.created_at ?? ""),
    updated_at: String(raw.updated_at ?? ""),
    external_ref: String(raw.external_ref ?? ""),
    labels: Array.isArray(raw.labels) ? (raw.labels as readonly string[]) : [],
  }
}

export class Service extends Context.Service<Service, BeadsClient>()("@opencode/Beads") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const available = Effect.fn("Beads.available")(function* () {
      const hasBd = yield* Effect.sync(() => which("bd") !== null)
      if (!hasBd) return false
      const result = yield* execBd(["status"])
      return result.code === 0
    })

    const list = Effect.fn("Beads.list")(function* () {
      const result = yield* execBd(["list", "--json"])
      if (result.code !== 0) throw new BeadsDownError({ cause: result.stderr || result.text })
      const parsed = JSON.parse(result.text)
      if (!Array.isArray(parsed)) return []
      return parsed.map(parseBriefBead).filter((b): b is BriefBead => b !== null && b.id !== "")
    })

    const show = Effect.fn("Beads.show")(function* (id: string) {
      const result = yield* execBd(["show", id, "--json"])
      if (result.code !== 0) return null
      const parsed = JSON.parse(result.text)
      if (!Array.isArray(parsed) || parsed.length === 0) return null
      const raw = parsed[0] as Record<string, unknown>
      if (!raw.id) return null
      return parseBeadDetail(raw)
    })

    const create = Effect.fn("Beads.create")(function* (input: { title: string; description: string; priority: number }) {
      const result = yield* execBd([
        "create",
        `--title=${input.title}`,
        `--description=${input.description}`,
        "--type=task",
        `--priority=${input.priority}`,
        "--labels=opencode",
      ])
      if (result.code !== 0) throw new BeadsDownError({ cause: result.stderr || result.text })
      const beadsId = parseBeadIdFromOutput(result.text)
      if (!beadsId) throw new BeadsDownError({ cause: `Could not parse beads ID from output: ${result.text}` })
      return beadsId
    })

    const close = Effect.fn("Beads.close")(function* (id: string) {
      const result = yield* execBd(["close", id])
      if (result.code !== 0) throw new BeadsDownError({ cause: result.stderr || result.text })
    })

    const updateStatus = Effect.fn("Beads.updateStatus")(function* (id: string, status: string) {
      const result = yield* execBd(["update", id, `--status=${status}`])
      if (result.code !== 0) throw new BeadsDownError({ cause: result.stderr || result.text })
    })

    return {
      available,
      list,
      show,
      create,
      close,
      updateStatus,
    }
  }),
)

export { layer }
