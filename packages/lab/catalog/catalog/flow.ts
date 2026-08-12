import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import type { Driver } from "opencode-drive/driver"
import type {
  FlowStepDefinition,
  NonEmpty,
  ScreenDefinition,
  Taxonomies,
  TaxonomyDefinition,
  TaxonomyItemId,
} from "./dsl"

const FlowStateTypeId: unique symbol = Symbol("CatalogFlowState")

export interface FlowStateMetadata<ScreenLabel extends string, UiElement extends string> {
  readonly screen: ScreenDefinition<ScreenLabel, UiElement>
  readonly step: Omit<FlowStepDefinition<never>, "capture">
}

export interface FlowState<
  FlowId extends string,
  StateId extends string,
  Metadata extends FlowStateMetadata<string, string> = FlowStateMetadata<string, string>,
> {
  readonly [FlowStateTypeId]: (flow: FlowId) => FlowId
  readonly id: StateId
  readonly address: `${FlowId}/${StateId}`
  readonly metadata: Metadata
}

type AnyFlowState<FlowId extends string> = FlowState<FlowId, string>

export interface FlowRunContext<
  FlowId extends string,
  States extends NonEmpty<AnyFlowState<FlowId>>,
> {
  readonly driver: Driver
  readonly checkpoint: (state: States[number]) => Effect.Effect<void, unknown>
}

interface FlowProgram<
  FlowId extends string,
  States extends NonEmpty<AnyFlowState<FlowId>>,
  Error,
  Requirements,
> {
  readonly states: States
  readonly run: (
    context: FlowRunContext<FlowId, States>,
  ) => Effect.Effect<void, Error, Requirements>
}

export interface ExecutableFlow<
  FlowId extends string,
  States extends NonEmpty<AnyFlowState<FlowId>>,
  Error,
  Requirements,
  GroupId extends string = string,
> {
  readonly id: FlowId
  readonly title: string
  readonly group: { readonly id: GroupId; readonly label: string }
  readonly description: string
  readonly states: States
  readonly run: (
    context: FlowRunContext<FlowId, States>,
  ) => Effect.Effect<void, Error, Requirements>
}

export interface ExecutableScenarioState {
  readonly id: string
  readonly address: string
  readonly metadata: FlowStateMetadata<string, string>
}

export interface ExecutableScenario {
  readonly id: string
  readonly title: string
  readonly group: { readonly id: string; readonly label: string }
  readonly description: string
  readonly llmMode: "queue" | "serve"
  readonly clientIsolation: "shared" | "isolated"
  readonly states: ReadonlyArray<ExecutableScenarioState>
  readonly run: (options: {
    readonly driver: Driver
    readonly through?: string
    readonly capture: (state: ExecutableScenarioState) => Effect.Effect<void, unknown>
  }) => Effect.Effect<void, unknown>
}

interface FlowAuthor<
  FlowId extends string,
  ScreenLabel extends string,
  UiElement extends string,
> {
  readonly state: <
    const StateId extends string,
    const Metadata extends FlowStateMetadata<ScreenLabel, UiElement>,
  >(
    id: StateId,
    metadata: Metadata,
  ) => FlowState<FlowId, StateId, Metadata>
  readonly program: <
    const States extends NonEmpty<AnyFlowState<FlowId>>,
    Error,
    Requirements,
  >(
    states: States,
    run: (
      context: FlowRunContext<FlowId, States>,
    ) => Effect.Effect<void, Error, Requirements>,
  ) => FlowProgram<FlowId, States, Error, Requirements>
}

export function defineExecutableFlow<
  ScreenLabels extends TaxonomyDefinition,
  UiElements extends TaxonomyDefinition,
  const FlowId extends string,
  const GroupId extends string,
  const States extends NonEmpty<AnyFlowState<FlowId>>,
  Error,
  Requirements,
