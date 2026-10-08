import { powerSaveBlocker } from "electron"
import type { MainSetup } from "../sdk/main"
import { Pairing } from "./contract"
import type definition from "./index"

/** The display sleep blocker this instance holds, if any. */
type Blocker = { id?: number }

const setup: MainSetup<typeof definition> = (ctx) => {
  const stored = ctx.stores.keepScreenActive
  const blocker: Blocker = {}

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

  if (stored.value) keepScreenActive(true)
  ctx.scope.addFinalizer(release)

  ctx.provide(Pairing, {
    screenActive: () => blocker.id !== undefined && powerSaveBlocker.isStarted(blocker.id),
    setScreenActive: (enabled) => keepScreenActive(enabled),
  })
}

export default setup
