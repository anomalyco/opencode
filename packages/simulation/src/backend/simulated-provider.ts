import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { SdkPlugins } from "@opencode-ai/core/plugin/sdk"
import { Plugin } from "@opencode-ai/plugin/v2/effect"
import { Tool } from "@opencode-ai/plugin/v2/effect/tool"
import { createHash } from "node:crypto"
import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FiberSet,
  Layer,
  PubSub,
  Queue,
  Ref,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from "effect"
import { SimulationControlServer } from "../control-server"
import { SimulationProtocol } from "../protocol"

export interface ProviderRequest {
  readonly url: string
  readonly body: unknown
}

export type ProviderResponseEvent =
  | SimulationProtocol.Backend.Item
  | { readonly type: "finish"; readonly reason: SimulationProtocol.Backend.FinishReason }

export class ProviderDisconnectedError extends Schema.TaggedErrorClass<ProviderDisconnectedError>()(
  "SimulatedProvider.ProviderDisconnectedError",
  { message: Schema.String },
) {}

export interface Interface {
  readonly stream: (request: ProviderRequest) => Stream.Stream<ProviderResponseEvent, ProviderDisconnectedError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/simulation/SimulatedProvider") {}

interface ProviderInvocation extends ProviderRequest {
  readonly id: string
}

interface PendingInvocation extends ProviderInvocation {
  readonly responses: Queue.Queue<ProviderResponseEvent, ProviderDisconnectedError | Cause.Done>
}

interface State {
  readonly counter: number
  readonly pending: ReadonlyMap<string, PendingInvocation>
}

interface Driver {
  readonly requests: Stream.Stream<ProviderInvocation>
  readonly push: (
    id: string,
    items: readonly SimulationProtocol.Backend.Item[],
  ) => Effect.Effect<void, InvocationNotFoundError>
  readonly finish: (
    id: string,
    reason: SimulationProtocol.Backend.FinishReason,
  ) => Effect.Effect<void, InvocationNotFoundError>
  readonly disconnect: (id: string) => Effect.Effect<void, InvocationNotFoundError>
  readonly pending: () => Effect.Effect<readonly ProviderInvocation[]>
}

type ControlSocket = SimulationControlServer.Socket

interface ToolController {
  readonly socket: ControlSocket
}

type ToolCompletion =
  | { readonly type: "success"; readonly output: SimulationProtocol.Backend.ToolOutput }
  | { readonly type: "failure"; readonly message: string }

interface PendingToolInvocation {
  readonly id: string
  readonly notification: SimulationProtocol.Backend.ToolInvocation
  readonly progress: Tool.Context["progress"]
  readonly completion: Deferred.Deferred<ToolCompletion>
  readonly operations: Semaphore.Semaphore
  update?: { readonly sequence: number; readonly fingerprint: string }
}

interface ToolReconciliation {
  readonly generation: number
  readonly result: Deferred.Deferred<Exit.Exit<void, unknown>>
}

interface ToolRegistrationUpdate {
  readonly generation: number
  readonly registrations: ReadonlyArray<SimulationProtocol.Backend.ToolRegistration>
}

interface ToolState {
  readonly counter: number
  readonly generation: number
  readonly appliedGeneration: number
  readonly controller?: ToolController
  readonly registrations: ReadonlyArray<SimulationProtocol.Backend.ToolRegistration>
  readonly pending: ReadonlyMap<string, PendingToolInvocation>
  readonly completed: ReadonlyMap<string, string>
  readonly activeOverlays: ReadonlySet<object>
  readonly reconciliation: ReadonlyMap<object, ToolReconciliation>
}

interface ToolDriver {
  readonly attach: (
    socket: ControlSocket,
    registrations: ReadonlyArray<SimulationProtocol.Backend.ToolRegistration>,
  ) => Effect.Effect<{ readonly attached: true }, ToolControllerError>
  readonly update: (
    socket: ControlSocket,
    params: SimulationProtocol.Backend.ToolUpdateParams,
  ) => Effect.Effect<void, ToolInvocationNotFoundError | ToolControllerError>
  readonly finish: (
    socket: ControlSocket,
    params: SimulationProtocol.Backend.ToolFinishParams,
  ) => Effect.Effect<void, ToolInvocationNotFoundError | ToolControllerError>
  readonly fail: (
    socket: ControlSocket,
    params: SimulationProtocol.Backend.ToolFailParams,
  ) => Effect.Effect<void, ToolInvocationNotFoundError | ToolControllerError>
  readonly release: (socket: ControlSocket) => Effect.Effect<void>
  readonly shutdown: Effect.Effect<void>
}

class InvocationNotFoundError extends Schema.TaggedErrorClass<InvocationNotFoundError>()(
  "SimulatedProvider.InvocationNotFoundError",
  { id: Schema.String, message: Schema.String },
) {}

class ControllerDisconnectedError extends Schema.TaggedErrorClass<ControllerDisconnectedError>()(
  "SimulatedProvider.ControllerDisconnectedError",
  { message: Schema.String },
) {}

class ToolInvocationNotFoundError extends Schema.TaggedErrorClass<ToolInvocationNotFoundError>()(
  "SimulatedProvider.ToolInvocationNotFoundError",
  { id: Schema.String, message: Schema.String },
) {}

class ToolControllerError extends Schema.TaggedErrorClass<ToolControllerError>()(
  "SimulatedProvider.ToolControllerError",
  { message: Schema.String },
) {}

export const layerDrive = (options: { readonly endpoint: string }) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = yield* Ref.make<State>({ counter: 0, pending: new Map() })
      const opened = yield* PubSub.unbounded<ProviderInvocation>()
      const lock = yield* Semaphore.make(1)

