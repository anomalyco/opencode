import { describe, expect } from "bun:test"
import { BrowserControl } from "@opencode-ai/core/browser-control"
import { BrowserHost } from "@opencode-ai/core/browser-host"
import { SessionV2 } from "@opencode-ai/core/session"
import { Deferred, Effect, Fiber, Option } from "effect"
import { it } from "./lib/effect"

const sessionID = SessionV2.ID.make("ses_browser_host")
const state: BrowserControl.State = {
  url: "https://example.com/",
  title: "Example",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  generation: 3,
}

describe("BrowserHost", () => {
  it.effect("captures a lease generation and never redirects it", () =>
    Effect.gen(function* () {
      let current = "lease-1"
      const requests: BrowserControl.Request[] = []
      const control: BrowserControl.Interface = {
        request: (request) => {
          requests.push(request)
          const result: BrowserControl.Result =
            request.command.type === "status" && (!request.lease || request.lease === current)
              ? { type: "status", attached: true, lease: current, state }
              : { type: "status", attached: false }
          return Promise.resolve({
            type: "desktop.browser.response",
            version: BrowserControl.VERSION,
            requestID: request.requestID,
            result,
          } satisfies BrowserControl.Response)
        },
      }
      const host = BrowserHost.make(() => control)
      const first = Option.getOrThrow(yield* host.lease(sessionID))
      expect(first.id).toBe("lease-1")

      current = "lease-2"
      expect(yield* first.request({ type: "status" })).toEqual({ type: "status", attached: false })
      expect(requests.at(-1)?.lease).toBe("lease-1")

      const replacement = Option.getOrThrow(yield* host.lease(sessionID))
      expect(replacement.id).toBe("lease-2")
    }),
  )

  it.live("propagates Effect cancellation to the transport", () =>
    Effect.gen(function* () {
      const started = Deferred.makeUnsafe<void>()
      let aborted = false
      const host = BrowserHost.make(() => ({
        request: (_request, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                aborted = true
                reject(new Error("aborted"))
              },
              { once: true },
            )
            queueMicrotask(() => Effect.runSync(Deferred.succeed(started, undefined)))
          }),
      }))
      const fiber = yield* Effect.forkChild(host.lease(sessionID))
      yield* Deferred.await(started)
      yield* Fiber.interrupt(fiber)
      expect(aborted).toBe(true)
    }),
  )
})
