import * as Effect from "effect/Effect"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Ref from "effect/Ref"
import * as Semaphore from "effect/Semaphore"
import * as Scope from "effect/Scope"
import * as Exit from "effect/Exit"
import { RpcClientError } from "effect/unstable/rpc"
import * as OpenCodeInstance from "../instance/runtime.js"
import * as SimulationConnector from "../simulation/connector.js"
import * as OpenCodeTui from "./client.js"
import * as OpenCodeSdk from "./opencode.js"
import { error, type OpenCodeDriverError } from "./error.js"
import * as LlmController from "./llm-controller.js"
import * as ToolProducer from "../tool/producer.js"
import type * as Tool from "../tool/index.js"
import { LifecycleError } from "../tool/types.js"

export interface Target {
  readonly command?: ReadonlyArray<string>
  readonly dev?: string
  readonly env?: Readonly<Record<string, string>>
  readonly visible?: boolean
  readonly compatibility?: SimulationConnector.CompatibilityPolicy
}

export interface Options {
  readonly instance: OpenCodeInstance.Instance
  readonly target?: Target
}

export interface Server {
  readonly llm: LlmController.Controller
  readonly tools: Tool.Controls
  readonly settleTools: ToolProducer.Controller["settle"]
  readonly tuis: OpenCodeTui.Control
  readonly launch: () => Effect.Effect<
    OpenCodeSdk.OpenCode,
    | OpenCodeDriverError
    | LlmController.LlmControllerError
    | SimulationConnector.SimulationCompatibilityError
  >
  readonly kill: () => Effect.Effect<void, OpenCodeDriverError>
  readonly failure: Effect.Effect<never, OpenCodeDriverError | LlmController.LlmControllerError>
  readonly compatibility: Effect.Effect<
    ReadonlyArray<SimulationConnector.EndpointCompatibility>
  >
}

