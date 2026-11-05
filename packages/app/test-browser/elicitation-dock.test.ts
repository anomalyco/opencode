import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test"
import { createRoot } from "solid-js"
import type { FormInfo, LocationRef } from "@opencode/client/promise"
import { toaster } from "@opencode/ui/toast"
import type { ServerScope } from "@/runtime/server/scope"
import {
  createElicitationDock,
  elicitationCache,
  isElicitationSettled,
} from "@/session/requests/elicitation-controller"
import { ELICITATION_REQUEST_TIMEOUT_MS } from "@/session/requests/elicitation-machine"

// SAFETY: a scope is any string without a null byte.
const scope = "test-elicitation-dock" as ServerScope

const request: FormInfo & { location?: LocationRef } = {
  id: "frm_elicitation",
  sessionID: "ses_elicitation",
  title: "Deploy",
  metadata: { kind: "mcp-elicitation" },
  fields: [{ key: "env", type: "string", title: "Environment" }],
}

const cacheKey = `${scope}\u0000frm_elicitation`

type Call = { formID: string; headers: Record<string, string> | undefined }

// A request whose response never comes settles only when it is aborted, as a fetch does, unless `answer` settles it.
function setup(input: { request?: typeof request; answer?: () => Promise<void> } = {}) {
  const listeners = new Map<string, (event: { data: { id: string } }) => void>()
  const aborted: string[] = []
  const toasts: string[] = []
  const calls: Call[] = []
  const synced: string[] = []

  const send = (body: { formID: string }, options: { signal: AbortSignal; headers?: Record<string, string> }) => {
    calls.push({ formID: body.formID, headers: options.headers })

    if (input.answer) return input.answer()

    return new Promise<void>((_, reject) =>
      options.signal.addEventListener("abort", () => {
        aborted.push(body.formID)
        reject(new Error("aborted"))
      }),
    )
  }

  const sdk = {
    scope,
    api: { session: { form: { reply: send, cancel: send } } },
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
      // SAFETY: the driver reads only these members of the server SDK.
      sdk: sdk as never,
      forms: {
        invalidate: (sessionID) => void synced.push(`invalidate:${sessionID}`),
        sync: async (sessionID) => void synced.push(`sync:${sessionID}`),
      },
      // The failure toast's title is the only text the driver translates, so this records each failure toast.
      language: { t: (key) => (toasts.push(key), key) },
      request: () => input.request ?? request,
      onSubmit: () => undefined,
    }),
    dispose,
  }))

  return { ...owned, listeners, aborted, toasts, calls, synced }
}

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
    await Promise.resolve()
    jest.advanceTimersByTime(ELICITATION_REQUEST_TIMEOUT_MS)

    expect(owner.aborted).toEqual(["frm_elicitation"])
    expect(owner.toasts).toEqual([])
    expect(elicitationCache.get(cacheKey)).toBeUndefined()
    expect(owner.listeners.size).toBe(0)
  })

  test("a dismissal that hangs after the dock unmounted reports the failure and keeps the draft", async () => {
    const owner = setup()
    owner.dock.setText("env", "prod")
    owner.dock.dismiss()
    owner.dispose()

    jest.advanceTimersByTime(ELICITATION_REQUEST_TIMEOUT_MS)
    await Promise.resolve()

    expect(owner.aborted).toEqual(["frm_elicitation"])
    expect(owner.toasts).toEqual(["common.requestFailed"])
    expect(elicitationCache.get(cacheKey)?.text).toEqual({ env: "prod" })
    expect(owner.listeners.size).toBe(0)
  })

  test("a Location elicitation another client already settled counts as sent and hides at once", async () => {
    const owner = setup({
      request: { ...request, sessionID: "global", location: { directory: "C:/Work Tree" } },
      // The client rejects with the server's decoded error body.
      answer: () =>
        Promise.reject(
          JSON.parse('{"_tag":"FormAlreadySettledError","id":"frm_elicitation","message":"Form already settled"}'),
        ),
    })

    owner.dock.reply()
    owner.dock.reply()
    await Promise.resolve()
    await Promise.resolve()

    expect(owner.calls).toEqual([
      { formID: "frm_elicitation", headers: { "x-opencode-directory": encodeURIComponent("C:/Work Tree") } },
    ])
    expect(owner.toasts).toEqual([])
    expect(owner.dock.busy()).toBe(true)
    expect(isElicitationSettled(scope, "frm_elicitation")).toBe(true)
    expect(owner.synced).toEqual(["invalidate:global", "sync:global"])
    owner.dispose()
  })
})
