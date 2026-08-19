import { describe, expect, test } from "bun:test"
import {
  createDirectoryVisualizationFollowUp,
  isVisualizationEnabled,
  type VisualizationDialogStack,
  requestVisualizationFollowUp,
} from "./directory-visualization-provider"
import { createVisualizationFollowupDialogActions } from "@/components/dialog-visualization-followup"

type Selection = {
  agent?: { name: string }
  model?: { id: string; provider: { id: string } }
  variant?: string
}

function createDeferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

function setup(
  input: {
    confirmation?: () => Promise<"confirmed" | "cancelled">
    send?: () => Promise<boolean>
    selection?: Selection | null
  } = {},
) {
  let sessionID: string | undefined = "session-1"
  let active = true
  let selection: Selection | undefined =
    input.selection === undefined
      ? {
          agent: { name: "build" },
          model: { id: "gpt-5.4", provider: { id: "openai" } },
          variant: "high",
        }
      : (input.selection ?? undefined)
  const sent: unknown[] = []
  const errors: unknown[] = []
  const followUp = createDirectoryVisualizationFollowUp({
    currentSessionID: () => sessionID,
    directory: () => "/repo/main",
    selection: () => selection,
    isActive: () => active,
    confirm: input.confirmation ?? (() => Promise.resolve("confirmed")),
    send: async (draft) => {
      sent.push(draft)
      return input.send?.() ?? true
    },
    onError: (error) => errors.push(error),
  })

  return {
    followUp,
    sent,
    errors,
    session: (value: string | undefined) => {
      sessionID = value
    },
    selection: (value: Selection | undefined) => {
      selection = value
    },
    active: (value: boolean) => {
      active = value
    },
  }
}