      const close = (invocation: PendingInvocation) =>
        Effect.gen(function* () {
          yield* Queue.shutdown(invocation.responses)
          yield* lock.withPermit(
            Ref.update(state, (current) =>
              current.pending.get(invocation.id) === invocation ? remove(current, invocation.id) : current,
            ),
          )
        })

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          const current = yield* Ref.get(state)
          yield* Effect.forEach(current.pending.values(), (invocation) => Queue.shutdown(invocation.responses), {
            discard: true,
          })
          yield* PubSub.shutdown(opened)
        }),
      )

      const open = (request: ProviderRequest) =>
        lock.withPermit(
          Effect.gen(function* () {
            const current = yield* Ref.get(state)
            const id = `inv_${current.counter + 1}`
            const responses = yield* Queue.bounded<ProviderResponseEvent, ProviderDisconnectedError | Cause.Done>(256)
            const invocation: PendingInvocation = { id, ...request, responses }
            yield* Ref.set(state, {
              counter: current.counter + 1,
              pending: new Map(current.pending).set(id, invocation),
            })
            yield* PubSub.publish(opened, { id, ...request })
            return invocation
          }),
        )

      const requireInvocation = (id: string) =>
        Effect.gen(function* () {
          const current = yield* Ref.get(state)
          const invocation = current.pending.get(id)
          if (invocation) return invocation
          return yield* Effect.fail(
            new InvocationNotFoundError({
              id,
              message: `Simulated provider invocation not found or already finished: ${id}`,
            }),
          )
        })

      const remove = (current: State, id: string) => {
        const pending = new Map(current.pending)
        pending.delete(id)
        return { ...current, pending }
      }

      const driver: Driver = {
        requests: Stream.unwrap(
          lock.withPermit(
            Effect.gen(function* () {
              const subscription = yield* PubSub.subscribe(opened)
              const current = yield* Ref.get(state)
              const pending = Array.from(current.pending.values(), ({ id, url, body }) => ({ id, url, body }))
              return Stream.concat(Stream.fromIterable(pending), Stream.fromEffectRepeat(PubSub.take(subscription)))
            }),
          ),
        ),
        push: (id, items) =>
          Effect.gen(function* () {
            const invocation = yield* lock.withPermit(requireInvocation(id))
            yield* Queue.offerAll(invocation.responses, items)
          }),
        finish: (id, reason) =>
          Effect.gen(function* () {
            const invocation = yield* lock.withPermit(
              Effect.gen(function* () {
                const invocation = yield* requireInvocation(id)
                const current = yield* Ref.get(state)
                yield* Ref.set(state, remove(current, id))
                return invocation
              }),
            )
            yield* Queue.offer(invocation.responses, { type: "finish", reason })
            yield* Queue.end(invocation.responses)
          }),
        disconnect: (id) =>
          Effect.gen(function* () {
            const invocation = yield* lock.withPermit(
              Effect.gen(function* () {
                const invocation = yield* requireInvocation(id)
                const current = yield* Ref.get(state)
                yield* Ref.set(state, remove(current, id))
                return invocation
              }),
            )
            yield* Queue.fail(
              invocation.responses,
              new ProviderDisconnectedError({ message: "Simulated model provider disconnected" }),
            )
          }),
        pending: () =>
          lock.withPermit(
            Ref.get(state).pipe(
              Effect.map((current) => Array.from(current.pending.values(), ({ id, url, body }) => ({ id, url, body }))),
            ),
          ),
      }

      const fibers = yield* FiberSet.make<void, unknown>()
      const activeController = yield* Ref.make<Fiber.Fiber<void> | undefined>(undefined)
      const controllerLock = yield* Semaphore.make(1)
      const tools = yield* makeToolDriver()
      yield* Effect.addFinalizer(() => tools.shutdown)
      yield* SimulationControlServer.start({
        endpoint: options.endpoint,
        label: "opencode drive backend websocket",
        data: () => ({}),
        decode: SimulationProtocol.Backend.decodeRequestEffect,
        handle: (socket, request) => handle(driver, tools, fibers, activeController, controllerLock, socket, request),
        close: (socket) =>
          Effect.all([releaseController(activeController, controllerLock, socket), tools.release(socket)], {
            discard: true,
          }),
      })
      yield* Effect.sync(() => process.stderr.write(`opencode drive backend websocket: ${options.endpoint}\n`))

      return Service.of({
        stream: (request) =>
          Stream.unwrap(
            Effect.acquireRelease(open(request), close).pipe(
              Effect.map((invocation) =>
                Stream.fromQueue(invocation.responses).pipe(Stream.takeUntil((event) => event.type === "finish")),
              ),
            ),
          ),
      })
    }),
  )

