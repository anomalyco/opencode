import { Input } from "../../input";
import { Nextable, State, StateArgs } from "./state";

export interface PassArgs extends StateArgs { }

/**
 * The `Pass` state is internally used by the `StepFunctions` component to add a [Pass
 * workflow state](https://docs.aws.amazon.com/step-functions/latest/dg/state-pass.html)
 * to a state machine.
 *
 * :::note
 * This component is not intended to be created directly.
 * :::
 *
 * You'll find this component returned by the `pass` method of the `StepFunctions` component.
 */
export class Pass extends State implements Nextable {
  constructor(protected args: PassArgs) {
    super(args);
  }

  /**
   * Add a next state to the `Pass` state. After this state completes, it'll
   * transition to the given `state`.
   *
   * @example
   *
   * ```ts title="sst.config.ts"
   * sst.aws.StepFunctions.pass({
   *   // ...
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
      Type: "Pass",
      ...super.toJSON(),
    };
  }
}
