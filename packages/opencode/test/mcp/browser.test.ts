import { expect, mock, test } from "bun:test"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"

await mock.module("@opencode-ai/core/open", () => ({
  openUrl: async (url: string) => {
    const code = new URL(url).pathname === "/successful" ? 0 : 23
    const subprocess = spawn(process.execPath, ["-e", `process.exit(${code})`], { stdio: "ignore" })
    await once(subprocess, "close")
    return subprocess
  },
}))

const { McpBrowser } = await import("../../src/mcp/browser")

test("reports a browser launcher that exited before openUrl returned", async () => {
  const error = await Effect.runPromise(
    Effect.gen(function* () {
      const browser = yield* McpBrowser.Service
      return yield* Effect.flip(browser.open("https://example.com/authorize"))
    }).pipe(Effect.provide(LayerNode.compile(McpBrowser.node))),
  )

  expect(error.message).toBe("Browser open failed with exit code 23")
})

test("accepts a browser launcher that exited successfully before openUrl returned", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const browser = yield* McpBrowser.Service
      yield* browser.open("https://example.com/successful")
    }).pipe(Effect.provide(LayerNode.compile(McpBrowser.node))),
  )
})
