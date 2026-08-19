import path from "path"
import { Global } from "@opencode-ai/core/global"
import { Effect } from "effect"

export type ActiveSession = {
  id: string
  timestamp: number
}

type Manifest = { sessions: ActiveSession[] }

let manifestDir = Global.Path.data

export function setManifestDir(dir: string) {
  manifestDir = dir
}

function manifestPath() {
  return path.join(manifestDir, "active-sessions.json")
}

async function readRaw(): Promise<Manifest> {
  const file = Bun.file(manifestPath())
  const exists = await file.exists()
  if (!exists) return { sessions: [] }
  return file.json().catch(() => ({ sessions: [] }))
}

async function writeRaw(manifest: Manifest): Promise<void> {
  await Bun.write(manifestPath(), JSON.stringify(manifest))
}

const write = Effect.fn("ActiveManifest.write")(function* (entry: ActiveSession) {
  yield* Effect.promise(async () => {
    const manifest = await readRaw()
    const without = manifest.sessions.filter((s) => s.id !== entry.id)
    without.push(entry)
    await writeRaw({ sessions: without })
  })
})

const remove = Effect.fn("ActiveManifest.remove")(function* (sessionID: string) {
  yield* Effect.promise(async () => {
    const manifest = await readRaw()
    const without = manifest.sessions.filter((s) => s.id !== sessionID)
    await writeRaw({ sessions: without })
  })
})

const read = Effect.fn("ActiveManifest.read")(function* () {
  return yield* Effect.promise(() => readRaw().then((m) => m.sessions))
})

const clear = Effect.fn("ActiveManifest.clear")(function* () {
  yield* Effect.promise(async () => {
    const file = Bun.file(manifestPath())
    if (await file.exists()) await file.unlink()
  })
})

const hasCrashed = Effect.fn("ActiveManifest.hasCrashed")(function* () {
  return yield* Effect.promise(() => Bun.file(manifestPath()).exists())
})

export const ActiveManifest = {
  write,
  remove,
  read,
  clear,
  hasCrashed,
}
