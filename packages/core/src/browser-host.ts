export * as BrowserHost from "./browser-host"

import { Browser } from "@opencode-ai/schema/browser"
import { Session } from "@opencode-ai/schema/session"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Context, Deferred, Effect, Layer, Option, Schema, Scope, Stream, SynchronizedRef } from "effect"
import { Bus } from "./bus"
import { SessionEvent } from "./session/event"
import { SessionStore } from "./session/store"

export class RegistrationError extends Schema.TaggedErrorClass<RegistrationError>()("BrowserHost.RegistrationError", {
  reason: Schema.Literals(["unknown_session", "already_registered", "stale_registration", "stale_lease"]),
  message: Schema.String,
}) {}

export class RequestError extends Schema.TaggedErrorClass<RequestError>()("BrowserHost.RequestError", {
  code: Browser.ErrorCode,
  message: Schema.String,
}) {}

export interface Peer {
  readonly open: Effect.Effect<void, RequestError>
  readonly request: (
    command: Browser.Command,
    leaseID: Browser.LeaseID,
  ) => Effect.Effect<Browser.Result, RequestError>
}

export interface Controller {
  readonly attach: (leaseID: Browser.LeaseID, state: Browser.State) => Effect.Effect<void, RegistrationError>
  readonly state: (leaseID: Browser.LeaseID, state: Browser.State) => Effect.Effect<void, RegistrationError>
  readonly detach: (leaseID: Browser.LeaseID) => Effect.Effect<void, RegistrationError>
}

export interface Available {
  readonly type: "available"
  readonly open: Effect.Effect<void, RequestError>
}

export interface Attached {
  readonly type: "attached"
  readonly state: Browser.State
  readonly revoked: Effect.Effect<void>
  readonly request: (command: Browser.Command) => Effect.Effect<Browser.Result, RequestError>
}

export type Capability = Available | Attached

