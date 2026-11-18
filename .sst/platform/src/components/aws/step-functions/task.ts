import { all, Output, output } from "@pulumi/pulumi";
import { Duration, toSeconds } from "../../duration";
import { Input } from "../../input";
import { Prettify } from "../../component";
import {
  Function,
  FunctionArgs,
  FunctionArn,
  FunctionPermissionArgs,
} from "../function";
import {
  CatchArgs,
  Failable,
  isJSONata,
  JSONata,
  Nextable,
  RetryArgs,
  State,
  StateArgs,
} from "./state";
import { SnsTopic } from "../sns-topic";
import { Queue } from "../queue";
import { Task as ServiceTask } from "../task";
import { Bus } from "../bus";

interface TaskBaseArgs extends StateArgs {
  /**
   * Specifies how a `Task` state integrates with the specified AWS service.
   *
   * The `response` integration is the default. The `Task` state calls a service and
   * progress to the next state immediately after it gets an HTTP response.
   *
   * In `sync` integration, the `Task` state waits for the service to complete the
   * job (ie. Amazon ECS task, AWS CodeBuild build, etc.) before progressing to
   * the next state.
   *
   * In `token` integration, the `Task` state calls a service and pauses until a task token
   * is returned. To resume execution, call the [`SendTaskSuccess`](https://docs.aws.amazon.com/step-functions/latest/apireference/API_SendTaskSuccess.html)
   * or [`SendTaskFailure`](https://docs.aws.amazon.com/step-functions/latest/apireference/API_SendTaskFailure.html)
   * API with the task token.
   *
   * Learn more about [service integration patterns](https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html).
   *
   * @default `"response"`
   *
   * @example
   *
   * ```ts
   * {
   *   integration: "token"
   * }
   * ```
   */
  integration?: Input<"response" | "sync" | "token">;
  /**
   * Specifies a target role the state machine's execution role must assume before invoking the specified resource.
   * See [Task state's Credentials field](https://docs.aws.amazon.com/step-functions/latest/dg/state-task.html#task-state-example-credentials) examples.
   *
   * @internal
   *
   * @example
   *
   * ```ts
   * {
   *   role: "arn:aws:iam::123456789012:role/MyRole"
   * }
   * ```
   */
  role?: Input<string>;
  /**
   * Specifies the maximum time a task can run before it times out with the
   * `States.Timeout` error and fails.
   *
   * @example
   * ```ts
   * {
   *   timeout: "10 seconds"
   * }
   * ```
   *
   * Alternatively, you can specify a JSONata expression that evaluates to a number
   * in seconds.
   *
   * ```ts
   * {
   *   time: "{% $states.input.timeout %}"
   * }
   * ```
   *
   * @default `"99999999 seconds"`
   */
  timeout?: Input<JSONata | Duration>;
}

export interface TaskArgs extends TaskBaseArgs {
  /**
   * Specifies the maximum time a task can run before it times out with the
   * `States.Timeout` error and fails.
   *
   * @example
   * ```ts
   * {
   *   timeout: "10 seconds"
   * }
   * ```
   *
   * Alternatively, you can specify a JSONata expression that evaluates to a number
   * in seconds.
   *
   * ```ts
   * {
   *   time: "{% $states.input.timeout %}"
   * }
   * ```
   *
   * @default `"60 seconds"` for HTTP tasks, `"99999999 seconds"` for all other tasks.
   */
  timeout?: Input<JSONata | Duration>;
  /**
   * The ARN of the task. Follows the format.
   *
   * ```ts
   * {
   *   resource: "arn:aws:states:::service:task_type:name"
   * }
   * ```
   *
   * @example
   *
   * For example, to start an AWS CodeBuild build.
   *
   * ```ts
   * {
   *   resource: "arn:aws:states:::codebuild:startBuild"
   * }
   * ```
   *
   * Learn more about [task ARNs](https://docs.aws.amazon.com/step-functions/latest/dg/state-task.html#task-types).
   *
   */
  resource: Input<string>;
  /**
   * The arguments to be passed to the APIs of the connected resources. Values can
   * include outputs from other resources and JSONata expressions.
   *
   * @example
   *
   * ```ts
   * {
   *   arguments: {
   *     product: "{% $states.input.order.product %}",
   *     url: api.url,
   *     count: 32
   *   }
   * }
   * ```
   */
  arguments?: Input<Record<string, Input<any>>>;
  /**
   * Permissions and the resources that the task needs to access. These permissions
   * are used to create the task's IAM role.
   *
   * @example
   * For example, allow the task to read and write to an S3 bucket called
   * `my-bucket`.
   *
   * ```js
   * {
   *   permissions: [
   *     {
   *       actions: ["s3:GetObject", "s3:PutObject"],
   *       resources: ["arn:aws:s3:::my-bucket/*"]
   *     }
   *   ]
   * }
   * ```
   *
   * Allow the task to perform all actions on an S3 bucket called `my-bucket`.
   *
   * ```js
   * {
   *   permissions: [
   *     {
   *       actions: ["s3:*"],
   *       resources: ["arn:aws:s3:::my-bucket/*"]
   *     }
   *   ]
   * }
   * ```
   *
   * Granting the task permissions to access all resources.
   *
   * ```js
   * {
   *   permissions: [
   *     {
   *       actions: ["*"],
   *       resources: ["*"]
   *     }
   *   ]
   * }
   * ```
   */
  permissions?: Prettify<FunctionPermissionArgs>[];
}

