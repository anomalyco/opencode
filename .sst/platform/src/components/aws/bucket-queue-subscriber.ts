import {
  ComponentResourceOptions,
  Input,
  interpolate,
  output,
} from "@pulumi/pulumi";
import { Component, transform } from "../component";
import { BucketSubscriberArgs } from "./bucket";
import { s3, sqs } from "@pulumi/aws";
import { Queue } from "./queue";

export interface Args extends BucketSubscriberArgs {
  /**
   * The bucket to use.
   */
  bucket: Input<{
    /**
     * The name of the bucket.
     */
    name: Input<string>;
    /**
     * The ARN of the bucket.
     */
    arn: Input<string>;
  }>;
  /**
   * The subscriber ID.
   */
  subscriberId: Input<string>;
  /**
   * The ARN of the SQS Queue.
   */
  queue: Input<string>;
}

/**
 * The `BucketQueueSubscriber` component is internally used by the `Bucket` component
 * to add subscriptions to your [AWS S3 Bucket](https://aws.amazon.com/s3/).
 *
 * :::note
 * This component is not intended to be created directly.
 * :::
 *
 * You'll find this component returned by the `subscribeQueue` method of the `Bucket` component.
 */
export class BucketQueueSubscriber extends Component {
  private readonly policy: sqs.QueuePolicy;
  private readonly notification: s3.BucketNotification;

  constructor(name: string, args: Args, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);

    const self = this;
    const queueArn = output(args.queue);
    const bucket = output(args.bucket);
    const events = args.events
      ? output(args.events)
      : output([
          "s3:ObjectCreated:*",
          "s3:ObjectRemoved:*",
          "s3:ObjectRestore:*",
          "s3:ReducedRedundancyLostObject",
          "s3:Replication:*",
          "s3:LifecycleExpiration:*",
          "s3:LifecycleTransition",
          "s3:IntelligentTiering",
          "s3:ObjectTagging:*",
          "s3:ObjectAcl:Put",
        ]);
    const policy = createPolicy();
    const notification = createNotification();

    this.policy = policy;
    this.notification = notification;

    function createPolicy() {
      return Queue.createPolicy(`${name}Policy`, queueArn);
    }

    function createNotification() {
      return new s3.BucketNotification(
        ...transform(
          args.transform?.notification,
          `${name}Notification`,
          {
            bucket: bucket.name,
            queues: [
              {
                id: interpolate`Notification${args.subscriberId}`,
                queueArn,
                events,
                filterPrefix: args.filterPrefix,
                filterSuffix: args.filterSuffix,
              },
            ],
          },
          { parent: self, dependsOn: [policy] },
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
       * The S3 Bucket notification.
       */
      notification: this.notification,
    };
  }
}

const __pulumiType = "sst:aws:BucketQueueSubscriber";
// @ts-expect-error
BucketQueueSubscriber.__pulumiType = __pulumiType;
