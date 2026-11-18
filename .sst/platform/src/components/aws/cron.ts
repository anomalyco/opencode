import { all, ComponentResourceOptions, output, Output } from "@pulumi/pulumi";
import { Component, Transform, transform } from "../component";
import { FunctionArgs, FunctionArn } from "./function";
import { Input } from "../input.js";
import { cloudwatch, iam, lambda } from "@pulumi/aws";
import { functionBuilder, FunctionBuilder } from "./helpers/function-builder";
import { Task } from "./task";
import { VisibleError } from "../error";

export interface CronArgs {
  /**
   * The function that'll be executed when the cron job runs.
   * @deprecated Use `function` instead.
   *
   * @example
   *
   * ```ts
   * {
   *   job: "src/cron.handler"
   * }
   * ```
   *
   * You can pass in the full function props.
   *
   * ```ts
   * {
   *   job: {
   *     handler: "src/cron.handler",
   *     timeout: "60 seconds"
   *   }
   * }
   * ```
   *
   * You can also pass in a function ARN.
   *
   * ```ts
   * {
   *   job: "arn:aws:lambda:us-east-1:000000000000:function:my-sst-app-jayair-MyFunction",
   * }
   * ```
   */
  job?: Input<string | FunctionArgs | FunctionArn>;
  /**
   * The function that'll be executed when the cron job runs.
   *
   * @example
   *
   * ```ts
   * {
   *   function: "src/cron.handler"
   * }
   * ```
   *
   * You can pass in the full function props.
   *
   * ```ts
   * {
   *   function: {
   *     handler: "src/cron.handler",
   *     timeout: "60 seconds"
   *   }
   * }
   * ```
   *
   * You can also pass in a function ARN.
   *
   * ```ts
   * {
   *   function: "arn:aws:lambda:us-east-1:000000000000:function:my-sst-app-jayair-MyFunction",
   * }
   * ```
   */
  function?: Input<string | FunctionArgs | FunctionArn>;
  /**
   * The task that'll be executed when the cron job runs.
   *
   * @example
   *
   * For example, let's say you have a task.
   *
   * ```js title="sst.config.ts"
   * const myCluster = new sst.aws.Cluster("MyCluster");
   * const myTask = new sst.aws.Task("MyTask", { cluster: myCluster });
   * ```
   *
   * You can then pass in the task to the cron job.
   *
   * ```js title="sst.config.ts"
   * new sst.aws.Cron("MyCronJob", {
   *   task: myTask,
   *   schedule: "rate(1 minute)"
   * });
   * ```
   *
   */
  task?: Task;
  /**
   * The event that'll be passed to the function or task.
   *
   * @example
   * ```ts
   * {
   *   event: {
   *     foo: "bar",
   *   }
   * }
   * ```
   *
   * For Lambda functions, the event will be passed to the function as an event.
   *
   * ```ts
   * function handler(event) {
   *   console.log(event.foo);
   * }
   * ```
   *
   * For ECS Fargate tasks, the event will be passed to the task as the `SST_EVENT`
   * environment variable.
   *
   * ```ts
   * const event = JSON.parse(process.env.SST_EVENT);
   * console.log(event.foo);
   * ```
   */
  event?: Input<Record<string, Input<string>>>;
  /**
   * The schedule for the cron job.
   *
   * :::note
   * The cron job continues to run even after you exit `sst dev`.
   * :::
   *
   * @example
   *
   * You can use a [rate expression](https://docs.aws.amazon.com/lambda/latest/dg/services-cloudwatchevents-expressions.html).
   *
   * ```ts
   * {
   *   schedule: "rate(5 minutes)"
   *   // schedule: "rate(1 minute)"
   *   // schedule: "rate(5 minutes)"
   *   // schedule: "rate(1 hour)"
   *   // schedule: "rate(5 hours)"
   *   // schedule: "rate(1 day)"
   *   // schedule: "rate(5 days)"
   * }
   * ```
   * Or a [cron expression](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-create-rule-schedule.html#eb-cron-expressions).
   *
   * ```ts
   * {
   *   schedule: "cron(15 10 * * ? *)", // 10:15 AM (UTC) every day
   * }
   * ```
   */
  schedule: Input<`rate(${string})` | `cron(${string})`>;
  /**
   * Configures whether the cron job is enabled. When disabled, the cron job won't run.
   * @default true
   * @example
   * ```ts
   * {
   *   enabled: false
   * }
   * ```
   */
  enabled?: Input<boolean>;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying resources.
   */
  transform?: {
    /**
     * Transform the EventBridge Rule resource.
     */
    rule?: Transform<cloudwatch.EventRuleArgs>;
    /**
     * Transform the EventBridge Target resource.
     */
    target?: Transform<cloudwatch.EventTargetArgs>;
  };
}

