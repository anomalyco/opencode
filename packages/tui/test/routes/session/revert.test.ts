import { describe, expect, test } from "bun:test"
import type { Part, Session } from "@opencode-ai/sdk/v2"
import { createStore } from "solid-js/store"
import { messagePrompt, revertChoices, revertSession, unrevertSession } from "../../../src/routes/session/revert"
import { resolve, revertFiles } from "../../../src/config"

const sessionID = "ses_test"

function session(revert?: Session["revert"]): Session {
  return {
    id: sessionID,
    slug: "test",
    projectID: "project",
    directory: "/tmp",
    title: "test",
    version: "1",
    time: { created: 0, updated: 0 },
    revert,
  }
}

function harness(revert?: Session["revert"]) {
  const [store, setStore] = createStore({ session: [session(revert)] })
  const toasts: { variant: string; message: string }[] = []
  const calls: Record<string, unknown>[] = []
  const answer = {
    result: { data: {} } as { data?: unknown; error?: unknown },
    later: undefined as Promise<{ error: unknown }> | undefined,
  }
  const respond = (name: string) => (input: Record<string, unknown>) => {
    calls.push({ name, ...input })
    return answer.later ?? Promise.resolve(answer.result)
  }
  const sdk = { client: { session: { revert: respond("revert"), unrevert: respond("unrevert") } } }
  const toast = { show: (input: { variant: string; message: string }) => toasts.push(input) }
  return {
    store,
    toasts,
    calls,
    answer,
    deps: { sync: { data: store, set: setStore }, sdk, toast } as unknown as Parameters<typeof revertSession>[0],
  }
}

describe("revert choices", () => {
  test("put the configured default first", () => {
    expect(revertChoices(true).map((choice) => choice.files)).toEqual([true, false])
    expect(revertChoices(false).map((choice) => choice.files)).toEqual([false, true])
    expect(revertChoices(false).map((choice) => choice.title)).toEqual([
      "Revert messages",
      "Revert messages and files",
    ])
  })

  test("default to reverting files, unless tui.json says otherwise", () => {
    expect(revertFiles(undefined)).toBe(true)
    expect(revertFiles({ files: false })).toBe(false)
    expect(resolve({ revert: { files: false } }, { terminalSuspend: true }).revert).toEqual({ files: false })
  })

  test("the undo variants take their own keybinds", () => {
    const config = resolve(
      { keybinds: { messages_undo_keep_files: "ctrl+o", messages_undo_with_files: "ctrl+k" } },
      { terminalSuspend: true },
    )
    expect(config.keybinds.get("session.undo.messages")).toMatchObject([{ key: "ctrl+o" }])
    expect(config.keybinds.get("session.undo.files")).toMatchObject([{ key: "ctrl+k" }])
    expect(config.keybinds.get("session.undo")).toMatchObject([{ key: "<leader>u" }])
  })
})

describe("messagePrompt", () => {
  test("keeps what the user wrote and the files, not synthetic text", () => {
    const parts = [
      { id: "prt_1", sessionID, messageID: "msg_1", type: "text", text: "hello " },
      { id: "prt_2", sessionID, messageID: "msg_1", type: "text", text: "plugin note", synthetic: true },
      { id: "prt_3", sessionID, messageID: "msg_1", type: "text", text: "world" },
      { id: "prt_4", sessionID, messageID: "msg_1", type: "file", mime: "text/plain", url: "file:///a.txt" },
    ] as Part[]
    const prompt = messagePrompt(parts)
    expect(prompt.input).toBe("hello world")
    expect(prompt.parts).toEqual([{ type: "file", mime: "text/plain", url: "file:///a.txt" }])
  })
})

describe("revertSession", () => {
  test("shows the revert before the server answers and passes the files choice", async () => {
    const rig = harness()
    const pending = revertSession({ ...rig.deps, sessionID, messageID: "msg_2", files: false })
    expect(rig.store.session[0].revert).toEqual({ messageID: "msg_2" })
    expect(await pending).toBe(true)
    expect(rig.calls).toEqual([{ name: "revert", sessionID, messageID: "msg_2", files: false }])
    expect(rig.toasts).toEqual([])
  })

  test("puts the previous revert back and says why when the server refuses", async () => {
    const rig = harness({ messageID: "msg_5" })
    rig.answer.result = { error: { message: "Session is busy: ses_test" } }
    expect(await revertSession({ ...rig.deps, sessionID, messageID: "msg_2", files: true })).toBe(false)
    expect(rig.store.session[0].revert).toEqual({ messageID: "msg_5" })
    expect(rig.toasts).toEqual([{ variant: "error", message: "Session is busy: ses_test" }])
  })

  test("leaves a newer state alone when it rolls back", async () => {
    const rig = harness()
    let fail: (value: { error: unknown }) => void = () => {}
    rig.answer.later = new Promise((resolve) => (fail = resolve))
    const pending = revertSession({ ...rig.deps, sessionID, messageID: "msg_2", files: true })
    rig.deps.sync.set("session", 0, "revert", { messageID: "msg_9" })
    fail({ error: { message: "boom" } })
    await pending
    expect(rig.store.session[0].revert).toEqual({ messageID: "msg_9" })
  })

  test("unrevert clears the revert at once and restores it on failure", async () => {
    const rig = harness({ messageID: "msg_2" })
    const pending = unrevertSession({ ...rig.deps, sessionID })
    expect(rig.store.session[0].revert).toBeUndefined()
    expect(await pending).toBe(true)

    rig.answer.result = { error: new Error("offline") }
    expect(await unrevertSession({ ...rig.deps, sessionID })).toBe(false)
    expect(rig.toasts.at(-1)).toEqual({ variant: "error", message: "offline" })
  })
})
