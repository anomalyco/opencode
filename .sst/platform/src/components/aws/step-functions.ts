import {
  all,
  ComponentResourceOptions,
  interpolate,
  output,
} from "@pulumi/pulumi";
import { Component, Transform, transform } from "../component";
import { cloudwatch, iam, sfn } from "@pulumi/aws";
import { Link } from "../link";
import { permission } from "./permission";
import { State } from "./step-functions/state";
import { Choice, ChoiceArgs } from "./step-functions/choice";
import { Fail, FailArgs } from "./step-functions/fail";
import { Map, MapArgs } from "./step-functions/map";
import { Parallel, ParallelArgs } from "./step-functions/parallel";
import { Pass, PassArgs } from "./step-functions/pass";
import { Succeed, SucceedArgs } from "./step-functions/succeed";
import {
  Task,
  TaskArgs,
  LambdaInvokeArgs,
  SnsPublishArgs,
  SqsSendMessageArgs,
  EcsRunTaskArgs,
  EventBridgePutEventsArgs,
} from "./step-functions/task";
import { Wait, WaitArgs } from "./step-functions/wait";
import { Input } from "../input";
import { RETENTION } from "./logging";
import { physicalName } from "../naming";
import { functionBuilder } from "./helpers/function-builder";
import { Function } from "./function";

export interface StepFunctionsArgs {
  /**
   * The type of state machine workflow to create.
   *
   * :::caution
   * Changing the type of the state machine workflow will cause the state machine
   * to be destroyed and recreated.
   * :::
   *
   * The `standard` workflow is the default and is meant for long running workflows.
   * The `express` workflow is meant for workflows shorter than 5 minutes.
   *
   * This is because the `express` workflow is run in a single Lambda function. As a
   * result, it's faster and cheaper to run. So if your workflow are short, the
   * `express` workflow is recommended.
   *
   * @default `"standard"`
   * @example
   * ```js
   * {
   *   type: "express"
   * }
   * ```
   */
  type?: Input<"standard" | "express">;
  /**
   * The definition of the state machine. It takes a chain of `State` objects.
   *
   * @example
   *
   * ```ts title="sst.config.ts"
   * const foo = sst.aws.StepFunctions.pass({ name: "Foo" });
   * const bar = sst.aws.StepFunctions.succeed({ name: "Bar" });
   *
   * new sst.aws.StepFunctions("MyStateMachine", {
   *   definition: foo.next(bar)
   * });
   * ```
   */
  definition: State;
  /**
   * Configure the execution logs in CloudWatch. Or pass in `false` to disable writing logs.
   * @default `{retention: "1 month", level: "error", includeData: false}`
   * @example
   * ```js
   * {
   *   logging: false
   * }
   * ```
   */
  logging?: Input<
    | false
    | {
        /**
         * The duration the logs are kept in CloudWatch.
         *
         * @default `1 month`
         * @example
         * ```js
         * {
         *   logging: {
         *     retention: "forever"
         *   }
         * }
         * ```
         */
        retention?: Input<keyof typeof RETENTION>;
        /**
         * Specify whether execution data is included in the logs.
         *
         * @default `false`
         * @example
         * ```js
         * {
         *   logging: {
         *     includeData: true
         *   }
         * }
         * ```
         */
        includeData?: Input<boolean>;
        /**
         * Specify the type of execution events that are logged. Read more about the
         * [Step Functions log level](https://docs.aws.amazon.com/step-functions/latest/dg/cw-logs.html#cloudwatch-log-level).
         *
         * @default `"error"`
         * @example
         * ```js
         * {
         *   logging: {
         *     level: "all"
         *   }
         * }
         * ```
         */
        level?: Input<"all" | "error" | "fatal">;
      }
  >;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying resources.
   */
  transform?: {
    /**
     * Transform the Step Functions StateMachine resource.
     */
    stateMachine?: Transform<sfn.StateMachineArgs>;
    /**
     * Transform the Step Functions LogGroup resource.
     */
    logGroup?: Transform<cloudwatch.LogGroupArgs>;
  };
}

