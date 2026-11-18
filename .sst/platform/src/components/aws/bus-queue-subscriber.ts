import { ComponentResourceOptions, Input, output } from "@pulumi/pulumi";
import { Component, transform } from "../component";
import { BusBaseSubscriberArgs, createRule } from "./bus-base-subscriber";
import { cloudwatch, sqs } from "@pulumi/aws";
import { Queue } from "./queue";

export interface Args extends BusBaseSubscriberArgs {
  /**
   * The ARN of the SQS Queue.
   */
  queue: Input<string | Queue>;
}

/**
 * The `BusQueueSubscriber` component is internally used by the `Bus` component
 * to add subscriptions to [Amazon EventBridge Event Bus](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-bus.html).
 *
 * :::note
 * This component is not intended to be created directly.
 * :::
 *
 * You'll find this component returned by the `subscribeQueue` method of the `Bus` component.
 */
export class BusQueueSubscriber extends Component {
  private readonly policy: sqs.QueuePolicy;
  private readonly rule: cloudwatch.EventRule;
  private readonly target: cloudwatch.EventTarget;

  constructor(name: string, args: Args, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);

    const self = this;
    const bus = output(args.bus);
    const queueArn = output(args.queue).apply((queue) =>
      queue instanceof Queue ? queue.arn : output(queue),
    );
    const policy = createPolicy();
    const rule = createRule(name, bus.name, args, self);
    const target = createTarget();

    this.policy = policy;
    this.rule = rule;
    this.target = target;

    function createPolicy() {
      return Queue.createPolicy(`${name}Policy`, queueArn, { parent: self });
    }

    function createTarget() {
      return new cloudwatch.EventTarget(
        ...transform(
          args?.transform?.target,
          `${name}Target`,
          {
            arn: queueArn,
            rule: rule.name,
            eventBusName: bus.name,
          },
          { parent: self },
        ),
      );
    }
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The SQS Queue policy.
       */
      policy: this.policy,
      /**
       * The EventBus rule.
       */
      rule: this.rule,
      /**
       * The EventBus target.
       */
      target: this.target,
    };
  }
}

const __pulumiType = "sst:aws:BusQueueSubscriber";
// @ts-expect-error
BusQueueSubscriber.__pulumiType = __pulumiType;
