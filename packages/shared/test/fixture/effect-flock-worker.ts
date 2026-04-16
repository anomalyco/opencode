import fs from "fs/promises"
import os from "os"
import { Effect, Layer } from "effect"
import { AppFileSystem } from "@opencode-ai/shared/filesystem"
import { EffectFlock } from "@opencode-ai/shared/util/effect-flock"
import { Global } from "@opencode-ai/shared/global"

type Msg = {
  key: string
  dir: string
  holdMs?: number
  ready?: string
  active?: string
  done?: string
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

const msg: Msg = JSON.parse(process.argv[2]!)

const testGlobal = Layer.succeed(
  Global.Service,
  Global.Service.of({
    home: os.homedir(),
    data: os.tmpdir(),
    cache: os.tmpdir(),
    config: os.tmpdir(),
    state: os.tmpdir(),
    bin: os.tmpdir(),
    log: os.tmpdir(),
  }),
)

const testLayer = EffectFlock.layer.pipe(Layer.provide(testGlobal), Layer.provide(AppFileSystem.defaultLayer))

async function job() {
  if (msg.ready) await fs.writeFile(msg.ready, String(process.pid))
  if (msg.active) await fs.writeFile(msg.active, String(process.pid), { flag: "wx" })

  try {
    if (msg.holdMs && msg.holdMs > 0) await sleep(msg.holdMs)
    if (msg.done) await fs.appendFile(msg.done, "1\n")
  } finally {
    if (msg.active) await fs.rm(msg.active, { force: true })
  }
}

await Effect.runPromise(
  Effect.gen(function* () {
    const flock = yield* EffectFlock.Service
    yield* flock.withLock(
      Effect.promise(() => job()),
      msg.key,
      msg.dir,
    )
  }).pipe(Effect.provide(testLayer)),
).catch((err) => {
  const text = err instanceof Error ? (err.stack ?? err.message) : String(err)
  process.stderr.write(text)
  process.exit(1)
})
