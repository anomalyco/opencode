export * as BrowserControlConnection from "./browser-control-connection"

import { BrowserHost } from "@opencode-ai/core/browser-host"
import { BrowserControlProtocol } from "@opencode-ai/protocol/browser-control"
import { Browser } from "@opencode-ai/schema/browser"
import { BrowserControl } from "@opencode-ai/schema/browser-control"
import { Session } from "@opencode-ai/schema/session"
import { Deferred, Effect } from "effect"
import { Socket } from "effect/unstable/socket"

const registrations = new Map<Session.ID, { readonly token: object; readonly leaseID?: Browser.LeaseID }>()

export function isAttached(sessionID: Session.ID, leaseID: Browser.LeaseID) {
  return registrations.get(sessionID)?.leaseID === leaseID
}

export const run = Effect.fn("BrowserControlConnection.run")(function* (
  socket: Socket.Socket,
  opened: Effect.Effect<void> = Effect.void,
) {
  const browser = yield* BrowserHost.Service
  const write = yield* socket.writer
  const pending = new Map<BrowserControl.RequestID, Deferred.Deferred<Browser.Outcome>>()
  const token = {}
  let sessionID: Session.ID | undefined
  let controller: BrowserHost.Controller | undefined

  const send = (message: BrowserControl.FromServer) =>
    Effect.try({
      try: () => BrowserControlProtocol.encodeFromServer(message),
      catch: () =>
        new BrowserHost.RequestError({ code: "protocol", message: "Failed to encode browser control message." }),
    }).pipe(
      Effect.flatMap(write),
      Effect.mapError(
        () => new BrowserHost.RequestError({ code: "internal", message: "Browser control connection failed." }),
      ),
    )

  const peer: BrowserHost.Peer = {
    open: send({ type: "browser.control.open" }),
    request: (command, leaseID) =>
      Effect.gen(function* () {
        const requestID = BrowserControl.RequestID.create()
        const done = yield* Deferred.make<Browser.Outcome>()
        pending.set(requestID, done)
        yield* send({ type: "browser.control.request", requestID, leaseID, command })
        const outcome = yield* Deferred.await(done).pipe(
          Effect.onInterrupt(() => send({ type: "browser.control.cancel", requestID, leaseID }).pipe(Effect.ignore)),
          Effect.ensuring(Effect.sync(() => pending.delete(requestID))),
        )
        if (outcome.type === "failure") return yield* new BrowserHost.RequestError(outcome)
        return outcome.result
      }),
  }

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      if (sessionID && registrations.get(sessionID)?.token === token) registrations.delete(sessionID)
      pending.forEach((done) =>
        Deferred.doneUnsafe(
          done,
          Effect.succeed({ type: "failure", code: "not_attached", message: "Browser control connection closed." }),
        ),
      )
      pending.clear()
    }),
  )

  const receive = Effect.fnUntraced(function* (raw: string | Uint8Array) {
    const message = yield* BrowserControlProtocol.decodeFromClient(raw)
    if (!controller) {
      if (message.type !== "browser.control.register")
        return yield* Effect.fail(new Error("Expected browser registration."))
      sessionID = message.sessionID
      controller = yield* browser.register(message.sessionID, peer)
      registrations.set(message.sessionID, { token })
      yield* send({ type: "browser.control.registered" })
      return
    }
    if (!sessionID || message.type === "browser.control.register") {
      return yield* Effect.fail(new Error("Browser control connection is already registered."))
    }
    if (message.type === "browser.control.attach") {
      yield* controller.attach(message.leaseID, message.state)
      registrations.set(sessionID, { token, leaseID: message.leaseID })
      yield* send({ type: "browser.control.attached", leaseID: message.leaseID })
      return
    }
    if (message.type === "browser.control.state") {
      yield* controller.state(message.leaseID, message.state)
      return
    }
    if (message.type === "browser.control.detach") {
      yield* controller.detach(message.leaseID)
      registrations.set(sessionID, { token })
      return
    }
    const done = pending.get(message.requestID)
    if (!done || registrations.get(sessionID)?.leaseID !== message.leaseID) {
      return yield* Effect.fail(new Error("Browser response does not match a pending request."))
    }
    Deferred.doneUnsafe(done, Effect.succeed(message.outcome))
  })

  yield* socket.runRaw(receive, { onOpen: opened }).pipe(
    Effect.catchCause((cause) =>
      write(new Socket.CloseEvent(1002, "Invalid browser control message")).pipe(
        Effect.timeoutOrElse({ duration: "1 second", orElse: () => Effect.void }),
        Effect.catch(() => Effect.void),
        Effect.andThen(Effect.logDebug("Browser control connection closed", { cause })),
      ),
    ),
  )
})
