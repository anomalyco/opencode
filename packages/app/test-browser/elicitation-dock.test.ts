import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test"
import { createRoot } from "solid-js"
import type { FormInfo } from "@opencode/client/promise"
import { toaster } from "@opencode/ui/toast"
import type { ServerScope } from "@/runtime/server/scope"
import { createElicitationDock, elicitationCache } from "@/session/requests/elicitation-controller"
import { ELICITATION_REQUEST_TIMEOUT_MS } from "@/session/requests/elicitation-machine"

// SAFETY: a scope is any string without a null byte.
const scope = "test-elicitation-dock" as ServerScope

const request: FormInfo = {
  id: "frm_elicitation",
  sessionID: "ses_elicitation",
  title: "Deploy",
  metadata: { kind: "mcp-elicitation" },
  fields: [{ key: "env", type: "string", title: "Environment" }],
}

const cacheKey = `${scope}\u0000frm_elicitation`

// A data layer whose reply and dismissal never settle until the test settles them.
function setup() {
  const listeners = new Map<string, (event: { data: { id: string } }) => void>()
  const toasts: string[] = []
  const pending: { reject: (error: Error) => void }[] = []

  const send = () => new Promise<void>((_, reject) => void pending.push({ reject }))

  const sdk = {
    scope,
    event: {
      // SAFETY: the driver subscribes by type and reads only the form id of these events.
      on: ((type: string, handler: (event: { data: { id: string } }) => void) => {
        listeners.set(type, handler)

        return () => listeners.delete(type)
      }) as never,
    },
  }

  const owned = createRoot((dispose) => ({
    dock: createElicitationDock({
      sdk,
      forms: { reply: send, cancel: send },
      // The failure toast's title is the only text the driver translates, so this records each failure toast.
      language: { t: (key) => (toasts.push(key), key) },
      request: () => request,
      onSubmit: () => undefined,
    }),
    dispose,
  }))

  return { ...owned, listeners, toasts, pending }
}

// Lets a settled request's handlers run.
const settled = () =>
  Promise.resolve()
    .then(() => undefined)
    .then(() => undefined)
    .then(() => undefined)

describe("createElicitationDock", () => {
  beforeEach(() => {
    jest.useFakeTimers()
    toaster.dismiss()
    elicitationCache.delete(cacheKey)
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    toaster.dismiss()
  })

  test("a reply the server settles after the dock unmounted ends without a failure or a kept draft", async () => {
    const owner = setup()
    owner.dock.setText("env", "prod")
    owner.dock.reply()
    owner.dispose()

    expect([...owner.listeners.keys()]).toEqual(["form.replied", "form.cancelled"])
    owner.listeners.get("form.replied")?.({ data: { id: "frm_elicitation" } })
    jest.advanceTimersByTime(ELICITATION_REQUEST_TIMEOUT_MS)
    owner.pending[0]?.reject(new Error("late"))
    await settled()

    expect(owner.toasts).toEqual([])
    expect(elicitationCache.get(cacheKey)).toBeUndefined()
    expect(owner.listeners.size).toBe(0)
  })

  test("a dismissal that hangs after the dock unmounted reports one failure and keeps the draft", async () => {
    const owner = setup()
    owner.dock.setText("env", "prod")
    owner.dock.dismiss()
    owner.dispose()

    jest.advanceTimersByTime(ELICITATION_REQUEST_TIMEOUT_MS)
    // The data layer's own request ends later; the attempt already timed out.
    owner.pending[0]?.reject(new Error("late"))
    await settled()

    expect(owner.pending).toHaveLength(1)
    expect(owner.toasts).toEqual(["common.requestFailed"])
    expect(elicitationCache.get(cacheKey)?.text).toEqual({ env: "prod" })
    expect(owner.listeners.size).toBe(0)
  })
})