function handle(
  driver: Driver,
  tools: ToolDriver,
  fibers: FiberSet.FiberSet<void, unknown>,
  activeController: Ref.Ref<Fiber.Fiber<void> | undefined>,
  controllerLock: Semaphore.Semaphore,
  socket: ControlSocket,
  request: SimulationProtocol.Backend.Request,
) {
  switch (request.method) {
    case "simulation.handshake":
      return SimulationProtocol.Handshake.dispatch(
        {
          role: "backend",
          server: { name: "opencode", version: InstallationVersion },
          capabilities: SimulationProtocol.Backend.Capabilities,
        },
        request.params,
      )
    case "llm.attach":
      return controllerLock.withPermit(
        Effect.gen(function* () {
          if (socket.data.closed)
            return yield* Effect.fail(
              new ControllerDisconnectedError({ message: "Drive controller disconnected before attachment" }),
            )
          const previous = yield* Ref.get(activeController)
          if (previous) yield* Fiber.interrupt(previous)
          const attachment = yield* FiberSet.run(
            fibers,
            driver.requests.pipe(
              Stream.runForEach((invocation) =>
                Effect.sync(() => {
                  socket.send(JSON.stringify({ jsonrpc: "2.0", method: "llm.request", params: invocation }))
                }),
              ),
            ),
          )
          if (socket.data.closed) {
            yield* Fiber.interrupt(attachment)
            return yield* Effect.fail(
              new ControllerDisconnectedError({ message: "Drive controller disconnected during attachment" }),
            )
          }
          socket.data.attachment = attachment
          yield* Ref.set(activeController, attachment)
          return { attached: true }
        }),
      )
    case "llm.chunk":
      return driver.push(request.params.id, request.params.items).pipe(Effect.as({ ok: true }))
    case "llm.finish":
      return driver.finish(request.params.id, request.params.reason).pipe(Effect.as({ ok: true }))
    case "llm.disconnect":
      return driver.disconnect(request.params.id).pipe(Effect.as({ ok: true }))
    case "llm.pending":
      return driver.pending().pipe(Effect.map((invocations) => ({ invocations })))
    case "tool.attach":
      return tools.attach(socket, request.params.tools)
    case "tool.update":
      return tools.update(socket, request.params).pipe(Effect.as({ ok: true }))
    case "tool.finish":
      return tools.finish(socket, request.params).pipe(Effect.as({ ok: true }))
    case "tool.fail":
      return tools.fail(socket, request.params).pipe(Effect.as({ ok: true }))
  }
}

