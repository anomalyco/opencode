import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Session } from "./index"

export async function ensureSession() {
  const config = await Config.get()
  if (!config.ensureSession) return

  const active = [...Session.list({ directory: Instance.directory, roots: true })].filter((s) => !s.time?.archived)
  if (active.length > 0) return

  await Session.create({})
}
