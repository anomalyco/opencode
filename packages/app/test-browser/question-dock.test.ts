import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test"
import { createRoot } from "solid-js"
import type { FormInfo } from "@opencode/client/promise"
import { toaster } from "@opencode/ui/toast"
import type { ServerScope } from "@/runtime/server/scope"
import { createQuestionDock } from "@/session/requests/question-controller"
import { QUESTION_REQUEST_TIMEOUT_MS } from "@/session/requests/question-machine"
import { questionCache } from "@/session/requests/question-state"

const request: FormInfo = {
  id: "frm_dock",
  sessionID: "ses_dock",
  title: "Questions",
  metadata: { kind: "question" },
  fields: [
    {
      key: "layout",
      type: "string",
      title: "Layout",
      description: "Which layout?",
      options: [{ value: "wide", label: "Wide" }],
      custom: true,
    },
  ],
}

const cacheKey = `test-question-dock\u0000frm_dock`

// A reply whose response never comes: it settles only when it is aborted, as a fetch does.
function setup() {
  const listeners = new Map<string, (event: { data: { id: string } }) => void>()
  const aborted: string[] = []
  const toasts: string[] = []

  const sdk = {
    // SAFETY: a scope is any string without a null byte.
    scope: "test-question-dock" as ServerScope,
    api: {
      session: {
        form: {
          reply: (_: { formID: string }, options: { signal: AbortSignal }) =>
            new Promise<void>((_, reject) =>
              options.signal.addEventListener("abort", () => {
                aborted.push("reply")
                reject(new Error("aborted"))
              }),
            ),
        },
      },
    },
    event: {
      // SAFETY: the driver subscribes by type and reads only the form id of these events.
      on: ((type: string, handler: (event: { data: { id: string } }) => void) => {
        listeners.set(type, handler)

        return () => listeners.delete(type)
      }) as never,
    },
  }

  const owned = createRoot((dispose) => ({
    // SAFETY: the driver reads only these members of the server SDK.
    dock: createQuestionDock({
      sdk: sdk as never,
      // The failure toast's title is the only text the driver translates, so this records each failure toast.
      language: { t: (key) => (toasts.push(key), key) },
      request: () => request,
      onSubmit: () => undefined,
    }),
    dispose,
  }))

  return { ...owned, listeners, aborted, toasts }
}

describe("createQuestionDock", () => {
  beforeEach(() => {
    jest.useFakeTimers()
    toaster.dismiss()
    questionCache.delete(cacheKey)
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    toaster.dismiss()
  })

  test("a reply the server settles after the dock unmounted ends without a failure or a kept draft", async () => {
    const owner = setup()
    owner.dock.pick("wide")
    owner.dock.reply()
    owner.dispose()

    expect([...owner.listeners.keys()]).toEqual(["form.replied", "form.cancelled"])
    owner.listeners.get("form.replied")?.({ data: { id: "frm_dock" } })
    await Promise.resolve()
    jest.advanceTimersByTime(QUESTION_REQUEST_TIMEOUT_MS)

    expect(owner.aborted).toEqual(["reply"])
    expect(owner.toasts).toEqual([])
    expect(questionCache.get(cacheKey)).toBeUndefined()
    expect(owner.listeners.size).toBe(0)
  })

  test("a reply that hangs after the dock unmounted reports the failure and keeps the draft", async () => {
    const owner = setup()
    owner.dock.pick("wide")
    owner.dock.reply()
    owner.dispose()

    jest.advanceTimersByTime(QUESTION_REQUEST_TIMEOUT_MS)
    await Promise.resolve()

    expect(owner.aborted).toEqual(["reply"])
    expect(owner.toasts).toEqual(["common.requestFailed"])
    expect(questionCache.get(cacheKey)?.drafts[0]?.selected).toEqual(["wide"])
    expect(owner.listeners.size).toBe(0)
  })

  test("an unanswered dock stops listening as it unmounts", () => {
    const owner = setup()
    owner.dispose()

    expect(owner.listeners.size).toBe(0)
    expect(questionCache.get(cacheKey)?.tab).toBe(0)
  })
})
