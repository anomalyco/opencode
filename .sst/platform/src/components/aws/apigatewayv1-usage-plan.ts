import { apigateway } from "@pulumi/aws";
import { ComponentResourceOptions, Input, output } from "@pulumi/pulumi";
import { Component } from "../component";
import {
  ApiGatewayV1ApiKeyArgs,
  ApiGatewayV1UsagePlanArgs,
} from "./apigatewayv1";
import { ApiGatewayV1ApiKey } from "./apigatewayv1-api-key";

export interface UsagePlanArgs extends ApiGatewayV1UsagePlanArgs {
  /**
   * The API Gateway REST API to use for the usage plan.
   */
  apiId: Input<string>;
  /**
   * The stage of the API Gateway REST API.
   */
  apiStage: Input<string>;
}

/**
 * The `ApiGatewayV1UsagePlan` component is internally used by the `ApiGatewayV1` component
 * to add usage plans to [Amazon API Gateway REST API](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-rest-api.html).
 *
 * :::note
 * This component is not intended to be created directly.
 * :::
 *
 * You'll find this component returned by the `addUsagePlan` method of the `ApiGatewayV1` component.
 */
export class ApiGatewayV1UsagePlan extends Component {
  private constructorArgs: UsagePlanArgs;
  private constructorOpts: ComponentResourceOptions;
  private readonly plan: apigateway.UsagePlan;

  constructor(
    name: string,
    args: UsagePlanArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super(__pulumiType, name, args, opts);

    const self = this;

    this.plan = new apigateway.UsagePlan(
      `${name}UsagePlan`,
      {
        apiStages: [{ apiId: args.apiId, stage: args.apiStage }],
        quotaSettings:
          args.quota &&
          output(args.quota).apply((quota) => ({
            limit: quota.limit,
            period: quota.period.toUpperCase(),
            offset: quota.offset,
          })),
        throttleSettings:
          args.throttle &&
          output(args.throttle).apply((throttle) => ({
            burstLimit: throttle.burst,
            rateLimit: throttle.rate,
          })),
      },
      { parent: self },
    );

    this.constructorArgs = args;
    this.constructorOpts = opts;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The API Gateway Usage Plan.
       */
      usagePlan: this.plan,
    };
  }

  /**
   * Add an API key to the API Gateway usage plan.
   *
   * @param name The name of the API key.
   * @param args Configure the API key.
   * @example
   * ```js title="sst.config.ts"
   * plan.addApiKey("MyKey", {
   *   value: "d41d8cd98f00b204e9800998ecf8427e",
   * });
   * ```
   */
  public addApiKey(name: string, args?: ApiGatewayV1ApiKeyArgs) {
    return new ApiGatewayV1ApiKey(
      name,
      {
        apiId: this.constructorArgs.apiId,
        usagePlanId: this.plan.id,
        ...args,
      },
      { provider: this.constructorOpts.provider },
    );
  }
}

const __pulumiType = "sst:aws:ApiGatewayV1UsagePlan";
// @ts-expect-error
ApiGatewayV1UsagePlan.__pulumiType = __pulumiType;
