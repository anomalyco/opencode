import type { Cdp } from "./cdp"
import { agentDriven, DOWNLOAD_GRACE_MS, type TabActivity } from "./policy"

// Blink routes both HTML file inputs and the File System Access pickers through this Page-domain gate.
// Suppressing in the renderer matters: receiving fileChooserOpened alone does not stop a native dialog.
export function guardFileChoosers(cdp: Cdp, activity: TabActivity, refuse: (message: string) => void) {
  const targets = new Map<string | undefined, { enabled: boolean; ready: Promise<void> }>()
  let timer: ReturnType<typeof setTimeout> | undefined

  const off = cdp.on("Page.fileChooserOpened", () => {
    if (agentDriven(activity, Date.now())) refuse("Agent actions cannot open a native file picker. Use browser.files.upload({ tabID, ref, paths }) for a file input.")
  })

  function set(sessionID: string | undefined, enabled: boolean) {
    const current = targets.get(sessionID)

    if (current?.enabled === enabled) return current.ready
    const ready = cdp.send("Page.setInterceptFileChooserDialog", { enabled, cancel: enabled }, sessionID)
    targets.set(sessionID, { enabled, ready })

    return ready
  }

  function update() {
    const now = Date.now()
    const enabled = agentDriven(activity, now)
    clearTimeout(timer)

    if (targets.size && enabled && !activity.agentRuns && activity.agentEndedAt !== undefined) {
      timer = setTimeout(() => void update().catch(() => undefined), activity.agentEndedAt + DOWNLOAD_GRACE_MS + 1 - now)
    }

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
      clearTimeout(timer)
      targets.clear()
      off()
    },
  }
}
