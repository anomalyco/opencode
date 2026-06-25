export * as Integration from "./integration"

import {
  Cause,
  Clock,
  Context,
  Duration,
  Effect,
  Exit,
  Layer,
  Schedule,
  Schema,
  Scope,
  SynchronizedRef,
  Types,
} from "effect"
import { Integration } from "@opencode-ai/schema/integration"
import { Credential } from "./credential"
import { State } from "./state"
import { EventV2 } from "./event"
import { IntegrationConnection } from "./integration/connection"

export const ID = Integration.ID
export type ID = Integration.ID

export const MethodID = Integration.MethodID
export type MethodID = Integration.MethodID

export const AttemptID = Integration.AttemptID
export type AttemptID = typeof AttemptID.Type

export const When = Integration.When
export type When = Integration.When

export const TextPrompt = Integration.TextPrompt
export type TextPrompt = Integration.TextPrompt

export const SelectPrompt = Integration.SelectPrompt
export type SelectPrompt = Integration.SelectPrompt

export const Prompt = Integration.Prompt
export type Prompt = Integration.Prompt

export const OAuthMethod = Integration.OAuthMethod
export type OAuthMethod = Integration.OAuthMethod

export const KeyMethod = Integration.KeyMethod
export type KeyMethod = Integration.KeyMethod

export const EnvMethod = Integration.EnvMethod
export type EnvMethod = Integration.EnvMethod

export const Method = Integration.Method
export type Method = Integration.Method

export const Info = Integration.Info
export type Info = Integration.Info

export const Inputs = Integration.Inputs
export type Inputs = Integration.Inputs

export type OAuthAuthorization = {
  readonly url: string
  readonly instructions: string
} & (
  | {
      readonly mode: "auto"
      readonly callback: Effect.Effect<Credential.OAuth, unknown>
    }
  | {
      readonly mode: "code"
      readonly callback: (code: string) => Effect.Effect<Credential.OAuth, unknown>
    }
)

