import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import { createSubagentDraft, subagentEnterAction, type SubagentDraftState } from "./subagent-draft"
import { subagentDraftStorage } from "./subagent-draft-store"

function draftWith(send: (text: string, id: string) => Promise<void>, text = "") {
  const errors: unknown[] = []
  // The real Solid store, so a cleared key must actually be deleted rather than merged away.
  const [stored, setStored] = createStore<SubagentDraftState>({ text })

  const draft = createSubagentDraft({
    send,
    onError: (error) => errors.push(error),
    storage: subagentDraftStorage(() => stored, setStored),
  })

  return { draft, errors }
}

describe("subagent composer", () => {
  test("sends a trimmed draft and clears it", async () => {
    const sent: string[] = []
    const { draft } = draftWith(async (text) => void sent.push(text))

    draft.setValue("  focus on the API  ")
    await draft.submit()

    expect(sent).toEqual(["focus on the API"])
    expect(draft.value()).toBe("")
    expect(draft.sending()).toBe(false)
  })

  test("ignores an empty draft", async () => {
    const sent: string[] = []
    const { draft } = draftWith(async (text) => void sent.push(text))

    draft.setValue("   \n ")
    await draft.submit()

    expect(sent).toEqual([])
    expect(draft.value()).toBe("   \n ")
  })

  test("returns the draft and reports a failed send", async () => {
    const error = new Error("offline")
    const { draft, errors } = draftWith(() => Promise.reject(error))

    draft.setValue("check the tests")
    await draft.submit()

    expect(draft.value()).toBe("check the tests")
    expect(draft.sending()).toBe(false)
    expect(errors).toEqual([error])
  })

  test("restores a failed message in front of what was typed since", async () => {
    let fail: (error: Error) => void = () => {}

    const { draft, errors } = draftWith(
      () =>
        new Promise((_, reject) => {
          fail = reject
        }),
    )

    draft.setValue("first")
    const sending = draft.submit()
    draft.setValue("second")
    fail(new Error("offline"))
    await sending

    expect(draft.value()).toBe("first\nsecond")
    expect(errors).toHaveLength(1)
  })

  test("keeps a whitespace-only draft alongside the failed message", async () => {
    const { draft } = draftWith(() => Promise.reject(new Error("offline")))

    draft.setValue("first")
    const sending = draft.submit()
    draft.setValue("   ")
    await sending

    expect(draft.value()).toBe("first\n   ")
  })

  test("ignores a second submit while one is in flight", async () => {
    const sent: string[] = []
    let resolve: () => void = () => {}

    const { draft } = draftWith(
      (text) =>
        new Promise((done) => {
          sent.push(text)
          resolve = done
        }),
    )

    draft.setValue("first")
    const sending = draft.submit()
    await draft.submit()
    resolve()
    await sending

    expect(sent).toEqual(["first"])
  })

  test("resends a failed message under its admission ID", async () => {
    const ids: string[] = []

    const { draft } = draftWith((_, id) => {
      ids.push(id)

      return ids.length === 1 ? Promise.reject(new Error("offline")) : Promise.resolve()
    })

    draft.setValue("first")
    await draft.submit()
    await draft.submit()

    expect(ids).toHaveLength(2)
    expect(ids[1]).toBe(ids[0]!)
  })

  test("keeps the retry ID across a remount, so a restored draft is not admitted twice", async () => {
    const ids: string[] = []
    const [stored, setStored] = createStore<SubagentDraftState>({ text: "" })
    const storage = subagentDraftStorage(() => stored, setStored)

    const send = (_text: string, id: string) => {
      ids.push(id)

      return ids.length === 1 ? Promise.reject(new Error("offline")) : Promise.resolve()
    }

    const first = createSubagentDraft({ send, storage, onError() {} })
    first.setValue("first")
    await first.submit()

    // Leaving the child disposes the region; the next mount restores both the text and the admission.
    const remounted = createSubagentDraft({ send, storage, onError() {} })
    await remounted.submit()

    expect(remounted.value()).toBe("")
    expect(ids).toHaveLength(2)
    expect(ids[1]).toBe(ids[0]!)
  })

  test("a successful resend clears the stored retry, so the next identical message is admitted again", async () => {
    const ids: string[] = []
    const [stored, setStored] = createStore<SubagentDraftState>({ text: "" })
    const storage = subagentDraftStorage(() => stored, setStored)

    const send = (_text: string, id: string) => {
      ids.push(id)

      return ids.length === 1 ? Promise.reject(new Error("offline")) : Promise.resolve()
    }

    const draft = createSubagentDraft({ send, storage, onError() {} })
    draft.setValue("check the tests")
    await draft.submit()
    await draft.submit()

    expect(stored.retry).toBeUndefined()

    draft.setValue("check the tests")
    await draft.submit()

    expect(ids).toHaveLength(3)
    expect(ids[2]).not.toBe(ids[0]!)
  })

  test("mints a new admission ID once the restored message is edited", async () => {
    const ids: string[] = []

    const { draft } = draftWith((_, id) => {
      ids.push(id)

      return ids.length === 1 ? Promise.reject(new Error("offline")) : Promise.resolve()
    })

    draft.setValue("first")
    await draft.submit()
    draft.setValue("first, and the tests")
    await draft.submit()

    expect(ids[1]).not.toBe(ids[0]!)
  })

  test("admits a new message under a new ID after a success", async () => {
    const ids: string[] = []
    const { draft } = draftWith(async (_, id) => void ids.push(id))

    draft.setValue("one")
    await draft.submit()
    draft.setValue("two")
    await draft.submit()

    expect(ids[0]).not.toBe(ids[1]!)
  })
})

describe("subagent composer Return", () => {
  const enter = {
    key: "Enter",
    shiftKey: false,
    isComposing: false,
    keyCode: 13,
    repeat: false,
    metaKey: false,
    ctrlKey: false,
  }

  const rows: Array<[string, Partial<typeof enter>, boolean, ReturnType<typeof subagentEnterAction>]> = [
    ["Enter sends", {}, false, "send"],
    ["Shift+Enter adds a line", { shiftKey: true }, false, "default"],
    ["an IME confirms without sending", { keyCode: 229 }, false, "default"],
    ["a composition confirms without sending", { isComposing: true }, false, "default"],
    ["auto-repeat sends nothing", { repeat: true }, false, "swallow"],
    ["a touch Return adds a line", {}, true, "default"],
    ["a touch Mod+Enter sends", { metaKey: true }, true, "send"],
    ["a touch Ctrl+Enter sends", { ctrlKey: true }, true, "send"],
    ["another key adds a line", { key: "a" }, false, "default"],
  ]

  for (const [name, event, touch, expected] of rows)
    test(name, () => {
      expect(subagentEnterAction({ ...enter, ...event }, touch)).toBe(expected)
    })
})