/**
 * The `Task` state is internally used by the `StepFunctions` component to add a [Task
 * workflow state](https://docs.aws.amazon.com/step-functions/latest/dg/state-task.html)
 * to a state machine.
 *
 * :::note
 * This component is not intended to be created directly.
 * :::
 *
 * You'll find this component returned by the `task` method of the `StepFunctions`
 * component.
 *
 * It's also returned by convenience methods like `lambdaInvoke`, `snsPublish`,
 * `sqsSendMessage`, and more.
 */
export class Task extends State implements Nextable, Failable {
  private resource: Output<string>;

  constructor(protected args: TaskArgs) {
    super(args);

    const integration = output(this.args.integration ?? "response");
    this.resource = all([this.args.resource, integration]).apply(
      ([resource, integration]) => {
        if (integration === "sync" && !resource.endsWith(".sync"))
          return `${resource}.sync`;
        if (integration === "token" && !resource.endsWith(".waitForTaskToken"))
          return `${resource}.waitForTaskToken`;
        return resource;
      },
    );
  }

  /**
   * Add a next state to the `Task` state. If the state completes successfully,
   * continue execution to the given `state`.
   *
   * @param state The state to transition to.
   *
   * @example
   *
   * ```ts title="sst.config.ts"
   * sst.aws.StepFunctions.task({
   *   // ...
   * })
   * .next(state);
   * ```
   */
  public next<T extends State>(state: T): T {
    return this.addNext(state);
  }

  /**
   * Add a retry behavior to the `Task` state. If the state fails with any of the
   * specified errors, retry the execution.
   *
   * @param args Properties to define the retry behavior.
   *
   * @example
   *
   * This defaults to.
   *
   * ```ts title="sst.config.ts" {5-8}
   * sst.aws.StepFunctions.task({
   *   // ...
   * })
   * .retry({
   *   errors: ["States.ALL"],
   *   interval: "1 second",
   *   maxAttempts: 3,
   *   backoffRate: 2
   * });
   * ```
   */
  public retry(args?: RetryArgs) {
    return this.addRetry(args);
  }

  /**
   * Add a catch behavior to the `Task` state. So if the state fails with any of the
   * specified errors, it'll continue execution to the given `state`.
   *
   * @param state The state to transition to on error.
   * @param args Properties to customize error handling.
   *
   * @example
   *
   * This defaults to.
   *
   * ```ts title="sst.config.ts" {5}
   * sst.aws.StepFunctions.task({
   *   // ...
   * })
   * .catch({
   *   errors: ["States.ALL"]
   * });
   * ```
   */
  public catch(state: State, args: CatchArgs = {}) {
    return this.addCatch(state, args);
  }

  /**
   * @internal
   */
  public getPermissions() {
    return [...(this.args.permissions || []), ...super.getPermissions()];
  }

  /**
   * Serialize the state into JSON state definition.
   */
  protected toJSON() {
    return {
      Type: "Task",
      ...super.toJSON(),
      Resource: this.resource,
      Credentials: this.args.role && {
        RoleArn: this.args.role,
      },
      Timeout: this.args.timeout
        ? output(this.args.timeout).apply((t) =>
            isJSONata(t) ? t : toSeconds(t as Duration),
          )
        : undefined,
      Arguments: this.args.arguments,
    };
  }
}

export interface LambdaInvokeArgs extends TaskBaseArgs {
  /**
   * The `Function` to invoke.
   */
  function: Function | Input<string | FunctionArgs | FunctionArn>;
  /**
   * The payload to send to the Lambda function. Values can include outputs from
   * other resources and JSONata expressions.
   * @example
   *
   * ```ts
   * {
   *   payload: {
   *     env: "{% $states.input.foo %}",
   *     url: api.url,
   *     key: 1
   *   }
   * }
   * ```
   */
  payload?: Record<string, Input<unknown>>;
}

