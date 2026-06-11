export * as Integration from "./integration"

import { Cause, Clock, Context, Duration, Effect, Exit, Layer, Schedule, Schema, Scope, SynchronizedRef } from "effect"
import { castDraft, enableMapSet, type Draft } from "immer"
import { Credential } from "./credential"
import { IntegrationSchema } from "./integration/schema"
import { withStatics } from "./schema"
import { State } from "./state"
import { Identifier } from "./util/identifier"
import { KeyedMutex } from "./effect/keyed-mutex"
import { EventV2 } from "./event"

export const ID = IntegrationSchema.ID
export type ID = IntegrationSchema.ID

export const MethodID = IntegrationSchema.MethodID
export type MethodID = IntegrationSchema.MethodID

export const AttemptID = Schema.String.pipe(
  Schema.brand("Integration.AttemptID"),
  withStatics((schema) => ({ create: () => schema.make("con_" + Identifier.ascending()) })),
)
export type AttemptID = typeof AttemptID.Type

export const When = Schema.Struct({
  key: Schema.String,
  op: Schema.Literals(["eq", "neq"]),
  value: Schema.String,
}).annotate({ identifier: "Integration.When" })
export type When = typeof When.Type

export class TextPrompt extends Schema.Class<TextPrompt>("Integration.TextPrompt")({
  type: Schema.Literal("text"),
  key: Schema.String,
  message: Schema.String,
  placeholder: Schema.optional(Schema.String),
  when: Schema.optional(When),
}) {}

