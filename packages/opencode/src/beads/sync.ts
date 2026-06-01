import { Context, Effect, Layer, Schema, Stream } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Todo } from "@/session/todo"
import { BeadsDownError } from "@/beads/beads"
import type { BriefBead } from "@/beads/beads"
import { Mapping, type MappingFile } from "@/beads/mapping"
import { InstanceState } from "@/effect/instance-state"
import { which } from "@/util/which"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "beads-sync" })

const OPCODE_TO_BEADS_STATUS: Record<string, string> = {
  pending: "open",
  in_progress: "in_progress",
  completed: "closed",
  cancelled: "closed",
}

const OPCODE_TO_BEADS_PRIORITY: Record<string, number> = {
  high: 1,
  medium: 3,
  low: 5,
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
      [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
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

function findOrCreateBead(
  mapping: MappingFile,
  title: string,
): Effect.Effect<string, BeadsDownError> {
  return Effect.gen(function* () {
    const result = yield* execBd(["list", "--json"])
    if (result.code !== 0) throw new BeadsDownError({ cause: result.stderr || result.text })
    const parsed = JSON.parse(result.text)
    if (!Array.isArray(parsed)) throw new BeadsDownError({ cause: "bd list returned non-array" })
    const beads: BriefBead[] = parsed.map(parseBriefBead).filter((b): b is BriefBead => b !== null && b.id !== "")

    const exact = beads.find((b) => b.title === title)
    if (exact) return exact.id

    const prefix = beads.find((b) => b.title.startsWith(title.split("\n")[0].slice(0, 50)))
    if (prefix) return prefix.id

    const priority = OPCODE_TO_BEADS_PRIORITY.medium
    const createResult = yield* execBd([
      "create",
      `--title=${title}`,
      `--description=${title}`,
      "--type=task",
      `--priority=${priority}`,
      "--labels=opencode",
    ])
    if (createResult.code !== 0) throw new BeadsDownError({ cause: createResult.stderr || createResult.text })
    const beadsId = parseBeadIdFromOutput(createResult.text)
    if (!beadsId) throw new BeadsDownError({ cause: `Could not parse beads ID from output: ${createResult.text}` })
    const entry = Mapping.createNewEntry(title, "open", "medium")
    Mapping.addEntry(mapping, beadsId, entry)
    return beadsId
  })
}

function syncTodo(
  mapping: MappingFile,
  sessionID: string,
  todo: { content: string; status: string; priority: string },
  position: number,
): Effect.Effect<void, BeadsDownError> {
  return Effect.gen(function* () {
    const beadsStatus = OPCODE_TO_BEADS_STATUS[todo.status] ?? "open"
    const existingBeadsId = Mapping.findEntryBySession(mapping, sessionID, position)

    if (existingBeadsId) {
      const entry = mapping.mapping[existingBeadsId]
      if (!entry) return

      const showResult = yield* execBd(["show", existingBeadsId, "--json"])
      const currentStatus = showResult.code === 0 ? JSON.parse(showResult.text)[0]?.status ?? "open" : "open"

      if (currentStatus !== beadsStatus) {
        const updateResult = yield* execBd(["update", existingBeadsId, `--status=${beadsStatus}`])
        if (updateResult.code !== 0) throw new BeadsDownError({ cause: updateResult.stderr || updateResult.text })
      }

      if (entry.title !== todo.content) {
        mapping.mapping = {
          ...mapping.mapping,
          [existingBeadsId]: {
            ...entry,
            title: todo.content,
            status: beadsStatus,
            priority: todo.priority,
            updated_at: new Date().toISOString(),
          },
        }
      }

      if (!(sessionID in entry.sessions)) {
        Mapping.addSession(mapping, existingBeadsId, sessionID, position)
      }
    } else {
      const beadsId = yield* findOrCreateBead(mapping, todo.content)
      const entry = mapping.mapping[beadsId]
      if (!entry) {
        Mapping.addSession(mapping, beadsId, sessionID, position)
        return
      }

      mapping.mapping = {
        ...mapping.mapping,
        [beadsId]: {
          ...entry,
          status: beadsStatus,
          priority: todo.priority,
          title: todo.content,
          updated_at: new Date().toISOString(),
        },
      }
      Mapping.addSession(mapping, beadsId, sessionID, position)
    }
  })
}

function syncAllTodos(
  mapping: MappingFile,
  sessionID: string,
  todos: { content: string; status: string; priority: string }[],
  activeSessionIDs: Set<string>,
): Effect.Effect<void, BeadsDownError> {
  return Effect.gen(function* () {
    for (let i = 0; i < todos.length; i++) {
      const todo = todos[i]
      yield* syncTodo(mapping, sessionID, todo, i)
    }
    Mapping.cleanupStaleSessions(mapping, activeSessionIDs)
  })
}

export interface Interface {
  readonly sync: (input: { sessionID: string; todos: { content: string; status: string; priority: string }[] }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/BeadsSync") {}

export const layer: Layer.Layer<Service, never, EventV2Bridge.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service

    const hasBd = yield* Effect.sync(() => which("bd") !== null)
    if (!hasBd) {
      log.debug("bd not found, sync disabled")
      return { sync: () => Effect.void } satisfies Interface
    }

    const sync = (input: {
      sessionID: string
      todos: { content: string; status: string; priority: string }[]
    }) =>
      Effect.gen(function* () {
        const { sessionID, todos } = input
        if (todos.length === 0) return

        const dir = yield* InstanceState.directory
        let mapping: MappingFile
        try {
          mapping = yield* Mapping.load(dir)
        } catch {
          mapping = { version: 1, mapping: {} } as MappingFile
        }

        const activeSessions = new Set<string>([sessionID])

        yield* syncAllTodos(mapping, sessionID, todos, activeSessions)

        yield* Mapping.save(dir, mapping)
      }).pipe(
        Effect.catch((err) =>
          Effect.sync(() =>
            log.error("beads sync failed", { sessionID: input.sessionID, error: String(err) }),
          ),
        ),
      )

    yield* events.subscribe(Todo.Event.Updated).pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          const todos = event.data.todos as { content: string; status: string; priority: string }[]
          yield* sync({ sessionID: event.data.sessionID, todos }).pipe(
            Effect.catch((err) =>
              Effect.sync(() =>
                log.error("beads sync failed", { sessionID: event.data.sessionID, error: String(err) }),
              ),
            ),
          )
        }),
      ),
      Effect.forkScoped,
    )

    return { sync } satisfies Interface
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(EventV2Bridge.defaultLayer))

export * as BeadsSync from "./sync"
