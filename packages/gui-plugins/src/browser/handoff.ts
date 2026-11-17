import type { Browser } from "@opencode/plugin-browser/rpc"
import type { HandoffEvent } from "./ipc"
import { destinationOrigin } from "./policy"

/** The outcomes a handoff settles with; a launch the user started that failed rejects instead. */
export type HandoffOutcome = Extract<HandoffEvent["state"], "completed" | "cancelled" | "timedOut">

export type HandoffResult = { readonly state: HandoffOutcome; readonly host: string }

type Pending = {
  readonly id: string
  readonly tabID: Browser.TabID
  readonly url: string
  opened: boolean
  readonly launch: () => Promise<void>
  readonly finish: (state: HandoffOutcome) => void
}

/**
 * Waits for the user to move one page to the system browser and say they are done.
 *
 * Nothing opens until the user chooses Open in the Review pane: the pane never launches the user's browser on the
 * agent's word alone. The pane also cannot inherit the external browser's session — copying its cookies or
 * credentials would be exactly the transfer this feature exists to avoid — so a handoff reports only whether the
 * user finished, and the page here stays signed out. The URL is used once, on the user's click, then dropped;
 * events and results carry the host only, except the URL the banner shows while asking.
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
    const result = Promise.withResolvers<HandoffResult>()

    let timer: ReturnType<typeof setTimeout> | undefined

    // The user's Open click, not the agent's request, launches the browser. Electron's rejection can name the URL,
    // so the error the agent reads is this one instead.
    const launch = async () => {
      try {
        await input.openExternal(url.href)
      } catch {
        if (!close()) return

        request.emit({ type: "handoff", tabID: request.tabID, id, host, state: "failed" })
        result.reject(
          new Error(
            "Could not open the system browser. The page stayed in the Review pane; use its Open in system browser button, then finish sign-in there.",
          ),
        )

        return
      }

      if (pending.get(request.binding)?.id === id)
        request.emit({ type: "handoff", tabID: request.tabID, id, host, url: url.href, state: "opened" })
    }

    const close = () => {
      if (pending.get(request.binding)?.id !== id) return false

      pending.delete(request.binding)

      if (timer) clearTimeout(timer)

      request.signal.removeEventListener("abort", abort)

      return true
    }

    const finish = (state: HandoffOutcome) => {
      if (!close()) return

      request.emit({ type: "handoff", tabID: request.tabID, id, host, state })
      result.resolve({ state, host })
    }

    const abort = () => finish("cancelled")

    pending.set(request.binding, { id, tabID: request.tabID, url: url.href, opened: false, launch, finish })

    timer = setTimeout(() => finish("timedOut"), timeoutMs)

    request.signal.addEventListener("abort", abort, { once: true })
    request.emit({ type: "handoff", tabID: request.tabID, id, host, url: url.href, state: "pending" })

    return result.promise
  }

  function settle(binding: string, id: string, action: "open" | "done" | "cancel") {
    const current = pending.get(binding)

    if (!current || current.id !== id) return false

    if (action === "open") {
      // A second Open while the browser is starting must not launch it twice.
      if (current.opened) return true
      current.opened = true

      void current.launch()

      return true
    }

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
