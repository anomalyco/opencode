import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Session } from "./index"

type MainInput = NonNullable<Parameters<typeof Session.create>[0]>

const pending = new Map<string, Promise<Session.Info>>()

function active(dir: string) {
  return [...Session.list({ directory: dir, roots: true })].filter((s) => !s.time?.archived)
}

export async function getOrCreateMain(input?: MainInput) {
  if (input?.parentID) return Session.create(input)

  const config = await Config.get()
  if (!config.ensureOneSession) return Session.create(input)

  const dir = Instance.directory
  const existing = active(dir)
  if (existing[0]) return existing[0]

  const inflight = pending.get(dir)
  if (inflight) return inflight

  const task = Session.create(input).finally(() => pending.delete(dir))
  pending.set(dir, task)
  return task
}

export async function ensureSession() {
  const config = await Config.get()
  if (!config.ensureSession) return

  if (active(Instance.directory).length > 0) return

  await getOrCreateMain()
}
