export * as Integration from "./integration"

import { makeLocationNode } from "./effect/app-node"
import {
  Cause,
  Clock,
  Context,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Schedule,
  Schema,
  Scope,
  Stream,
  SynchronizedRef,
  Types,
} from "effect"
import { Integration } from "@opencode-ai/schema/integration"
import { Credential } from "./credential"
import { State } from "./state"
import { EventV2 } from "./event"
import { IntegrationConnection } from "./integration/connection"
import { AppProcess } from "./process"
import { ChildProcess } from "effect/unstable/process"

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

export const CommandMethod = Integration.CommandMethod
export type CommandMethod = Integration.CommandMethod

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
  readonly expiresAt?: number
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

export interface CommandImplementation {
  readonly integrationID: ID
  readonly method: CommandMethod
}

export interface EnvImplementation {
  readonly integrationID: ID
  readonly method: EnvMethod
}

export type Implementation = OAuthImplementation | CommandImplementation | KeyImplementation | EnvImplementation

export const Attempt = Integration.Attempt
export type Attempt = Integration.Attempt

export const AttemptStatus = Integration.AttemptStatus
export type AttemptStatus = typeof AttemptStatus.Type

export const CommandAttempt = Integration.CommandAttempt
export type CommandAttempt = Integration.CommandAttempt

export const CommandAttemptStatus = Integration.CommandAttemptStatus
export type CommandAttemptStatus = Integration.CommandAttemptStatus

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
    /** Updates a stored credential exposed as a connection. */
    readonly update: (
      credentialID: Credential.ID,
      updates: Partial<Pick<Credential.Info, "label">>,
    ) => Effect.Effect<void>
    /** Removes a stored credential connection. */
    readonly remove: (credentialID: Credential.ID) => Effect.Effect<void>
  }
  readonly oauth: {
    /** Starts a stateful OAuth attempt. */
    readonly connect: (input: {
      readonly integrationID: ID
      readonly methodID: MethodID
      readonly inputs: Inputs
      readonly label?: string
    }) => Effect.Effect<Attempt, AuthorizationError>
    /** Returns the current state of an OAuth attempt. */
    readonly status: (input: {
      readonly integrationID: ID
      readonly attemptID: AttemptID
    }) => Effect.Effect<AttemptStatus>
    /** Completes the attempt and stores its credential. */
    readonly complete: (input: {
      readonly integrationID: ID
      readonly attemptID: AttemptID
      readonly code?: string
    }) => Effect.Effect<void, CodeRequiredError | AuthorizationError>
    /** Cancels an attempt and releases its resources. */
    readonly cancel: (input: { readonly integrationID: ID; readonly attemptID: AttemptID }) => Effect.Effect<void>
  }
  readonly command: {
    readonly connect: (input: {
      readonly integrationID: ID
      readonly methodID: MethodID
      readonly label?: string
    }) => Effect.Effect<CommandAttempt, AuthorizationError>
    readonly status: (input: {
      readonly integrationID: ID
      readonly attemptID: AttemptID
    }) => Effect.Effect<CommandAttemptStatus>
    readonly cancel: (input: { readonly integrationID: ID; readonly attemptID: AttemptID }) => Effect.Effect<void>
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
  persisting: boolean
  authorization: OAuthAuthorization
  integrationID: ID
  methodID: MethodID
  label?: string
  scope: Scope.Closeable
  time: AttemptTime
}
type TerminalAttempt = {
  status: "complete" | "failed" | "expired"
  integrationID: ID
  message?: string
  removeAt: number
  time: AttemptTime
}
type AttemptEntry = PendingAttempt | TerminalAttempt

