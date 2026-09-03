export * as BrowserConnection from "./connection.js"

import type { Context } from "@opencode-ai/plugin/effect/plugin"
import type { RpcRegistration } from "@opencode-ai/plugin/effect/rpc"
import type { Session } from "@opencode-ai/schema/session"
import { Tool } from "@opencode-ai/schema/tool"
import { Deferred, Effect, Schema, Stream } from "effect"
import { Browser } from "./rpc.js"

type Attachment = {
  connectionID: string
  state: Browser.State
  closed: Deferred.Deferred<"closed" | "replaced">
  pending: Map<string, { command: Browser.Command; result: Deferred.Deferred<Browser.Result, Tool.Error> }>
}

export type Connection = Effect.Success<ReturnType<typeof make>>

export const make = Effect.fn("BrowserConnection.make")(function* (
  ctx: Pick<Context, "rpc" | "session" | "location" | "event">,
) {
  const browsers = new Map<Session.ID, Attachment>()
  let active = true
  const close = (sessionID: Session.ID, reason: "closed" | "replaced" = "closed") =>
    Effect.gen(function* () {
      const browser = browsers.get(sessionID)
      if (!browser) return
      browsers.delete(sessionID)
      yield* Deferred.succeed(browser.closed, reason)
    })
  yield* Effect.addFinalizer(() => {
    active = false
    return Effect.forEach(browsers.keys(), (id) => close(id), { discard: true })
  })
  const rpc: RpcRegistration<typeof Browser.Definition> = yield* ctx.rpc
    .register(Browser.Definition, {
      attach: (input, call) =>
        Effect.gen(function* () {
          const session = yield* ctx.session
            .get({ sessionID: input.sessionID })
            .pipe(Effect.mapError(() => call.error("unavailable", "Session not found.", {})))
          if (
            session.location.directory !== ctx.location.directory ||
            session.location.workspaceID !== ctx.location.workspaceID
          )
            return yield* Effect.fail(call.error("unavailable", "Session belongs to another location.", {}))
          const browser = yield* Effect.acquireRelease(
            Effect.gen(function* () {
              if (!active) return yield* Effect.fail(call.error("unavailable", "Browser is unavailable.", {}))
              yield* close(input.sessionID, "replaced")
              const browser: Attachment = {
                connectionID: input.connectionID,
                state: { tabs: [], focusedTabID: null },
                closed: yield* Deferred.make<"closed" | "replaced">(),
                pending: new Map(),
              }
              browsers.set(input.sessionID, browser)
              return browser
            }),
            (browser) => (browsers.get(input.sessionID) === browser ? close(input.sessionID) : Effect.void),
          )
          yield* rpc.events
            .emit("control", { type: "attached", connectionID: input.connectionID, version: 3 })
            .pipe(Effect.orDie)
          return yield* Deferred.await(browser.closed)
        }).pipe(Effect.scoped),
      state: (input, call) =>
        Effect.gen(function* () {
          const browser = browsers.get(input.sessionID)
          if (!browser || browser.connectionID !== input.connectionID)
            return yield* Effect.fail(call.error("unavailable", "Browser is unavailable.", {}))
          browser.state = input.state
        }),
      command: (input, call) =>
        Effect.gen(function* () {
          const browser = browsers.get(input.sessionID)
          const pending =
            browser?.connectionID === input.connectionID ? browser.pending.get(input.requestID) : undefined
          if (!pending)
            return yield* Effect.fail(call.error("unavailable", "Browser request is no longer available.", {}))
          return pending.command
        }),
      result: (input, call) =>
        Effect.gen(function* () {
          const browser = browsers.get(input.sessionID)
          if (!browser || browser.connectionID !== input.connectionID)
            return yield* Effect.fail(call.error("unavailable", "Browser is unavailable.", {}))
          const pending = browser.pending.get(input.requestID)
          if (!pending) return
          if (input.outcome.type === "failure")
            return yield* Deferred.fail(
              pending.result,
              new Tool.Error({ message: `[browser.${input.outcome.code}] ${input.outcome.message}` }),
            ).pipe(Effect.asVoid)
          yield* Deferred.succeed(pending.result, input.outcome.result)
        }).pipe(Effect.asVoid),
    })
    .pipe(Effect.orDie)
  yield* ctx.event.subscribe().pipe(
    Stream.filter((event) => event.type === "session.deleted" || event.type === "session.moved"),
    Stream.runForEach((event) => close(event.data.sessionID)),
    Effect.forkScoped({ startImmediately: true }),
  )

  return {
    target: Effect.fn("BrowserConnection.target")(function* (sessionID: Session.ID, action: Browser.Action) {
      const browser = browsers.get(sessionID)
      if (!browser)
        return yield* new Tool.Error({
          message:
            "[browser.disconnected] No desktop browser is connected to this session. Open this session in the desktop app, enable the experimental browser setting, and wait for it to connect. Then call browser.tabs.list({}). Repeating browser actions while disconnected will not help.",
        })
      const tab = "tabID" in action ? browser.state.tabs.find((tab) => tab.id === action.tabID) : undefined
      if ("tabID" in action && !tab)
        return yield* new Tool.Error({
          message:
            "[browser.tab_unavailable] This tab is closed or does not belong to the connected session. Call browser.tabs.list({}) and use an exact returned tabID. If no tabs exist, use browser.tabs.open({}). Never substitute a request ID, file ID, or element ref for tabID.",
        })
      // Keep the selected attachment and document, even while permissions or file IO wait.
      return {
        tab,
        inspect: () =>
          request(rpc, browser, action, tab, [], { inspect: true }).pipe(
            Effect.flatMap((result) => Schema.decodeUnknownEffect(Browser.Target)(result.value)),
            Effect.mapError(
              (error) =>
                new Tool.Error({
                  message:
                    error instanceof Tool.Error
                      ? error.message
                      : "Browser returned invalid target metadata. Check desktop/plugin versions; no action was authorized.",
                  error,
                }),
            ),
          ),
        request: (files: readonly Browser.File[], target?: Browser.Target) =>
          request(rpc, browser, action, tab, files, { target }),
      }
    }),
  }
})

