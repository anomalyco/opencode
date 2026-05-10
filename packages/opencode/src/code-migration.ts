import { Context, Effect, Layer } from "effect"
import { makeRuntime } from "./effect/run-service"
import { Database, type TxOrDb } from "./storage/db"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import path from "path"
import { mkdir } from "fs/promises"

export type Migration = {
  name: string
  run: (db: TxOrDb) => void | Promise<void>
}

export interface Interface {
  readonly start: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/CodeMigration") {}

const log = Log.create({ service: "code-migration" })
const marker = path.join(Global.Path.data, "code-migration.json")

export const All: Migration[] = []

async function readCompleted() {
  const file = Bun.file(marker)
  if (!(await file.exists())) return new Set<string>()
  return new Set((await file.json()) as string[])
}

async function writeCompleted(completed: Set<string>) {
  await mkdir(path.dirname(marker), { recursive: true })
  await Bun.write(marker, JSON.stringify([...completed].sort(), null, 2))
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    let started = false

    const start = Effect.fn("CodeMigration.start")(function* () {
      if (started) return
      started = true
      yield* Effect.sync(() => {
        void runPending().catch((error) => {
          log.error("failed to run code migrations", { error })
        })
      })
    })

    return Service.of({ start })
  }),
)

export const defaultLayer = layer

async function runPending() {
  if (All.length === 0) return

  const db = Database.Client()

  const completed = await readCompleted()
  for (const migration of All.filter((item) => !completed.has(item.name))) {
    log.info("running code migration", { name: migration.name })
    await migration.run(db)
    completed.add(migration.name)
    await writeCompleted(completed)
  }
}

const { runFork } = makeRuntime(Service, defaultLayer)

export function start() {
  runFork((svc) => svc.start())
}

export * as CodeMigration from "./code-migration"
