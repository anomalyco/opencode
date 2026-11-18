import * as aws from "@pulumi/aws";

import { ComponentResourceOptions, Output, all, output } from "@pulumi/pulumi";
import { Component, Transform, transform } from "../component.js";
import { Input } from "../input.js";
import { Link } from "../link.js";
import { hashStringToPrettyString, logicalName } from "../naming.js";
import { FunctionArgs, FunctionArn } from "./function.js";
import { KinesisStreamLambdaSubscriber } from "./kinesis-stream-lambda-subscriber.js";
import { parseKinesisStreamArn } from "./helpers/arn.js";
import { permission } from "./permission.js";
import { isFunctionSubscriber } from "./helpers/subscriber.js";

export interface KinesisStreamArgs {
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the Kinesis stream resource.
     */
    stream?: Transform<aws.kinesis.StreamArgs>;
  };
}

export interface KinesisStreamLambdaSubscriberArgs {
  /**
   * Filter the events that'll be processed by the `subscribers` functions.
   *
   * :::tip
   * You can pass in up to 5 different filters.
   * :::
   *
   * You can pass in up to 5 different filter policies. These will logically ORed together. Meaning that if any single policy matches, the record will be processed. Learn more about the [filter rule syntax](https://docs.aws.amazon.com/lambda/latest/dg/invocation-eventfiltering.html#filtering-syntax).
   *
   * @example
   * For example, if your Kinesis stream contains events in this JSON format.
   * ```js
   * {
   *   record: 12345,
   *   order: {
   *     type: "buy",
   *     stock: "ANYCO",
   *     quantity: 1000
   *   }
   * }
   * ```
   *
   * To process only those events where the `type` is `buy`.
   * ```js
   * {
   *   filters: [
   *     {
   *       data: {
   *         order: {
   *           type: ["buy"],
   *         },
   *       },
   *     },
   *   ],
   * }
   * ```
   *
   */
  filters?: Input<Input<Record<string, any>>[]>;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the Lambda Event Source Mapping resource.
     */
    eventSourceMapping?: Transform<aws.lambda.EventSourceMappingArgs>;
  };
}

/**
 * The `KinesisStream` component lets you add an [Amazon Kinesis Data Streams](https://docs.aws.amazon.com/streams/latest/dev/introduction.html) to your app.
 *
 * @example
 *
 * #### Minimal example
 *
 * ```ts title="sst.config.ts"
 * const stream = new sst.aws.KinesisStream("MyStream");
 * ```
 *
 * #### Subscribe to a stream
 *
 * ```ts title="sst.config.ts"
 * stream.subscribe("MySubscriber", "src/subscriber.handler");
 * ```
 *
 * #### Link the stream to a resource
 *
 * You can link the stream to other resources, like a function or your Next.js app.
 *
 * ```ts {2} title="sst.config.ts"
 * new sst.aws.Nextjs("MyWeb", {
 *   link: [stream]
 * });
 * ```
 *
 * Once linked, you can write to the stream from your function code.
 *
 * ```ts title="app/page.tsx" {1,7}
 * import { Resource } from "sst";
 * import { KinesisClient, PutRecordCommand } from "@aws-sdk/client-kinesis";
 *
 * const client = new KinesisClient();
 *
 * await client.send(new PutRecordCommand({
 *   StreamName: Resource.MyStream.name,
 *   Data: JSON.stringify({ foo: "bar" }),
 *   PartitionKey: "myKey",
 * }));
 * ```
 */
export class KinesisStream extends Component implements Link.Linkable {
  private constructorName: string;
  private constructorOpts: ComponentResourceOptions;
  private stream: aws.kinesis.Stream;

