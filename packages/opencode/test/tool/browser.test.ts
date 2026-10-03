import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { Cause, Effect, Exit, Result, Schema } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { BrowserTool, Parameters } from "../../src/tool/browser"
import { SessionID, MessageID } from "../../src/session/schema"
import { Tool } from "@/tool/tool"
import { testEffect, pollWithTimeout } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([httpClient, Truncate.node, Agent.node]), [[httpClient, FetchHttpClient.layer]]),
)

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_message"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const failureMessage = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isSuccess(exit) ? "" : String(Cause.squash(exit.cause))

/** A fresh tool per yield: the session state lives in the init closure, so each
 *  test gets its own browser session exactly like the per-instance registry does. */
const openTool = Effect.gen(function* () {
  const info = yield* BrowserTool
  return yield* info.init()
})

const PAGE =
  "<!doctype html><html><head><title>fixture</title></head><body>" +
  '<h1 id="title">hello</h1><input id="name" /><button id="go">go</button>' +
  "<script>" +
  'console.warn("fixture-booted");' +
  'document.getElementById("go").addEventListener("click", () => {' +
  '  document.getElementById("title").textContent = document.getElementById("name").value || "clicked"' +
  "})" +
  "</script></body></html>"

describe("tool.browser", () => {
  it.effect("enforces the action schema", () =>
    Effect.sync(() => {
      expect(Result.isSuccess(Schema.decodeUnknownResult(Parameters)({ action: "teleport" }))).toBe(false)
      expect(Result.isSuccess(Schema.decodeUnknownResult(Parameters)({}))).toBe(false)
      expect(Result.isSuccess(Schema.decodeUnknownResult(Parameters)({ action: "goto", url: "https://x.dev" }))).toBe(
        true,
      )
    }),
  )

  it.instance(
    "validates required fields before touching the browser",
    () =>
      Effect.gen(function* () {
        const tool = yield* openTool

        const failure = (args: Tool.InferParameters<typeof BrowserTool>) =>
          Effect.gen(function* () {
            const exit = yield* Effect.exit(tool.execute(args, ctx))
            return failureMessage(exit)
          })

        expect(yield* failure({ action: "goto" })).toContain('The browser action "goto" requires "url"')
        expect(yield* failure({ action: "click" })).toContain('requires "selector"')
        expect(yield* failure({ action: "fill", selector: "#x" })).toContain('requires "value"')
        expect(yield* failure({ action: "eval" })).toContain('requires "code"')
        expect(yield* failure({ action: "viewport", width: 375 })).toContain('requires "height"')
        expect(yield* failure({ action: "click", selector: "#x" })).toContain("requires an open browser session")
        expect(yield* failure({ action: "screenshot" })).toContain("requires an open browser session")

        const close = yield* tool.execute({ action: "close" }, ctx)
        expect(close.output).toBe("No browser session to close.")
      }),
    30_000,
  )

  it.instance(
    "drives a real page, or reports honest unavailability",
    () =>
      Effect.gen(function* () {
        const tool = yield* openTool

        const openExit = yield* Effect.exit(tool.execute({ action: "open" }, ctx))
        if (Exit.isFailure(openExit)) {
          // Playwright is optional and runtime-sensitive: the tool must say
          // honestly why no browser exists (not installed, or launcher blocked
          // in this runtime) — never simulate a browser result (Fase 40).
          const message = failureMessage(openExit)
          expect(message).toContain("playwright")
          expect(/install|BLOCKED/i.test(message)).toBe(true)
          return
        }

        const serve = Effect.acquireUseRelease(
          Effect.sync(() =>
            Bun.serve({
              port: 0,
              fetch: () => new Response(PAGE, { headers: { "content-type": "text/html" } }),
            }),
          ),
          (server) =>
            Effect.gen(function* () {
              const goto = yield* tool.execute({ action: "goto", url: server.url.toString() }, ctx)
              expect(goto.output).toContain("Title: fixture")

              yield* tool.execute({ action: "fill", selector: "#name", value: "world" }, ctx)
              yield* tool.execute({ action: "click", selector: "#go" }, ctx)
              const evaluated = yield* tool.execute(
                { action: "eval", code: "document.getElementById('title').textContent" },
                ctx,
              )
              expect(evaluated.output).toBe("world")

              const consoleOutput = yield* pollWithTimeout(
                Effect.gen(function* () {
                  const read = yield* tool.execute({ action: "console" }, ctx)
                  return read.output.includes("fixture-booted") ? read.output : undefined
                }),
                "console buffer never showed the boot message",
              )
              expect(consoleOutput).toContain("fixture-booted")

              const network = yield* tool.execute({ action: "network" }, ctx)
              expect(network.output).toContain("200")

              const snapshot = yield* tool.execute({ action: "snapshot" }, ctx)
              expect(snapshot.output).toContain('<h1 id="title">world</h1>')

              const shot = yield* tool.execute({ action: "screenshot" }, ctx)
              expect(shot.attachments?.[0]?.mime).toBe("image/png")
              expect(shot.attachments?.[0]?.url.startsWith("data:image/png;base64,")).toBe(true)

              const viewport = yield* tool.execute({ action: "viewport", width: 375, height: 667 }, ctx)
              expect(viewport.output).toContain("375x667")
              const viewportRead = yield* tool.execute({ action: "viewport" }, ctx)
              expect(viewportRead.output).toContain("375x667")

              yield* tool.execute({ action: "wait", selector: "#name" }, ctx)
            }),
          (server) => Effect.sync(() => server.stop(true)),
        )

        // The browser must be closed even when an assertion inside fails.
        yield* Effect.ensuring(serve, tool.execute({ action: "close" }, ctx))
      }),
    60_000,
  )
})