const makeToolDriver = Effect.fn("SimulatedProvider.makeToolDriver")(function* () {
  const completedRetention = 256
  const plugins = yield* SdkPlugins.Service
  const state = yield* Ref.make<ToolState>({
    counter: 0,
    generation: 0,
    appliedGeneration: 0,
    registrations: [],
    pending: new Map(),
    completed: new Map(),
    activeOverlays: new Set(),
    reconciliation: new Map(),
  })
  const registrationUpdates = yield* PubSub.unbounded<ToolRegistrationUpdate>()
  const lock = yield* Semaphore.make(1)
  const attachmentLock = yield* Semaphore.make(1)

  const remove = (current: ToolState, id: string) => {
    const pending = new Map(current.pending)
    pending.delete(id)
    return { ...current, pending }
  }

  const complete = (current: ToolState, id: string, completion: string) => {
    const completed = new Map(current.completed)
    completed.set(id, completion)
    if (completed.size > completedRetention) {
      const oldest = completed.keys().next().value
      if (oldest !== undefined) completed.delete(oldest)
    }
    return { ...remove(current, id), completed }
  }

  const notify = (
    socket: ControlSocket,
    method: "tool.invocation" | "tool.cancel",
    params: SimulationProtocol.Backend.ToolInvocation | SimulationProtocol.Backend.ToolCancellation,
  ) =>
    Effect.sync(() => {
      socket.send(JSON.stringify({ jsonrpc: "2.0", method, params }))
    })

  const requireController = (socket: ControlSocket) =>
    Effect.gen(function* () {
      const current = yield* Ref.get(state)
      if (current.controller?.socket === socket) return current
      return yield* Effect.fail(new ToolControllerError({ message: "Drive tool controller is not attached" }))
    })

  const requireInvocation = (socket: ControlSocket, id: string) =>
    Effect.gen(function* () {
      const current = yield* requireController(socket)
      const invocation = current.pending.get(id)
      if (invocation) return { current, invocation }
      return yield* Effect.fail(
        new ToolInvocationNotFoundError({
          id,
          message: `Simulated tool invocation not found or already finished: ${id}`,
        }),
      )
    })

  const cancel = (id: string) =>
    Effect.gen(function* () {
      const invocation = yield* lock.withPermit(Ref.get(state).pipe(Effect.map((current) => current.pending.get(id))))
      if (!invocation) return
      yield* invocation.operations.withPermit(
        lock.withPermit(
          Effect.gen(function* () {
            const current = yield* Ref.get(state)
            if (current.pending.get(id) !== invocation) return
            yield* Ref.set(state, remove(current, id))
            if (current.controller && !current.controller.socket.data.closed)
              yield* notify(current.controller.socket, "tool.cancel", { id, reason: "interrupted" })
          }),
        ),
      )
    })

  const invoke = (
    registrationGeneration: number,
    name: string,
    input: unknown,
    context: Tool.Context,
  ): Effect.Effect<Tool.DynamicOutput, Tool.Failure> =>
    Effect.gen(function* () {
      const encoded = yield* Schema.decodeUnknownEffect(Schema.Json)(input).pipe(
        Effect.mapError((error) => new Tool.Failure({ message: `Simulated tool input is not JSON: ${error.message}` })),
      )
      const invocation = yield* Effect.uninterruptibleMask((restore) =>
        attachmentLock
          .withPermit(
            lock.withPermit(
              Effect.gen(function* () {
                const current = yield* Ref.get(state)
                if (current.generation !== registrationGeneration)
                  yield* Effect.fail(
                    new Tool.Failure({ message: `Simulated tool registration is no longer active: ${name}` }),
                  )
                const id = `tool_${current.counter + 1}`
                const completion = yield* Deferred.make<ToolCompletion>()
                const notification: SimulationProtocol.Backend.ToolInvocation = {
                  id,
                  name,
                  input: encoded,
                  context: {
                    sessionID: context.sessionID,
                    agent: context.agent,
                    messageID: context.messageID,
                    callID: context.callID,
                  },
                }
                const pending: PendingToolInvocation = {
                  id,
                  notification,
                  progress: context.progress,
                  completion,
                  operations: Semaphore.makeUnsafe(1),
                }
                yield* Ref.set(state, {
                  counter: current.counter + 1,
                  generation: current.generation,
                  appliedGeneration: current.appliedGeneration,
                  ...(current.controller === undefined ? {} : { controller: current.controller }),
                  registrations: current.registrations,
                  pending: new Map(current.pending).set(id, pending),
                  completed: current.completed,
                  activeOverlays: current.activeOverlays,
                  reconciliation: current.reconciliation,
                })
                if (current.controller && !current.controller.socket.data.closed)
                  yield* notify(current.controller.socket, "tool.invocation", notification)
                return pending
              }),
            ),
          )
          .pipe(
            Effect.flatMap((pending) =>
              restore(Deferred.await(pending.completion)).pipe(
                Effect.onInterrupt(() => cancel(pending.id)),
                Effect.ensuring(
                  lock.withPermit(
                    Ref.update(state, (current) =>
                      current.pending.get(pending.id) === pending ? remove(current, pending.id) : current,
                    ),
                  ),
                ),
              ),
            ),
          ),
      )
      if (invocation.type === "success") return invocation.output
      return yield* Effect.fail(new Tool.Failure({ message: invocation.message }))
    })

  yield* plugins.register(
    Plugin.define({
      id: "opencode.simulation.tools",
      effect: (ctx) =>
        Effect.gen(function* () {
          const scope = yield* Scope.Scope
          const token = {}
          const registrationLock = Semaphore.makeUnsafe(1)
          let currentScope: Scope.Closeable | undefined
          const reconcile = (
            generation: number,
            nextRegistrations: ReadonlyArray<SimulationProtocol.Backend.ToolRegistration>,
          ) =>
            registrationLock.withPermit(
              Effect.gen(function* () {
                const nextScope = yield* Scope.fork(scope)
                const applied = yield* Effect.exit(
                  ctx.tool
                    .transform((draft) => {
                      for (const registration of nextRegistrations)
                        draft.add(
                          registration.name,
                          Tool.make({
                            description: registration.description,
                            jsonSchema: registration.inputSchema,
                            ...(registration.outputSchema === undefined
                              ? {}
                              : { outputSchema: registration.outputSchema }),
                            ...(registration.permission === undefined ? {} : { permission: registration.permission }),
                            execute: (input, context) =>
                              invoke(
                                generation,
                                SimulationProtocol.Backend.exposedToolName(registration),
                                input,
                                context,
                              ),
                          }),
                          registration.options,
                        )
                    })
                    .pipe(Scope.provide(nextScope)),
                )
                if (Exit.isFailure(applied)) {
                  yield* Scope.close(nextScope, applied)
                  yield* Effect.failCause(applied.cause)
                }
                const previousScope = currentScope
                currentScope = nextScope
                if (previousScope) yield* Scope.close(previousScope, Exit.void)
              }),
            )

          const acknowledge = (generation: number, result: Exit.Exit<void, unknown>) =>
            lock.withPermit(
              Effect.gen(function* () {
                const current = yield* Ref.get(state)
                const reconciliation = current.reconciliation.get(token)
                if (reconciliation?.generation !== generation) return
                yield* Deferred.succeed(reconciliation.result, result)
              }),
            )

          const initialized = yield* lock.withPermit(
            Effect.gen(function* () {
              const subscription = yield* PubSub.subscribe(registrationUpdates)
              const current = yield* Ref.get(state)
              const activeOverlays = new Set(current.activeOverlays).add(token)
              yield* Ref.set(state, { ...current, activeOverlays })
              return { subscription, generation: current.generation, registrations: current.registrations }
            }),
          )
          yield* Effect.addFinalizer(() =>
            lock.withPermit(
              Effect.gen(function* () {
                const current = yield* Ref.get(state)
                const activeOverlays = new Set(current.activeOverlays)
                activeOverlays.delete(token)
                const reconciliation = new Map(current.reconciliation)
                const pending = reconciliation.get(token)
                reconciliation.delete(token)
                yield* Ref.set(state, { ...current, activeOverlays, reconciliation })
                if (pending) yield* Deferred.succeed(pending.result, Exit.void)
              }),
            ),
          )
          yield* reconcile(initialized.generation, initialized.registrations)
          yield* Stream.fromEffectRepeat(PubSub.take(initialized.subscription)).pipe(
            Stream.runForEach((update) =>
              Effect.gen(function* () {
                const result = yield* Effect.exit(reconcile(update.generation, update.registrations))
                yield* acknowledge(update.generation, result)
              }),
            ),
            Effect.forkScoped({ startImmediately: true }),
          )
        }),
    }),
  )

  const reconcileRegistrations = (
    controller: ToolController | undefined,
    registrations: ReadonlyArray<SimulationProtocol.Backend.ToolRegistration>,
    targetGeneration?: number,
  ) =>
    Effect.gen(function* () {
      const reconciliation = yield* lock.withPermit(
        Effect.gen(function* () {
          const current = yield* Ref.get(state)
          const generation = targetGeneration ?? current.generation + 1
          const reconciliation = new Map<object, ToolReconciliation>()
          for (const token of current.activeOverlays)
            reconciliation.set(token, {
              generation,
              result: Deferred.makeUnsafe<Exit.Exit<void, unknown>>(),
            })
          yield* Ref.set(state, {
            counter: current.counter,
            generation,
            appliedGeneration: current.appliedGeneration,
            ...(controller === undefined ? {} : { controller }),
            registrations,
            pending: current.pending,
            completed: current.completed,
            activeOverlays: current.activeOverlays,
            reconciliation,
          })
          yield* PubSub.publish(registrationUpdates, { generation, registrations })
          return { generation, previous: current, reconciliation }
        }),
      )
      const results = yield* Effect.forEach(reconciliation.reconciliation.values(), (item) =>
        Deferred.await(item.result),
      )
      const failure = results.find(Exit.isFailure)
      yield* lock.withPermit(
        Ref.update(state, (current) =>
          current.generation === reconciliation.generation
            ? {
                ...current,
                ...(failure === undefined ? { appliedGeneration: reconciliation.generation } : {}),
                reconciliation: new Map(),
              }
            : current,
        ),
      )
      return { failure, previous: reconciliation.previous }
    })

  const attach: ToolDriver["attach"] = (socket, registrations) =>
    attachmentLock.withPermit(
      Effect.gen(function* () {
        if (socket.data.closed)
          return yield* Effect.fail(
            new ToolControllerError({ message: "Drive tool controller disconnected before attachment" }),
          )
        const current = yield* Ref.get(state)
        if (current.controller && current.controller.socket !== socket && !current.controller.socket.data.closed)
          return yield* Effect.fail(
            new ToolControllerError({ message: "Another Drive tool controller is already attached" }),
          )
        const controller: ToolController = { socket }
        const replay = current.controller?.socket !== socket
        const sameRegistrations =
          current.appliedGeneration === current.generation &&
          fingerprintJson(current.registrations) === fingerprintJson(registrations)
        if (replay && current.pending.size > 0 && !sameRegistrations)
          return yield* Effect.fail(
            new ToolControllerError({
              message: "A reconnecting Drive tool controller must settle pending invocations before replacing tools",
            }),
          )
        if (sameRegistrations) {
          yield* lock.withPermit(
            Effect.gen(function* () {
              const current = yield* Ref.get(state)
              yield* Ref.set(state, { ...current, controller })
              if (replay)
                yield* Effect.forEach(
                  current.pending.values(),
                  (invocation) => notify(socket, "tool.invocation", invocation.notification),
                  { discard: true },
                )
            }),
          )
          return { attached: true as const }
        }
        const reconciled = yield* reconcileRegistrations(controller, registrations)
        if (reconciled.failure) {
          const rolledBack = yield* reconcileRegistrations(
            reconciled.previous.controller,
            reconciled.previous.registrations,
            reconciled.previous.generation,
          )
          return yield* Effect.fail(
            new ToolControllerError({
              message: rolledBack.failure
                ? `Failed to apply and restore simulated tools: ${Cause.pretty(reconciled.failure.cause)}; ${Cause.pretty(rolledBack.failure.cause)}`
                : `Failed to apply simulated tools: ${Cause.pretty(reconciled.failure.cause)}`,
            }),
          )
        }
        if (replay)
          yield* lock.withPermit(
            Effect.gen(function* () {
              const current = yield* Ref.get(state)
              if (current.controller?.socket !== socket) return
              yield* Effect.forEach(
                current.pending.values(),
                (invocation) => notify(socket, "tool.invocation", invocation.notification),
                { discard: true },
              )
            }),
          )
        return { attached: true as const }
      }),
    )

  const update: ToolDriver["update"] = (socket, params) =>
    Effect.gen(function* () {
      const { invocation } = yield* lock.withPermit(requireInvocation(socket, params.id))
      yield* invocation.operations.withPermit(
        Effect.gen(function* () {
          const current = yield* lock.withPermit(Ref.get(state))
          if (current.pending.get(params.id) !== invocation)
            yield* Effect.fail(
              new ToolInvocationNotFoundError({
                id: params.id,
                message: `Simulated tool invocation not found or already finished: ${params.id}`,
              }),
            )
          const fingerprint = fingerprintJson(params.update)
          const applied = invocation.update
          if (applied?.sequence === params.sequence && applied.fingerprint === fingerprint) return
          if (applied?.sequence === params.sequence)
            yield* Effect.fail(
              new ToolControllerError({
                message: `Simulated tool update sequence ${params.sequence} was reused with different progress`,
              }),
            )
          const expected = applied === undefined ? 0 : applied.sequence + 1
          if (params.sequence !== expected)
            yield* Effect.fail(
              new ToolControllerError({
                message: `Expected simulated tool update sequence ${expected}, received ${params.sequence}`,
              }),
            )
          yield* invocation.progress(params.update)
          invocation.update = { sequence: params.sequence, fingerprint }
        }),
      )
    })

  const settle = (socket: ControlSocket, id: string, completion: ToolCompletion) =>
    Effect.gen(function* () {
      const current = yield* lock.withPermit(requireController(socket))
      const fingerprint = fingerprintJson(completion)
      const invocation = current.pending.get(id)
      if (!invocation) {
        if (current.completed.get(id) === fingerprint) return
        yield* Effect.fail(
          new ToolInvocationNotFoundError({
            id,
            message: `Simulated tool invocation not found or already finished: ${id}`,
          }),
        )
        return
      }
      yield* invocation.operations.withPermit(
        Effect.uninterruptible(
          lock.withPermit(
            Effect.gen(function* () {
              const current = yield* Ref.get(state)
              if (current.pending.get(id) !== invocation) {
                if (current.completed.get(id) === fingerprint) return
                yield* Effect.fail(
                  new ToolInvocationNotFoundError({
                    id,
                    message: `Simulated tool invocation not found or already finished: ${id}`,
                  }),
                )
                return
              }
              yield* Ref.set(state, complete(current, id, fingerprint))
              yield* Deferred.succeed(invocation.completion, completion)
            }),
          ),
        ),
      )
    })

  const release: ToolDriver["release"] = (socket) =>
    attachmentLock.withPermit(
      lock.withPermit(
        Ref.update(
          state,
          (current): ToolState =>
            current.controller?.socket !== socket
              ? current
              : {
                  counter: current.counter,
                  generation: current.generation,
                  appliedGeneration: current.appliedGeneration,
                  registrations: current.registrations,
                  pending: current.pending,
                  completed: current.completed,
                  activeOverlays: current.activeOverlays,
                  reconciliation: current.reconciliation,
                },
        ),
      ),
    )

  const shutdown = attachmentLock.withPermit(
    Effect.gen(function* () {
      yield* reconcileRegistrations(undefined, [])
      const current = yield* lock.withPermit(
        Effect.gen(function* () {
          const current = yield* Ref.get(state)
          yield* Ref.set(state, {
            counter: current.counter,
            generation: current.generation,
            appliedGeneration: current.appliedGeneration,
            registrations: [],
            pending: new Map(),
            completed: current.completed,
            activeOverlays: new Set<object>(),
            reconciliation: new Map(),
          })
          return current
        }),
      )
      yield* Effect.forEach(
        current.pending.values(),
        (invocation) =>
          Deferred.succeed(invocation.completion, {
            type: "failure",
            message: "Simulated tool controller shut down",
          }),
        { discard: true },
      )
      yield* PubSub.shutdown(registrationUpdates)
    }),
  )

  return {
    attach,
    update,
    finish: (socket, params) => settle(socket, params.id, { type: "success", output: params.output }),
    fail: (socket, params) => settle(socket, params.id, { type: "failure", message: params.message }),
    release,
    shutdown,
  } satisfies ToolDriver
})

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`
  }
  return JSON.stringify(value) ?? String(value)
}

function fingerprintJson(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("base64url")
}

function releaseController(
  activeController: Ref.Ref<Fiber.Fiber<void> | undefined>,
  controllerLock: Semaphore.Semaphore,
  socket: ControlSocket,
) {
  return controllerLock.withPermit(
    Effect.gen(function* () {
      const attachment = socket.data.attachment
      if (!attachment) return
      yield* Fiber.interrupt(attachment)
      yield* Ref.update(activeController, (active) => (active === attachment ? undefined : active))
    }),
  )
}

export * as SimulatedProvider from "./simulated-provider"