/**
 * The `StepFunctions` component lets you add state machines to your app
 * using [AWS Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html).
 *
 * :::note
 * This component is currently in beta. Please [report any issues](https://github.com/sst/sst/issues) you find.
 * :::
 *
 * You define your state machine using a collection of states. Where each state
 * needs a unique name. It uses [JSONata](https://jsonata.org) for transforming
 * data between states.
 *
 * @example
 * #### Minimal example
 *
 * The state machine definition is compiled into JSON and passed to AWS.
 *
 * ```ts title="sst.config.ts"
 * const foo = sst.aws.StepFunctions.pass({ name: "Foo" });
 * const bar = sst.aws.StepFunctions.succeed({ name: "Bar" });
 *
 * const definition = foo.next(bar);
 *
 * new sst.aws.StepFunctions("MyStateMachine", {
 *   definition
 * });
 * ```
 *
 * #### Invoking a Lambda function
 *
 * Create a function and invoke it from a state machine.
 *
 * ```ts title="sst.config.ts" {5-8,12}
 * const myFunction = new sst.aws.Function("MyFunction", {
 *   handler: "src/index.handler"
 * });
 *
 * const invoke = sst.aws.StepFunctions.lambdaInvoke({
 *   name: "InvokeMyFunction",
 *   function: myFunction
 * });
 * const done = sst.aws.StepFunctions.succeed({ name: "Done" });
 *
 * new sst.aws.StepFunctions("MyStateMachine", {
 *   definition: invoke.next(done)
 * });
 * ```
 *
 * #### Use the express workflow
 *
 * ```ts title="sst.config.ts" {5}
 * const foo = sst.aws.StepFunctions.pass({ name: "Foo" });
 * const bar = sst.aws.StepFunctions.succeed({ name: "Bar" });
 *
 * new sst.aws.StepFunctions("MyStateMachine", {
 *   type: "express",
 *   definition: foo.next(bar)
 * });
 * ```
 */
export class StepFunctions extends Component implements Link.Linkable {
  private stateMachine: sfn.StateMachine;

  constructor(
    name: string,
    args: StepFunctionsArgs,
    opts?: ComponentResourceOptions,
  ) {
    super(__pulumiType, name, args, opts);

    const parent = this;

    const type = output(args.type ?? "standard");
    const logging = normalizeLogging();
    const logGroup = createLogGroup();
    const role = createRole();
    const stateMachine = createStateMachine();

    this.stateMachine = stateMachine;

    function normalizeLogging() {
      return output(args.logging).apply((logging) => {
        if (logging === false) return undefined;

        return {
          retention: logging?.retention ?? "1 month",
          level: logging?.level ?? "error",
          includeData: logging?.includeData ?? false,
        };
      });
    }

    function createLogGroup() {
      return logging.apply((logging) => {
        if (!logging) return;

        return new cloudwatch.LogGroup(
          ...transform(
            args.transform?.logGroup,
            `${name}LogGroup`,
            {
              name: interpolate`/aws/states/${physicalName(
                64,
                `${name}StateMachine`,
              )}`,
              retentionInDays: RETENTION[logging.retention],
            },
            { parent, ignoreChanges: ["name"] },
          ),
        );
      });
    }

    function createRole() {
      return new iam.Role(
        `${name}Role`,
        {
          assumeRolePolicy: iam.assumeRolePolicyForPrincipal({
            Service: "states.amazonaws.com",
          }),
          inlinePolicies: [
            {
              name: "inline",
              policy: iam.getPolicyDocumentOutput({
                statements: [
                  {
                    actions: ["events:*"],
                    resources: ["*"],
                  },
                  {
                    actions: [
                      "logs:CreateLogDelivery",
                      "logs:CreateLogStream",
                      "logs:GetLogDelivery",
                      "logs:UpdateLogDelivery",
                      "logs:DeleteLogDelivery",
                      "logs:ListLogDeliveries",
                      "logs:PutLogEvents",
                      "logs:PutResourcePolicy",
                      "logs:DescribeResourcePolicies",
                      "logs:DescribeLogGroups",
                    ],
                    resources: ["*"],
                  },
                  {
                    actions: [
                      "states:StartExecution",
                      "states:DescribeExecution",
                    ],
                    resources: ["*"],
                  },
                  ...args.definition.getRoot().getPermissions(),
                ],
              }).json,
            },
          ],
        },
        { parent },
      );
    }

    function createStateMachine() {
      const root = args.definition.getRoot();
      root.assertStateNameUnique();
      root.assertStateNotReused();

      return new sfn.StateMachine(
        ...transform(
          args.transform?.stateMachine,
          `${name}StateMachine`,
          {
            type: type.apply((type) => type.toUpperCase()),
            definition: $jsonStringify({
              StartAt: root.name,
              States: root.serialize(),
            }),
            roleArn: role.arn,
            loggingConfiguration: all([logging, logGroup]).apply(
              ([logging, logGroup]) => ({
                includeExecutionData: logging?.includeData ?? false,
                level: (logging?.level ?? "off").toUpperCase(),
                logDestination: interpolate`${logGroup?.arn}:*`,
              }),
            ),
          },
          { parent },
        ),
      );
    }
  }

