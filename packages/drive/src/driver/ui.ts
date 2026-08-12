import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import type { RpcClientError } from "effect/unstable/rpc"
import {
  supportsCapability,
  type UiConnection,
} from "../simulation/connector.js"
import { Frontend } from "../client/protocol.js"
import type { SimulationRequestError } from "../simulation/rpc.js"

export interface WaitOptions {
  /** Maximum wait in milliseconds. Defaults to 5,000. */
  readonly timeout?: number
  /** Poll interval in milliseconds. Defaults to 50. */
  readonly interval?: number
}

export interface ElementQuery {
  readonly id?: string
  readonly num?: number
  readonly focusable?: boolean
  readonly focused?: boolean
  readonly clickable?: boolean
  readonly editor?: boolean
}

export type SemanticQuery = Partial<Frontend.SemanticNode>

export type Position = Pick<Frontend.ClickParams, "x" | "y">

export type Predicate = (state: Frontend.State) => boolean
export type EffectPredicate<E> = (
  state: Frontend.State,
) => Effect.Effect<boolean, E>

export class UiTimeoutError extends Schema.TaggedErrorClass<UiTimeoutError>()(
  "UiTimeoutError",
  {
    operation: Schema.String,
    milliseconds: Schema.Number,
    message: Schema.String,
    frame: Schema.optionalKey(Frontend.CapturedFrame),
  },
) {}

export class UiElementAmbiguousError extends Schema.TaggedErrorClass<UiElementAmbiguousError>()(
  "UiElementAmbiguousError",
  {
    count: Schema.Number,
  },
) {
  override get message() {
    return `ui.getElement matched ${this.count} elements`
  }
}

export class UiNodeAmbiguousError extends Schema.TaggedErrorClass<UiNodeAmbiguousError>()(
  "UiNodeAmbiguousError",
  {
    count: Schema.Number,
  },
) {
  override get message() {
    return `ui.getNode matched ${this.count} semantic nodes`
  }
}

export class UiCapabilityError extends Schema.TaggedErrorClass<UiCapabilityError>()(
  "UiCapabilityError",
  {
    capability: Schema.Literals(["ui.snapshot", "ui.click.semantic"]),
    message: Schema.String,
  },
) {}

export class UiWaitOptionsError extends Schema.TaggedErrorClass<UiWaitOptionsError>()(
  "UiWaitOptionsError",
  {
    field: Schema.Literals(["timeout", "interval"]),
    value: Schema.Number,
    message: Schema.String,
  },
) {}

export class UiPredicateError extends Schema.TaggedErrorClass<UiPredicateError>()(
  "UiPredicateError",
  {
    cause: Schema.Defect(),
    message: Schema.String,
  },
) {}

export interface Options {
  /** Per-RPC timeout in milliseconds. Defaults to 30,000. */
  readonly requestTimeout?: number
}

const RequestTimeout = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

export type WaitError = UiTimeoutError | UiWaitOptionsError
type RpcError = SimulationRequestError | RpcClientError.RpcClientError
export type OperationError = RpcError | UiTimeoutError
export type SemanticOperationError = OperationError | UiCapabilityError

