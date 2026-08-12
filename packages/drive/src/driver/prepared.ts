import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as OpenCodeInstance from "../instance/runtime.js"
import * as SimulationConnector from "../simulation/connector.js"
import * as OpenCodeTui from "./client.js"
import { error, type OpenCodeDriverError } from "./error.js"
import type {
  Driver,
  Llm,
} from "./index.js"
import type {
  LlmControllerError,
  LlmSettlementError,
} from "./llm-controller.js"
import * as OpenCodeServer from "./server.js"
import * as SharedEffect from "./shared.js"
import type * as OpenCodeUi from "./ui.js"
import { decodeRunReport } from "./report.js"

export interface Options {
  readonly visible?: boolean
  readonly tui?: OpenCodeTui.TuiOptions
  readonly launch?: "automatic" | "manual"
  readonly tuiName?: string
  readonly artifactsRetained?: boolean
  readonly compatibility?: SimulationConnector.CompatibilityPolicy
}

export interface Prepared {
  readonly driver: Driver | undefined
  readonly primary: OpenCodeTui.Tui | undefined
  readonly llm: Llm
  readonly tools: Driver["tools"]
  readonly tuis: OpenCodeTui.Tuis
  readonly server: Pick<OpenCodeServer.Server, "launch" | "kill">
  readonly artifacts: string
  readonly settle: Driver["settle"]
  readonly failure: Effect.Effect<never, LlmControllerError | OpenCodeDriverError>
  readonly unexpectedTuiExit: OpenCodeTui.Control["unexpectedExit"]
}

export const makeWithServices = Effect.fn("OpenCodeDriver.makePreparedWithServices")(
  function* (
    instance: OpenCodeInstance.Instance,
    options: Options,
  ) {
    const server = yield* OpenCodeServer.make({
      instance,
      target: {
        visible: options.visible,
        compatibility: options.compatibility,
      },
    })
    const opencode = (options.launch ?? "automatic") === "automatic"
      ? yield* server.launch()
      : undefined
    const primary = (options.launch ?? "automatic") === "automatic"
      ? options.tuiName === undefined
        ? yield* server.tuis.launch(options.tui)
        : yield* server.tuis.launch(options.tuiName, options.tui)
      : undefined
    const complete = (
      tuis: Effect.Effect<
        ReadonlyArray<string>,
        OpenCodeDriverError | OpenCodeUi.OperationError
      >,
    ) =>
      Effect.gen(function* () {
        const llm = yield* Effect.exit(server.llm.settle())
        const tools = yield* Effect.exit(
          server.settleTools.pipe(
            Effect.mapError((cause) => error("tools.settle", cause)),
          ),
        )
        const shutdown = yield* Effect.exit(server.llm.shutdown())
        const tuiExit = yield* Effect.exit(tuis)
        let failure: Cause.Cause<
          | LlmControllerError
          | LlmSettlementError
          | OpenCodeDriverError
          | OpenCodeUi.OperationError
        > | undefined
        if (Exit.isFailure(llm)) failure = llm.cause
        if (Exit.isFailure(tools))
          failure = failure === undefined
            ? tools.cause
            : Cause.combine(failure, tools.cause)
        if (Exit.isFailure(shutdown))
          failure = failure === undefined
            ? shutdown.cause
            : Cause.combine(failure, shutdown.cause)
        if (Exit.isFailure(tuiExit))
          failure = failure === undefined
            ? tuiExit.cause
            : Cause.combine(failure, tuiExit.cause)
        if (failure !== undefined) return yield* Effect.failCause(failure)
        const compatibility = [
          ...(yield* server.compatibility),
          ...(yield* server.tuis.compatibility),
        ]
        const recordings = Exit.isSuccess(tuiExit) ? tuiExit.value : []
        const report = yield* decodeRunReport({
          artifacts: instance.artifacts,
          retained: options.artifactsRetained ?? true,
          recordings,
          compatibility,
        }).pipe(
          Effect.mapError((cause) => error("report.make", cause)),
        )
        return report
      })
    const settle = yield* SharedEffect.make(complete(server.tuis.settle()))
    yield* Effect.addFinalizer(() => server.llm.shutdown())
    const llm: Llm = server.llm
    const driver: Driver | undefined = primary === undefined || opencode === undefined
      ? undefined
      : {
          opencode,
          tui: primary,
          ui: primary.ui,
          llm,
          tools: server.tools,
          tuis: server.tuis,
          artifacts: instance.artifacts,
          settle: () => settle,
        }
    return {
      driver,
      primary,
      llm,
      tools: server.tools,
      tuis: server.tuis,
      server,
      artifacts: instance.artifacts,
      settle: () => settle,
      failure: Effect.raceFirst(
        server.failure,
        server.tuis.unexpectedExit.pipe(
          Effect.flatMap(({ name, status }) =>
            Effect.fail(
              error(
                "tui.exit",
                `OpenCode TUI "${name}" exited with status ${status}`,
              ),
            ),
          ),
        ),
      ),
      unexpectedTuiExit: server.tuis.unexpectedExit,
    } satisfies Prepared
  },
)

export const make = (
  instance: OpenCodeInstance.Instance,
  options: Options,
) =>
  makeWithServices(instance, options).pipe(
    Effect.provide(SimulationConnector.layer),
  )