const request = Effect.fn("BrowserConnection.request")(function* (
  rpc: RpcRegistration<typeof Browser.Definition>,
  browser: Attachment,
  action: Browser.Action,
  tab: Browser.Tab | undefined,
  files: readonly Browser.File[],
  inspection: Pick<Browser.Command, "inspect" | "target">,
) {
  const requestID = crypto.randomUUID()
  const pending = yield* Deferred.make<Browser.Result, Tool.Error>()
  const command =
    action.type === "files.upload" || action.type === "files.drop"
      ? { ...action, paths: files.map((file) => file.name) }
      : action
  browser.pending.set(requestID, {
    command: { action: command, ...(tab ? { generation: tab.generation } : {}), files, ...inspection },
    result: pending,
  })
  return yield* rpc.events.emit("control", { type: "command", connectionID: browser.connectionID, requestID }).pipe(
    Effect.mapError(
      (error) =>
        new Tool.Error({
          message: `Could not dispatch browser.${action.type}. Check the desktop connection and call browser.tabs.list({}) before deciding whether to retry.`,
          error,
        }),
    ),
    Effect.andThen(Deferred.await(pending)),
    Effect.raceFirst(
      Deferred.await(browser.closed).pipe(
        Effect.andThen(
          new Tool.Error({
            message:
              "[browser.disconnected] Browser connection closed; the action may already have run. Reconnect this session in the desktop app, call browser.tabs.list({}), and inspect the target tab with browser.snapshot({tabID}). Do not repeat clicks, submissions, uploads, or evaluations until their outcome is known.",
          }),
        ),
      ),
    ),
    Effect.onInterrupt(() =>
      rpc.events.emit("control", { type: "cancel", connectionID: browser.connectionID, requestID }).pipe(Effect.ignore),
    ),
    Effect.timeoutOrElse({
      duration: "60 seconds",
      orElse: () =>
        new Tool.Error({
          message: `[browser.timeout] browser.${action.type} did not finish within 60 seconds; its outcome is unknown. Check the desktop connection, call browser.tabs.list({}), and inspect the tab or browser.files.list({tabID}) for completed work. Do not blindly repeat a mutating action or start another recording.`,
        }),
    }),
    Effect.ensuring(Effect.sync(() => browser.pending.delete(requestID))),
  )
})
