import { describe, expect, test } from "bun:test"
import type { Prompt } from "@/context/prompt"
import { forkSession } from "./fork"

describe("forkSession", () => {
  test("stores the prompt for the forked session and navigates", async () => {
    const value: Prompt = [{ type: "text", content: "hello", start: 0, end: 5 }]
    const calls: string[] = []

    await forkSession({
      fork: async () => ({ data: { id: "child" } }),
      sessionID: "parent",
      messageID: "msg",
      prompt: [...value],
      directory: "/tmp/demo",
      fail: () => calls.push("fail"),
      done: () => calls.push("done"),
      set: (prompt, next) => {
        expect(prompt).toEqual(value)
        expect(next).toEqual({ dir: "L3RtcC9kZW1v", id: "child" })
        calls.push("set")
      },
      navigate: (href) => {
        expect(href).toBe("/L3RtcC9kZW1v/session/child")
        calls.push("navigate")
      },
    })

    expect(calls).toEqual(["done", "set", "navigate"])
  })

  test("fails when the fork response is empty", async () => {
    const calls: string[] = []

    await forkSession({
      fork: async () => ({ data: undefined }),
      sessionID: "parent",
      messageID: "msg",
      prompt: [{ type: "text", content: "hello", start: 0, end: 5 }],
      directory: "/tmp/demo",
      fail: (message) => calls.push(message ?? "fail"),
      set: () => calls.push("set"),
      navigate: () => calls.push("navigate"),
    })

    expect(calls).toEqual(["fail"])
  })
})
