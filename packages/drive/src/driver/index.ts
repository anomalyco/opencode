import * as Effect from "effect/Effect"
import * as Cause from "effect/Cause"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as OpenCodeInstance from "../instance/runtime.js"
import * as SimulationConnector from "../simulation/connector.js"
import type {
  OpenCodeConfig,
  OpenCodeTuiConfig,
  Project,
  Setup,
} from "../project.js"
import * as OpenCodeTui from "./client.js"
import type * as OpenCodeSdk from "./opencode.js"
import { error, type OpenCodeDriverError } from "./error.js"
import type {
  LlmControllerError,
  LlmSettlementError,
} from "./llm-controller.js"
import * as OpenCodeProject from "./project.js"
import * as PreparedDriver from "./prepared.js"
import * as OpenCodeServer from "./server.js"
import type * as OpenCodeUi from "./ui.js"
import type { Llm } from "./llm.js"
import type { RunReport } from "./report.js"
import * as ToolController from "../tool/controller.js"
import type * as Tool from "../tool/index.js"

export interface Options {
  readonly project?: Project
  readonly config?: OpenCodeConfig
  readonly tuiConfig?: OpenCodeTuiConfig
  readonly setup?: Setup
  readonly tools?: Tool.Configuration
  readonly tui?: OpenCodeTui.TuiOptions
  readonly opencode?: OpenCodeServer.Target
  readonly keepArtifacts?: boolean
}

export interface Driver {
  /** Generated SDK client connected to this driver's private OpenCode service. */
  readonly opencode: OpenCodeSdk.OpenCode
  readonly tui: OpenCodeTui.Tui
  /** Convenience alias for the primary TUI's UI. */
  readonly ui: OpenCodeUi.Ui
  readonly llm: Llm
  /** Runtime controls for tools declared by name in the driver options. */
  readonly tools: Tool.Controls
  readonly tuis: OpenCodeTui.Tuis
  readonly artifacts: string
  /** Validates queued LLM work, stops TUIs, and exports recordings. */
  readonly settle: () => Effect.Effect<
    RunReport,
    | LlmControllerError
    | LlmSettlementError
    | OpenCodeDriverError
    | OpenCodeUi.OperationError
  >
}

const makeWithServices = Effect.fn("OpenCodeDriver.makeWithServices")(
  function* (options: Options = {}) {
    const toolController = yield* ToolController.make(options.tools)
    const project = yield* OpenCodeProject.make({
      project: options.project,
      config: options.config,
      tui: options.tuiConfig,
      setup: ToolController.composeSetup(toolController, options.setup),
      keepArtifacts: options.keepArtifacts,
    })
    const instance = yield* OpenCodeInstance.make({
      artifacts: project.artifacts,
      name: `library-${crypto.randomUUID().slice(0, 12)}`,
      scripted: true,
      command: options.opencode?.command,
      dev: options.opencode?.dev,
      env: options.opencode?.env,
      visible: options.opencode?.visible,
    }, toolController).pipe(Effect.mapError((cause) => error("server.prepare", cause)))
    const prepared = yield* PreparedDriver.makeWithServices(instance, {
      visible: options.opencode?.visible,
      tui: options.tui,
      artifactsRetained: options.keepArtifacts ?? false,
      compatibility: options.opencode?.compatibility,
    })
    if (prepared.driver === undefined)
      return yield* Effect.die(
        new Error("automatic driver did not launch a TUI"),
      )
    return { driver: prepared.driver, failure: prepared.failure }
  },
)

type MakeWithServices = ReturnType<typeof makeWithServices>
const layer = Layer.merge(SimulationConnector.layer, NodeServices.layer)

const makeManaged = (
  options: Options = {},
): Effect.Effect<
  Effect.Success<MakeWithServices>,
  Effect.Error<MakeWithServices>,
  Scope.Scope
> =>
  makeWithServices(options).pipe(
    Effect.provide(layer),
  )

export const make = (options: Options = {}) =>
  makeManaged(options).pipe(Effect.map(({ driver }) => driver))

type Program<A, E, R> = (
  driver: Driver,
) => Effect.Effect<A, E, R>

const runReport = <A, E, R>(
  options: Options,
  f: Program<A, E, R>,
) =>
  Effect.scoped(
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const { driver, failure } = yield* makeManaged(options)
        const useExit = yield* Effect.exit(
          restore(Effect.raceFirst(f(driver), failure)),
        )
        const settlement = yield* Effect.exit(driver.settle())
        if (Exit.isFailure(useExit) && Exit.isFailure(settlement))
          return yield* Effect.failCause(
            Cause.combine(useExit.cause, settlement.cause),
          )
        if (Exit.isFailure(useExit)) return yield* Effect.failCause(useExit.cause)
        if (Exit.isFailure(settlement))
          return yield* Effect.failCause(settlement.cause)
        return { value: useExit.value, report: settlement.value }
      }),
    ),
  )

export function useReport<A, E, R>(
  f: Program<A, E, R>,
): ReturnType<typeof runReport<A, E, R>>
export function useReport<A, E, R>(
  options: Options,
  f: Program<A, E, R>,
): ReturnType<typeof runReport<A, E, R>>
export function useReport<A, E, R>(
  optionsOrProgram: Options | Program<A, E, R>,
  program?: Program<A, E, R>,
) {
  if (typeof optionsOrProgram === "function")
    return runReport({}, optionsOrProgram)
  if (program === undefined)
    return Effect.die(new Error("OpenCodeDriver.useReport requires a program"))
  return runReport(optionsOrProgram, program)
}

const run = <A, E, R>(options: Options, program: Program<A, E, R>) =>
  runReport(options, program).pipe(Effect.map(({ value }) => value))

export function use<A, E, R>(
  f: Program<A, E, R>,
): ReturnType<typeof run<A, E, R>>
export function use<A, E, R>(
  options: Options,
  f: Program<A, E, R>,
): ReturnType<typeof run<A, E, R>>
export function use<A, E, R>(
  optionsOrProgram: Options | Program<A, E, R>,
  program?: Program<A, E, R>,
) {
  return typeof optionsOrProgram === "function"
    ? run({}, optionsOrProgram)
    : program === undefined
      ? Effect.die(new Error("OpenCodeDriver.use requires a program"))
      : run(optionsOrProgram, program)
}

export { OpenCodeDriverError } from "./error.js"
export {
  LlmControllerError,
  LlmModeError,
  LlmSettlementError,
} from "./llm-controller.js"
export {
  UiCapabilityError,
  UiElementAmbiguousError,
  UiNodeAmbiguousError,
  UiPredicateError,
  UiTimeoutError,
  UiWaitOptionsError,
} from "./ui.js"
export { SimulationRequestError } from "@opencode-ai/protocol/simulation"
export {
  SimulationCompatibilityError,
  SimulationConnectionError,
} from "../simulation/connector.js"
export type {
  CompatibilityPolicy,
  EndpointCompatibility,
} from "../simulation/connector.js"
export type {
  Recording,
  Tui,
  TuiLaunchError,
  TuiOptions,
  Tuis,
} from "./client.js"
export type { Llm } from "./llm.js"
export type { Target as OpenCodeTarget } from "./server.js"
export type { OpenCode } from "./opencode.js"
export type { Ui } from "./ui.js"
export type {
  Project,
  ProjectFileSystem,
  Setup,
  SetupContext,
} from "../project.js"
export * from "./report.js"
