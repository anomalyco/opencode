import { describe, expect, test } from "bun:test"
import { revertMessage } from "../../src/util/revert"

describe("revertMessage", () => {
  test("cancels a running turn before reverting the message", async () => {
    const calls: string[] = []

    const result = await revertMessage({
      sessionID: "ses_test",
      messageID: "msg_test",
      status: { type: "busy" },
      abort: async () => {
        calls.push("abort")
      },
      revert: async () => {
        calls.push("revert")
        return {}
      },
    })

    expect(calls).toEqual(["abort", "revert"])
    expect(result).toEqual({ ok: true })
  })

  test("cancels a running turn while the session is auto-retrying", async () => {
    const calls: string[] = []

    await revertMessage({
      sessionID: "ses_test",
      messageID: "msg_test",
      status: { type: "retry" },
      abort: async () => {
        calls.push("abort")
      },
      revert: async () => {
        calls.push("revert")
        return {}
      },
    })

    expect(calls).toEqual(["abort", "revert"])
  })

  test("does not cancel when the session is idle", async () => {
    const calls: string[] = []

    await revertMessage({
      sessionID: "ses_test",
      messageID: "msg_test",
      status: { type: "idle" },
      abort: async () => {
        calls.push("abort")
      },
      revert: async () => {
        calls.push("revert")
        return {}
      },
    })

    expect(calls).toEqual(["revert"])
  })

  test("cancels when the session status has not hydrated yet", async () => {
    const calls: string[] = []

    await revertMessage({
      sessionID: "ses_test",
      messageID: "msg_test",
      status: undefined,
      abort: async () => {
        calls.push("abort")
      },
      revert: async () => {
        calls.push("revert")
        return {}
      },
    })

    expect(calls).toEqual(["abort", "revert"])
  })

  test("still reverts when the cancel request fails", async () => {
    const calls: string[] = []

    const result = await revertMessage({
      sessionID: "ses_test",
      messageID: "msg_test",
      status: { type: "busy" },
      abort: async () => {
        calls.push("abort")
        throw new Error("offline")
      },
      revert: async () => {
        calls.push("revert")
        return {}
      },
    })

    expect(calls).toEqual(["abort", "revert"])
    expect(result).toEqual({ ok: true })
  })

  test("reports failure when the revert request returns an error", async () => {
    const error = { name: "SessionBusyError" }

    const result = await revertMessage({
      sessionID: "ses_test",
      messageID: "msg_test",
      status: { type: "idle" },
      abort: async () => {},
      revert: async () => ({ error }),
    })

    expect(result).toEqual({ ok: false, error })
  })

  test("reports failure when the revert request rejects", async () => {
    const error = new Error("network")

    const result = await revertMessage({
      sessionID: "ses_test",
      messageID: "msg_test",
      status: { type: "idle" },
      abort: async () => {},
      revert: async () => {
        throw error
      },
    })

    expect(result).toEqual({ ok: false, error })
  })

  test("passes the session and message ids to both requests", async () => {
    const seen: Array<{ call: string; input: { sessionID: string; messageID?: string } }> = []

    await revertMessage({
      sessionID: "ses_test",
      messageID: "msg_test",
      status: { type: "busy" },
      abort: async (input) => {
        seen.push({ call: "abort", input })
      },
      revert: async (input) => {
        seen.push({ call: "revert", input })
        return {}
      },
    })

    expect(seen).toEqual([
      { call: "abort", input: { sessionID: "ses_test" } },
      { call: "revert", input: { sessionID: "ses_test", messageID: "msg_test" } },
    ])
  })
})
