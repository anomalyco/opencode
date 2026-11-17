import type { Browser } from "@opencode/plugin-browser/rpc"
import type { HandoffEvent } from "./ipc"
import { destinationOrigin } from "./policy"

export type HandoffState = Exclude<HandoffEvent["state"], "pending">

export type HandoffResult = { readonly state: HandoffState; readonly host: string }

type Pending = {
  readonly id: string
  readonly tabID: Browser.TabID
  readonly finish: (state: HandoffState) => void
}

/**
 * Moves one page to the system browser and waits for the user to say they are done.
 *
 * The pane cannot inherit the external browser's session: copying its cookies or credentials would be exactly the
 * transfer this feature exists to avoid. A handoff reports only whether the user finished, and the page here stays
 * signed out. The URL is used once to open the browser, then dropped; events and results carry the host only.
 */
export function createHandoffs(input: {
  openExternal: (url: string) => Promise<void>
  timeoutMs?: number
  createID?: () => string
}) {
  const pending = new Map<string, Pending>()
  const timeoutMs = input.timeoutMs ?? 10 * 60_000
  const createID = input.createID ?? (() => `handoff_${crypto.randomUUID()}`)

  async function begin(request: {
    binding: string
    tabID: Browser.TabID
    url: string
    signal: AbortSignal
    emit: (event: HandoffEvent) => void
  }): Promise<HandoffResult> {
    if (pending.has(request.binding))
      throw new Error(
        "A handoff is already waiting in this pane. Finish or cancel it in the Review pane before starting another.",
      )

    if (!destinationOrigin(request.url))
      throw new Error(
        "Only HTTP and HTTPS pages can move to the system browser. Open the sign-in page in this tab first.",
      )

    if (request.signal.aborted)
      throw new Error(
        "Browser request was cancelled before the system browser opened. Inspect the tab before retrying.",
      )

    const url = new URL(request.url)
    const host = url.host
    const id = createID()

    // The launch happens before the banner: a browser that never opened is a tool error, not a confirmation the user
    // never saw. Electron's rejection can name the URL, so the error the agent reads is this one instead.
    try {
      await input.openExternal(url.href)
    } catch {
      throw new Error(
        "Could not open the system browser. The page stayed in the Review pane; use its Open in system browser button, then finish sign-in there.",
      )
    }

    if (request.signal.aborted) return { state: "cancelled", host }

    const result = Promise.withResolvers<HandoffResult>()

    let timer: ReturnType<typeof setTimeout> | undefined

    const finish = (state: HandoffState) => {
      if (pending.get(request.binding)?.id !== id) return

      pending.delete(request.binding)

      if (timer) clearTimeout(timer)

      request.signal.removeEventListener("abort", abort)
      request.emit({ type: "handoff", tabID: request.tabID, id, host, state })
      result.resolve({ state, host })
    }

    const abort = () => finish("cancelled")

    pending.set(request.binding, { id, tabID: request.tabID, finish })
    timer = setTimeout(() => finish("timedOut"), timeoutMs)
    request.signal.addEventListener("abort", abort, { once: true })
    request.emit({ type: "handoff", tabID: request.tabID, id, host, state: "pending" })

    return result.promise
  }

  function settle(binding: string, id: string, action: "done" | "cancel") {
    const current = pending.get(binding)

    if (!current || current.id !== id) return false
    current.finish(action === "done" ? "completed" : "cancelled")

    return true
  }

  function cancelTab(binding: string, tabID: Browser.TabID) {
    const current = pending.get(binding)

    if (current?.tabID === tabID) current.finish("cancelled")
  }

  function cancelBinding(binding: string) {
    pending.get(binding)?.finish("cancelled")
  }

  function cancelAll() {
    Array.from(pending.values()).forEach((current) => current.finish("cancelled"))
  }

  return { begin, settle, cancelTab, cancelBinding, cancelAll }
}
