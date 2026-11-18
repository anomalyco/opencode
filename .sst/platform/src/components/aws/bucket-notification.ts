import {
  ComponentResourceOptions,
  Input,
  Output,
  output,
} from "@pulumi/pulumi";
import { Component, transform } from "../component";
import { BucketNotificationsArgs } from "./bucket";
import { iam, lambda, s3, sns } from "@pulumi/aws";
import { FunctionBuilder, functionBuilder } from "./helpers/function-builder";
import { VisibleError } from "../error";
import { SnsTopic } from "./sns-topic";
import { Queue } from "./queue";

export interface Args extends BucketNotificationsArgs {
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
}

/**
 * The `BucketNotification` component is internally used by the `Bucket` component to
 * add bucket notifications to [AWS S3 Bucket](https://aws.amazon.com/s3/).
 *
 * :::note
 * This component is not intended to be created directly.
 * :::
 *
 * You'll find this component returned by the `notify` method of the `Bucket` component.
 */
export class BucketNotification extends Component {
  private readonly functionBuilders: Output<FunctionBuilder[]>;
  private readonly notification: s3.BucketNotification;

  constructor(name: string, args: Args, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);

    const self = this;
    const bucket = output(args.bucket);
    const notifications = normalizeNotifications();
    const { config, functionBuilders } = createNotificationsConfig();
    const notification = createNotification();

    this.functionBuilders = functionBuilders;
    this.notification = notification;

    function normalizeNotifications() {
      return output(args.notifications).apply((notifications) =>
        notifications.map((n) => {
          const count =
            (n.function ? 1 : 0) + (n.queue ? 1 : 0) + (n.topic ? 1 : 0);
          if (count === 0)
            throw new VisibleError(
              `At least one of function, queue, or topic is required for the "${n.name}" bucket notification.`,
            );
          if (count > 1)
            throw new VisibleError(
              `Only one of function, queue, or topic is allowed for the "${n.name}" bucket notification.`,
            );

          return {
            ...n,
            events: n.events ?? [
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
            ],
          };
        }),
      );
    }

    function createNotificationsConfig() {
      return notifications.apply((notifications) => {
        const config = notifications.map((n) => {
          if (n.function) {
            const fn = functionBuilder(
              `${name}Notification${n.name}`,
              n.function,
              {
                description:
                  n.events.length < 5
                    ? `Notified by ${name} on ${n.events.join(", ")}`
                    : `Notified by ${name} on ${n.events
                        .slice(0, 3)
                        .join(", ")}, and ${n.events.length - 3} more events`,
              },
              undefined,
              { parent: self },
            );

            const permission = new lambda.Permission(
              `${name}Notification${n.name}Permission`,
              {
                action: "lambda:InvokeFunction",
                function: fn.arn,
                principal: "s3.amazonaws.com",
                sourceArn: bucket.arn,
              },
              { parent: self },
            );
            return { args: n, functionBuilder: fn, dependsOn: permission };
          }

          if (n.topic) {
            const arn =
              n.topic instanceof SnsTopic ? n.topic.arn : output(n.topic);
            const policy = new sns.TopicPolicy(
              `${name}Notification${n.name}Policy`,
              {
                arn,
                policy: iam.getPolicyDocumentOutput({
                  statements: [
                    {
                      actions: ["sns:Publish"],
                      resources: [arn],
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
              },
              { parent: self },
            );
            return { args: n, topicArn: arn, dependsOn: policy };
          }

          if (n.queue) {
            const arn =
              n.queue instanceof Queue ? n.queue.arn : output(n.queue);
            const policy = Queue.createPolicy(
              `${name}Notification${n.name}Policy`,
              arn,
              { parent: self },
            );
            return { args: n, queueArn: arn, dependsOn: policy };
          }
        });
        return {
          config,
          functionBuilders: config
            .filter((c) => c!.functionBuilder)
            .map((c) => c!.functionBuilder!),
        };
      });
    }

    function createNotification() {
      return new s3.BucketNotification(
        ...transform(
          args.transform?.notification,
          `${name}Notification`,
          {
            bucket: bucket.name,
            lambdaFunctions: config.apply((config) =>
              config
                .filter((c) => c!.functionBuilder)
                .map((c) => ({
                  id: c!.args.name,
                  lambdaFunctionArn: c!.functionBuilder!.arn,
                  events: c!.args.events,
                  filterPrefix: c!.args.filterPrefix,
                  filterSuffix: c!.args.filterSuffix,
                })),
            ),
            queues: config.apply((config) =>
              config
                .filter((c) => c!.queueArn)
                .map((c) => ({
                  id: c!.args.name,
                  queueArn: c!.queueArn!,
                  events: c!.args.events,
                  filterPrefix: c!.args.filterPrefix,
                  filterSuffix: c!.args.filterSuffix,
                })),
            ),
            topics: config.apply((config) =>
              config
                .filter((c) => c!.topicArn)
                .map((c) => ({
                  id: c!.args.name,
                  topicArn: c!.topicArn!,
                  events: c!.args.events,
                  filterPrefix: c!.args.filterPrefix,
                  filterSuffix: c!.args.filterSuffix,
                })),
            ),
          },
          {
            parent: self,
            dependsOn: config.apply((config) =>
              config.map((c) => c!.dependsOn),
            ),
          },
        ),
      );
    }
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    const self = this;
    return {
      /**
       * The functions that will be notified.
       */
      get functions() {
        return output(self.functionBuilders).apply((functionBuilders) =>
          functionBuilders.map((builder) => builder.getFunction()),
        );
      },
      /**
       * The notification resource that's created.
       */
      notification: this.notification,
    };
  }
}

const __pulumiType = "sst:aws:BucketNotification";
// @ts-expect-error
BucketNotification.__pulumiType = __pulumiType;