  /**
   * The State Machine ARN.
   */
  public get arn() {
    return this.stateMachine.arn;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The Step Function State Machine resource.
       */
      stateMachine: this.stateMachine,
    };
  }

  /**
   * A `Choice` state is used to conditionally continue to different states based
   * on the matched condition.
   *
   * @example
   * ```ts title="sst.config.ts"
   * const processPayment = sst.aws.StepFunctions.choice({ name: "ProcessPayment" });
   *
   * const makePayment = sst.aws.StepFunctions.lambdaInvoke({ name: "MakePayment" });
   * const sendReceipt = sst.aws.StepFunctions.lambdaInvoke({ name: "SendReceipt" });
   * const failure = sst.aws.StepFunctions.fail({ name: "Failure" });
   *
   * processPayment.when("{% $states.input.status === 'unpaid' %}", makePayment);
   * processPayment.when("{% $states.input.status === 'paid' %}", sendReceipt);
   * processPayment.otherwise(failure);
   * ```
   */
  public static choice(args: ChoiceArgs) {
    return new Choice(args);
  }

  /**
   * A `Fail` state is used to fail the execution of a state machine.
   *
   * @example
   * ```ts title="sst.config.ts"
   * sst.aws.StepFunctions.fail({ name: "Failure" });
   * ```
   */
  public static fail(args: FailArgs) {
    return new Fail(args);
  }

  /**
   * A `Map` state is used to iterate over a list of items and execute a task for
   * each item.
   *
   * @example
   * ```ts title="sst.config.ts"
   * const processor = sst.aws.StepFunctions.lambdaInvoke({
   *   name: "Processor",
   *   function: "src/processor.handler"
   * });
   *
   * sst.aws.StepFunctions.map({
   *   processor,
   *   name: "Map",
   *   items: "{% $states.input.items %}"
   * });
   * ```
   */
  public static map(args: MapArgs) {
    return new Map(args);
  }

  /**
   * A `Parallel` state is used to execute multiple branches of a state in parallel.
   *
   * @example
   * ```ts title="sst.config.ts"
   * const processorA = sst.aws.StepFunctions.lambdaInvoke({
   *   name: "ProcessorA",
   *   function: "src/processorA.handler"
   * });
   *
   * const processorB = sst.aws.StepFunctions.lambdaInvoke({
   *   name: "ProcessorB",
   *   function: "src/processorB.handler"
   * });
   *
   * const parallel = sst.aws.StepFunctions.parallel({ name: "Parallel" });
   *
   * parallel.branch(processorA);
   * parallel.branch(processorB);
   * ```
   */
  public static parallel(args: ParallelArgs) {
    return new Parallel(args);
  }

  /**
   * A `Pass` state is used to pass the input to the next state. It's useful for
   * transforming the input before passing it along.
   *
   * @example
   * ```ts title="sst.config.ts"
   * sst.aws.StepFunctions.pass({
   *   name: "Pass",
   *   output: "{% $states.input.message %}"
   * });
   * ```
   */
  public static pass(args: PassArgs) {
    return new Pass(args);
  }

  /**
   * A `Succeed` state is used to indicate that the execution of a state machine
   * has succeeded.
   *
   * @example
   * ```ts title="sst.config.ts"
   * sst.aws.StepFunctions.succeed({ name: "Succeed" });
   * ```
   */
  public static succeed(args: SucceedArgs) {
    return new Succeed(args);
  }

  /**
   * A `Wait` state is used to wait for a specific amount of time before continuing
   * to the next state.
   *
   * @example
   *
   * For example, wait for 10 seconds before continuing to the next state.
   *
   * ```ts title="sst.config.ts"
   * sst.aws.StepFunctions.wait({
   *   name: "Wait",
   *   time: 10
   * });
   * ```
   *
   * Alternatively, you can wait until a specific timestamp.
   *
   * ```ts title="sst.config.ts"
   * sst.aws.StepFunctions.wait({
   *   name: "Wait",
   *   timestamp: "2026-01-01T00:00:00Z"
   * });
   * ```
   */
  public static wait(args: WaitArgs) {
    return new Wait(args);
  }

  /**
   * A `Task` state can be used to make calls to AWS resources. We created a few
   * convenience methods for common tasks like:
   *
   * - `sst.aws.StepFunctions.lambdaInvoke` to invoke a Lambda function.
   * - `sst.aws.StepFunctions.ecsRunTask` to run an ECS task.
   * - `sst.aws.StepFunctions.eventBridgePutEvents` to send custom events to
   *   EventBridge.
   *
   * For everything else, you can use the `Task` state.
   *
   * @example
   *
   * For example, to start an AWS CodeBuild build.
   *
   * ```ts title="sst.config.ts"
   * sst.aws.StepFunctions.task({
   *   name: "Task",
   *   resource: "arn:aws:states:::codebuild:startBuild",
   *   arguments: {
   *     projectName: "my-codebuild-project"
   *   },
   *   permissions: [
   *     {
   *       actions: ["codebuild:StartBuild"],
   *       resources: ["*"]
   *     }
   *   ]
   * });
   * ```
   */
  public static task(args: TaskArgs) {
    return new Task(args);
  }

  /**
   * Create a `Task` state that invokes a Lambda function. [Learn more](https://docs.aws.amazon.com/lambda/latest/api/API_Invoke.html).
   *
   * @example
   * ```ts title="sst.config.ts"
   * sst.aws.StepFunctions.lambdaInvoke({
   *   name: "LambdaInvoke",
   *   function: "src/index.handler"
   * });
   * ```
   *
   * Customize the function.
   *
   * ```ts title="sst.config.ts"
   * sst.aws.StepFunctions.lambdaInvoke({
   *   name: "LambdaInvoke",
   *   function: {
   *     handler: "src/index.handler"
   *     timeout: "60 seconds",
   *   }
   * });
   * ```
   *
   * Pass in an existing `Function` component.
   *
   * ```ts title="sst.config.ts"
   * const myLambda = new sst.aws.Function("MyLambda", {
   *   handler: "src/index.handler"
   * });
   *
   * sst.aws.StepFunctions.lambdaInvoke({
   *   name: "LambdaInvoke",
   *   function: myLambda
   * });
   * ```
   *
   * Or pass in the ARN of an existing Lambda function.
   *
   * ```ts title="sst.config.ts"
   * sst.aws.StepFunctions.lambdaInvoke({
   *   name: "LambdaInvoke",
   *   function: "arn:aws:lambda:us-east-1:123456789012:function:my-function"
   * });
   * ```
   */
  public static lambdaInvoke(args: LambdaInvokeArgs) {
    const fn =
      args.function instanceof Function
        ? args.function
        : functionBuilder(`${args.name}Function`, args.function, {});

    return new Task({
      ...args,
      resource: "arn:aws:states:::lambda:invoke",
      arguments: {
        FunctionName: fn.arn,
        Payload: args.payload,
      },
      permissions: [
        {
          actions: ["lambda:InvokeFunction"],
          resources: [fn.arn],
        },
      ],
    });
  }

  /**
   * Create a `Task` state that publishes a message to an SNS topic. [Learn more](https://docs.aws.amazon.com/sns/latest/api/API_Publish.html).
   *
   * @example
   * ```ts title="sst.config.ts"
   * const myTopic = new sst.aws.SnsTopic("MyTopic");
   *
   * sst.aws.StepFunctions.snsPublish({
   *   name: "SnsPublish",
   *   topic: myTopic,
   *   message: "Hello, world!"
   * });
   * ```
   */
  public static snsPublish(args: SnsPublishArgs) {
    return new Task({
      ...args,
      resource: "arn:aws:states:::sns:publish",
      arguments: {
        TopicArn: args.topic.arn,
        Message: args.message,
        MessageAttributes: args.messageAttributes,
        MessageDeduplicationId: args.messageDeduplicationId,
        MessageGroupId: args.messageGroupId,
        Subject: args.subject,
      },
      permissions: [
        {
          actions: ["sns:Publish"],
          resources: [args.topic.arn],
        },
      ],
    });
  }

  /**
   * Create a `Task` state that sends a message to an SQS queue. [Learn more](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_SendMessage.html).
   *
   * @example
   * ```ts title="sst.config.ts"
   * const myQueue = new sst.aws.Queue("MyQueue");
   *
   * sst.aws.StepFunctions.sqsSendMessage({
   *   name: "SqsSendMessage",
   *   queue: myQueue,
   *   messageBody: "Hello, world!"
   * });
   * ```
   */
  public static sqsSendMessage(args: SqsSendMessageArgs) {
    return new Task({
      ...args,
      resource: "arn:aws:states:::sqs:sendMessage",
      arguments: {
        QueueUrl: args.queue.url,
        MessageBody: args.messageBody,
        MessageAttributes: args.messageAttributes,
        MessageDeduplicationId: args.messageDeduplicationId,
        MessageGroupId: args.messageGroupId,
      },
      permissions: [
        {
          actions: ["sqs:SendMessage"],
          resources: [args.queue.arn],
        },
      ],
    });
  }

  /**
   * Create a `Task` state that runs an ECS task using the [`Task`](/docs/component/aws/task) component. [Learn more](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_RunTask.html).
   *
   * @example
   * ```ts title="sst.config.ts"
   * const myCluster = new sst.aws.Cluster("MyCluster");
   * const myTask = new sst.aws.Task("MyTask", { cluster: myCluster });
   *
   * sst.aws.StepFunctions.ecsRunTask({
   *   name: "RunTask",
   *   task: myTask
   * });
   * ```
   */
  public static ecsRunTask(args: EcsRunTaskArgs) {
    return new Task({
      ...args,
      resource: "arn:aws:states:::ecs:runTask",
      arguments: {
        Cluster: args.task.cluster,
        TaskDefinition: args.task.taskDefinition,
        LaunchType: "FARGATE",
        NetworkConfiguration: {
          AwsvpcConfiguration: {
            Subnets: args.task.subnets,
            SecurityGroups: args.task.securityGroups,
            AssignPublicIp: args.task.assignPublicIp.apply((v) =>
              v ? "ENABLED" : "DISABLED",
            ),
          },
        },
        Overrides:
          args.environment &&
          all([args.environment, args.task.containers]).apply(
            ([environment, containers]) => ({
              ContainerOverrides: containers.map((name) => ({
                Name: name,
                Environment: Object.entries(environment).map(
                  ([name, value]) => ({ Name: name, Value: value }),
                ),
              })),
            }),
          ),
      },
      permissions: [
        {
          actions: ["ecs:RunTask"],
          resources: [args.task.nodes.taskDefinition.arn],
        },
        {
          actions: ["iam:PassRole"],
          resources: [
            args.task.nodes.executionRole.arn,
            args.task.nodes.taskRole.arn,
          ],
        },
      ],
    });
  }

  /**
   * Create a `Task` state that sends custom events to one or more EventBridge buses
   * using the [`Bus`](/docs/component/aws/bus) component. [Learn more](https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_PutEvents.html).
   *
   * @example
   * ```ts title="sst.config.ts"
   * const myBus = new sst.aws.EventBus("MyBus");
   *
   * sst.aws.StepFunctions.eventBridgePutEvents({
   *   name: "EventBridgePutEvents",
   *   events: [
   *     {
   *       bus: myBus,
   *       source: "my-source"
   *     }
   *   ]
   * });
   * ```
   */
  public static eventBridgePutEvents(args: EventBridgePutEventsArgs) {
    const busArns = output(args.events).apply((events) =>
      all(events.map((event) => event.bus.arn)).apply((arns) =>
        arns.filter((arn, index, self) => self.indexOf(arn) === index),
      ),
    );

    return new Task({
      ...args,
      resource: "arn:aws:states:::events:putEvents",
      arguments: {
        Entries: output(args.events).apply((events) =>
          events.map((event) => ({
            EventBusName: event.bus.name,
            Source: event.source,
            DetailType: event.detailType,
            Detail: event.detail,
          })),
        ),
      },
      permissions: [
        {
          actions: ["events:PutEvents"],
          resources: busArns,
        },
      ],
    });
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        arn: this.arn,
      },
      include: [
        permission({
          actions: ["states:*"],
          resources: [
            this.arn,
            this.arn.apply(
              (arn) => `${arn.replace("stateMachine", "execution")}:*`,
            ),
          ],
        }),
        permission({
          actions: [
            "states:SendTaskSuccess",
            "states:SendTaskFailure",
            "states:SendTaskHeartbeat",
          ],
          resources: ["*"],
        }),
      ],
    };
  }
}

const __pulumiType = "sst:aws:StepFunctions";
// @ts-expect-error
StepFunctions.__pulumiType = __pulumiType;
