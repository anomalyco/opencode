import {
  ComponentResourceOptions,
  Input,
  Output,
  output,
} from "@pulumi/pulumi";
import { Component, transform } from "../component";
import { Function, FunctionArgs } from "./function";
import { QueueSubscriberArgs } from "./queue";
import { lambda } from "@pulumi/aws";
import { toSeconds } from "../duration";
import { FunctionBuilder, functionBuilder } from "./helpers/function-builder";
import { parseFunctionArn } from "./helpers/arn";

export interface Args extends QueueSubscriberArgs {
  /**
   * The queue to use.
   */
  queue: Input<{
    /**
     * The ARN of the queue.
     */
    arn: Input<string>;
  }>;
  /**
   * The subscriber function.
   */
  subscriber: Input<string | FunctionArgs>;
}

/**
 * The `QueueLambdaSubscriber` component is internally used by the `Queue` component to
 * add a consumer to [Amazon SQS](https://aws.amazon.com/sqs/).
 *
 * :::note
 * This component is not intended to be created directly.
 * :::
 *
 * You'll find this component returned by the `subscribe` method of the `Queue` component.
 */
export class QueueLambdaSubscriber extends Component {
  private readonly fn: FunctionBuilder;
  private readonly eventSourceMapping: lambda.EventSourceMapping;

  constructor(name: string, args: Args, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);

    const self = this;
    const queue = output(args.queue);
    const fn = createFunction();
    const eventSourceMapping = createEventSourceMapping();

    this.fn = fn;
    this.eventSourceMapping = eventSourceMapping;

    function createFunction() {
      return functionBuilder(
        `${name}Function`,
        args.subscriber,
        {
          description: `Subscribed to ${name}`,
          permissions: [
            {
              actions: [
                "sqs:ChangeMessageVisibility",
                "sqs:DeleteMessage",
                "sqs:GetQueueAttributes",
                "sqs:GetQueueUrl",
                "sqs:ReceiveMessage",
              ],
              resources: [queue.arn],
            },
          ],
        },
        undefined,
        { parent: self },
      );
    }

    function createEventSourceMapping() {
      return new lambda.EventSourceMapping(
        ...transform(
          args.transform?.eventSourceMapping,
          `${name}EventSourceMapping`,
          {
            functionResponseTypes: output(args.batch).apply((batch) =>
              batch?.partialResponses ? ["ReportBatchItemFailures"] : [],
            ),
            batchSize: output(args.batch).apply((batch) => batch?.size ?? 10),
            maximumBatchingWindowInSeconds: output(args.batch).apply((batch) =>
              batch?.window ? toSeconds(batch.window) : 0,
            ),
            eventSourceArn: queue.arn,
            functionName: fn.arn.apply(
              (arn) => parseFunctionArn(arn).functionName,
            ),
            filterCriteria: args.filters && {
              filters: output(args.filters).apply((filters) =>
                filters.map((filter) => ({
                  pattern: JSON.stringify(filter),
                })),
              ),
            },
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
    const self = this;
    return {
      /**
       * The Lambda function that'll be notified.
       */
      get function() {
        return self.fn.apply((fn) => fn.getFunction());
      },
      /**
       * The Lambda event source mapping.
       */
      eventSourceMapping: this.eventSourceMapping,
    };
  }
}

const __pulumiType = "sst:aws:QueueLambdaSubscriber";
// @ts-expect-error
QueueLambdaSubscriber.__pulumiType = __pulumiType;
