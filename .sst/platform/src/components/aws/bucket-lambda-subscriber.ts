import {
  ComponentResourceOptions,
  Input,
  Output,
  interpolate,
  output,
} from "@pulumi/pulumi";
import { Component, transform } from "../component";
import { Function, FunctionArgs } from "./function";
import { BucketSubscriberArgs } from "./bucket";
import { lambda, s3 } from "@pulumi/aws";
import { FunctionBuilder, functionBuilder } from "./helpers/function-builder";

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
   * The subscriber function.
   */
  subscriber: Input<string | FunctionArgs>;
}

/**
 * The `BucketLambdaSubscriber` component is internally used by the `Bucket` component to
 * add bucket notifications to [AWS S3 Bucket](https://aws.amazon.com/s3/).
 *
 * :::note
 * This component is not intended to be created directly.
 * :::
 *
 * You'll find this component returned by the `subscribe` method of the `Bucket` component.
 */
export class BucketLambdaSubscriber extends Component {
  private readonly fn: FunctionBuilder;
  private readonly permission: lambda.Permission;
  private readonly notification: s3.BucketNotification;

  constructor(name: string, args: Args, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);

    const self = this;
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

    const fn = createFunction();
    const permission = createPermission();
    const notification = createNotification();

    this.fn = fn;
    this.permission = permission;
    this.notification = notification;

    function createFunction() {
      return functionBuilder(
        `${name}Function`,
        args.subscriber,
        {
          description: events.apply((events) =>
            events.length < 5
              ? `Subscribed to ${name} on ${events.join(", ")}`
              : `Subscribed to ${name} on ${events
                  .slice(0, 3)
                  .join(", ")}, and ${events.length - 3} more events`,
          ),
        },
        undefined,
        { parent: self },
      );
    }

    function createPermission() {
      return new lambda.Permission(
        `${name}Permission`,
        {
          action: "lambda:InvokeFunction",
          function: fn.arn,
          principal: "s3.amazonaws.com",
          sourceArn: bucket.arn,
        },
        { parent: self },
      );
    }

    function createNotification() {
      return new s3.BucketNotification(
        ...transform(
          args.transform?.notification,
          `${name}Notification`,
          {
            bucket: bucket.name,
            lambdaFunctions: [
              {
                id: interpolate`Notification${args.subscriberId}`,
                lambdaFunctionArn: fn.arn,
                events,
                filterPrefix: args.filterPrefix,
                filterSuffix: args.filterSuffix,
              },
            ],
          },
          { parent: self, dependsOn: [permission] },
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
       * The Lambda function that'll be notified.
       */
      get function() {
        return self.fn.apply((fn) => fn.getFunction());
      },
      /**
       * The Lambda permission.
       */
      permission: this.permission,
      /**
       * The S3 bucket notification.
       */
      notification: this.notification,
    };
  }
}

const __pulumiType = "sst:aws:BucketLambdaSubscriber";
// @ts-expect-error
BucketLambdaSubscriber.__pulumiType = __pulumiType;
