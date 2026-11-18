import { ComponentResourceOptions, Output, all, output } from "@pulumi/pulumi";
import { Component, outputId, Transform, transform } from "../component";
import { Link } from "../link";
import type { Input } from "../input";
import { FunctionArgs, FunctionArn } from "./function";
import { hashStringToPrettyString, logicalName } from "../naming";
import { parseTopicArn } from "./helpers/arn";
import { SnsTopicLambdaSubscriber } from "./sns-topic-lambda-subscriber";
import { SnsTopicQueueSubscriber } from "./sns-topic-queue-subscriber";
import { sns } from "@pulumi/aws";
import { permission } from "./permission";
import { isFunctionSubscriber, isQueueSubscriber } from "./helpers/subscriber";
import { Queue } from "./queue";

export interface SnsTopicArgs {
  /**
   * FIFO (First-In-First-Out) topics are designed to provide strict message ordering.
   *
   * :::caution
   * Changing a standard topic to a FIFO topic or the other way around will result in the destruction and recreation of the topic.
   * :::
   *
   * @default `false`
   * @example
   * ```js
   * {
   *   fifo: true
   * }
   * ```
   */
  fifo?: Input<boolean>;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the SNS Topic resource.
     */
    topic?: Transform<sns.TopicArgs>;
  };
}

export interface SnsTopicSubscriberArgs {
  /**
   * Filter the messages that'll be processed by the subscriber.
   *
   * If any single property in the filter doesn't match
   * an attribute assigned to the message, then the policy rejects the message.
   *
   * :::tip
   * Learn more about [subscription filter policies](https://docs.aws.amazon.com/sns/latest/dg/sns-subscription-filter-policies.html).
   * :::
   *
   * @example
   * For example, if your SNS Topic message contains this in a JSON format.
   * ```js
   * {
   *   store: "example_corp",
   *   event: "order-placed",
   *   customer_interests: [
   *      "soccer",
   *      "rugby",
   *      "hockey"
   *   ],
   *   price_usd: 210.75
   * }
   * ```
   *
   * Then this filter policy accepts the message.
   *
   * ```js
   * {
   *   filter: {
   *     store: ["example_corp"],
   *     event: [{"anything-but": "order_cancelled"}],
   *     customer_interests: [
   *        "rugby",
   *        "football",
   *        "baseball"
   *     ],
   *     price_usd: [{numeric: [">=", 100]}]
   *   }
   * }
   * ```
   */
  filter?: Input<Record<string, any>>;
  /**
   * [Transform](/docs/components#transform) how this subscription creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the SNS Topic Subscription resource.
     */
    subscription?: Transform<sns.TopicSubscriptionArgs>;
  };
}

interface SnsTopicRef {
  ref: true;
  topicArn: Input<string>;
}

/**
 * The `SnsTopic` component lets you add an [Amazon SNS Topic](https://docs.aws.amazon.com/sns/latest/dg/sns-create-topic.html) to your app.
 *
 * :::note
 * The difference between an `SnsTopic` and a `Queue` is that with a topic you can deliver messages to multiple subscribers.
 * :::
 *
 * @example
 *
 * #### Create a topic
 *
 * ```ts title="sst.config.ts"
 * const topic = new sst.aws.SnsTopic("MyTopic");
 * ```
 *
 * #### Make it a FIFO topic
 *
 * You can optionally make it a FIFO topic.
 *
 * ```ts {2} title="sst.config.ts"
 * new sst.aws.SnsTopic("MyTopic", {
 *   fifo: true
 * });
 * ```
 *
 * #### Add a subscriber
 *
 * ```ts title="sst.config.ts"
 * topic.subscribe("MySubscriber", "src/subscriber.handler");
 * ```
 *
 * #### Link the topic to a resource
 *
 * You can link the topic to other resources, like a function or your Next.js app.
 *
 * ```ts title="sst.config.ts"
 * new sst.aws.Nextjs("MyWeb", {
 *   link: [topic]
 * });
 * ```
 *
 * Once linked, you can publish messages to the topic from your function code.
 *
 * ```ts title="app/page.tsx" {1,7}
 * import { Resource } from "sst";
 * import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
 *
 * const sns = new SNSClient({});
 *
 * await sns.send(new PublishCommand({
 *   TopicArn: Resource.MyTopic.arn,
 *   Message: "Hello from Next.js!"
 * }));
 * ```
 */
