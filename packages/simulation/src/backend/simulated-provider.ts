import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Cause, Context, Effect, Fiber, FiberSet, Layer, PubSub, Queue, Ref, Schema, Semaphore, Stream } from "effect"
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

class InvocationNotFoundError extends Schema.TaggedErrorClass<InvocationNotFoundError>()(
  "SimulatedProvider.InvocationNotFoundError",
  { id: Schema.String, message: Schema.String },
) {}

class ControllerDisconnectedError extends Schema.TaggedErrorClass<ControllerDisconnectedError>()(
  "SimulatedProvider.ControllerDisconnectedError",
  { message: Schema.String },
) {}

type ControlSocket = SimulationControlServer.Socket

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
      yield* SimulationControlServer.start({
        endpoint: options.endpoint,
        label: "opencode drive backend websocket",
        data: () => ({}),
        decode: SimulationProtocol.Backend.decodeRequestEffect,
        handle: (socket, request) => handle(driver, fibers, activeController, controllerLock, socket, request),
        close: (socket) => releaseController(activeController, controllerLock, socket),
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
  }
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
