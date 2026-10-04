import { powerSaveBlocker } from "electron"
import { Schema } from "effect"
import { MainApp, MainStorage, type Setup } from "../sdk/main"
import { Pairing } from "./contract"

const setup: Setup = (ctx) => {
  const app = ctx.use(MainApp)
  const stored = ctx.use(MainStorage).store("keepScreenActive", {
    schema: Schema.Boolean,
    initial: false,
    from: "state:opencode.settings/keepScreenActive",
  })
  const blocker = { id: undefined as number | undefined }
  const release = () => {
    if (blocker.id === undefined) return
    powerSaveBlocker.stop(blocker.id)
    blocker.id = undefined
  }
  const keepScreenActive = (enabled: boolean) => {
    if (enabled && blocker.id === undefined) blocker.id = powerSaveBlocker.start("prevent-display-sleep")
    if (!enabled) release()
    stored.set(enabled)
  }
  if (stored.get()) keepScreenActive(true)
  ctx.cleanup(release)

  const client = async () => {
    const server = app.server("sidecar")
    if (!server) throw new Error("The local desktop server is not ready")
    const { OpenCode } = await import("@opencode/client/promise")
    return OpenCode.make({ baseUrl: server.url, headers: server.headers })
  }

  ctx.provide(Pairing, {
    info: async () => ({ urls: (await (await client()).server.info()).urls }),
    code: async () => (await (await client()).server.pair()).code,
    screenActive: () => blocker.id !== undefined && powerSaveBlocker.isStarted(blocker.id),
    setScreenActive: (enabled) => keepScreenActive(enabled),
  })
}

export default setup
