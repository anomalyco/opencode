import { randomBytes } from "crypto";
import { Duration, toSeconds } from "../../duration";
import { Input } from "../../input";
import { FunctionPermissionArgs } from "../function";

export type JSONata = `{% ${string} %}`;

export function isJSONata(value: string) {
  return value.startsWith("{%") && value.endsWith("%}");
}

type DefaultError =
  | "States.ALL"
  | "States.DataLimitExceeded"
  | "States.ExceedToleratedFailureThreshold"
  | "States.HeartbeatTimeout"
  | "States.Http.Socket"
  | "States.IntrinsicFailure"
  | "States.ItemReaderFailed"
  | "States.NoChoiceMatched"
  | "States.ParameterPathFailure"
  | "States.Permissions"
  | "States.ResultPathMatchFailure"
  | "States.ResultWriterFailed"
  | "States.Runtime"
  | "States.TaskFailed"
  | "States.Timeout";

/**
 * @internal
 */
export interface Nextable {
  next: (state: State) => State;
}

/**
 * @internal
 */
export interface Failable {
  retry: (props?: RetryArgs) => State;
  catch: (state: State, props?: CatchArgs) => State;
}

export interface RetryArgs {
  /**
   * A list of errors that are being retried. By default, this retries all errors.
   *
   * @default `["States.ALL"]`
   */
  errors?: string[];
  /**
   * The amount of time to wait before the first retry attempt. The maximum value is
   * `99999999 seconds`.
   *
   * Following attempts will retry based on the `backoffRate` multiplier.
   *
   * @default `"1 second"`
   */
  interval?: Duration;
  /**
   * The maximum number of retries before it falls back to the normal error handling.
   *
   * A value of `0` means the error won't be retried. The maximum value is
   * `99999999`.
   *
   * @default `3`
   */
  maxAttempts?: number;
  /**
   * The backoff rate. This is a multiplier that increases the interval between
   * retries.
   *
   * For example, if the interval is `1 second` and the backoff rate is `2`, the
   * first retry will happen after `1 second`, and the second retry will happen
   * after `2 * 1 second = 2 seconds`.
   *
   * @default `2`
   */
  backoffRate?: number;
}

export interface CatchArgs {
  /**
   * A list of errors that are being caught. By default, this catches all errors.
   *
   * @default `["States.ALL"]`
   */
  errors?: string[];
}

export interface StateArgs {
  /**
   * The name of the state. This needs to be unique within the state machine.
   */
  name: string;
  /**
   * Optionally add a comment that describes the state.
   * @internal
   */
  comment?: Input<string>;
  /**
   * Transform the output of the state. When specified, the value overrides the
   * default output from the state.
   *
   * This takes any JSON value; object, array, string, number, boolean, null.
   *
   * ```ts
   * {
   *   output: {
   *     charged: true
   *   }
   * }
   * ```
   *
   * Or, you can pass in a JSONata expression.
   *
   * ```ts
   * {
   *   output: {
   *     product: "{% $states.input.product %}"
   *   }
   * }
   * ```
   *
   * Learn more about [transforming data with JSONata](https://docs.aws.amazon.com/step-functions/latest/dg/transforming-data.html).
   */
  output?: Input<JSONata | Record<string, any>>;
  /**
   * Store variables that can be accessed by any state later in the workflow,
   * instead of passing it through each state.
   *
   * This takes a set of key/value pairs. Where the key is the name of the variable
   * that can be accessed by any subsequent state.
   *
   * @example
   *
   * The value can be any JSON value; object, array, string, number, boolean, null.
   *
   * ```ts
   * {
   *   assign: {
   *     productName: "product1",
   *     count: 42,
   *     available: true
   *   }
   * }
   * ```
   *
   * Or, you can pass in a JSONata expression.
   *
   * ```ts
   * {
   *   assign: {
   *     product: "{% $states.input.order.product %}",
   *     currentPrice: "{% $states.result.Payload.current_price %}"
   *   }
   * }
   * ```
   *
   * Learn more about [passing data between states with variables](https://docs.aws.amazon.com/step-functions/latest/dg/workflow-variables.html).
   */
  assign?: Record<string, any>;
}

/**
 * The `State` class is the base class for all states in `StepFunctions` state
 * machine.
 *
 * :::note
 * This component is not intended to be created directly.
 * :::
 *
 * This is used for reference only.
 */