export interface Interface {
  readonly register: (
    sessionID: Session.ID,
    peer: Peer,
  ) => Effect.Effect<Controller, RegistrationError, Scope.Scope>
  readonly get: (sessionID: Session.ID) => Effect.Effect<Option.Option<Capability>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/BrowserHost") {}

type Attachment = {
  readonly token: object
  readonly leaseID: Browser.LeaseID
  readonly state: Browser.State
  readonly revoked: Deferred.Deferred<void>
}

type Registration = {
  readonly token: object
  readonly peer: Peer
  readonly attached: Deferred.Deferred<void>
  readonly attachment?: Attachment
}

type State = ReadonlyMap<Session.ID, Registration>

export function make(
  sessionExists: (sessionID: Session.ID) => Effect.Effect<boolean>,
  deleted: Stream.Stream<Session.ID> = Stream.never,
) {
  return Effect.gen(function* () {
    const registrations = yield* SynchronizedRef.make<State>(new Map())

    const remove = Effect.fn("BrowserHost.remove")(function* (sessionID: Session.ID, token?: object) {
      const attachment = yield* SynchronizedRef.modify(registrations, (current): readonly [Attachment | undefined, State] => {
        const registration = current.get(sessionID)
        if (!registration || (token && registration.token !== token)) return [undefined, current]
        const next = new Map(current)
        next.delete(sessionID)
        return [registration.attachment, next]
      })
      if (attachment) Deferred.doneUnsafe(attachment.revoked, Effect.void)
    })

    const register: Interface["register"] = Effect.fn("BrowserHost.register")(function* (sessionID, peer) {
      if (!(yield* sessionExists(sessionID))) {
        return yield* new RegistrationError({
          reason: "unknown_session",
          message: "The browser Session does not exist.",
        })
      }

      const token = {}
      yield* SynchronizedRef.modifyEffect(
        registrations,
        Effect.fnUntraced(function* (current) {
          if (current.has(sessionID)) {
            return yield* new RegistrationError({
              reason: "already_registered",
              message: "The browser Session is already registered.",
            })
          }
          return [undefined, new Map(current).set(sessionID, { token, peer, attached: Deferred.makeUnsafe<void>() })] as const
        }),
      )
      yield* Effect.addFinalizer(() => remove(sessionID, token))

      const attach: Controller["attach"] = Effect.fn("BrowserHost.attach")(function* (leaseID, state) {
        const previous = yield* SynchronizedRef.modifyEffect(
        registrations,
        Effect.fnUntraced(function* (current) {
            const registration = current.get(sessionID)
            if (registration?.token !== token) {
              return yield* new RegistrationError({
                reason: "stale_registration",
                message: "The browser registration is no longer active.",
              })
            }
            const attachment = { token: {}, leaseID, state, revoked: Deferred.makeUnsafe<void>() }
            return [
              registration.attachment,
              new Map(current).set(sessionID, { ...registration, attachment }),
            ] as const
          }),
        )
        if (previous) Deferred.doneUnsafe(previous.revoked, Effect.void)
        const current = (yield* SynchronizedRef.get(registrations)).get(sessionID)
        if (current) Deferred.doneUnsafe(current.attached, Effect.void)
      })

      const update: Controller["state"] = Effect.fn("BrowserHost.state")(function* (leaseID, state) {
        yield* SynchronizedRef.updateEffect(
          registrations,
          Effect.fnUntraced(function* (current) {
            const registration = current.get(sessionID)
            if (registration?.token !== token) {
              return yield* new RegistrationError({
                reason: "stale_registration",
                message: "The browser registration is no longer active.",
              })
            }
            const attachment = registration.attachment
            if (attachment?.leaseID !== leaseID) {
              return yield* new RegistrationError({
                reason: "stale_lease",
                message: "The browser attachment lease is no longer active.",
              })
            }
            return new Map(current).set(sessionID, {
              ...registration,
              attachment: { ...attachment, state },
            })
          }),
        )
      })

      const detach: Controller["detach"] = Effect.fn("BrowserHost.detach")(function* (leaseID) {
        const attachment = yield* SynchronizedRef.modifyEffect(
          registrations,
          Effect.fnUntraced(function* (current) {
            const registration = current.get(sessionID)
            if (registration?.token !== token) {
              return yield* new RegistrationError({
                reason: "stale_registration",
                message: "The browser registration is no longer active.",
              })
            }
            const attachment = registration.attachment
            if (attachment?.leaseID !== leaseID) {
              return yield* new RegistrationError({
                reason: "stale_lease",
                message: "The browser attachment lease is no longer active.",
              })
            }
            return [
              attachment,
              new Map(current).set(sessionID, { token, peer, attached: Deferred.makeUnsafe<void>() }),
            ] as const
          }),
        )
        Deferred.doneUnsafe(attachment.revoked, Effect.void)
      })

      return { attach, state: update, detach }
    })

    const get: Interface["get"] = Effect.fn("BrowserHost.get")(function* (sessionID) {
      if (!(yield* sessionExists(sessionID))) {
        yield* remove(sessionID)
        return Option.none()
      }
      const registration = (yield* SynchronizedRef.get(registrations)).get(sessionID)
      if (!registration) return Option.none()
      if (!registration.attachment) {
        return Option.some({
          type: "available" as const,
          open: Effect.gen(function* () {
            const current = (yield* SynchronizedRef.get(registrations)).get(sessionID)
            if (current?.token !== registration.token || current.attachment) return yield* unavailable()
            yield* registration.peer.open
            return yield* Deferred.await(registration.attached).pipe(
              Effect.timeoutOrElse({
                duration: "30 seconds",
                orElse: () => Effect.fail(new RequestError({ code: "timeout", message: "Browser pane did not open." })),
              }),
            )
          }),
        })
      }

      const attachment = registration.attachment
      return Option.some({
        type: "attached" as const,
        state: attachment.state,
        revoked: Deferred.await(attachment.revoked),
        request: (command) =>
          Effect.gen(function* () {
            const current = (yield* SynchronizedRef.get(registrations)).get(sessionID)
            if (current?.token !== registration.token || current.attachment?.token !== attachment.token) {
              return yield* unavailable()
            }
            const result = yield* registration.peer
              .request(command, attachment.leaseID)
              .pipe(Effect.raceFirst(Deferred.await(attachment.revoked).pipe(Effect.andThen(unavailable()))))
            if (result.type === command.type) return result
            return yield* new RequestError({ code: "protocol", message: "Browser response does not match its command." })
          }),
      })
    })

    yield* Stream.runForEach(deleted, (sessionID) => remove(sessionID)).pipe(Effect.forkScoped)
    return Service.of({ register, get })
  })
}

function unavailable() {
  return new RequestError({ code: "not_attached", message: "The browser attachment is no longer available." })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* SessionStore.Service
    const bus = yield* Bus.Service
    return yield* make(
      (sessionID) => sessions.get(sessionID).pipe(Effect.map((session) => session !== undefined)),
      bus.subscribe(SessionEvent.Deleted).pipe(Stream.map((event) => event.data.sessionID)),
    )
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [SessionStore.node, Bus.node],
})
