import {
  ComponentResourceOptions,
  Input,
  interpolate,
  output,
} from "@pulumi/pulumi";
import { Component, transform } from "../component";
import { BucketSubscriberArgs } from "./bucket";
import { iam, s3, sns } from "@pulumi/aws";

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
   * The ARN of the SNS Topic.
   */
  topic: Input<string>;
}

/**
 * The `BucketTopicSubscriber` component is internally used by the `Bucket` component
 * to add subscriptions to your [AWS S3 Bucket](https://aws.amazon.com/s3/).
 *
 * :::note
 * This component is not intended to be created directly.
 * :::
 *
 * You'll find this component returned by the `subscribeTopic` method of the `Bucket` component.
 */
export class BucketTopicSubscriber extends Component {
  private readonly policy: sns.TopicPolicy;
  private readonly notification: s3.BucketNotification;

  constructor(name: string, args: Args, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);

    const self = this;
    const topicArn = output(args.topic);
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
      return new sns.TopicPolicy(`${name}Policy`, {
        arn: topicArn,
        policy: iam.getPolicyDocumentOutput({
          statements: [
            {
              actions: ["sns:Publish"],
              resources: [topicArn],
              principals: [
                {
                  type: "Service",
                  identifiers: ["s3.amazonaws.com"],
                },
              ],
              conditions: [
                {
                  test: "ArnEquals",
                  variable: "aws:SourceArn",
                  values: [bucket.arn],
                },
              ],
            },
          ],
        }).json,
      });
    }

    function createNotification() {
      return new s3.BucketNotification(
        ...transform(
          args.transform?.notification,
          `${name}Notification`,
          {
            bucket: bucket.name,
            topics: [
              {
                id: interpolate`Notification${args.subscriberId}`,
                topicArn,
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
       * The SNS Topic policy.
       */
      policy: this.policy,
      /**
       * The S3 Bucket notification.
       */
      notification: this.notification,
    };
  }
}

const __pulumiType = "sst:aws:BucketTopicSubscriber";
// @ts-expect-error
BucketTopicSubscriber.__pulumiType = __pulumiType;
