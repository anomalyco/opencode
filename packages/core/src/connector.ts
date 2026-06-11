export * as Connector from "./connector"

import { Cause, Clock, Context, Duration, Effect, Exit, Layer, Schedule, Schema, Scope, SynchronizedRef } from "effect"
import { castDraft, enableMapSet, type Draft } from "immer"
import { Credential } from "./credential"
import { ConnectorSchema } from "./connector/schema"
import { withStatics } from "./schema"
import { State } from "./state"
import { Identifier } from "./util/identifier"
import { KeyedMutex } from "./effect/keyed-mutex"
import { EventV2 } from "./event"

export const ID = ConnectorSchema.ID
export type ID = ConnectorSchema.ID

export const MethodID = ConnectorSchema.MethodID
export type MethodID = ConnectorSchema.MethodID

export const AttemptID = Schema.String.pipe(
  Schema.brand("Connector.AttemptID"),
  withStatics((schema) => ({ create: () => schema.make("con_" + Identifier.ascending()) })),
)
export type AttemptID = typeof AttemptID.Type

export const When = Schema.Struct({
  key: Schema.String,
  op: Schema.Literals(["eq", "neq"]),
  value: Schema.String,
}).annotate({ identifier: "Connector.When" })
export type When = typeof When.Type

export class TextPrompt extends Schema.Class<TextPrompt>("Connector.TextPrompt")({
  type: Schema.Literal("text"),
  key: Schema.String,
  message: Schema.String,
  placeholder: Schema.optional(Schema.String),
  when: Schema.optional(When),
}) {}

export class SelectPrompt extends Schema.Class<SelectPrompt>("Connector.SelectPrompt")({
  type: Schema.Literal("select"),
  key: Schema.String,
  message: Schema.String,
  options: Schema.Array(
    Schema.Struct({
      label: Schema.String,
      value: Schema.String,
      hint: Schema.optional(Schema.String),
    }),
  ),
  when: Schema.optional(When),
}) {}

export const Prompt = Schema.Union([TextPrompt, SelectPrompt]).pipe(Schema.toTaggedUnion("type"))
export type Prompt = typeof Prompt.Type

export class OAuthMethod extends Schema.Class<OAuthMethod>("Connector.OAuthMethod")({
  id: MethodID,
  type: Schema.Literal("oauth"),
  label: Schema.String,
  prompts: Schema.optional(Schema.Array(Prompt)),
}) {}

export class KeyMethod extends Schema.Class<KeyMethod>("Connector.KeyMethod")({
  id: MethodID,
  type: Schema.Literal("key"),
  label: Schema.String,
  prompts: Schema.optional(Schema.Array(Prompt)),
}) {}

export const Method = Schema.Union([OAuthMethod, KeyMethod]).pipe(Schema.toTaggedUnion("type"))
export type Method = typeof Method.Type

export class Info extends Schema.Class<Info>("Connector.Info")({
  id: ID,
  name: Schema.String,
  methods: Schema.Array(Method),
}) {}

export type Inputs = Readonly<{ [key: string]: string }>

export type OAuthAuthorization = {
  readonly url: string
  readonly instructions: string
} & (
  | {
      readonly mode: "auto"
      readonly callback: Effect.Effect<Credential.Value, unknown>
    }
  | {
      readonly mode: "code"
      readonly callback: (code: string) => Effect.Effect<Credential.Value, unknown>
    }
)

export interface OAuthImplementation {
  readonly connectorID: ID
  readonly method: OAuthMethod
  readonly authorize: (inputs: Inputs) => Effect.Effect<OAuthAuthorization, unknown, Scope.Scope>
  readonly refresh?: (credential: Credential.OAuth) => Effect.Effect<Credential.OAuth, unknown>
}

export interface KeyImplementation {
  readonly connectorID: ID
  readonly method: KeyMethod
  readonly authorize: (key: string, inputs: Inputs) => Effect.Effect<Credential.Key, unknown>
}

export type Implementation = OAuthImplementation | KeyImplementation

function isKeyImplementation(implementation: Implementation): implementation is KeyImplementation {
  return implementation.method.type === "key"
}

function isOAuthImplementation(implementation: Implementation): implementation is OAuthImplementation {
  return implementation.method.type === "oauth"
}

export class Attempt extends Schema.Class<Attempt>("Connector.Attempt")({
  attemptID: AttemptID,
  url: Schema.String,
  instructions: Schema.String,
  mode: Schema.Literals(["auto", "code"]),
  time: Schema.Struct({
    created: Schema.Number,
    expires: Schema.Number,
  }),
}) {}

const Time = Schema.Struct({
  created: Schema.Number,
  expires: Schema.Number,
})