  constructor(
    name: string,
    args: KinesisStreamArgs = {},
    opts: $util.ComponentResourceOptions = {},
  ) {
    super(__pulumiType, name, args, opts);

    const parent = this;
    const stream = createStream();
    this.stream = stream;
    this.constructorName = name;
    this.constructorOpts = opts;

    function createStream() {
      return new aws.kinesis.Stream(
        ...transform(
          args?.transform?.stream,
          `${name}Stream`,
          {
            streamModeDetails: {
              streamMode: "ON_DEMAND",
            },
          },
          { parent },
        ),
      );
    }
  }

  /**
   * Subscribe to the Kinesis stream.
   *
   * @param name The name of the subscriber.
   * @param subscriber The function that'll be notified.
   * @param args Configure the subscription.
   *
   * @example
   *
   * ```js title="sst.config.ts"
   * stream.subscribe("MySubscriber", "src/subscriber.handler");
   * ```
   *
   * Add a filter to the subscription.
   *
   * ```js title="sst.config.ts"
   * stream.subscribe("MySubscriber", "src/subscriber.handler", {
   *   filters: [
   *     {
   *       data: {
   *         order: {
   *           type: ["buy"],
   *         },
   *       },
   *     },
   *   ],
   * });
   * ```
   *
   * Customize the subscriber function.
   *
   * ```js title="sst.config.ts"
   * stream.subscribe("MySubscriber", {
   *   handler: "src/subscriber.handler",
   *   timeout: "60 seconds"
   * });
   * ```
   *
   * Or pass in the ARN of an existing Lambda function.
   *
   * ```js title="sst.config.ts"
   * stream.subscribe("MySubscriber", "arn:aws:lambda:us-east-1:123456789012:function:my-function");
   * ```
   */
  public subscribe(
    name: string,
    subscriber: Input<string | FunctionArgs | FunctionArn>,
    args?: KinesisStreamLambdaSubscriberArgs,
  ): Output<KinesisStreamLambdaSubscriber>;
  /**
   * @deprecated The subscribe function now requires a `name` parameter as the first argument.
   * To migrate, remove the current subscriber, deploy the changes, and then add the subscriber
   * back with the new `name` argument.
   */
  public subscribe(
    subscriber: Input<string | FunctionArgs | FunctionArn>,
    args?: KinesisStreamLambdaSubscriberArgs,
  ): Output<KinesisStreamLambdaSubscriber>;
  public subscribe(nameOrSubscriber: any, subscriberOrArgs?: any, args?: any) {
    return isFunctionSubscriber(subscriberOrArgs).apply((v) =>
      v
        ? KinesisStream._subscribe(
            nameOrSubscriber, // name
            this.constructorName,
            this.nodes.stream.arn,
            subscriberOrArgs, // subscriber
            args,
            { provider: this.constructorOpts.provider },
          )
        : KinesisStream._subscribeV1(
            this.constructorName,
            this.nodes.stream.arn,
            nameOrSubscriber, // subscriber
            subscriberOrArgs, // args
            { provider: this.constructorOpts.provider },
          ),
    );
  }