>(
  taxonomies: Taxonomies<ScreenLabels, UiElements>,
  definition: {
    readonly id: FlowId
    readonly title: string
    readonly group: { readonly id: GroupId; readonly label: string }
    readonly description: string
  },
  build: (
    author: FlowAuthor<
      FlowId,
      TaxonomyItemId<ScreenLabels>,
      TaxonomyItemId<UiElements>
    >,
  ) => FlowProgram<FlowId, States, Error, Requirements>,
): ExecutableFlow<FlowId, States, Error, Requirements, GroupId> {
  void taxonomies
  const author: FlowAuthor<
    FlowId,
    TaxonomyItemId<ScreenLabels>,
    TaxonomyItemId<UiElements>
  > = {
    state: (id, metadata) => ({
      [FlowStateTypeId]: (flow) => flow,
      id,
      address: `${definition.id}/${id}`,
      metadata,
    }),
    program: (states, run) => ({ states, run }),
  }
  const program = build(author)
  return { ...definition, ...program }
}

export class FlowStateNotReachedError extends Error {
  readonly _tag = "FlowStateNotReachedError"

  constructor(readonly address: string) {
    super(`Flow completed without reaching ${address}`)
  }
}

export class FlowCheckpointOrderError extends Error {
  readonly _tag = "FlowCheckpointOrderError"

  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`Expected checkpoint ${expected}, received ${actual}`)
  }
}

export function executeFlow<
  const FlowId extends string,
  const States extends NonEmpty<AnyFlowState<FlowId>>,
  FlowError,
  FlowRequirements,
  CaptureError,
>(
  flow: ExecutableFlow<FlowId, States, FlowError, FlowRequirements>,
  options: {
    readonly driver: Driver
    readonly through?: States[number]
    readonly capture: (
      state: States[number],
    ) => Effect.Effect<void, CaptureError>
  },
): Effect.Effect<
  void,
  FlowError | CaptureError | FlowCheckpointOrderError | FlowStateNotReachedError,
  FlowRequirements
> {
  const target = options.through
  if (target === undefined) {
    return Effect.gen(function* () {
      let index = 0
      yield* flow.run({
        driver: options.driver,
        checkpoint: (state) => Effect.gen(function* () {
          const expected = flow.states[index]
          if (state !== expected) {
            return yield* Effect.fail(
              new FlowCheckpointOrderError(
                expected?.address ?? "the end of the flow",
                state.address,
              ),
            )
          }
          index++
          yield* options.capture(state)
        }),
      })
      const missing = flow.states[index]
      if (missing) return yield* Effect.fail(new FlowStateNotReachedError(missing.address))
    })
  }

  return Effect.gen(function* () {
    const reached = yield* Deferred.make<void>()
    let index = 0
    const program = flow.run({
      driver: options.driver,
      checkpoint: (state) => Effect.gen(function* () {
        const expected = flow.states[index]
        if (state !== expected) {
          return yield* Effect.fail(
            new FlowCheckpointOrderError(
              expected?.address ?? "the end of the flow",
              state.address,
            ),
          )
        }
        index++
        if (state !== target) return
        return yield* options.capture(state).pipe(
          Effect.andThen(Deferred.succeed(reached, undefined)),
          Effect.andThen(Effect.never),
        )
      }),
    }).pipe(
      Effect.andThen(Effect.fail(new FlowStateNotReachedError(target.address))),
    )
    yield* Effect.raceFirst(Deferred.await(reached), program)
  })
}

export function executableScenario<
  const FlowId extends string,
  const States extends NonEmpty<AnyFlowState<FlowId>>,
  FlowError,
  const GroupId extends string,
>(
  flow: ExecutableFlow<FlowId, States, FlowError, never, GroupId>,
  options: {
    readonly llmMode?: "queue" | "serve"
    readonly clientIsolation?: "shared" | "isolated"
  } = {},
): ExecutableScenario & {
  readonly flow: ExecutableFlow<FlowId, States, FlowError, never, GroupId>
} {
  return {
    flow,
    id: flow.id,
    title: flow.title,
    group: flow.group,
    description: flow.description,
    llmMode: options.llmMode ?? "queue",
    clientIsolation: options.clientIsolation ?? "shared",
    states: flow.states,
    run: ({ driver, through, capture }) => {
      const target = through === undefined
        ? undefined
        : flow.states.find((state) => state.id === through)
      if (through !== undefined && target === undefined) {
        return Effect.fail(new Error(`Unknown state ${JSON.stringify(`${flow.id}/${through}`)}`))
      }
      return executeFlow(flow, { driver, through: target, capture })
    },
  }
}