export class SelectPrompt extends Schema.Class<SelectPrompt>("Integration.SelectPrompt")({
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

export class OAuthMethod extends Schema.Class<OAuthMethod>("Integration.OAuthMethod")({
  id: MethodID,
  type: Schema.Literal("oauth"),
  label: Schema.String,
  prompts: Schema.optional(Schema.Array(Prompt)),
}) {}

export class KeyMethod extends Schema.Class<KeyMethod>("Integration.KeyMethod")({
  type: Schema.Literal("key"),
  label: Schema.optional(Schema.String),
}) {}

export class EnvMethod extends Schema.Class<EnvMethod>("Integration.EnvMethod")({
  type: Schema.Literal("env"),
  names: Schema.Array(Schema.String),
}) {}

export const Method = Schema.Union([OAuthMethod, KeyMethod, EnvMethod]).pipe(Schema.toTaggedUnion("type"))
export type Method = typeof Method.Type

export class CredentialConnection extends Schema.Class<CredentialConnection>("Integration.CredentialConnection")({
  type: Schema.Literal("credential"),
  id: Credential.ID,
  label: Schema.String,
  active: Schema.Boolean,
}) {}

export class EnvConnection extends Schema.Class<EnvConnection>("Integration.EnvConnection")({
  type: Schema.Literal("env"),
  name: Schema.String,
  active: Schema.Boolean,
}) {}

export const Connection = Schema.Union([CredentialConnection, EnvConnection]).pipe(Schema.toTaggedUnion("type"))
export type Connection = typeof Connection.Type

export class Info extends Schema.Class<Info>("Integration.Info")({
  id: ID,
  name: Schema.String,
  methods: Schema.Array(Method),
  connections: Schema.Array(Connection),
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
  readonly integrationID: ID
  readonly method: OAuthMethod
  readonly authorize: (inputs: Inputs) => Effect.Effect<OAuthAuthorization, unknown, Scope.Scope>
  readonly refresh?: (credential: Credential.OAuth) => Effect.Effect<Credential.OAuth, unknown>
}

export interface KeyImplementation {
  readonly integrationID: ID
  readonly method: KeyMethod
}

export interface EnvImplementation {
  readonly integrationID: ID
  readonly method: EnvMethod
}

export type Implementation = OAuthImplementation | KeyImplementation | EnvImplementation

function isOAuthImplementation(implementation: Implementation): implementation is OAuthImplementation {
  return implementation.method.type === "oauth"
}

export class Attempt extends Schema.Class<Attempt>("Integration.Attempt")({
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

export class CodeRequiredError extends Schema.TaggedErrorClass<CodeRequiredError>()("Integration.CodeRequired", {
  attemptID: AttemptID,
}) {}

export class AuthorizationError extends Schema.TaggedErrorClass<AuthorizationError>()("Integration.Authorization", {
  cause: Schema.Defect,
}) {}

export type Error = CodeRequiredError | AuthorizationError

export const Event = {
  Updated: EventV2.define({
    type: "integration.updated",
    schema: {},
  }),
}

export type Ref = {
  id: ID
  name: string
}

type Entry = {
  ref: Ref
  methods: Method[]
  implementations: Map<MethodID, OAuthImplementation>
}

type Data = {
  integrations: Map<ID, Entry>
}

export type Editor = {
  list: () => readonly Ref[]
  get: (id: ID) => Ref | undefined
  update: (id: ID, update: (integration: Draft<Ref>) => void) => void
  remove: (id: ID) => void
  method: {
    list: (integrationID: ID) => readonly Method[]
    update: (implementation: Implementation) => void
    remove: (integrationID: ID, method: Method) => void
  }
}

export interface Interface {
  /** Registers a scoped transform over the integration registry. */
  readonly transform: State.Interface<Data, Editor>["transform"]
  /** Registers and immediately applies a scoped integration registry update. */
  readonly update: State.Interface<Data, Editor>["update"]
  /** Returns one integration with its methods and current connections. */
  readonly get: (id: ID) => Effect.Effect<Info | undefined>
  /** Returns all integrations with their methods and current connections. */
  readonly list: () => Effect.Effect<Info[]>
  /** Refreshes an OAuth credential with its originating method. */
  readonly refresh: (credentialID: Credential.ID) => Effect.Effect<void, AuthorizationError>
  readonly connect: {
    /** Runs a key method and stores the resulting credential. */
    readonly key: (input: {
      /** Integration receiving the credential. */
      readonly integrationID: ID
      /** Secret entered by the user. */
      readonly key: string
      /** User-facing label for the stored credential. */
      readonly label?: string
    }) => Effect.Effect<void, AuthorizationError>
    readonly oauth: {
      /** Starts a stateful OAuth attempt. */
      readonly begin: (input: {
        /** Integration being authenticated. */
        readonly integrationID: ID
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

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Integration") {}

enableMapSet()

const attemptLifetime = Duration.toMillis(Duration.minutes(10))
const terminalRetention = Duration.toMillis(Duration.minutes(1))
const scrubInterval = Duration.seconds(30)

type AttemptTime = { created: number; expires: number }
type PendingAttempt = {
  status: "pending"
  completing: boolean
  authorization: OAuthAuthorization
  integrationID: ID
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
      initial: () => ({ integrations: new Map<ID, Entry>() }),
      editor: (draft) => ({
        list: () => Array.from(draft.integrations.values(), (entry) => entry.ref) as Ref[],
        get: (id) => draft.integrations.get(id)?.ref as Ref | undefined,
        update: (id, update) => {
          const current =
            draft.integrations.get(id) ??
            castDraft({ ref: { id, name: id } as Ref, methods: [], implementations: new Map() })
          if (!draft.integrations.has(id)) draft.integrations.set(id, current)
          update(current.ref)
          current.ref.id = id
        },
        remove: (id) => draft.integrations.delete(id),
        method: {
          list: (integrationID) =>
            (draft.integrations.get(integrationID)?.methods as Method[] | undefined) ?? [],
          update: (implementation) => {
            const current =
              draft.integrations.get(implementation.integrationID) ??
              castDraft({
                ref: {
                  id: implementation.integrationID,
                  name: implementation.integrationID,
                } as Ref,
                methods: [],
                implementations: new Map<MethodID, OAuthImplementation>(),
              })
            if (!draft.integrations.has(implementation.integrationID)) {
              draft.integrations.set(implementation.integrationID, current)
            }
            const index = current.methods.findIndex((method) => {
              if (method.type !== implementation.method.type) return false
              if (method.type !== "oauth" || implementation.method.type !== "oauth") return true
              return method.id === implementation.method.id
            })
            if (index === -1) current.methods.push(castDraft(implementation.method))
            else current.methods[index] = castDraft(implementation.method)
            if (isOAuthImplementation(implementation)) {
              current.implementations.set(implementation.method.id, castDraft(implementation))
            }
          },
          remove: (integrationID, method) => {
            const current = draft.integrations.get(integrationID)
            if (!current) return
            const index = current.methods.findIndex((candidate) => {
              if (candidate.type !== method.type) return false
              if (candidate.type !== "oauth" || method.type !== "oauth") return true
              return candidate.id === method.id
            })
            if (index !== -1) current.methods.splice(index, 1)
            if (method.type === "oauth") current.implementations.delete(method.id)
          },
        },
      }),
      finalize: () => events.publish(Event.Updated, {}).pipe(Effect.asVoid),
    })

    const connections = (
      entry: Entry,
      credentialRows: Credential.Info[],
      activeID: Credential.ID | undefined,
    ): Connection[] => {
      const saved = credentialRows.map(
        (row) =>
          new CredentialConnection({ type: "credential", id: row.id, label: row.label, active: row.id === activeID }),
      )
      const detected = entry.methods
        .filter((method) => method.type === "env")
        .flatMap((method) => method.names.filter((name) => process.env[name]))
        .map((name, index) => new EnvConnection({ type: "env", name, active: !activeID && index === 0 }))
      return [...saved, ...detected]
    }

    const project = (entry: Entry, credentialRows: Credential.Info[], activeID?: Credential.ID) =>
      new Info({
        id: entry.ref.id,
        name: entry.ref.name,
        methods: entry.methods,
        connections: connections(entry, credentialRows, activeID),
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
          integrationID: result.integrationID,
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
      get: Effect.fn("Integration.get")(function* (id) {
        const entry = state.get().integrations.get(id)
        if (!entry) return undefined
        const rows = yield* credentials.forIntegration(id)
        const active = yield* credentials.active(id)
        return project(entry, rows, active?.id)
      }),
      list: Effect.fn("Integration.list")(function* () {
        const rows = yield* credentials.all()
        const active = yield* credentials.activeAll()
        return Array.from(state.get().integrations.values(), (entry) =>
          project(
            entry,
            rows.filter((row) => row.integrationID === entry.ref.id),
            active.get(entry.ref.id)?.id,
          ),
        ).toSorted((a, b) => a.name.localeCompare(b.name))
      }),
      refresh: Effect.fn("Integration.refresh")(function* (credentialID) {
        yield* refreshLocks.withLock(credentialID)(
          Effect.gen(function* () {
            const credential = yield* credentials.get(credentialID)
            if (!credential || credential.value.type !== "oauth") {
              return yield* Effect.die(`OAuth credential not found: ${credentialID}`)
            }
            const implementation = state
              .get()
              .integrations.get(credential.integrationID)
              ?.implementations.get(credential.methodID)
            if (!implementation?.refresh) {
              return yield* Effect.die(
                `OAuth refresh method not found: ${credential.integrationID}/${credential.methodID}`,
              )
            }
            const value = yield* authorize(implementation.refresh(credential.value))
            yield* credentials.update(credential.id, { value })
          }),
        )
      }),
      connect: {
        key: Effect.fn("Integration.connect.key")(function* (input) {
          const method = state
            .get()
            .integrations.get(input.integrationID)
            ?.methods.some((method) => method.type === "key")
          if (!method) return yield* Effect.die(`Key method not found: ${input.integrationID}`)
          yield* credentials.create({
            integrationID: input.integrationID,
            methodID: MethodID.make("api-key"),
            label: input.label,
            value: new Credential.Key({ type: "key", key: input.key }),
          })
        }),
        oauth: {
          begin: Effect.fn("Integration.connect.oauth.begin")(function* (input) {
            const method = state.get().integrations.get(input.integrationID)?.implementations.get(input.methodID)
            if (!method) {
              return yield* Effect.die(`OAuth method not found: ${input.integrationID}/${input.methodID}`)
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
                integrationID: input.integrationID,
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
          status: Effect.fn("Integration.connect.oauth.status")(function* (attemptID) {
            const attempt = (yield* SynchronizedRef.get(attempts)).get(attemptID)
            if (!attempt) return yield* Effect.die(`OAuth attempt not found: ${attemptID}`)
            if (attempt.status === "failed") {
              return { status: attempt.status, message: attempt.message ?? "Authorization failed", time: attempt.time }
            }
            return { status: attempt.status, time: attempt.time }
          }),
          complete: Effect.fn("Integration.connect.oauth.complete")(function* (input) {
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
          cancel: Effect.fn("Integration.connect.oauth.cancel")(function* (attemptID) {
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