describe("directory visualization follow-up", () => {
  test("enables visualization rendering only for the desktop platform", () => {
    expect(isVisualizationEnabled("web")).toBe(false)
    expect(isVisualizationEnabled("desktop")).toBe(true)
  })

  test("rejects a request for a session that is no longer current", async () => {
    const subject = setup()

    await expect(subject.followUp({ sessionID: "session-2", prompt: "Use compact layout" })).resolves.toBe("rejected")
    expect(subject.sent).toEqual([])
  })

  test("does not send after cancelling confirmation", async () => {
    const subject = setup({ confirmation: () => Promise.resolve("cancelled") })

    await expect(subject.followUp({ sessionID: "session-1", prompt: "Use compact layout" })).resolves.toBe("cancelled")
    expect(subject.sent).toEqual([])
  })

  test("sends a pure text draft using the current local selection", async () => {
    const subject = setup()

    await expect(
      subject.followUp({ sessionID: "session-1", title: "Choose a layout", prompt: "/review current selection" }),
    ).resolves.toBe("sent")
    expect(subject.sent).toEqual([
      {
        sessionID: "session-1",
        sessionDirectory: "/repo/main",
        prompt: [{ type: "text", content: "/review current selection", start: 0, end: 25 }],
        context: [],
        agent: "build",
        model: { providerID: "openai", modelID: "gpt-5.4" },
        variant: "high",
      },
    ])
  })

  test("uses UTF-16 indexes for emoji prompt text", async () => {
    const subject = setup()

    await expect(subject.followUp({ sessionID: "session-1", prompt: "/review 🚀" })).resolves.toBe("sent")
    expect(subject.sent[0]).toMatchObject({
      prompt: [{ type: "text", content: "/review 🚀", start: 0, end: 10 }],
    })
  })

  test("rejects and reports a sending failure", async () => {
    const failure = new Error("offline")
    const subject = setup({ send: () => Promise.reject(failure) })

    await expect(subject.followUp({ sessionID: "session-1", prompt: "Use compact layout" })).resolves.toBe("rejected")
    expect(subject.errors).toEqual([failure])
  })

  test("rejects if the current session changes while confirmation is open", async () => {
    let subject: ReturnType<typeof setup>
    subject = setup({
      confirmation: async () => {
        subject.session("session-2")
        return "confirmed"
      },
    })

    await expect(subject.followUp({ sessionID: "session-1", prompt: "Use compact layout" })).resolves.toBe("rejected")
    expect(subject.sent).toEqual([])
  })

  test("rejects if the provider is disposed after confirmation", async () => {
    let subject: ReturnType<typeof setup>
    subject = setup({
      confirmation: async () => {
        subject.active(false)
        return "confirmed"
      },
    })

    await expect(subject.followUp({ sessionID: "session-1", prompt: "Use compact layout" })).resolves.toBe("rejected")
    expect(subject.sent).toEqual([])
  })

  test("does not submit if the provider becomes inactive while preparing the draft", async () => {
    let active = true
    let sends = 0
    const followUp = createDirectoryVisualizationFollowUp({
      currentSessionID: () => "session-1",
      directory: () => "/repo/main",
      isActive: () => active,
      confirm: () => Promise.resolve("confirmed"),
      selection: () => {
        active = false
        return {
          agent: { name: "build" },
          model: { id: "gpt-5.4", provider: { id: "openai" } },
        }
      },
      send: async () => {
        sends++
        return true
      },
      onError: () => undefined,
    })

    await expect(followUp({ sessionID: "session-1", prompt: "Use compact layout" })).resolves.toBe("rejected")
    expect(sends).toBe(0)
  })

  test("does not submit if the provider becomes inactive before sending", async () => {
    let active = true
    let submissions = 0
    const followUp = createDirectoryVisualizationFollowUp({
      currentSessionID: () => "session-1",
      directory: () => "/repo/main",
      isActive: () => active,
      confirm: () => Promise.resolve("confirmed"),
      selection: () => ({
        agent: { name: "build" },
        model: { id: "gpt-5.4", provider: { id: "openai" } },
      }),
      send: async (_draft, before) => {
        active = false
        if (!before()) return false
        submissions++
        return true
      },
      onError: () => undefined,
    })

    await expect(followUp({ sessionID: "session-1", prompt: "Use compact layout" })).resolves.toBe("rejected")
    expect(submissions).toBe(0)
  })

  test("rejects when the current local agent or model is unavailable", async () => {
    const subject = setup({ selection: null })

    await expect(subject.followUp({ sessionID: "session-1", prompt: "Use compact layout" })).resolves.toBe("rejected")
    expect(subject.sent).toEqual([])
  })

  test("immediately rejects a second request while one confirmation is pending", async () => {
    const confirmation = createDeferred<"confirmed" | "cancelled">()
    const subject = setup({ confirmation: () => confirmation.promise })
    const first = subject.followUp({ sessionID: "session-1", prompt: "Use compact layout" })

    await expect(subject.followUp({ sessionID: "session-1", prompt: "Use spacious layout" })).resolves.toBe("rejected")
    confirmation.resolve("confirmed")
    await expect(first).resolves.toBe("sent")
    expect(subject.sent).toHaveLength(1)
  })

  test("settles dialog close only once", async () => {
    let onClose: (() => void) | undefined
    const handle = {
      id: "A",
      close: () => onClose?.(),
    }
    const dialog: VisualizationDialogStack = {
      push: (_element, close) => {
        onClose = close
        return handle
      },
    }

    const request = requestVisualizationFollowUp(dialog, { sessionID: "session-1", prompt: "Use compact layout" })
    expect(request).toHaveProperty("promise")
    if (!("promise" in request) || !(request.promise instanceof Promise)) return

    onClose?.()
    onClose?.()

    await expect(request.promise).resolves.toBe("cancelled")
  })

  test("allows another request after an external dialog cancellation", async () => {
    let onClose: (() => void) | undefined
    let active = "A"
    let firstClosed = 0
    let replacementClosed = 0
    const dialog: VisualizationDialogStack = {
      push: (_element, close) => {
        onClose = close
        return {
          id: "A",
          close: () => {
            if (active === "A") {
              firstClosed++
              onClose?.()
            }
          },
        }
      },
    }
    const request = requestVisualizationFollowUp(dialog, { sessionID: "session-1", prompt: "Use compact layout" })
    let confirmations = 0
    const subject = setup({
      confirmation: () =>
        confirmations++ === 0 && "promise" in request ? request.promise : Promise.resolve("confirmed"),
    })
    const first = subject.followUp({ sessionID: "session-1", prompt: "Use compact layout" })

    expect(request).toHaveProperty("cancel")
    if (!("cancel" in request) || typeof request.cancel !== "function") return
    active = "B"
    request.cancel()

    await expect(first).resolves.toBe("cancelled")
    expect(firstClosed).toBe(0)
    expect(replacementClosed).toBe(0)
    await expect(subject.followUp({ sessionID: "session-1", prompt: "Use spacious layout" })).resolves.toBe("sent")
    expect(subject.sent).toHaveLength(1)
    onClose?.()
  })

  test("cancellation closes its own dialog handle", async () => {
    let onClose: (() => void) | undefined
    let closes = 0
    const dialog: VisualizationDialogStack = {
      push: (_element, close) => {
        onClose = close
        return {
          id: "A",
          close: () => {
            closes++
            onClose?.()
          },
        }
      },
    }
    const request = requestVisualizationFollowUp(dialog, { sessionID: "session-1", prompt: "Use compact layout" })

    request.cancel()

    await expect(request.promise).resolves.toBe("cancelled")
    expect(closes).toBe(1)
  })

  test("confirmation without an injected close callback settles without closing another dialog", () => {
    const settled: string[] = []
    const actions = createVisualizationFollowupDialogActions({
      onResult: (result) => settled.push(result),
    })

    actions.confirm()

    expect(settled).toEqual(["confirmed"])
  })

  test("confirmation closes only its own handle and still sends the follow-up", async () => {
    const confirmation = createDeferred<"confirmed" | "cancelled">()
    const subject = setup({ confirmation: () => confirmation.promise })
    const first = subject.followUp({ sessionID: "session-1", prompt: "Use compact layout" })
    let firstClosed = 0
    let secondClosed = 0
    const actions = createVisualizationFollowupDialogActions({
      onResult: confirmation.resolve,
      close: () => {
        firstClosed++
      },
    })

    actions.confirm()

    await expect(first).resolves.toBe("sent")
    expect(firstClosed).toBe(1)
    expect(secondClosed).toBe(0)
    expect(subject.sent).toHaveLength(1)
  })

  test("settles and closes dialog actions only once", () => {
    const settled: string[] = []
    let closes = 0
    const actions = createVisualizationFollowupDialogActions({
      onResult: (result) => settled.push(result),
      close: () => {
        closes++
      },
    })

    actions.confirm()
    actions.cancel()

    expect(settled).toEqual(["confirmed"])
    expect(closes).toBe(1)
  })
})
