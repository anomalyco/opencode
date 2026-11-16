import electron from "electron"
import type { RefusalNotice } from "./ipc"
import { externalTarget } from "./refusal-notice"

/** Only the tab's current notice can be answered. The window returns a one-use token, never a destination. */
export function noticeActions(
  report: (notice: RefusalNotice, token: string) => void,
  open: (url: string) => Promise<void>,
) {
  let pending: { token: string; notice: RefusalNotice } | undefined

  return {
    clear() {
      pending = undefined
    },
    show(notice: RefusalNotice) {
      pending = { token: crypto.randomUUID(), notice }
      report(notice, pending.token)
    },
    async answer(token: string, dismiss: boolean) {
      if (!pending || pending.token !== token) return
      const notice = pending.notice
      pending = undefined

      if (dismiss) return

      if (notice.reason === "popup" && notice.action === "tab") return open(notice.target)

      if (notice.reason !== "external") return
      const safe = externalTarget(notice.target)

      if (safe && notice.action === "copy") return electron.clipboard.writeText(notice.target)

      if (safe === "open" && notice.action === "open") await electron.shell.openExternal(notice.target)
    },
  }
}
