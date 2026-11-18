import { output } from "@pulumi/pulumi";
import { Duration, toSeconds } from "../../duration";
import { Input } from "../../input";
import { isJSONata, JSONata, Nextable, State, StateArgs } from "./state";

export interface WaitArgs extends StateArgs {
  /**
   * Specify the amount of time to wait before starting the next state.
   * @example
   *
   * ```ts
   * {
   *   time: "10 seconds"
   * }
   * ```
   *
   * Alternatively, you can specify a JSONata expression that evaluates to a number
   * in seconds.
   *
   * ```ts
   * {
   *   time: "{% $states.input.wait_time %}"
   * }
   * ```
   *
   * Here `wait_time` is a number in seconds.
   */
  time?: Input<JSONata | Duration>;
  /**
   * A timestamp to wait till.
   *
   * Timestamps must conform to the RFC3339 profile of ISO 8601 and it needs:
   *
   * 1. An uppercase T as a delimiter between the date and time.
   * 2. An uppercase Z to denote that a time zone offset is not present.
   *
   * @example
   * ```ts
   * {
   *   timestamp: "2026-01-01T00:00:00Z"
   * }
   * ```
   *
   * Alternatively, you can use a JSONata expression to evaluate to a timestamp that
   * conforms to the above format.
   *
   * ```ts
   * {
   *   timestamp: "{% $states.input.timestamp %}"
   * }
   * ```
   */
  timestamp?: Input<string>;
}

/**
 * The `Wait` state is internally used by the `StepFunctions` component to add a [Wait
 * workflow state](https://docs.aws.amazon.com/step-functions/latest/dg/state-wait.html)
 * to a state machine.
 *
 * :::note
 * This component is not intended to be created directly.
 * :::
 *
 * You'll find this component returned by the `wait` method of the `StepFunctions` component.
 */
export class Wait extends State implements Nextable {
  constructor(protected args: WaitArgs) {
    super(args);
  }

  /**
   * Add a next state to the `Wait` state. After the wait completes, it'll transition
   * to the given `state`.
   *
   * @example
   *
   * ```ts title="sst.config.ts"
   * sst.aws.StepFunctions.wait({
   *   name: "Wait",
   *   time: "10 seconds"
   * })
   * .next(state);
   * ```
   */
  public next<T extends State>(state: T): T {
    return this.addNext(state);
  }

  /**
   * Serialize the state into JSON state definition.
   */
  protected toJSON() {
    return {
      Type: "Wait",
      Seconds: this.args.time
        ? output(this.args.time).apply((t) =>
          isJSONata(t) ? t : toSeconds(t as Duration),
        )
        : undefined,
      Timestamp: this.args.timestamp,
      ...super.toJSON(),
    };
  }
}