export abstract class State {
  protected _parentGraphState?: State; // only used for Parallel, Map
  protected _childGraphStates: State[] = []; // only used for Parallel, Map
  protected _prevState?: State;
  protected _nextState?: State;
  protected _retries?: RetryArgs[];
  protected _catches?: { next: State; props: CatchArgs }[];

  constructor(protected args: StateArgs) {}

  protected addChildGraph<T extends State>(state: T): T {
    if (state._parentGraphState)
      throw new Error(
        `Cannot reuse the "${state.name}" state. States cannot be reused in Map or Parallel branches.`,
      );

    this._childGraphStates.push(state);
    state._parentGraphState = this;
    return state;
  }

  protected addNext<T extends State>(state: T): T {
    if (this._nextState)
      throw new Error(
        `The "${this.name}" state already has a next state. States cannot have multiple next states.`,
      );

    this._nextState = state;
    state._prevState = this;
    return state;
  }

  protected addRetry(args?: RetryArgs) {
    this._retries = this._retries || [];
    this._retries.push({
      errors: ["States.ALL"],
      backoffRate: 2,
      interval: "1 second",
      maxAttempts: 3,
      ...args,
    });
    return this;
  }

  protected addCatch(state: State, args: CatchArgs = {}) {
    this._catches = this._catches || [];
    this._catches.push({
      next: state.getHead(),
      props: {
        errors: args.errors ?? ["States.ALL"],
      },
    });
    return this;
  }

  /**
   * @internal
   */
  public get name() {
    return this.args.name;
  }

  /**
   * @internal
   */
  public getRoot(): State {
    return (
      this._prevState?.getRoot() ?? this._parentGraphState?.getRoot() ?? this
    );
  }

  /**
   * @internal
   */
  public getHead(): State {
    return this._prevState?.getHead() ?? this;
  }

  /**
   * Assert that the state name is unique.
   * @internal
   */
  public assertStateNameUnique(states: Map<string, State> = new Map()) {
    const existing = states.get(this.name);
    if (existing && existing !== this)
      throw new Error(
        `Multiple states with the same name "${this.name}". State names must be unique.`,
      );

    states.set(this.name, this);

    this._nextState?.assertStateNameUnique(states);
    this._catches?.forEach((c) => c.next.assertStateNameUnique(states));
    this._childGraphStates.forEach((c) => c.assertStateNameUnique(states));
  }

  /**
   * Assert that the state is not reused.
   * @internal
   */
  public assertStateNotReused(
    states: Map<State, string> = new Map(),
    graphId: string = "main",
  ) {
    const existing = states.get(this);
    if (existing && existing !== graphId)
      throw new Error(
        `Cannot reuse the "${this.name}" state. States cannot be reused in Map or Parallel branches.`,
      );

    states.set(this, graphId);

    this._nextState?.assertStateNotReused(states, graphId);
    this._catches?.forEach((c) => c.next.assertStateNotReused(states, graphId));
    this._childGraphStates.forEach((c) => {
      const childGraphId = randomBytes(16).toString("hex");
      c.assertStateNotReused(states, childGraphId);
    });
  }

  /**
   * Get the permissions required for the state.
   * @internal
   */
  public getPermissions(): FunctionPermissionArgs[] {
    return [
      ...(this._nextState?.getPermissions() || []),
      ...(this._catches || []).flatMap((c) => c.next.getPermissions()),
    ];
  }

  /**
   * Serialize the state into JSON state definition.
   * @internal
   */
  public serialize(): Record<string, any> {
    return {
      [this.name]: this.toJSON(),
      ...this._nextState?.serialize(),
      ...this._catches?.reduce(
        (acc, c) => ({ ...acc, ...c.next.serialize() }),
        {},
      ),
    };
  }

  protected toJSON(): Record<string, any> {
    return {
      QueryLanguage: "JSONata",
      Comment: this.args.comment,
      Output: this.args.output,
      Assign: this.args.assign,
      ...(this._nextState ? { Next: this._nextState.name } : { End: true }),
      Retry: this._retries?.map((r) => ({
        ErrorEquals: r.errors,
        IntervalSeconds: toSeconds(r.interval!),
        MaxAttempts: r.maxAttempts,
        BackoffRate: r.backoffRate,
      })),
      Catch: this._catches?.map((c) => ({
        ErrorEquals: c.props.errors,
        Next: c.next.name,
      })),
    };
  }
}