export const AttemptStatus = Schema.Union([
  Schema.Struct({ status: Schema.Literal("pending"), time: Time }),
  Schema.Struct({ status: Schema.Literal("complete"), time: Time }),
  Schema.Struct({ status: Schema.Literal("failed"), message: Schema.String, time: Time }),
  Schema.Struct({ status: Schema.Literal("expired"), time: Time }),
]).pipe(Schema.toTaggedUnion("status"))
export type AttemptStatus = typeof AttemptStatus.Type

export class CodeRequiredError extends Schema.TaggedErrorClass<CodeRequiredError>()("Connector.CodeRequired", {
  attemptID: AttemptID,
}) {}

export class AuthorizationError extends Schema.TaggedErrorClass<AuthorizationError>()("Connector.Authorization", {
  cause: Schema.Defect,
}) {}

export type Error = CodeRequiredError | AuthorizationError

export const Event = {
  Updated: EventV2.define({
    type: "connector.updated",
    schema: {},
  }),
}

type Entry = {
  connector: Info
  implementations: Map<MethodID, Implementation>
}

type Data = {
  connectors: Map<ID, Entry>
}

export type Editor = {
  list: () => readonly Info[]
  get: (id: ID) => Info | undefined
  update: (id: ID, update: (connector: Draft<Omit<Info, "methods">>) => void) => void
  remove: (id: ID) => void
  method: {
    update: (implementation: Implementation) => void
    remove: (connectorID: ID, methodID: MethodID) => void
  }
}

export interface Interface {
  /** Registers a scoped transform over the connector registry. */
  readonly transform: State.Interface<Data, Editor>["transform"]
  /** Registers and immediately applies a scoped connector registry update. */
  readonly update: State.Interface<Data, Editor>["update"]
  /** Returns one connector with its serializable login methods. */
  readonly get: (id: ID) => Effect.Effect<Info | undefined>
  /** Returns all connectors with their serializable login methods. */
  readonly list: () => Effect.Effect<Info[]>
  /** Refreshes an OAuth credential with its originating method. */
  readonly refresh: (credentialID: Credential.ID) => Effect.Effect<void, AuthorizationError>
  readonly connect: {
    /** Runs a key method and stores the resulting credential. */
    readonly key: (input: {
      /** Connector receiving the credential. */
      readonly connectorID: ID
      /** Key method selected by the caller. */
      readonly methodID: MethodID
      /** Secret entered by the user. */
      readonly key: string
      /** Answers to the method's optional prompts. */
      readonly inputs: Inputs
      /** User-facing label for the stored credential. */
      readonly label?: string
    }) => Effect.Effect<void, AuthorizationError>
    readonly oauth: {
      /** Starts a stateful OAuth attempt. */
      readonly begin: (input: {
        /** Connector being authenticated. */
        readonly connectorID: ID
        /** OAuth method selected by the caller. */
        readonly methodID: MethodID
        /** Answers to the method's optional prompts. */
        readonly inputs: Inputs
        /** User-facing label for the credential created on completion. */
        readonly label?: string
      }) => Effect.Effect<Attempt, AuthorizationError>
      /** Returns the current state of an OAuth attempt. */
      readonly status: (attemptID: AttemptID) => Effect.Effect<AttemptStatus>
      /** Completes the attempt and stores its credential. */
      readonly complete: (input: {
        /** Opaque handle returned by `begin`. */
        readonly attemptID: AttemptID
        /** Authorization code required by attempts in code mode. */
        readonly code?: string
      }) => Effect.Effect<void, CodeRequiredError | AuthorizationError>
      /** Cancels an attempt and releases its resources. */
      readonly cancel: (attemptID: AttemptID) => Effect.Effect<void>
    }
  }
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Connector") {}

enableMapSet()

const attemptLifetime = Duration.toMillis(Duration.minutes(10))
const terminalRetention = Duration.toMillis(Duration.minutes(1))
const scrubInterval = Duration.seconds(30)

type AttemptTime = { created: number; expires: number }
type PendingAttempt = {
  status: "pending"
  completing: boolean
  authorization: OAuthAuthorization
  connectorID: ID
  methodID: MethodID
  label?: string
  scope: Scope.Closeable
  time: AttemptTime
}
type TerminalAttempt = {
  status: "complete" | "failed" | "expired"
  message?: string
  removeAt: number
  time: AttemptTime
}
type AttemptEntry = PendingAttempt | TerminalAttempt

export const locationLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const credentials = yield* Credential.Service
    const events = yield* EventV2.Service
    const scope = yield* Scope.Scope
    const attempts = SynchronizedRef.makeUnsafe(new Map<AttemptID, AttemptEntry>())
    const refreshLocks = KeyedMutex.makeUnsafe<Credential.ID>()
    const state = State.create<Data, Editor>({
      initial: () => ({ connectors: new Map<ID, Entry>() }),
      editor: (draft) => ({
        list: () => Array.from(draft.connectors.values(), (entry) => entry.connector) as Info[],
        get: (id) => draft.connectors.get(id)?.connector as Info | undefined,
        update: (id, update) => {
          const current =
            draft.connectors.get(id) ??
            castDraft({ connector: new Info({ id, name: id, methods: [] }), implementations: new Map() })
          if (!draft.connectors.has(id)) draft.connectors.set(id, current)
          update(current.connector)
          current.connector.id = id
        },
        remove: (id) => draft.connectors.delete(id),
        method: {
          update: (implementation) => {
            const current =
              draft.connectors.get(implementation.connectorID) ??
              castDraft({
                connector: new Info({ id: implementation.connectorID, name: implementation.connectorID, methods: [] }),
                implementations: new Map<MethodID, Implementation>(),
              })
            if (!draft.connectors.has(implementation.connectorID)) {
              draft.connectors.set(implementation.connectorID, current)
            }
            const index = current.connector.methods.findIndex((method) => method.id === implementation.method.id)
            if (index === -1) current.connector.methods.push(castDraft(implementation.method))
            else current.connector.methods[index] = castDraft(implementation.method)
            current.implementations.set(implementation.method.id, castDraft(implementation))
          },
          remove: (connectorID, methodID) => {
            const current = draft.connectors.get(connectorID)
            if (!current) return
            const index = current.connector.methods.findIndex((method) => method.id === methodID)
            if (index !== -1) current.connector.methods.splice(index, 1)
            current.implementations.delete(methodID)
          },
        },
      }),
      finalize: () => events.publish(Event.Updated, {}).pipe(Effect.asVoid),
    })