  /**
   * Subscribe to the Kinesis stream that was not created in your app.
   *
   * @param name The name of the subscriber.
   * @param streamArn The ARN of the Kinesis Stream to subscribe to.
   * @param subscriber The function that'll be notified.
   * @param args Configure the subscription.
   *
   * @example
   *
   * For example, let's say you have the ARN of an existing Kinesis stream.
   *
   * ```js title="sst.config.ts"
   * const streamArn = "arn:aws:kinesis:us-east-1:123456789012:stream/MyStream";
   * ```
   *
   * You can subscribe to it by passing in the ARN.
   *
   * ```js title="sst.config.ts"
   * sst.aws.KinesisStream.subscribe("MySubscriber", streamArn, "src/subscriber.handler");
   * ```
   *
   * Add a filter to the subscription.
   *
   * ```js title="sst.config.ts"
   * sst.aws.KinesisStream.subscribe("MySubscriber", streamArn, "src/subscriber.handler", {
   *   filters: [
   *     {
   *       data: {
   *         order: {
   *           type: ["buy"],
   *         },
   *       },
   *     },
   *   ],
   * });
   * ```
   *
   * Customize the subscriber function.
   *
   * ```js title="sst.config.ts"
   * sst.aws.KinesisStream.subscribe("MySubscriber", streamArn, {
   *   handler: "src/subscriber.handler",
   *   timeout: "60 seconds"
   * });
   * ```
   */
  public static subscribe(
    name: string,
    streamArn: Input<string>,
    subscriber: Input<string | FunctionArgs | FunctionArn>,
    args?: KinesisStreamLambdaSubscriberArgs,
  ): Output<KinesisStreamLambdaSubscriber>;
  /**
   * @deprecated The subscribe function now requires a `name` parameter as the first argument.
   * To migrate, remove the current subscriber, deploy the changes, and then add the subscriber
   * back with the new `name` argument.
   */
  public static subscribe(
    streamArn: Input<string>,
    subscriber: Input<string | FunctionArgs | FunctionArn>,
    args?: KinesisStreamLambdaSubscriberArgs,
  ): Output<KinesisStreamLambdaSubscriber>;
  public static subscribe(
    nameOrStreamArn: any,
    streamArnOrSubscriber: any,
    subscriberOrArgs?: any,
    args?: any,
  ) {
    return isFunctionSubscriber(subscriberOrArgs).apply((v) =>
      v
        ? output(streamArnOrSubscriber).apply((streamArn) =>
            this._subscribe(
              nameOrStreamArn, // name
              logicalName(parseKinesisStreamArn(streamArn).streamName),
              streamArn,
              subscriberOrArgs, // subscriber
              args,
            ),
          )
        : output(nameOrStreamArn).apply((streamArn) =>
            this._subscribeV1(
              logicalName(parseKinesisStreamArn(streamArn).streamName),
              streamArn,
              streamArnOrSubscriber, // subscriber
              subscriberOrArgs, // args
            ),
          ),
    );
  }

  private static _subscribe(
    subscriberName: string,
    name: string,
    streamArn: Input<string>,
    subscriber: Input<string | FunctionArgs | FunctionArn>,
    args: KinesisStreamLambdaSubscriberArgs = {},
    opts: ComponentResourceOptions = {},
  ) {
    return output(args).apply(
      (args) =>
        new KinesisStreamLambdaSubscriber(
          `${name}Subscriber${subscriberName}`,
          {
            stream: { arn: streamArn },
            subscriber,
            ...args,
          },
          opts,
        ),
    );
  }

  private static _subscribeV1(
    name: string,
    streamArn: Input<string>,
    subscriber: Input<string | FunctionArgs | FunctionArn>,
    args: KinesisStreamLambdaSubscriberArgs = {},
    opts: ComponentResourceOptions = {},
  ) {
    return all([streamArn, subscriber, args]).apply(
      ([streamArn, subscriber, args]) => {
        const suffix = logicalName(
          hashStringToPrettyString(
            [
              streamArn,
              JSON.stringify(args.filters ?? {}),
              typeof subscriber === "string" ? subscriber : subscriber.handler,
            ].join(""),
            6,
          ),
        );
        return new KinesisStreamLambdaSubscriber(
          `${name}Subscriber${suffix}`,
          {
            stream: { arn: streamArn },
            subscriber,
            ...args,
          },
          opts,
        );
      },
    );
  }

  public get name() {
    return this.stream.name;
  }

  public get arn() {
    return this.stream.arn;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The Amazon Kinesis Data Stream.
       */
      stream: this.stream,
    };
  }

  /** @internal */
  getSSTLink() {
    return {
      properties: {
        name: this.stream.name,
      },
      include: [
        permission({
          actions: ["kinesis:*"],
          resources: [this.nodes.stream.arn],
        }),
      ],
    };
  }
}

const __pulumiType = "sst:aws:KinesisStream";
// @ts-expect-error
KinesisStream.__pulumiType = __pulumiType;
