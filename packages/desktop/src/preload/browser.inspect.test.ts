import { describe, expect, test } from "bun:test"

import { createBrowserApi } from "./browser"

describe("createBrowserApi inspect controls", () => {
  test("routes inspect start and stop to dedicated IPC channels", async () => {
    const calls: { type: "send" | "invoke"; channel: string; args: unknown[] }[] = []
    const api = createBrowserApi({
      invoke(channel: string, ...args: unknown[]) {
        calls.push({ type: "invoke", channel, args })
        return Promise.resolve(channel)
      },
      send(channel: string, ...args: unknown[]) {
        calls.push({ type: "send", channel, args })
      },
    })

    await api.startInspectMode()
    await api.stopInspectMode()

    expect(calls).toEqual([
      { type: "invoke", channel: "browser-inspect-start", args: [] },
      { type: "invoke", channel: "browser-inspect-stop", args: [] },
    ])
  })
})
