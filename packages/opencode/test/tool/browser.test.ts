import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { Cause, Effect, Exit, Option, Result, Schema } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { BrowserTool, Parameters } from "../../src/tool/browser"
import { BrowserRecording } from "../../src/tool/browser-recording"
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

  it.effect("renders the Browser Test Recording artifact from a recording", () =>
    Effect.sync(() => {
      const recording: BrowserRecording.Recording = {
        version: 1,
        startedAt: 1_700_000_000_000,
        endedAt: 1_700_000_005_000,
        url: "http://127.0.0.1:3000/",
        steps: [
          { at: 1_700_000_000_100, action: "open", params: { action: "open" }, ok: true, output: "Browser opened" },
          {
            at: 1_700_000_004_000,
            action: "fill",
            params: { action: "fill", selector: "#name", value: "<world> & co" },
            ok: true,
            url: "http://127.0.0.1:3000/",
            shot: "data:image/png;base64,AAAA",
          },
          {
            at: 1_700_000_004_500,
            action: "click",
            params: { action: "click", selector: "#missing" },
            ok: false,
            error: 'Timeout 30000ms exceeded: <div class="x">',
          },
        ],
        console: [{ at: 1_700_000_001_000, type: "pageerror", text: "Unexpected token" }],
        network: [
          {
            at: 1_700_000_002_000,
            method: "GET",
            url: "http://127.0.0.1:3000/",
            resourceType: "document",
            ok: true,
            status: 200,
          },
        ],
      }

      const html = BrowserRecording.render(recording)
      expect(html).toContain("<title>Browser Test Recording</title>")
      expect(html).toContain("duration 5.0s")
      expect(html).toContain("data:image/png;base64,AAAA")
      expect(html).toContain("#missing")
      expect(html).toContain("Unexpected token")
      // Recorded page HTML is evidence, not markup: it must be escaped so it
      // can never inject elements into the artifact (Fase 40).
      expect(html).toContain("Timeout 30000ms exceeded")
      expect(html).not.toContain('<div class="x">')
      expect(html).not.toContain("<world>")

      expect(Option.isSome(BrowserRecording.decode(JSON.stringify(recording)))).toBe(true)
      expect(Option.isSome(BrowserRecording.decode("{not json"))).toBe(false)
      expect(Option.isSome(BrowserRecording.decode('{"version":1}'))).toBe(false)
    }),
  )

  it.instance(
    "records the session, exports the artifact, and replays it after close",
    () =>
      Effect.gen(function* () {
        const tool = yield* openTool

        const openExit = yield* Effect.exit(tool.execute({ action: "open" }, ctx))
        if (Exit.isFailure(openExit)) {
          // Playwright is optional: report honest unavailability (Fase 40),
          // never a simulated recording.
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
              yield* tool.execute({ action: "goto", url: server.url.toString() }, ctx)
              yield* tool.execute({ action: "fill", selector: "#name", value: "world" }, ctx)
              yield* tool.execute({ action: "click", selector: "#go" }, ctx)
              const evaluated = yield* tool.execute(
                { action: "eval", code: "document.getElementById('title').textContent" },
                ctx,
              )
              expect(evaluated.output).toBe("world")
              yield* pollWithTimeout(
                Effect.gen(function* () {
                  const read = yield* tool.execute({ action: "console" }, ctx)
                  return read.output.includes("fixture-booted") ? read.output : undefined
                }),
                "console buffer never showed the boot message",
              )
              yield* tool.execute({ action: "network" }, ctx)
              yield* tool.execute({ action: "screenshot" }, ctx)

              // Export the Browser Test Recording artifact (HTML + JSON).
              const recorded = yield* tool.execute({ action: "recording" }, ctx)
              expect(recorded.title).toBe("Browser Test Recording")
              const lines = recorded.output.split("\n")
              expect(lines[0].startsWith("Browser Test Recording saved: ")).toBe(true)
              const htmlPath = lines[0].slice("Browser Test Recording saved: ".length)
              const jsonPath = lines[2].slice('Replay with action "replay" path='.length)

              // Visual evidence: self-contained HTML with the embedded shot.
              const html = yield* Effect.promise(() => Bun.file(htmlPath).text())
              expect(html).toContain("<title>Browser Test Recording</title>")
              expect(html).toContain("fixture-booted")
              expect(html).toContain("data:image/png;base64,")
              expect(html).toContain("#go")
              expect(html).toContain("duration")

              // The JSON recording carries everything the phase demands:
              // URL, actions, inputs, screenshots, errors, console, network.
              const decoded = BrowserRecording.decode(yield* Effect.promise(() => Bun.file(jsonPath).text()))
              expect(Option.isSome(decoded)).toBe(true)
              if (!Option.isSome(decoded)) return
              const rec = decoded.value
              expect(rec.steps.length).toBeGreaterThanOrEqual(8)
              expect(rec.steps[0]?.action).toBe("open")
              expect(rec.steps.every((step) => typeof step.at === "number")).toBe(true)
              expect(rec.steps.some((step) => step.action === "click" && step.ok)).toBe(true)
              expect(rec.steps.every((step) => step.ok)).toBe(true)
              expect(rec.url).toContain(`:${server.url.port}`)
              expect(rec.console.some((entry) => entry.text.includes("fixture-booted"))).toBe(true)
              expect(rec.network.some((entry) => entry.status === 200)).toBe(true)
              const shot = rec.steps.find((step) => step.shot !== undefined)
              expect(shot?.shot?.startsWith("data:image/png;base64,")).toBe(true)
              expect(JSON.stringify(rec.steps.find((step) => step.action === "fill")?.params)).toContain("world")

              // close persists the recording for replay without a live driver.
              const closed = yield* tool.execute({ action: "close" }, ctx)
              expect(closed.output).toContain("Browser closed")

              // No session, no path: replay the last recorded session.
              const fallback = yield* tool.execute({ action: "replay" }, ctx)
              expect(fallback.title).toBe("browser replay")
              expect(fallback.output).toContain("steps from the last recorded session")
              expect(fallback.output).toMatch(/\(\d+ ok, 0 failed/)

              // Replay the exported artifact by path and prove the browser
              // really re-did the session: the page is back in final state.
              const replayed = yield* tool.execute({ action: "replay", path: jsonPath }, ctx)
              expect(replayed.output).toContain(`steps from the file ${jsonPath}`)
              expect(replayed.output).toMatch(/\(\d+ ok, 0 failed/)
              const after = yield* tool.execute(
                { action: "eval", code: "document.getElementById('title').textContent" },
                ctx,
              )
              expect(after.output).toBe("world")
            }),
          (server) => Effect.sync(() => server.stop(true)),
        )

        // The browser must be closed even when an assertion inside fails.
        yield* Effect.ensuring(serve, tool.execute({ action: "close" }, ctx))
      }),
    180_000,
  )
})