export interface SnsPublishArgs extends TaskBaseArgs {
  /**
   * The `SnsTopic` component to publish the message to.
   */
  topic: SnsTopic;
  /**
   * The message to send to the SNS topic.
   */
  message: Input<string>;
  /**
   * The message attributes to send to the SNS topic. Values can include outputs
   * from other resources and JSONata expressions.
   * @example
   *
   * ```ts
   * {
   *   messageAttributes: {
   *     env: "{% $states.input.foo %}",
   *     url: api.url,
   *     key: 1
   *   }
   * }
   * ```
   */
  messageAttributes?: Input<Record<string, Input<string>>>;
  /**
   * The message deduplication ID to send to the SNS topic. This applies to FIFO
   * topics only.
   *
   * This is a string that's used to deduplicate messages sent within the minimum
   * 5 minute interval.
   */
  messageDeduplicationId?: Input<string>;
  /**
   * The message group ID to send to the SNS topic. This only applies to FIFO
   * topics.
   */
  messageGroupId?: Input<string>;
  /**
   * An optional subject line when the message is delivered to email endpoints.
   */
  subject?: Input<string>;
}

export interface SqsSendMessageArgs extends TaskBaseArgs {
  /**
   * The `Queue` component to send the message to.
   */
  queue: Queue;
  /**
   * The message body to send to the SQS queue. The maximum size is 256KB.
   */
  messageBody: Input<string | Record<string, Input<unknown>>>;
  /**
   * The message attributes to send to the SQS queue. Values can include outputs
   * from other resources and JSONata expressions.
   * @example
   *
   * ```ts
   * {
   *   messageAttributes: {
   *     env: "{% $states.input.foo %}",
   *     url: api.url,
   *     key: 1
   *   }
   * }
   * ```
   */
  messageAttributes?: Input<Record<string, Input<string>>>;
  /**
   * The message deduplication ID to send to the SQS queue. This applies to FIFO
   * queues only.
   *
   * This is a string that's used to deduplicate messages sent within the minimum
   * 5 minute interval.
   */
  messageDeduplicationId?: Input<string>;
  /**
   * The message group ID to send to the SQS queue. This only applies to FIFO
   * queues.
   */
  messageGroupId?: Input<string>;
}

export interface EcsRunTaskArgs extends TaskBaseArgs {
  /**
   * The ECS `Task` to run.
   *
   * ```ts title="sst.config.ts" {6}
   * const myCluster = new sst.aws.Cluster("MyCluster");
   * const myTask = new sst.aws.Task("MyTask", { cluster: myCluster });
   *
   * sst.aws.StepFunctions.ecsRunTask({
   *   name: "RunTask",
   *   task: myTask
   * });
   * ```
   */
  task: ServiceTask;
  /**
   * The environment variables to apply to the ECS task. Values can include outputs
   * from other resources and JSONata expressions.
   * @example
   *
   * ```ts
   * {
   *   environment: {
   *     MY_ENV: "{% $states.input.foo %}",
   *     MY_URL: api.url,
   *     MY_KEY: 1
   *   }
   * }
   * ```
   */
  environment?: Input<Record<string, Input<string>>>;
}

export interface EventBridgePutEventsArgs extends TaskBaseArgs {
  /**
   * A list of events to send to the EventBridge.
   *
   * @example
   * ```ts
   * {
   *   events: [
   *     {
   *       bus: myBus,
   *       source: "my-application",
   *       detailType: "order-created",
   *       detail: {
   *         orderId: "{% $states.input.orderId %}",
   *         customerId: "{% $states.input.customer.id %}",
   *         items: "{% $states.input.items %}"
   *       }
   *     }
   *   ]
   * }
   * ```
   */
  events: {
    /**
     * The `Bus` component to send the event to.
     */
    bus: Bus;
    /**
     * The source of the event. This string or JSONata expression identifies the
     * service or component that generated it.
     */
    source?: Input<string>;
    /**
     * The detail type of the event. This helps subscribers filter and route events.
     * This can be a string or JSONata expression.
     */
    detailType?: Input<string>;
    /**
     * The event payload containing the event details as a JSON object.
     * Values can also include a JSONata expression.
     *
     * @example
     * ```ts
     * {
     *   detail: {
     *     type: "order",
     *     message: "{% $states.input.message %}"
     *   }
     * }
     * ```
     */
    detail?: Input<Record<string, Input<unknown>>>;
  }[];
}
