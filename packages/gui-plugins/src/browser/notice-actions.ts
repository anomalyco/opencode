import type { RefusalNotice } from "./ipc"
import { externalTarget } from "./refusal-notice"

/** Only the tab's current notice can be answered. The window returns a one-use token, never a destination. */
export function noticeActions(
  report: (notice: RefusalNotice, token: string) => void,
  actions: { tab(url: string): Promise<void>; app(url: string): Promise<void>; copy(url: string): void },
) {
  let pending: { token: string; notice: RefusalNotice; expires?: number; timer?: ReturnType<typeof setTimeout> } | undefined

  const clear = () => {
    clearTimeout(pending?.timer)
    pending = undefined
  }

  const show = (notice: RefusalNotice) => {
    clear()
    const token = crypto.randomUUID()
    pending = { token, notice }

    if ((notice.reason === "external" && notice.action === "open") || (notice.reason === "popup" && notice.action === "tab")) {
      pending.expires = Date.now() + 60_000
      pending.timer = setTimeout(() => {
        if (pending?.token !== token) return
        show(notice.reason === "external" ? { ...notice, action: "copy" } : { reason: "popup", target: notice.target })
      }, 60_000)
    }

    report(notice, token)
  }

  return {
    clear,
    show,
    async answer(token: string, dismiss: boolean, copy = false) {
      if (!pending || pending.token !== token) return
      const { notice, expires } = pending
      clear()

      if (dismiss || (expires !== undefined && Date.now() >= expires)) return

      if (notice.reason === "popup" && notice.action === "tab") return actions.tab(notice.target)

      if (notice.reason !== "external") return
      const safe = externalTarget(notice.target, notice.source)

      if (safe && (copy || notice.action === "copy")) return actions.copy(notice.target)

      if (safe === "open" && notice.action === "open") await actions.app(notice.target)
    },
  }
}