    const authorize = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.mapError((cause) => new AuthorizationError({ cause })))

    const close = (attemptScope: Scope.Closeable) =>
      Scope.close(attemptScope, Exit.void).pipe(Effect.forkIn(scope, { startImmediately: true }), Effect.asVoid)

    const message = (cause: Cause.Cause<unknown>) => {
      const error = Cause.squash(cause)
      return error instanceof Error ? error.message : String(error)
    }

    const settle = Effect.fnUntraced(function* (attemptID: AttemptID, exit: Exit.Exit<Credential.Value, unknown>) {
      const now = yield* Clock.currentTimeMillis
      const result = yield* SynchronizedRef.modify(attempts, (current) => {
        const attempt = current.get(attemptID)
        if (!attempt || attempt.status !== "pending") return [undefined, current]
        const terminal: TerminalAttempt = Exit.isSuccess(exit)
          ? { status: "complete", time: attempt.time, removeAt: now + terminalRetention }
          : { status: "failed", message: message(exit.cause), time: attempt.time, removeAt: now + terminalRetention }
        return [attempt, new Map(current).set(attemptID, terminal)]
      })
      if (!result) return
      if (Exit.isSuccess(exit)) {
        yield* credentials.create({
          connectorID: result.connectorID,
          methodID: result.methodID,
          label: result.label,
          value: exit.value,
        })
      }
      yield* close(result.scope)
    })

    const scrub = Effect.fnUntraced(function* () {
      const now = yield* Clock.currentTimeMillis
      const expired = yield* SynchronizedRef.modify(attempts, (current) => {
        const next = new Map(current)
        const scopes: Scope.Closeable[] = []
        for (const [id, attempt] of current) {
          if (attempt.status === "pending" && attempt.time.expires <= now) {
            scopes.push(attempt.scope)
            next.set(id, { status: "expired", time: attempt.time, removeAt: now + terminalRetention })
            continue
          }
          if (attempt.status !== "pending" && attempt.removeAt <= now) next.delete(id)
        }
        return [scopes, next]
      })
      yield* Effect.forEach(expired, close, { discard: true })
    })

    yield* scrub().pipe(Effect.repeat(Schedule.spaced(scrubInterval)), Effect.forkIn(scope))

    return Service.of({
      transform: state.transform,
      update: state.update,
      get: Effect.fn("Connector.get")(function* (id) {
        return state.get().connectors.get(id)?.connector
      }),
      list: Effect.fn("Connector.list")(function* () {
        return Array.from(state.get().connectors.values(), (record) => record.connector).toSorted((a, b) =>
          a.name.localeCompare(b.name),
        )
      }),
      refresh: Effect.fn("Connector.refresh")(function* (credentialID) {
        yield* refreshLocks.withLock(credentialID)(
          Effect.gen(function* () {
            const credential = yield* credentials.get(credentialID)
            if (!credential || credential.value.type !== "oauth") {
              return yield* Effect.die(`OAuth credential not found: ${credentialID}`)
            }
            const implementation = state
              .get()
              .connectors.get(credential.connectorID)
              ?.implementations.get(credential.methodID)
            if (!implementation || !isOAuthImplementation(implementation) || !implementation.refresh) {
              return yield* Effect.die(
                `OAuth refresh method not found: ${credential.connectorID}/${credential.methodID}`,
              )
            }
            const value = yield* authorize(implementation.refresh(credential.value))
            yield* credentials.update(credential.id, { value })
          }),
        )
      }),
      connect: {
        key: Effect.fn("Connector.connect.key")(function* (input) {
          const method = state.get().connectors.get(input.connectorID)?.implementations.get(input.methodID)
          if (!method || !isKeyImplementation(method)) {
            return yield* Effect.die(`Key method not found: ${input.connectorID}/${input.methodID}`)
          }
          const value = yield* authorize(method.authorize(input.key, input.inputs))
          yield* credentials.create({
            connectorID: input.connectorID,
            methodID: input.methodID,
            label: input.label,
            value,
          })
        }),
        oauth: {
          begin: Effect.fn("Connector.connect.oauth.begin")(function* (input) {
            const method = state.get().connectors.get(input.connectorID)?.implementations.get(input.methodID)
            if (!method || !isOAuthImplementation(method)) {
              return yield* Effect.die(`OAuth method not found: ${input.connectorID}/${input.methodID}`)
            }
            const attemptScope = yield* Scope.fork(scope)
            const authorization = yield* authorize(method.authorize(input.inputs)).pipe(
              Scope.provide(attemptScope),
              Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(attemptScope, exit) : Effect.void)),
            )
            const id = AttemptID.create()
            const created = yield* Clock.currentTimeMillis
            const time = { created, expires: created + attemptLifetime }
            yield* SynchronizedRef.update(attempts, (current) =>
              new Map(current).set(id, {
                status: "pending",
                completing: authorization.mode === "auto",
                authorization,
                connectorID: input.connectorID,
                methodID: input.methodID,
                label: input.label,
                scope: attemptScope,
                time,
              }),
            )
            if (authorization.mode === "auto") {
              yield* authorization.callback.pipe(
                Effect.exit,
                Effect.flatMap((exit) => settle(id, exit)),
                Effect.forkIn(attemptScope, { startImmediately: true }),
              )
            }
            return new Attempt({
              attemptID: id,
              url: authorization.url,
              instructions: authorization.instructions,
              mode: authorization.mode,
              time,
            })
          }),
          status: Effect.fn("Connector.connect.oauth.status")(function* (attemptID) {
            const attempt = (yield* SynchronizedRef.get(attempts)).get(attemptID)
            if (!attempt) return yield* Effect.die(`OAuth attempt not found: ${attemptID}`)
            if (attempt.status === "failed") {
              return { status: attempt.status, message: attempt.message ?? "Authorization failed", time: attempt.time }
            }
            return { status: attempt.status, time: attempt.time }
          }),
          complete: Effect.fn("Connector.connect.oauth.complete")(function* (input) {
            const attempt = yield* SynchronizedRef.modify(attempts, (current) => {
              const match = current.get(input.attemptID)
              if (!match || match.status !== "pending" || match.completing) return [match, current]
              if (match.authorization.mode === "code" && input.code === undefined) return [match, current]
              return [match, new Map(current).set(input.attemptID, { ...match, completing: true })]
            })
            if (!attempt) return yield* Effect.die(`OAuth attempt not found: ${input.attemptID}`)
            if (attempt.status !== "pending") return
            if (attempt.authorization.mode === "code" && input.code === undefined) {
              return yield* new CodeRequiredError({ attemptID: input.attemptID })
            }
            if (attempt.completing) return yield* Effect.die(`OAuth attempt already completing: ${input.attemptID}`)
            const callback =
              attempt.authorization.mode === "auto"
                ? attempt.authorization.callback
                : attempt.authorization.callback(input.code as string)
            const exit = yield* authorize(callback).pipe(Effect.exit)
            yield* settle(input.attemptID, exit)
            if (Exit.isFailure(exit)) return yield* exit
          }),
          cancel: Effect.fn("Connector.connect.oauth.cancel")(function* (attemptID) {
            const attempt = yield* SynchronizedRef.modify(attempts, (current) => {
              const match = current.get(attemptID)
              if (!match || match.status !== "pending") return [undefined, current]
              const next = new Map(current)
              next.delete(attemptID)
              return [match, next]
            })
            if (attempt) yield* Scope.close(attempt.scope, Exit.void)
          }),
        },
      },
    })
  }),
)
