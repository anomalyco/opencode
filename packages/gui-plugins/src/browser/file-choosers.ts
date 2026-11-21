import type { Cdp } from "./cdp"
import { activityOwner, type TabActivity } from "./policy"

// Blink routes both HTML file inputs and the File System Access pickers through this Page-domain gate.
// Suppressing in the renderer matters: receiving fileChooserOpened alone does not stop a native dialog.
export function guardFileChoosers(cdp: Cdp, activity: TabActivity, refuse: (message: string) => void) {
  const targets = new Map<string | undefined, { enabled: boolean; ready: Promise<void> }>()

  const off = cdp.on("Page.fileChooserOpened", () => {
    if (activityOwner(activity) === "agent") refuse("Agent actions cannot open a native file picker. Use browser.files.upload({ tabID, ref, paths }) for a file input.")
  })

  function set(sessionID: string | undefined, enabled: boolean) {
    const current = targets.get(sessionID)

    if (current?.enabled === enabled) return current.ready
    const ready = cdp.send("Page.setInterceptFileChooserDialog", { enabled, cancel: enabled }, sessionID)
    targets.set(sessionID, { enabled, ready })

    return ready
  }

  function update() {
    const enabled = activityOwner(activity) === "agent"

    return Promise.all(Array.from(targets.keys(), id => set(id, enabled)))
  }

  return {
    attach: (sessionID?: string) => {
      targets.set(sessionID, { enabled: false, ready: Promise.resolve() })

      return update()
    },
    detach: (sessionID: string) => targets.delete(sessionID),
    update,
    dispose() {
      targets.clear()
      off()
    },
  }
}
