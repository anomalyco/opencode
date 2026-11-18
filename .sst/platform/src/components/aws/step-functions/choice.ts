import { isJSONata, JSONata, State, StateArgs } from "./state";

export interface ChoiceArgs extends StateArgs { }

/**
 * The `Choice` state is internally used by the `StepFunctions` component to add a [Choice
 * workflow state](https://docs.aws.amazon.com/step-functions/latest/dg/state-choice.html)
 * to a state machine.
 *
 * :::note
 * This component is not intended to be created directly.
 * :::
 *
 * You'll find this component returned by the `choice` method of the `StepFunctions` component.
 */
export class Choice extends State {
  private choices: {
    condition: JSONata;
    next: State;
  }[] = [];
  private defaultNext?: State;

  constructor(protected args: ChoiceArgs) {
    super(args);
  }

  /**
   * Add a matching condition to the `Choice` state. If the given condition matches,
   * it'll continue execution to the given state.
   *
   * The condition needs to be a JSONata expression that evaluates to a boolean.
   *
   * @example
   *
   * ```ts
   * sst.aws.StepFunctions.choice({
   *   // ...
   * })
   * .when(
   *   "{% $states.input.status === 'unpaid' %}",
   *   state
   * );
   * ```
   *
   * @param condition The JSONata condition to evaluate.
   * @param next The state to transition to.
   */
  public when(condition: JSONata, next: State) {
    if (!isJSONata(condition))
      throw new Error("Condition must start with '{%' and end with '%}'.");

    this.choices.push({ condition, next });
    return this;
  }

  /**
   * Add a default next state to the `Choice` state. If no other condition matches,
   * continue execution with the given state.
   */
  public otherwise(next: State) {
    this.defaultNext = next;
    return this;
  }

  /**
   * @internal
   */
  public assertStateNameUnique(states: Map<string, State> = new Map()) {
    super.assertStateNameUnique(states);
    this.choices.forEach((c) => c.next.assertStateNameUnique(states));
    this.defaultNext?.assertStateNameUnique(states);
  }

  /**
   * @internal
   */
  public assertStateNotReused(
    states: Map<State, string> = new Map(),
    graphId: string = "main",
  ) {
    super.assertStateNotReused(states, graphId);
    this.choices.forEach((c) => c.next.assertStateNotReused(states, graphId));
    this.defaultNext?.assertStateNotReused(states, graphId);
  }

  /**
   * @internal
   */
  public getPermissions() {
    return [
      ...this.choices.flatMap((c) => c.next.getPermissions()),
      ...(this.defaultNext?.getPermissions() || []),
      ...super.getPermissions(),
    ];
  }

  /**
   * @internal
   */
  public serialize() {
    return {
      ...super.serialize(),
      ...this.defaultNext?.serialize(),
      ...this.choices.reduce(
        (acc, c) => ({ ...acc, ...c.next.serialize() }),
        {},
      ),
    };
  }

  protected toJSON() {
    return {
      Type: "Choice",
      Choices: this.choices.map((c) => ({
        Condition: c.condition,
        Next: c.next.name,
      })),
      Default: this.defaultNext?.name,
      ...super.toJSON(),
      End: undefined,
    };
  }
}