export const make = Effect.fn("OpenCodeServer.make")(function* (
  options: Options,
) {
  const connector = yield* SimulationConnector.Service
  const target = options.target ?? {}
  const instance = options.instance
  const llm = yield* LlmController.make()
  const toolProducer = yield* ToolProducer.make(instance.toolNames)
  const tools: Tool.Controls = {
    ...instance.tools,
    ...toolProducer.controls,
  }
  const tuis = yield* OpenCodeTui.makeTuis(
    instance,
    target.visible ?? false,
    connector,
    target.compatibility,
  )
  const parentScope = yield* Scope.Scope
  const generation = yield* Ref.make<
    {
      readonly scope: Scope.Scope
      readonly attachment: LlmController.Attachment
      readonly process: import("../instance/process.js").Running
    } | undefined
  >(undefined)
  const unexpectedExit = yield* Deferred.make<never, OpenCodeDriverError>()
  const toolConnectionFailure = yield* Deferred.make<never, OpenCodeDriverError>()
  const lifecycle = yield* Semaphore.make(1)
  let compatibility: ReadonlyArray<
    SimulationConnector.EndpointCompatibility
  > = []

  const launchGeneration = Effect.fn("OpenCodeServer.launch")(function* () {
    if ((yield* Ref.get(generation)) !== undefined)
      return yield* Effect.fail(
        error("server.launch", "the script server has already been launched"),
      )
    const scope = yield* Scope.fork(parentScope)
    const launched = yield* instance.launchServer.pipe(
      Effect.mapError((cause) => error("server.launch", cause)),
      Effect.onError(() => Scope.close(scope, Exit.void)),
    )
    let llmAttachment: LlmController.Attachment | undefined
    const rollbackLaunch = Effect.suspend(() =>
      (llmAttachment?.detach() ?? Effect.void).pipe(
        Effect.andThen(toolProducer.endGeneration),
        Effect.andThen(Scope.close(scope, Exit.void)),
        Effect.andThen(instance.killServer.pipe(Effect.ignore)),
      ),
    )
    const backend = yield* connector.backend(launched.endpoint, {
      compatibility: target.compatibility,
    }).pipe(
      Scope.provide(scope),
      Effect.mapError((cause) => error("server.connect", cause)),
      Effect.onError(() => rollbackLaunch),
    )
    const connectTools = Effect.fn("OpenCodeServer.connectTools")(function* () {
      const connectionScope = yield* Scope.fork(scope)
      const connection = yield* toolProducer
        .connectFrom(
          connector.backend(launched.endpoint, {
            attach: false,
            compatibility: target.compatibility,
          }).pipe(Scope.provide(connectionScope)),
        )
        .pipe(Effect.onError(() => Scope.close(connectionScope, Exit.void)))
      return { ...connection, scope: connectionScope }
    })
    const failToolConnection = (cause: unknown) =>
      toolProducer.shutdown.pipe(
        Effect.andThen(
          Deferred.fail(
            toolConnectionFailure,
            error("tools.connect", cause),
          ),
        ),
        Effect.asVoid,
      )
    function reconnectTools(): Effect.Effect<void> {
      return connectTools().pipe(
        Effect.flatMap(superviseTools),
        Effect.catchIf(
          isRetryableToolConnectionError,
          () => Effect.sleep(25).pipe(Effect.andThen(reconnectTools())),
        ),
        Effect.catchIf(isClosedToolConnectionError, () => Effect.void),
        Effect.catch(failToolConnection),
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterrupts(cause),
          (cause) => failToolConnection(Cause.pretty(cause)),
        ),
      )
    }
    function superviseTools(
      connection: Effect.Success<ReturnType<typeof connectTools>>,
    ): Effect.Effect<void> {
      return connection.backend.closed.pipe(
        Effect.ensuring(
          connection.attachment.detach().pipe(
            Effect.andThen(Scope.close(connection.scope, Exit.void)),
          ),
        ),
        Effect.andThen(Effect.sleep(25)),
        Effect.andThen(reconnectTools()),
      )
    }
    const toolConnection = yield* connectTools().pipe(
      Effect.mapError((cause) => error("tools.connect", cause)),
      Effect.onError(() => rollbackLaunch),
    )
    yield* superviseTools(toolConnection).pipe(
      Effect.forkIn(scope),
    )
    const attachment = yield* llm.attach(backend).pipe(
      Effect.onError(() => rollbackLaunch),
    )
    llmAttachment = attachment
    const opencode = yield* OpenCodeSdk.make(instance.artifacts).pipe(
      Effect.onError(() => rollbackLaunch),
    )
    const process = yield* instance.primary.pipe(
      Effect.mapError((cause) => error("server.launch", cause)),
      Effect.onError(() => rollbackLaunch),
    )
    yield* Ref.set(generation, { scope, attachment, process })
    compatibility = [...compatibility, backend.compatibility]
    yield* process.exitCode.pipe(
      Effect.tap(() => Effect.sleep(25)),
      Effect.flatMap((status) =>
        Ref.get(generation).pipe(
          Effect.flatMap((active) =>
            active?.process === process
              ? toolProducer.endGeneration.pipe(
                  Effect.andThen(
                    Deferred.fail(unexpectedExit, error("server.exit", `OpenCode server exited with status ${status}`)),
                  ),
                  Effect.asVoid,
                )
              : Effect.void,
          ),
        ),
      ),
      Effect.catchCause(() => Effect.void),
      Effect.forkIn(scope),
    )
    return opencode
  })

  const killGeneration = Effect.fn("OpenCodeServer.kill")(function* () {
    const active = yield* Ref.get(generation)
    if (active === undefined)
      return yield* Effect.fail(
        error("server.kill", "the script server is not running"),
      )
    yield* Ref.set(generation, undefined)
    yield* active.attachment.detach()
    yield* toolProducer.endGeneration
    yield* Scope.close(active.scope, Exit.void)
    const stopped = yield* Effect.exit(
      instance.killServer.pipe(
        Effect.mapError((cause) => error("server.kill", cause)),
      ),
    )
    if (Exit.isFailure(stopped)) return yield* Effect.failCause(stopped.cause)
    return undefined
  })
  const launch = () => lifecycle.withPermit(launchGeneration())
  const kill = () => lifecycle.withPermit(killGeneration())

  return {
    llm,
    tools,
    settleTools: toolProducer.settle,
    tuis,
    launch,
    kill,
    failure: Effect.raceFirst(
      toolProducer.failure.pipe(
        Effect.mapError((cause) => error("tools", cause)),
      ),
      Effect.raceFirst(
        Deferred.await(toolConnectionFailure),
        Effect.raceFirst(llm.failure, Deferred.await(unexpectedExit)),
      ),
    ).pipe(Effect.tapError(() => toolProducer.endGeneration)),
    compatibility: Effect.sync(() => compatibility),
  } satisfies Server
})

function isRetryableToolConnectionError(cause: unknown) {
  return (
    cause instanceof SimulationConnector.SimulationConnectionError ||
    (cause instanceof RpcClientError.RpcClientError &&
      isTransientRpcClientError(cause)) ||
    (cause instanceof LifecycleError && cause.reason === "transport-interrupted")
  )
}

function isClosedToolConnectionError(cause: unknown) {
  return cause instanceof LifecycleError && cause.reason === "controller-closed"
}

function isTransientRpcClientError(error: RpcClientError.RpcClientError) {
  if (error.reason._tag !== "RpcClientDefect") return true
  const message = error.reason.message
  return (
    message.startsWith("cannot connect") ||
    message === "connection closed" ||
    message === "connection error" ||
    message === "connection is not open" ||
    message === "failed to send request"
  )
}

export * as OpenCodeServer from "./server.js"
