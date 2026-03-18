import { describe, expect, mock, test } from "bun:test"
import { base64Encode } from "@opencode-ai/util/encode"
import { duplicateCommand, duplicateSession } from "./duplicate-command"

function state() {
  return {
    current: () => [{ type: "text", content: "draft" }],
    cursor: () => 3,
    set: mock(() => {}),
  }
}

function sdk(result: Promise<{ data?: { id: string } | null }>) {
  const fork = mock(() => result)
  return {
    fork,
    value: {
      directory: "/tmp/work",
      client: {
        session: { fork },
      },
    },
  }
}

describe("duplicate command", () => {
  test("disables the slash command without a session id", () => {
    const prompt = state()
    const cmd = duplicateCommand({
      t: (key) => key,
      prompt,
      sdk: sdk(Promise.resolve({ data: { id: "next" } })).value,
      navigate: mock(() => {}),
      toast: mock(() => {}),
      frame: (cb) => void cb(0),
    })

    expect(cmd.disabled).toBe(true)
    expect(cmd.slash).toBe("duplicate")
  })

  test("forks the session, navigates, and restores the draft", async () => {
    const prompt = state()
    const nav = mock(() => {})
    const toast = mock(() => {})
    const api = sdk(Promise.resolve({ data: { id: "next" } }))
    const frame = mock((cb: FrameRequestCallback) => void cb(0))

    await duplicateSession({
      id: "sess-1",
      t: (key) => key,
      prompt,
      sdk: api.value,
      navigate: nav,
      toast,
      frame,
    })

    expect(api.fork).toHaveBeenCalledWith({ sessionID: "sess-1" })
    expect(nav).toHaveBeenCalledWith(`/${base64Encode("/tmp/work")}/session/next`)
    expect(frame).toHaveBeenCalledTimes(1)
    expect(prompt.set).toHaveBeenCalledWith([{ type: "text", content: "draft" }], 3)
    expect(toast).not.toHaveBeenCalled()
  })

  test("shows a failure toast when the fork response is empty", async () => {
    const prompt = state()
    const nav = mock(() => {})
    const toast = mock(() => {})

    await duplicateSession({
      id: "sess-1",
      t: (key) => key,
      prompt,
      sdk: sdk(Promise.resolve({ data: null })).value,
      navigate: nav,
      toast,
      frame: (cb) => void cb(0),
    })

    expect(nav).not.toHaveBeenCalled()
    expect(prompt.set).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith({ title: "common.requestFailed" })
  })

  test("shows the thrown error message when the fork request fails", async () => {
    const toast = mock(() => {})

    await duplicateSession({
      id: "sess-1",
      t: (key) => key,
      prompt: state(),
      sdk: sdk(Promise.reject(new Error("boom"))).value,
      navigate: mock(() => {}),
      toast,
      frame: (cb) => void cb(0),
    })

    expect(toast).toHaveBeenCalledWith({
      title: "common.requestFailed",
      description: "boom",
    })
  })
})
