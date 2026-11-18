import { Input } from "../../input";
import {
  CatchArgs,
  Failable,
  Nextable,
  RetryArgs,
  State,
  StateArgs,
} from "./state";

export interface ParallelArgs extends StateArgs {
  /**
   * The arguments to be passed to the APIs of the connected resources. Values can
   * include outputs from other resources and JSONata expressions.
   *
   * @example
   *
   * ```ts
   * {
   *   arguments: {
   *     product: "{% $states.input.order.product %}",
   *     url: api.url,
   *     count: 32
   *   }
   * }
   * ```
   */
  arguments?: Input<Record<string, Input<any>>>;
}

/**
 * The `Parallel` state is internally used by the `StepFunctions` component to add a [Parallel
 * workflow state](https://docs.aws.amazon.com/step-functions/latest/dg/state-parallel.html)
 * to a state machine.
 *
 * :::note
 * This component is not intended to be created directly.
 * :::
 *
 * You'll find this component returned by the `parallel` method of the `StepFunctions` component.
 */
export class Parallel extends State implements Nextable, Failable {
  private branches: State[] = [];

  constructor(protected args: ParallelArgs) {
    super(args);
  }

  /**
   * Add a branch state to the `Parallel` state. Each branch runs concurrently.
   *
   * @param branch The state to add as a branch.
   *
   * @example
   *
   * ```ts title="sst.config.ts"
   * const parallel = sst.aws.StepFunctions.parallel({ name: "Parallel" });
   * 
   * parallel.branch(processorA);
   * parallel.branch(processorB);
   * ```
   */
  public branch(branch: State) {
    const head = branch.getHead();
    this.branches.push(head);
    this.addChildGraph(head);
    return this;
  }

  /**
   * Add a next state to the `Parallel` state. If all branches complete successfully,
   * this'll continue execution to the given `state`.
   *
   * @param state The state to transition to.
   *
   * @example
   *
   * ```ts title="sst.config.ts"
   * sst.aws.StepFunctions.parallel({
   *   // ...
   * })
   * .next(state);
   * ```
   */
  public next<T extends State>(state: T): T {
    return this.addNext(state);
  }

  /**
   * Add a retry behavior to the `Parallel` state. If the state fails with any of the
   * specified errors, retry execution using the specified parameters.
   *
   * @param args Properties to define the retry behavior.
   *
   * @example
   *
   * This defaults to.
   *
   * ```ts title="sst.config.ts" {5-8}
   * sst.aws.StepFunctions.parallel({
   *   // ...
   * })
   * .retry({
   *   errors: ["States.ALL"],
   *   interval: "1 second",
   *   maxAttempts: 3,
   *   backoffRate: 2
   * });
   * ```
   */
  public retry(args?: RetryArgs) {
    return this.addRetry(args);
  }

  /**
   * Add a catch behavior to the `Parallel` state. So if the state fails with any
   * of the specified errors, it'll continue execution to the given `state`.
   *
   * @param state The state to transition to on error.
   * @param args Properties to customize error handling.
   *
   * @example
   *
   * This defaults to.
   *
   * ```ts title="sst.config.ts" {5}
   * sst.aws.StepFunctions.parallel({
   *   // ...
   * })
   * .catch({
   *   errors: ["States.ALL"]
   * });
   * ```
   */
  public catch(state: State, args: CatchArgs = {}) {
    return this.addCatch(state, args);
  }

  /**
   * @internal
   */
  public getPermissions() {
    return [
      ...this.branches.flatMap((b) => b.getPermissions()),
      ...super.getPermissions(),
    ];
  }

  /**
   * Serialize the state into JSON state definition.
   */
  protected toJSON() {
    if (this.branches.length === 0) {
      throw new Error(
        `The "${this.name}" Parallel state must have at least one branch.`,
      );
    }

    return {
      Type: "Parallel",
      Branches: this.branches.map((b) => {
        return {
          StartAt: b.name,
          States: b.serialize(),
        };
      }),
      ...super.toJSON(),
    };
  }
}