export interface OAuthImplementation {
  readonly integrationID: ID
  readonly method: OAuthMethod
  readonly authorize: (inputs: Inputs) => Effect.Effect<OAuthAuthorization, unknown, Scope.Scope>
  readonly refresh?: (credential: Credential.OAuth) => Effect.Effect<Credential.OAuth, unknown>
  readonly label?: (credential: Credential.OAuth) => string | undefined
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

export const Attempt = Integration.Attempt
export type Attempt = Integration.Attempt

export const AttemptStatus = Integration.AttemptStatus
export type AttemptStatus = typeof AttemptStatus.Type

export class CodeRequiredError extends Schema.TaggedErrorClass<CodeRequiredError>()("Integration.CodeRequired", {
  attemptID: AttemptID,
}) {}

export class AuthorizationError extends Schema.TaggedErrorClass<AuthorizationError>()("Integration.Authorization", {
  cause: Schema.Defect(),
}) {}

export type Error = CodeRequiredError | AuthorizationError

export const Event = Integration.Event

export const Ref = Integration.Ref
export type Ref = Integration.Ref

type Entry = {
  ref: Types.DeepMutable<Ref>
  methods: Types.DeepMutable<Method>[]
  implementations: Map<MethodID, Types.DeepMutable<OAuthImplementation>>
}

type Data = {
  integrations: Map<ID, Entry>
}

export type Draft = {
  list: () => readonly Ref[]
  get: (id: ID) => Ref | undefined
  update: (id: ID, update: (integration: Types.DeepMutable<Ref>) => void) => void
  remove: (id: ID) => void
  method: {
    list: (integrationID: ID) => readonly Method[]
    update: (implementation: Implementation) => void
    remove: (integrationID: ID, method: Method) => void
  }
}

export interface Interface extends State.Transformable<Draft> {
  /** Registers a scoped transform over the integration registry. */
  /** Returns one integration with its methods and current connections. */
  readonly get: (id: ID) => Effect.Effect<Info | undefined>
  /** Returns all integrations with their methods and current connections. */
  readonly list: () => Effect.Effect<Info[]>
  readonly connection: {
    /** Returns the active connection for one integration. */
    readonly active: (id: ID) => Effect.Effect<IntegrationConnection.Info | undefined>
    /** Resolves a connection into usable credential material. */
    readonly resolve: (
      connection: IntegrationConnection.Info,
    ) => Effect.Effect<Credential.Value | undefined, AuthorizationError>
    /** Runs a key method and stores the resulting credential. */
    readonly key: (input: {
      /** Integration receiving the credential. */
      readonly integrationID: ID
      /** Secret entered by the user. */
      readonly key: string
      /** User-facing label for the stored credential. */
      readonly label?: string
    }) => Effect.Effect<void, AuthorizationError>
    /** Starts a stateful OAuth attempt. */
    readonly oauth: (input: {
      /** Integration being authenticated. */
      readonly integrationID: ID
      /** OAuth method selected by the caller. */
      readonly methodID: MethodID
      /** Answers to the method's optional prompts. */
      readonly inputs: Inputs
      /** User-facing label for the credential created on completion. */
      readonly label?: string
    }) => Effect.Effect<Attempt, AuthorizationError>
    /** Updates a stored credential exposed as a connection. */
    readonly update: (
      credentialID: Credential.ID,
      updates: Partial<Pick<Credential.Info, "label">>,
    ) => Effect.Effect<void>
    /** Removes a stored credential connection. */
    readonly remove: (credentialID: Credential.ID) => Effect.Effect<void>
  }
  readonly attempt: {
    /** Returns the current state of an OAuth attempt. */
    readonly status: (attemptID: AttemptID) => Effect.Effect<AttemptStatus>
    /** Completes the attempt and stores its credential. */
    readonly complete: (input: {
      /** Opaque handle returned by `oauth`. */
      readonly attemptID: AttemptID
      /** Authorization code required by attempts in code mode. */
      readonly code?: string
    }) => Effect.Effect<void, CodeRequiredError | AuthorizationError>
    /** Cancels an attempt and releases its resources. */
    readonly cancel: (attemptID: AttemptID) => Effect.Effect<void>
  }
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Integration") {}

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
    const state = State.create<Data, Draft>({
      initial: () => ({ integrations: new Map<ID, Entry>() }),
      draft: (draft) => ({
        list: () => Array.from(draft.integrations.values(), (entry) => entry.ref) as Ref[],
        get: (id) => draft.integrations.get(id)?.ref as Ref | undefined,
        update: (id, update) => {
          const current = draft.integrations.get(id) ?? {
            ref: { id, name: id },
            methods: [],
            implementations: new Map(),
          }
          if (!draft.integrations.has(id)) draft.integrations.set(id, current)
          update(current.ref)
          current.ref.id = id
        },
        remove: (id) => draft.integrations.delete(id),
        method: {
          list: (integrationID) => (draft.integrations.get(integrationID)?.methods as Method[] | undefined) ?? [],
          update: (implementation) => {
            const current = draft.integrations.get(implementation.integrationID) ?? {
              ref: {
                id: implementation.integrationID,
                name: implementation.integrationID,
              },
              methods: [],
              implementations: new Map<MethodID, Types.DeepMutable<OAuthImplementation>>(),
            }
            if (!draft.integrations.has(implementation.integrationID)) {
              draft.integrations.set(implementation.integrationID, current)
            }
            const index = current.methods.findIndex((method) => {
              if (method.type !== implementation.method.type) return false
              if (method.type !== "oauth" || implementation.method.type !== "oauth") return true
              return method.id === implementation.method.id
            })
            if (index === -1) current.methods.push(implementation.method as Types.DeepMutable<Method>)
            else current.methods[index] = implementation.method as Types.DeepMutable<Method>
            if (implementation.method.type === "oauth") {
              current.implementations.set(
                implementation.method.id,
                implementation as Types.DeepMutable<OAuthImplementation>,
              )
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

    const resolveConnections = (entry: Entry | undefined, saved: readonly Credential.Info[]) => {
      const credentials = saved
        .map((credential) => ({
          type: "credential" as const,
          id: credential.id,
          label: credential.label,
        }))
        .toReversed()
      const env = (entry?.methods ?? [])
        .filter((method) => method.type === "env")
        .flatMap((method) => method.names.filter((name) => process.env[name]))
        .map((name) => ({ type: "env" as const, name }))
      return [...credentials, ...env]
    }

    const project = (entry: Entry, connections: IntegrationConnection.Info[]) =>
      new Info({
        id: entry.ref.id,
        name: entry.ref.name,
        methods: entry.methods,
        connections,
      })

    const authorize = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.mapError((cause) => new AuthorizationError({ cause })))

    const close = (attemptScope: Scope.Closeable) =>
      Scope.close(attemptScope, Exit.void).pipe(Effect.forkIn(scope, { startImmediately: true }), Effect.asVoid)

    const message = (cause: Cause.Cause<unknown>) => {
      const error = Cause.squash(cause)
      return error instanceof Error ? error.message : String(error)
    }

    const settle = Effect.fnUntraced(function* (attemptID: AttemptID, exit: Exit.Exit<Credential.OAuth, unknown>) {
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
        const implementation = state.get().integrations.get(result.integrationID)?.implementations.get(result.methodID)
        yield* credentials.create({
          integrationID: result.integrationID,
          label: result.label ?? implementation?.label?.(exit.value),
          value: exit.value,
        })
        yield* events.publish(Event.ConnectionUpdated, { integrationID: result.integrationID })
        yield* events.publish(Event.Updated, {})
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
      reload: state.reload,
      get: Effect.fn("Integration.get")(function* (id) {
        const entry = state.get().integrations.get(id)
        if (!entry) return undefined
        return project(entry, resolveConnections(entry, yield* credentials.list(id)))
      }),
      list: Effect.fn("Integration.list")(function* () {
        const saved = Map.groupBy(yield* credentials.all(), (credential) => credential.integrationID)
        return Array.from(state.get().integrations.values(), (entry) =>
          project(entry, resolveConnections(entry, saved.get(entry.ref.id) ?? [])),
        ).toSorted((a, b) => a.name.localeCompare(b.name))
      }),
      connection: {
        active: Effect.fn("Integration.connection.active")(function* (id) {
          const entry = state.get().integrations.get(id)
          return resolveConnections(entry, yield* credentials.list(id))[0]
        }),
        resolve: Effect.fn("Integration.connection.resolve")(function* (connection) {
          if (connection.type === "env") {
            const key = process.env[connection.name]
            return key ? Credential.Key.make({ type: "key", key }) : undefined
          }
          const credential = yield* credentials.get(connection.id)
          if (!credential) return undefined
          if (credential.value.type === "key") return credential.value
          const implementation = state
            .get()
            .integrations.get(credential.integrationID)
            ?.implementations.get(credential.value.methodID)
          if (!implementation?.refresh) return credential.value
          const now = yield* Clock.currentTimeMillis
          if (credential.value.expires > now + Duration.toMillis(Duration.minutes(5))) return credential.value
          const value = yield* authorize(implementation.refresh(credential.value))
          yield* credentials.update(credential.id, { value })
          return value
        }),
        key: Effect.fn("Integration.connection.key")(function* (input) {
          const method = state
            .get()
            .integrations.get(input.integrationID)
            ?.methods.some((method) => method.type === "key")
          if (!method) return yield* Effect.die(`Key method not found: ${input.integrationID}`)
          yield* credentials.create({
            integrationID: input.integrationID,
            label: input.label,
            value: Credential.Key.make({ type: "key", key: input.key }),
          })
          yield* events.publish(Event.ConnectionUpdated, { integrationID: input.integrationID })
          yield* events.publish(Event.Updated, {})
        }),
        oauth: Effect.fn("Integration.connection.oauth")(function* (input) {
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
        update: Effect.fn("Integration.connection.update")(function* (credentialID, updates) {
          const credential = yield* credentials.get(credentialID)
          yield* credentials.update(credentialID, updates)
          if (credential) {
            yield* events.publish(Event.ConnectionUpdated, { integrationID: credential.integrationID })
          }
          yield* events.publish(Event.Updated, {})
        }),
        remove: Effect.fn("Integration.connection.remove")(function* (credentialID) {
          const credential = yield* credentials.get(credentialID)
          yield* credentials.remove(credentialID)
          if (credential) {
            yield* events.publish(Event.ConnectionUpdated, { integrationID: credential.integrationID })
          }
          yield* events.publish(Event.Updated, {})
        }),
      },
      attempt: {
        status: Effect.fn("Integration.attempt.status")(function* (attemptID) {
          const attempt = (yield* SynchronizedRef.get(attempts)).get(attemptID)
          if (!attempt) return yield* Effect.die(`OAuth attempt not found: ${attemptID}`)
          if (attempt.status === "failed") {
            return { status: attempt.status, message: attempt.message ?? "Authorization failed", time: attempt.time }
          }
          return { status: attempt.status, time: attempt.time }
        }),
        complete: Effect.fn("Integration.attempt.complete")(function* (input) {
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
        cancel: Effect.fn("Integration.attempt.cancel")(function* (attemptID) {
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
    })
  }),
)