export interface Ui {
  readonly state: () => Effect.Effect<Frontend.State, OperationError>
  readonly snapshot: () => Effect.Effect<Frontend.SemanticSnapshot, SemanticOperationError>
  readonly capture: () => Effect.Effect<Frontend.CapturedFrame, OperationError>
  readonly matches: (text: string) => Effect.Effect<boolean, OperationError>
  readonly screenshot: (
    name?: string,
  ) => Effect.Effect<string, OperationError>
  readonly type: (text: string) => Effect.Effect<Frontend.State, OperationError>
  readonly press: (
    key: string,
    modifiers?: Frontend.KeyModifiers,
  ) => Effect.Effect<Frontend.State, OperationError>
  readonly enter: () => Effect.Effect<Frontend.State, OperationError>
  readonly arrow: (
    direction: Frontend.ArrowParams["direction"],
  ) => Effect.Effect<Frontend.State, OperationError>
  readonly focus: (
    target: number | Frontend.Element,
  ) => Effect.Effect<Frontend.State, OperationError>
  readonly click: (
    target: number | Frontend.Element | Frontend.SemanticNode,
    position?: Position,
  ) => Effect.Effect<
    Frontend.State,
    OperationError | UiCapabilityError | UiElementAmbiguousError | UiWaitOptionsError
  >
  readonly resize: (
    viewport: Frontend.ResizeParams,
  ) => Effect.Effect<Frontend.State, OperationError>
  readonly submit: (
    text: string,
  ) => Effect.Effect<Frontend.State, OperationError>
  readonly waitFor: <E = never>(
    target: string | Predicate | EffectPredicate<E>,
    options?: WaitOptions,
  ) => Effect.Effect<
    Frontend.State,
    OperationError | WaitError | UiPredicateError | E
  >
  readonly getElement: (
    target: number | string | ElementQuery,
    options?: WaitOptions,
  ) => Effect.Effect<
    Frontend.Element,
    OperationError | WaitError | UiElementAmbiguousError
  >
  readonly getNode: (
    target: string | SemanticQuery,
    options?: WaitOptions,
  ) => Effect.Effect<
    Frontend.SemanticNode,
    SemanticOperationError | WaitError | UiNodeAmbiguousError
  >
}

interface Control extends Ui {
  readonly finishRecording: () => Effect.Effect<string, OperationError>
}

export interface Transform {
  <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E>
}

/** Applies one Effect transformation to every operation without changing the UI interface. */
export const transform = (ui: Ui, apply: Transform): Ui => ({
  state: () => apply(ui.state()),
  snapshot: () => apply(ui.snapshot()),
  capture: () => apply(ui.capture()),
  matches: (text) => apply(ui.matches(text)),
  screenshot: (name) => apply(ui.screenshot(name)),
  type: (text) => apply(ui.type(text)),
  press: (key, modifiers) => apply(ui.press(key, modifiers)),
  enter: () => apply(ui.enter()),
  arrow: (direction) => apply(ui.arrow(direction)),
  focus: (target) => apply(ui.focus(target)),
  click: (target, position) => apply(ui.click(target, position)),
  resize: (viewport) => apply(ui.resize(viewport)),
  submit: (text) => apply(ui.submit(text)),
  waitFor: (target, options) => apply(ui.waitFor(target, options)),
  getElement: (target, options) => apply(ui.getElement(target, options)),
  getNode: (target, options) => apply(ui.getNode(target, options)),
})