export class SnsTopic extends Component implements Link.Linkable {
  private constructorName: string;
  private constructorOpts: ComponentResourceOptions;
  private topic: sns.Topic;

  constructor(
    name: string,
    args: SnsTopicArgs = {},
    opts: ComponentResourceOptions = {},
  ) {
    super(__pulumiType, name, args, opts);
    const self = this;
    this.constructorName = name;
    this.constructorOpts = opts;

    if (args && "ref" in args) {
      const ref = reference();
      this.topic = ref.topic;
      return;
    }

    const fifo = normalizeFifo();

    this.topic = createTopic();

    function reference() {
      const ref = args as SnsTopicRef;
      const topic = sns.Topic.get(`${name}Topic`, ref.topicArn, undefined, {
        parent: self,
      });

      return { topic };
    }

    function normalizeFifo() {
      return output(args.fifo).apply((v) => v ?? false);
    }

    function createTopic() {
      return new sns.Topic(
        ...transform(
          args.transform?.topic,
          `${name}Topic`,
          {
            fifoTopic: fifo,
          },
          { parent: self },
        ),
      );
    }
  }

  /**
   * The ARN of the SNS Topic.
   */
  public get arn() {
    return this.topic.arn;
  }

  /**
   * The name of the SNS Topic.
   */
  public get name() {
    return this.topic.name;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The Amazon SNS Topic.
       */
      topic: this.topic,
    };
  }

  /**
   * Subscribe to this SNS Topic.
   *
   * @param name The name of the subscriber.
   * @param subscriber The function that'll be notified.
   * @param args Configure the subscription.
   *
   * @example
   *
   * ```js title="sst.config.ts"
   * topic.subscribe("MySubscriber", "src/subscriber.handler");
   * ```
   *
   * Add a filter to the subscription.
   *
   * ```js title="sst.config.ts"
   * topic.subscribe("MySubscriber", "src/subscriber.handler", {
   *   filter: {
   *     price_usd: [{numeric: [">=", 100]}]
   *   }
   * });
   * ```
   *
   * Customize the subscriber function.
   *
   * ```js title="sst.config.ts"
   * topic.subscribe("MySubscriber", {
   *   handler: "src/subscriber.handler",
   *   timeout: "60 seconds"
   * });
   * ```
   *
   * Or pass in the ARN of an existing Lambda function.
   *
   * ```js title="sst.config.ts"
   * topic.subscribe("MySubscriber", "arn:aws:lambda:us-east-1:123456789012:function:my-function");
   * ```
   */
  public subscribe(
    name: string,
    subscriber: Input<string | FunctionArgs | FunctionArn>,
    args?: SnsTopicSubscriberArgs,
  ): Output<SnsTopicLambdaSubscriber>;
  /**
   * @deprecated The subscribe function now requires a `name` parameter as the first argument.
   * To migrate, remove the current subscriber, deploy the changes, and then add the subscriber
   * back with the new `name` argument.
   */
  public subscribe(
    subscriber: Input<string | FunctionArgs | FunctionArn>,
    args?: SnsTopicSubscriberArgs,
  ): Output<SnsTopicLambdaSubscriber>;

  public subscribe(nameOrSubscriber: any, subscriberOrArgs?: any, args?: any) {
    return isFunctionSubscriber(subscriberOrArgs).apply((v) =>
      v
        ? SnsTopic._subscribeFunction(
            nameOrSubscriber, // name
            this.constructorName,
            this.arn,
            subscriberOrArgs, // subscriber
            args,
            { provider: this.constructorOpts.provider },
          )
        : SnsTopic._subscribeFunctionV1(
            this.constructorName,
            this.arn,
            nameOrSubscriber, // subscriber
            subscriberOrArgs, // args
            { provider: this.constructorOpts.provider },
          ),
    );
  }

  /**
   * Subscribe to an SNS Topic that was not created in your app.
   *
   * @param name The name of the subscriber.
   * @param topicArn The ARN of the SNS Topic to subscribe to.
   * @param subscriber The function that'll be notified.
   * @param args Configure the subscription.
   *
   * @example
   *
   * For example, let's say you have an existing SNS Topic with the following ARN.
   *
   * ```js title="sst.config.ts"
   * const topicArn = "arn:aws:sns:us-east-1:123456789012:MyTopic";
   * ```
   *
   * You can subscribe to it by passing in the ARN.
   *
   * ```js title="sst.config.ts"
   * sst.aws.SnsTopic.subscribe("MySubscriber", topicArn, "src/subscriber.handler");
   * ```
   *
   * Add a filter to the subscription.
   *
   * ```js title="sst.config.ts"
   * sst.aws.SnsTopic.subscribe("MySubscriber", topicArn, "src/subscriber.handler", {
   *   filter: {
   *     price_usd: [{numeric: [">=", 100]}]
   *   }
   * });
   * ```
   *
   * Customize the subscriber function.
   *
   * ```js title="sst.config.ts"
   * sst.aws.SnsTopic.subscribe("MySubscriber", topicArn, {
   *   handler: "src/subscriber.handler",
   *   timeout: "60 seconds"
   * });
   * ```
   */
  public static subscribe(
    name: string,
    topicArn: Input<string>,
    subscriber: Input<string | FunctionArgs | FunctionArn>,
    args?: SnsTopicSubscriberArgs,
  ): Output<SnsTopicLambdaSubscriber>;
  /**
   * @deprecated The subscribe function now requires a `name` parameter as the first argument.
   * To migrate, remove the current subscriber, deploy the changes, and then add the subscriber
   * back with the new `name` argument.
   */
  public static subscribe(
    topicArn: Input<string>,
    subscriber: Input<string | FunctionArgs | FunctionArn>,
    args?: SnsTopicSubscriberArgs,
  ): Output<SnsTopicLambdaSubscriber>;

  public static subscribe(
    nameOrTopicArn: any,
    topicArnOrSubscriber: any,
    subscriberOrArgs?: any,
    args?: any,
  ) {
    return isFunctionSubscriber(subscriberOrArgs).apply((v) =>
      v
        ? output(topicArnOrSubscriber).apply((topicArn) =>
            this._subscribeFunction(
              nameOrTopicArn, // name
              logicalName(parseTopicArn(topicArn).topicName),
              topicArn,
              subscriberOrArgs, // subscriber
              args,
            ),
          )
        : output(nameOrTopicArn).apply((topicArn) =>
            this._subscribeFunctionV1(
              logicalName(parseTopicArn(topicArn).topicName),
              topicArn,
              topicArnOrSubscriber, // subscriber
              subscriberOrArgs, // args
            ),
          ),
    );
  }

  private static _subscribeFunction(
    subscriberName: string,
    name: string,
    topicArn: string | Output<string>,
    subscriber: Input<string | FunctionArgs | FunctionArn>,
    args: SnsTopicSubscriberArgs = {},
    opts: $util.ComponentResourceOptions = {},
  ) {
    return output(args).apply(
      (args) =>
        new SnsTopicLambdaSubscriber(
          `${name}Subscriber${subscriberName}`,
          {
            topic: { arn: topicArn },
            subscriber,
            ...args,
          },
          opts,
        ),
    );
  }

  private static _subscribeFunctionV1(
    name: string,
    topicArn: string | Output<string>,
    subscriber: Input<string | FunctionArgs | FunctionArn>,
    args: SnsTopicSubscriberArgs = {},
    opts: $util.ComponentResourceOptions = {},
  ) {
    return all([subscriber, args]).apply(([subscriber, args]) => {
      const suffix = logicalName(
        hashStringToPrettyString(
          [
            typeof topicArn === "string" ? topicArn : outputId,
            JSON.stringify(args.filter ?? {}),
            typeof subscriber === "string" ? subscriber : subscriber.handler,
          ].join(""),
          6,
        ),
      );

      return new SnsTopicLambdaSubscriber(
        `${name}Subscriber${suffix}`,
        {
          topic: { arn: topicArn },
          subscriber,
          ...args,
        },
        opts,
      );
    });
  }

  /**
   * Subscribe to this SNS Topic with an SQS Queue.
   *
   * @param name The name of the subscriber.
   * @param queue The ARN of the queue or `Queue` component that'll be notified.
   * @param args Configure the subscription.
   *
   * @example
   *
   * For example, let's say you have a queue.
   *
   * ```js title="sst.config.ts"
   * const queue = sst.aws.Queue("MyQueue");
   * ```
   *
   * You can subscribe to this topic with it.
   *
   * ```js title="sst.config.ts"
   * topic.subscribeQueue("MySubscriber", queue.arn);
   * ```
   *
   * Add a filter to the subscription.
   *
   * ```js title="sst.config.ts"
   * topic.subscribeQueue("MySubscriber", queue.arn, {
   *   filter: {
   *     price_usd: [{numeric: [">=", 100]}]
   *   }
   * });
   * ```
   */
  public subscribeQueue(
    name: string,
    queue: Input<string | Queue>,
    args?: SnsTopicSubscriberArgs,
  ): Output<SnsTopicQueueSubscriber>;
  /**
   * @deprecated The subscribe function now requires a `name` parameter as the first argument.
   * To migrate, remove the current subscriber, deploy the changes, and then add the subscriber
   * back with the new `name` argument.
   */
  public subscribeQueue(
    queue: Input<string>,
    args?: SnsTopicSubscriberArgs,
  ): Output<SnsTopicQueueSubscriber>;

  public subscribeQueue(nameOrQueue: any, queueOrArgs?: any, args?: any) {
    return isQueueSubscriber(queueOrArgs).apply((v) =>
      v
        ? SnsTopic._subscribeQueue(
            nameOrQueue, // name
            this.constructorName,
            this.arn,
            queueOrArgs, // queue
            args,
          )
        : SnsTopic._subscribeQueueV1(
            this.constructorName,
            this.arn,
            nameOrQueue, // queue
            queueOrArgs, // args
          ),
    );
  }

  /**
   * Subscribe to an existing SNS Topic with a previously created SQS Queue.
   *
   * @param name The name of the subscriber.
   * @param topicArn The ARN of the SNS Topic to subscribe to.
   * @param queue The ARN of the queue or `Queue` component that'll be notified.
   * @param args Configure the subscription.
   *
   * @example
   *
   * For example, let's say you have an existing SNS Topic and SQS Queue with the following ARNs.
   *
   * ```js title="sst.config.ts"
   * const topicArn = "arn:aws:sns:us-east-1:123456789012:MyTopic";
   * const queueArn = "arn:aws:sqs:us-east-1:123456789012:MyQueue";
   * ```
   *
   * You can subscribe to the topic with the queue.
   *
   * ```js title="sst.config.ts"
   * sst.aws.SnsTopic.subscribeQueue("MySubscriber", topicArn, queueArn);
   * ```
   *
   * Add a filter to the subscription.
   *
   * ```js title="sst.config.ts"
   * sst.aws.SnsTopic.subscribeQueue("MySubscriber", topicArn, queueArn, {
   *   filter: {
   *     price_usd: [{numeric: [">=", 100]}]
   *   }
   * });
   * ```
   */
  public static subscribeQueue(
    name: string,
    topicArn: Input<string>,
    queue: Input<string | Queue>,
    args?: SnsTopicSubscriberArgs,
  ): Output<SnsTopicQueueSubscriber>;
  /**
   * @deprecated The subscribe function now requires a `name` parameter as the first argument.
   * To migrate, remove the current subscriber, deploy the changes, and then add the subscriber
   * back with the new `name` argument.
   */
  public static subscribeQueue(
    topicArn: Input<string>,
    queue: Input<string>,
    args?: SnsTopicSubscriberArgs,
  ): Output<SnsTopicQueueSubscriber>;
  public static subscribeQueue(
    nameOrTopicArn: any,
    topicArnOrQueue: any,
    queueOrArgs?: any,
    args?: any,
  ) {
    return isQueueSubscriber(queueOrArgs).apply((v) =>
      v
        ? output(topicArnOrQueue).apply((topicArn) =>
            this._subscribeQueue(
              nameOrTopicArn, // name
              logicalName(parseTopicArn(topicArn).topicName),
              topicArn,
              queueOrArgs, // queue
              args,
            ),
          )
        : output(nameOrTopicArn).apply((topicArn) =>
            this._subscribeQueueV1(
              logicalName(parseTopicArn(topicArn).topicName),
              topicArn,
              topicArnOrQueue, // queue
              queueOrArgs, // args
            ),
          ),
    );
  }

  private static _subscribeQueue(
    subscriberName: string,
    name: string,
    topicArn: string | Output<string>,
    queue: Input<string | Queue>,
    args: SnsTopicSubscriberArgs = {},
  ) {
    return output(args).apply(
      (args) =>
        new SnsTopicQueueSubscriber(`${name}Subscriber${subscriberName}`, {
          topic: { arn: topicArn },
          queue,
          ...args,
        }),
    );
  }

  private static _subscribeQueueV1(
    name: string,
    topicArn: string | Output<string>,
    queueArn: Input<string>,
    args: SnsTopicSubscriberArgs = {},
  ) {
    return all([queueArn, args]).apply(([queueArn, args]) => {
      const suffix = logicalName(
        hashStringToPrettyString(
          [
            typeof topicArn === "string" ? topicArn : outputId,
            JSON.stringify(args.filter ?? {}),
            queueArn,
          ].join(""),
          6,
        ),
      );

      return new SnsTopicQueueSubscriber(`${name}Subscriber${suffix}`, {
        topic: { arn: topicArn },
        queue: queueArn,
        disableParent: true,
        ...args,
      });
    });
  }

  /**
   * Reference an existing SNS topic with its topic ARN. This is useful when you create a
   * topic in one stage and want to share it in another stage. It avoids having to create
   * a new topic in the other stage.
   *
   * :::tip
   * You can use the `static get` method to share SNS topics across stages.
   * :::
   *
   * @param name The name of the component.
   * @param topicArn The ARN of the existing SNS Topic.
   * @param opts? Resource options.
   *
   * @example
   * Imagine you create a topic in the `dev` stage. And in your personal stage `frank`,
   * instead of creating a new topic, you want to share the topic from `dev`.
   *
   * ```ts title="sst.config.ts"
   * const topic = $app.stage === "frank"
   *   ? sst.aws.SnsTopic.get("MyTopic", "arn:aws:sns:us-east-1:123456789012:MyTopic")
   *   : new sst.aws.SnsTopic("MyTopic");
   * ```
   *
   * Here `arn:aws:sns:us-east-1:123456789012:MyTopic` is the ARN of the topic created in
   * the `dev` stage. You can find this by outputting the topic ARN in the `dev` stage.
   *
   * ```ts title="sst.config.ts"
   * return topic.arn;
   * ```
   */
  public static get(
    name: string,
    topicArn: Input<string>,
    opts?: ComponentResourceOptions,
  ) {
    return new SnsTopic(
      name,
      {
        ref: true,
        topicArn,
      } as SnsTopicArgs,
      opts,
    );
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        arn: this.arn,
      },
      include: [
        permission({
          actions: ["sns:*"],
          resources: [this.arn],
        }),
      ],
    };
  }
}

const __pulumiType = "sst:aws:SnsTopic";
// @ts-expect-error
SnsTopic.__pulumiType = __pulumiType;
