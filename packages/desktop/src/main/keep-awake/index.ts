export * as KeepAwake from "./index"

import type { PowerSaveBlocker, WebContents } from "electron"
import { Context, Effect } from "effect"

type Sender = Pick<WebContents, "id" | "isDestroyed" | "on" | "off">
type Dependencies = {
  power: Pick<PowerSaveBlocker, "start" | "stop">
  persistence: { read: () => unknown; write: (enabled: boolean) => void }
}

export class Service extends Context.Service<Service, Effect.Success<ReturnType<typeof make>>>()(
  "opencode/desktop/KeepAwake",
) {}

export const make = Effect.fn("KeepAwake.make")(function* (dependencies: Dependencies) {
  let enabled = dependencies.persistence.read() === true
  let blocker: number | undefined
  let disposed = false
  const senders = new Map<number, () => void>()
  const update = () => {
    if (enabled && senders.size > 0) {
      blocker ??= dependencies.power.start("prevent-app-suspension")
      return
    }
    if (blocker === undefined) return
    dependencies.power.stop(blocker)
    blocker = undefined
  }
  const remove = (id: number) => {
    senders.get(id)?.()
    senders.delete(id)
    update()
  }
  const dispose = () => {
    disposed = true
    senders.forEach((off) => off())
    senders.clear()
    update()
  }
  yield* Effect.addFinalizer(() => Effect.sync(dispose))

  return {
    getEnabled: () => enabled,
    setEnabled(value: boolean) {
      if (disposed || enabled === value) return
      dependencies.persistence.write(value)
      enabled = value
      update()
    },
    setActive(sender: Sender, active: boolean) {
      if (disposed) return
      if (!active) return remove(sender.id)
      if (sender.isDestroyed() || senders.has(sender.id)) return
      const clear = () => remove(sender.id)
      const navigate = (_event: Electron.Event, _url: string, inPlace: boolean, mainFrame: boolean) => {
        // App route changes keep the same renderer and its open tabs.
        if (mainFrame && !inPlace) clear()
      }
      sender.on("destroyed", clear)
      sender.on("render-process-gone", clear)
      sender.on("did-start-navigation", navigate)
      senders.set(sender.id, () => {
        sender.off("destroyed", clear)
        sender.off("render-process-gone", clear)
        sender.off("did-start-navigation", navigate)
      })
      // Retain reports while disabled so enabling applies to every window immediately.
      update()
    },
    dispose,
  }
})