export const make = (connection: UiConnection, options?: Options): Control => {
  const requestTimeout = RequestTimeout.make(options?.requestTimeout ?? 30_000)
  const evidenceTimeout = Math.min(requestTimeout, 1_000)
  const { rpc } = connection
  const call = <A, E>(
    operation: string,
    effect: Effect.Effect<A, E>,
  ): Effect.Effect<A, E | UiTimeoutError> =>
    Effect.timeoutOrElse(effect, {
      duration: requestTimeout,
      orElse: () =>
        Effect.fail(
          new UiTimeoutError({
            operation,
            milliseconds: requestTimeout,
            message: `ui.${operation} timed out after ${requestTimeout}ms`,
          }),
        ),
    })

  const state = Effect.fn("Ui.state")(() => call("state", rpc["ui.state"]()))
  const snapshot = Effect.fn("Ui.snapshot")(function* () {
    if (
      !supportsCapability(connection.compatibility, "ui.snapshot")
    )
      return yield* Effect.fail(
        new UiCapabilityError({
          capability: "ui.snapshot",
          message: "ui.snapshot is not available on this OpenCode endpoint",
        }),
      )
    return yield* call("snapshot", rpc["ui.snapshot"]())
  })
  const capture = Effect.fn("Ui.capture")(() =>
    call("capture", rpc["ui.capture"]()),
  )
  const matches = Effect.fn("Ui.matches")((text: string) =>
    call("matches", rpc["ui.matches"]({ text })),
  )
  const screenshot = Effect.fn("Ui.screenshot")((name?: string) =>
    call(
      "screenshot",
      rpc["ui.screenshot"](name === undefined ? undefined : { name }),
    ),
  )
  const finishRecording = Effect.fn("Ui.finishRecording")(() =>
    call("finishRecording", rpc["ui.recording.finish"]()),
  )
  const type = Effect.fn("Ui.type")((text: string) =>
    call("type", rpc["ui.type"]({ text })),
  )
  const press = Effect.fn("Ui.press")(
    (key: string, modifiers?: Frontend.KeyModifiers) =>
      call("press", rpc["ui.press"](Frontend.pressParams(key, modifiers))),
  )
  const enter = Effect.fn("Ui.enter")(() => call("enter", rpc["ui.enter"]()))
  const arrow = Effect.fn("Ui.arrow")(
    (direction: Frontend.ArrowParams["direction"]) =>
      call("arrow", rpc["ui.arrow"]({ direction })),
  )
  const focus = Effect.fn("Ui.focus")((target: number | Frontend.Element) =>
    call(
      "focus",
      rpc["ui.focus"]({
        target: typeof target === "number" ? target : target.num,
      }),
    ),
  )
  const resize = Effect.fn("Ui.resize")((viewport: Frontend.ResizeParams) =>
    call("resize", rpc["ui.resize"](viewport)),
  )
  const submit = Effect.fn("Ui.submit")(function* (text: string) {
    yield* type(text)
    return yield* enter()
  })

  const pollingTimeout = (
    operation: string,
    milliseconds: number,
    message: string,
  ) =>
    rpc["ui.capture"]().pipe(
      Effect.timeoutOrElse({
        duration: evidenceTimeout,
        orElse: () => Effect.succeed(undefined),
      }),
      Effect.catchCause(() => Effect.succeed(undefined)),
      Effect.flatMap((frame) =>
        Effect.fail(
          new UiTimeoutError({
            operation,
            milliseconds,
            message,
            ...(frame === undefined ? {} : { frame }),
          }),
        ),
      ),
    )

  const poll = <A, E>(
    operation: string,
    read: Effect.Effect<A | undefined, E>,
    options: WaitOptions | undefined,
    message: string,
  ): Effect.Effect<A, E | WaitError> => {
    const timeout = options?.timeout ?? 5_000
    const interval = options?.interval ?? 50
    const validate = Effect.gen(function* () {
      if (!Number.isFinite(timeout) || timeout < 0) {
        yield* Effect.fail(
          new UiWaitOptionsError({
            field: "timeout",
            value: timeout,
            message: "ui wait timeout must be a finite non-negative number",
          }),
        )
      }
      if (!Number.isFinite(interval) || interval <= 0) {
        yield* Effect.fail(
          new UiWaitOptionsError({
            field: "interval",
            value: interval,
            message: "ui wait interval must be a finite positive number",
          }),
        )
      }
    })
    return Effect.gen(function* () {
      yield* validate
      return yield* Effect.repeat(read, {
        until: (value): value is A => value !== undefined,
        schedule: Schedule.spaced(interval),
      }).pipe(
        Effect.timeoutOrElse({
          duration: timeout,
          orElse: () => pollingTimeout(operation, timeout, message),
        }),
      )
    })
  }

  const waitFor = Effect.fn("Ui.waitFor")(
    <E>(
      target: string | Predicate | EffectPredicate<E>,
      options?: WaitOptions,
    ) =>
      poll(
        "waitFor",
        typeof target === "string"
          ? Effect.gen(function* () {
              if (!(yield* matches(target))) return undefined
              return yield* state()
            })
          : Effect.flatMap(state(), (value) =>
              predicateEffect(target, value).pipe(
                Effect.map((matches) => matches ? value : undefined),
              ),
            ),
        options,
        typeof target === "string"
          ? `timed out waiting for the UI to match ${JSON.stringify(target)}`
          : "timed out waiting for the UI to match",
      ),
  )

  const getElement = Effect.fn("Ui.getElement")(
    (target: number | string | ElementQuery, options?: WaitOptions) =>
      poll(
        "getElement",
        Effect.flatMap(state(), (value) => {
          const elements = value.elements.filter((element) =>
            typeof target === "number"
              ? element.num === target
              : typeof target === "string"
                ? element.id === target
                : matchesQuery(element, target),
          )
          if (elements.length > 1)
            return Effect.fail(
              new UiElementAmbiguousError({ count: elements.length }),
            )
          return Effect.succeed(elements[0])
        }),
        options,
        "timed out waiting for the UI element",
      ),
  )

  const getNode = Effect.fn("Ui.getNode")(
    (target: string | SemanticQuery, options?: WaitOptions) =>
      poll(
        "getNode",
        Effect.flatMap(snapshot(), (value) => {
          const nodes = value.nodes.filter((node) =>
            typeof target === "string"
              ? node.id === target
              : matchesQuery(node, target),
          )
          if (nodes.length > 1)
            return Effect.fail(
              new UiNodeAmbiguousError({ count: nodes.length }),
            )
          return Effect.succeed(nodes[0])
        }),
        options,
        "timed out waiting for the semantic UI node",
      ),
  )

  const click = Effect.fn("Ui.click")(function* (
    target: number | Frontend.Element | Frontend.SemanticNode,
    position?: Position,
  ) {
    if (typeof target !== "number" && "element" in target) {
      if (!supportsCapability(connection.compatibility, "ui.click.semantic"))
        return yield* Effect.fail(
          new UiCapabilityError({
            capability: "ui.click.semantic",
            message: "semantic ui.click is not available on this OpenCode endpoint",
          }),
        )
      const element = position === undefined
        ? (yield* state()).elements.find((candidate) => candidate.num === target.element)
        : undefined
      return yield* call(
        "click",
        rpc["ui.click"]({
          target: target.element,
          x: position?.x ?? (element === undefined ? 0 : Math.floor(element.width / 2)),
          y: position?.y ?? (element === undefined ? 0 : Math.floor(element.height / 2)),
          semantic: {
            id: target.id,
            ...(target.instance === undefined ? {} : { instance: target.instance }),
            element: target.element,
          },
        }),
      )
    }
    const element =
      typeof target === "number"
        ? yield* getElement(target)
        : target
    return yield* call(
      "click",
      rpc["ui.click"]({
        target: element.num,
        x: position?.x ?? Math.floor(element.width / 2),
        y: position?.y ?? Math.floor(element.height / 2),
      }),
    )
  })

  return {
    state,
    snapshot,
    capture,
    matches,
    screenshot,
    finishRecording,
    type,
    press,
    enter,
    arrow,
    focus,
    click,
    resize,
    submit,
    waitFor,
    getElement,
    getNode,
  }
}

function predicateEffect<E>(
  predicate: Predicate | EffectPredicate<E>,
  state: Frontend.State,
): Effect.Effect<boolean, E | UiPredicateError> {
  return Effect.gen(function* () {
    const result = yield* Effect.try({
      try: () => predicate(state),
      catch: (cause) =>
        new UiPredicateError({
          cause,
          message: `ui.waitFor predicate failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    })
    const value: unknown = Effect.isEffect(result) ? yield* result : result
    if (typeof value === "boolean") return value
    return yield* Effect.fail(
      new UiPredicateError({
        cause: value,
        message: "ui.waitFor predicate must return a boolean or Effect",
      }),
    )
  })
}

function matchesQuery<Value extends object>(value: Value, query: Partial<Value>) {
  return Object.entries(query).every(
    ([key, expected]) => expected === undefined || Reflect.get(value, key) === expected,
  )
}

export * as OpenCodeUi from "./ui.js"