/**
 * The `Cron` component lets you add cron jobs to your app
 * using [Amazon Event Bus](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-bus.html). The cron job can invoke a `Function` or a container `Task`.
 *
 * @example
 * #### Cron job function
 *
 * Pass in a `schedule` and a `function` that'll be executed.
 *
 * ```ts title="sst.config.ts"
 * new sst.aws.Cron("MyCronJob", {
 *   function: "src/cron.handler",
 *   schedule: "rate(1 minute)"
 * });
 * ```
 *
 * #### Cron job container task
 *
 * Create a container task and pass in a `schedule` and a `task` that'll be executed.
 *
 * ```ts title="sst.config.ts" {5}
 * const myCluster = new sst.aws.Cluster("MyCluster");
 * const myTask = new sst.aws.Task("MyTask", { cluster: myCluster });
 *
 * new sst.aws.Cron("MyCronJob", {
 *   task: myTask,
 *   schedule: "rate(1 day)"
 * });
 * ```
 *
 * #### Customize the function
 *
 * ```js title="sst.config.ts"
 * new sst.aws.Cron("MyCronJob", {
 *   schedule: "rate(1 minute)",
 *   function: {
 *     handler: "src/cron.handler",
 *     timeout: "60 seconds"
 *   }
 * });
 * ```
 */
export class Cron extends Component {
  private name: string;
  private fn?: FunctionBuilder;
  private rule: cloudwatch.EventRule;
  private target: cloudwatch.EventTarget;

  constructor(name: string, args: CronArgs, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);

    const parent = this;

    const fnArgs = normalizeFunction();
    const event = output(args.event || {});
    normalizeTargets();
    const enabled = output(args.enabled ?? true);
    const rule = createRule();
    const fn = createFunction();
    const role = createRole();
    const target = createTarget();

    this.name = name;
    this.fn = fn;
    this.rule = rule;
    this.target = target;

    function normalizeFunction() {
      if (args.job && args.function)
        throw new VisibleError(
          `You cannot provide both "job" and "function" in the "${name}" Cron component. The "job" property has been deprecated. Use "function" instead.`,
        );

      const input = args.function ?? args.job;
      return input ? output(input) : undefined;
    }

    function normalizeTargets() {
      if (fnArgs && args.task)
        throw new VisibleError(
          `You cannot provide both a function and a task in the "${name}" Cron component.`,
        );
    }

    function createRule() {
      return new cloudwatch.EventRule(
        ...transform(
          args.transform?.rule,
          `${name}Rule`,
          {
            scheduleExpression: args.schedule,
            state: enabled.apply((v) => (v ? "ENABLED" : "DISABLED")),
          },
          { parent },
        ),
      );
    }

    function createFunction() {
      if (!fnArgs) return;

      const fn = fnArgs.apply((fnArgs) =>
        functionBuilder(`${name}Handler`, fnArgs, {}, undefined, {
          parent,
        }),
      );

      new lambda.Permission(
        `${name}Permission`,
        {
          action: "lambda:InvokeFunction",
          function: fn.arn,
          principal: "events.amazonaws.com",
          sourceArn: rule.arn,
        },
        { parent },
      );

      return fn;
    }

    function createRole() {
      if (!args.task) return;

      return new iam.Role(
        `${name}TargetRole`,
        {
          assumeRolePolicy: iam.assumeRolePolicyForPrincipal({
            Service: "events.amazonaws.com",
          }),
          inlinePolicies: [
            {
              name: "inline",
              policy: iam.getPolicyDocumentOutput({
                statements: [
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
              }).json,
            },
          ],
        },
        { parent },
      );
    }

    function createTarget() {
      return new cloudwatch.EventTarget(
        ...transform(
          args.transform?.target,
          `${name}Target`,
          fn
            ? {
                arn: fn.arn,
                rule: rule.name,
                input: event.apply((event) => JSON.stringify(event)),
              }
            : {
                arn: args.task!.cluster,
                rule: rule.name,
                ecsTarget: {
                  launchType: "FARGATE",
                  taskDefinitionArn: args.task!.nodes.taskDefinition.arn,
                  networkConfiguration: {
                    subnets: args.task!.subnets,
                    securityGroups: args.task!.securityGroups,
                    assignPublicIp: args.task!.assignPublicIp,
                  },
                },
                roleArn: role!.arn,
                input: all([event, args.task!.containers]).apply(
                  ([event, containers]) => {
                    return JSON.stringify({
                      containerOverrides: containers.map((name) => ({
                        name,
                        environment: [
                          {
                            name: "SST_EVENT",
                            value: JSON.stringify(event),
                          },
                        ],
                      })),
                    });
                  },
                ),
              },
          { parent },
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
       * The AWS Lambda Function that'll be invoked when the cron job runs.
       * @deprecated Use `nodes.function` instead.
       */
      get job() {
        if (!self.fn)
          throw new VisibleError(
            `No function created for the "${self.name}" cron job.`,
          );
        return self.fn.apply((fn) => fn.getFunction());
      },
      /**
       * The AWS Lambda Function that'll be invoked when the cron job runs.
       */
      get function() {
        if (!self.fn)
          throw new VisibleError(
            `No function created for the "${self.name}" cron job.`,
          );
        return self.fn.apply((fn) => fn.getFunction());
      },
      /**
       * The EventBridge Rule resource.
       */
      rule: this.rule,
      /**
       * The EventBridge Target resource.
       */
      target: this.target,
    };
  }
}

const __pulumiType = "sst:aws:Cron";
// @ts-expect-error
Cron.__pulumiType = __pulumiType;