type PendingCommandAttempt = {
  status: "pending"
  integrationID: ID
  label?: string
  message?: string
  persisting: boolean
  scope: Scope.Closeable
  time: AttemptTime
}
type TerminalCommandAttempt = {
  status: "complete" | "failed" | "expired"
  integrationID: ID
  message?: string
  removeAt: number
  time: AttemptTime
}
type CommandAttemptEntry = PendingCommandAttempt | TerminalCommandAttempt

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const credentials = yield* Credential.Service
    const events = yield* EventV2.Service
    const processes = yield* AppProcess.Service
    const scope = yield* Scope.Scope
    const attempts = SynchronizedRef.makeUnsafe(new Map<AttemptID, AttemptEntry>())
    const commandAttempts = SynchronizedRef.makeUnsafe(new Map<AttemptID, CommandAttemptEntry>())
    const state = State.create<Data, Draft>({
      name: "integration",
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
              if (method.type === "oauth" && implementation.method.type === "oauth")
                return method.id === implementation.method.id
              if (method.type === "command" && implementation.method.type === "command")
                return method.id === implementation.method.id
              return true
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
              if (candidate.type === "oauth" && method.type === "oauth") return candidate.id === method.id
              if (candidate.type === "command" && method.type === "command") return candidate.id === method.id
              return true
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
      Info.make({
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
      return yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const attempt = yield* SynchronizedRef.modify(attempts, (current) => {
            const match = current.get(attemptID)
            if (!match || match.status !== "pending" || match.persisting) return [undefined, current]
            const next = Exit.isSuccess(exit)
              ? { ...match, persisting: true }
              : {
                  status: "failed" as const,
                  integrationID: match.integrationID,
                  message: message(exit.cause),
                  time: match.time,
                  removeAt: now + terminalRetention,
                }
            return [match, new Map(current).set(attemptID, next)]
          })
          if (!attempt) return
          if (Exit.isFailure(exit)) {
            yield* close(attempt.scope)
            return
          }

          yield* Effect.gen(function* () {
            const implementation = state
              .get()
              .integrations.get(attempt.integrationID)
              ?.implementations.get(attempt.methodID)
            const persistence = yield* Effect.sync(() => attempt.label ?? implementation?.label?.(exit.value)).pipe(
              Effect.flatMap((label) =>
                credentials.create({
                  integrationID: attempt.integrationID,
                  label,
                  value: exit.value,
                }),
              ),
              Effect.asVoid,
              Effect.exit,
            )
            const settledAt = yield* Clock.currentTimeMillis
            const terminal: TerminalAttempt = Exit.isSuccess(persistence)
              ? {
                  status: "complete",
                  integrationID: attempt.integrationID,
                  time: attempt.time,
                  removeAt: settledAt + terminalRetention,
                }
              : {
                  status: "failed",
                  integrationID: attempt.integrationID,
                  message: message(persistence.cause),
                  time: attempt.time,
                  removeAt: settledAt + terminalRetention,
                }
            // Persisting attempts cannot be cancelled, expired, or claimed again.
            yield* SynchronizedRef.update(attempts, (current) => new Map(current).set(attemptID, terminal))
            if (Exit.isFailure(persistence)) yield* Effect.failCause(persistence.cause)
            yield* events.publish(Event.ConnectionUpdated, { integrationID: attempt.integrationID })
            yield* events.publish(Event.Updated, {})
          }).pipe(Effect.ensuring(close(attempt.scope)))
        }),
      )
    })

    const settleCommand = Effect.fnUntraced(function* (attemptID: AttemptID, exit: Exit.Exit<string, unknown>) {
      return yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const attempt = yield* SynchronizedRef.modify(commandAttempts, (current) => {
            const match = current.get(attemptID)
            if (!match || match.status !== "pending" || match.persisting) return [undefined, current]
            const next = Exit.isSuccess(exit)
              ? { ...match, persisting: true }
              : {
                  status: "failed" as const,
                  integrationID: match.integrationID,
                  message: message(exit.cause),
                  time: match.time,
                  removeAt: now + terminalRetention,
                }
            return [match, new Map(current).set(attemptID, next)]
          })
          if (!attempt) return
          if (Exit.isFailure(exit)) {
            yield* close(attempt.scope)
            return
          }

          const persistence = yield* credentials
            .create({
              integrationID: attempt.integrationID,
              label: attempt.label,
              value: Credential.Key.make({ type: "key", key: exit.value }),
            })
            .pipe(Effect.asVoid, Effect.exit)
          const settledAt = yield* Clock.currentTimeMillis
          const terminal: TerminalCommandAttempt = Exit.isSuccess(persistence)
            ? {
                status: "complete",
                integrationID: attempt.integrationID,
                time: attempt.time,
                removeAt: settledAt + terminalRetention,
              }
            : {
                status: "failed",
                integrationID: attempt.integrationID,
                message: message(persistence.cause),
                time: attempt.time,
                removeAt: settledAt + terminalRetention,
              }
          yield* SynchronizedRef.update(commandAttempts, (current) => new Map(current).set(attemptID, terminal))
          yield* close(attempt.scope)
          if (Exit.isFailure(persistence)) return
          yield* events.publish(Event.ConnectionUpdated, { integrationID: attempt.integrationID })
          yield* events.publish(Event.Updated, {})
        }),
      )
    })

    const scrub = Effect.fnUntraced(function* () {
      const now = yield* Clock.currentTimeMillis
      const expired = yield* SynchronizedRef.modify(attempts, (current) => {
        const next = new Map(current)
        const scopes: Scope.Closeable[] = []
        for (const [id, attempt] of current) {
          if (attempt.status === "pending" && !attempt.persisting && attempt.time.expires <= now) {
            scopes.push(attempt.scope)
            next.set(id, {
              status: "expired",
              integrationID: attempt.integrationID,
              time: attempt.time,
              removeAt: now + terminalRetention,
            })
            continue
          }
          if (attempt.status !== "pending" && attempt.removeAt <= now) next.delete(id)
        }
        return [scopes, next]
      })
      yield* Effect.forEach(expired, close, { discard: true })
    })

    const scrubCommands = Effect.fnUntraced(function* () {
      const now = yield* Clock.currentTimeMillis
      const expired = yield* SynchronizedRef.modify(commandAttempts, (current) => {
        const next = new Map(current)
        const scopes: Scope.Closeable[] = []
        for (const [id, attempt] of current) {
          if (attempt.status === "pending" && !attempt.persisting && attempt.time.expires <= now) {
            scopes.push(attempt.scope)
            next.set(id, {
              status: "expired",
              integrationID: attempt.integrationID,
              time: attempt.time,
              removeAt: now + terminalRetention,
            })
            continue
          }
          if (attempt.status !== "pending" && attempt.removeAt <= now) next.delete(id)
        }
        return [scopes, next]
      })
      yield* Effect.forEach(expired, close, { discard: true })
    })

    yield* scrub().pipe(Effect.repeat(Schedule.spaced(scrubInterval)), Effect.forkIn(scope))
    yield* scrubCommands().pipe(Effect.repeat(Schedule.spaced(scrubInterval)), Effect.forkIn(scope))

    const connectOAuth = Effect.fn("Integration.oauth.connect")(function* (input: {
      readonly integrationID: ID
      readonly methodID: MethodID
      readonly inputs: Inputs
      readonly label?: string
    }) {
      const method = state.get().integrations.get(input.integrationID)?.implementations.get(input.methodID)
      if (!method) {
        return yield* Effect.die(new Error(`OAuth method not found: ${input.integrationID}/${input.methodID}`))
      }
      const attemptScope = yield* Scope.fork(scope)
      const authorization = yield* authorize(method.authorize(input.inputs)).pipe(
        Scope.provide(attemptScope),
        Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(attemptScope, exit) : Effect.void)),
      )
      const id = AttemptID.create()
      const created = yield* Clock.currentTimeMillis
      const time = { created, expires: authorization.expiresAt ?? created + attemptLifetime }
      yield* SynchronizedRef.update(attempts, (current) =>
        new Map(current).set(id, {
          status: "pending",
          completing: authorization.mode === "auto",
          persisting: false,
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
    })

    const connectCommand = Effect.fn("Integration.command.connect")(function* (input: {
      readonly integrationID: ID
      readonly methodID: MethodID
      readonly label?: string
    }) {
      const method = state
        .get()
        .integrations.get(input.integrationID)
        ?.methods.find((method) => method.type === "command" && method.id === input.methodID)
      if (!method || method.type !== "command" || !method.command[0]) {
        return yield* Effect.die(new Error(`Command method not found: ${input.integrationID}/${input.methodID}`))
      }

      const attemptScope = yield* Scope.fork(scope)
      const attemptID = AttemptID.create()
      const created = yield* Clock.currentTimeMillis
      const time = { created, expires: created + attemptLifetime }
      yield* SynchronizedRef.update(commandAttempts, (current) =>
        new Map(current).set(attemptID, {
          status: "pending",
          integrationID: input.integrationID,
          label: input.label,
          persisting: false,
          scope: attemptScope,
          time,
        }),
      )

      yield* Effect.gen(function* () {
        const handle = yield* processes.spawn(
          ChildProcess.make(method.command[0], method.command.slice(1), {
            extendEnv: true,
            stdin: "ignore",
          }),
        )
        const stdout = yield* AppProcess.collectStream(handle.stdout, undefined).pipe(Effect.forkScoped)
        yield* handle.stderr.pipe(
          Stream.decodeText,
          Stream.tap((chunk) =>
            SynchronizedRef.update(commandAttempts, (current) => {
              const attempt = current.get(attemptID)
              if (!attempt || attempt.status !== "pending") return current
              const message = (attempt.message ?? "") + chunk
              return new Map(current).set(attemptID, { ...attempt, message })
            }),
          ),
          Stream.runDrain,
        )
        const exitCode = yield* handle.exitCode
        if (exitCode !== 0) {
          const attempt = (yield* SynchronizedRef.get(commandAttempts)).get(attemptID)
          return yield* Effect.fail(new Error(attempt?.message?.trim() || `Authentication command exited ${exitCode}`))
        }
        const credential = (yield* Fiber.join(stdout)).buffer.toString("utf8").trim()
        if (!credential) return yield* Effect.fail(new Error("Authentication command returned no credential"))
        return credential
      }).pipe(
        Scope.provide(attemptScope),
        Effect.exit,
        Effect.flatMap((exit) => settleCommand(attemptID, exit)),
        Effect.forkIn(attemptScope, { startImmediately: true }),
      )

      return CommandAttempt.make({ attemptID, time })
    })

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
          if (!method) return yield* Effect.die(new Error(`Key method not found: ${input.integrationID}`))
          yield* credentials.create({
            integrationID: input.integrationID,
            label: input.label,
            value: Credential.Key.make({ type: "key", key: input.key }),
          })
          yield* events.publish(Event.ConnectionUpdated, { integrationID: input.integrationID })
          yield* events.publish(Event.Updated, {})
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
      oauth: {
        connect: connectOAuth,
        status: Effect.fn("Integration.oauth.status")(function* (input) {
          const attempt = (yield* SynchronizedRef.get(attempts)).get(input.attemptID)
          if (!attempt || attempt.integrationID !== input.integrationID)
            return yield* Effect.die(new Error(`OAuth attempt not found: ${input.attemptID}`))
          if (attempt.status === "failed") {
            return { status: attempt.status, message: attempt.message ?? "Authorization failed", time: attempt.time }
          }
          return { status: attempt.status, time: attempt.time }
        }),
        complete: Effect.fn("Integration.oauth.complete")(function* (input) {
          const attempt = yield* SynchronizedRef.modify(attempts, (current) => {
            const match = current.get(input.attemptID)
            if (!match || match.integrationID !== input.integrationID) return [undefined, current]
            if (match.status !== "pending" || match.completing) return [match, current]
            if (match.authorization.mode === "code" && input.code === undefined) return [match, current]
            return [match, new Map(current).set(input.attemptID, { ...match, completing: true })]
          })
          if (!attempt) return yield* Effect.die(new Error(`OAuth attempt not found: ${input.attemptID}`))
          if (attempt.status !== "pending") return
          if (attempt.authorization.mode === "code" && input.code === undefined) {
            return yield* new CodeRequiredError({ attemptID: input.attemptID })
          }
          if (attempt.completing)
            return yield* Effect.die(new Error(`OAuth attempt already completing: ${input.attemptID}`))
          const callback =
            attempt.authorization.mode === "auto"
              ? attempt.authorization.callback
              : attempt.authorization.callback(input.code as string)
          const exit = yield* authorize(callback).pipe(Effect.exit)
          yield* settle(input.attemptID, exit)
          if (Exit.isFailure(exit)) return yield* exit
        }),
        cancel: Effect.fn("Integration.oauth.cancel")(function* (input) {
          const attempt = yield* SynchronizedRef.modify(attempts, (current) => {
            const match = current.get(input.attemptID)
            if (!match || match.integrationID !== input.integrationID || match.status !== "pending" || match.persisting)
              return [undefined, current]
            const next = new Map(current)
            next.delete(input.attemptID)
            return [match, next]
          })
          if (attempt) yield* Scope.close(attempt.scope, Exit.void)
        }),
      },
      command: {
        connect: connectCommand,
        status: Effect.fn("Integration.command.status")(function* (input) {
          const attempt = (yield* SynchronizedRef.get(commandAttempts)).get(input.attemptID)
          if (!attempt || attempt.integrationID !== input.integrationID)
            return yield* Effect.die(new Error(`Command attempt not found: ${input.attemptID}`))
          if (attempt.status === "pending") {
            return {
              status: attempt.status,
              ...(attempt.message ? { message: attempt.message } : {}),
              time: attempt.time,
            }
          }
          if (attempt.status === "failed") {
            return { status: attempt.status, message: attempt.message ?? "Authentication failed", time: attempt.time }
          }
          return { status: attempt.status, time: attempt.time }
        }),
        cancel: Effect.fn("Integration.command.cancel")(function* (input) {
          const attempt = yield* SynchronizedRef.modify(commandAttempts, (current) => {
            const match = current.get(input.attemptID)
            if (!match || match.integrationID !== input.integrationID || match.status !== "pending" || match.persisting)
              return [undefined, current]
            const next = new Map(current)
            next.delete(input.attemptID)
            return [match, next]
          })
          if (attempt) yield* Scope.close(attempt.scope, Exit.void)
        }),
      },
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Credential.node, EventV2.node, AppProcess.node],
})
