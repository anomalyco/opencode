import {
  ComponentResourceOptions,
  Input,
  jsonStringify,
  output,
} from "@pulumi/pulumi";
import { Component, transform } from "../component";
import { SnsTopicSubscriberArgs } from "./sns-topic";
import { sns, sqs } from "@pulumi/aws";
import { Queue } from "./queue";

export interface Args extends SnsTopicSubscriberArgs {
  /**
   * The SNS Topic to use.
   */
  topic: Input<{
    /**
     * The ARN of the SNS Topic.
     */
    arn: Input<string>;
  }>;
  /**
   * The ARN of the SQS Queue.
   */
  queue: Input<string | Queue>;
  /**
   * In early versions of SST, parent were forgotten to be set for resources in components.
   * This flag is used to disable the automatic setting of the parent to prevent breaking
   * changes.
   * @internal
   */
  disableParent?: boolean;
}

/**
 * The `SnsTopicQueueSubscriber` component is internally used by the `SnsTopic` component
 * to add subscriptions to your [Amazon SNS Topic](https://docs.aws.amazon.com/sns/latest/dg/sns-create-topic.html).
 *
 * :::note
 * This component is not intended to be created directly.
 * :::
 *
 * You'll find this component returned by the `subscribeQueue` method of the `SnsTopic` component.
 */
export class SnsTopicQueueSubscriber extends Component {
  private readonly policy: sqs.QueuePolicy;
  private readonly subscription: sns.TopicSubscription;

  constructor(name: string, args: Args, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);

    const self = this;
    const topic = output(args.topic);
    const queueArn = output(args.queue).apply((queue) =>
      queue instanceof Queue ? queue.arn : output(queue),
    );
    const policy = createPolicy();
    const subscription = createSubscription();

    this.policy = policy;
    this.subscription = subscription;

    function createPolicy() {
      return Queue.createPolicy(`${name}Policy`, queueArn, {
        parent: args.disableParent ? undefined : self,
      });
    }

    function createSubscription() {
      return new sns.TopicSubscription(
        ...transform(
          args?.transform?.subscription,
          `${name}Subscription`,
          {
            topic: topic.arn,
            protocol: "sqs",
            endpoint: queueArn,
            filterPolicy: args.filter && jsonStringify(args.filter),
          },
          { parent: args.disableParent ? undefined : self },
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
       * The SNS Topic subscription.
       */
      subscription: this.subscription,
    };
  }
}

const __pulumiType = "sst:aws:SnsTopicQueueSubscriber";
// @ts-expect-error
SnsTopicQueueSubscriber.__pulumiType = __pulumiType;
