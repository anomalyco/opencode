import {
  ComponentResourceOptions,
  Input,
  Output,
  output,
} from "@pulumi/pulumi";
import { Component, transform } from "../component";
import { apigatewayv2 } from "@pulumi/aws";
import {
  ApiGatewayV2BaseRouteArgs,
  createApiRoute,
} from "./apigatewayv2-base-route";

export interface Args extends ApiGatewayV2BaseRouteArgs {
  /**
   * The ARN of the AWS Load Balancer or Cloud Map service.
   * @example
   * ```js
   * {
   *   arn: "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/my-load-balancer/50dc6c495c0c9188"
   * }
   * ```
   */
  arn: Input<string>;
  /**
   * The ID of the VPC link.
   * @example
   * ```js
   * {
   *   vpcLink: "vpcl-0123456789abcdef"
   * }
   * ```
   */
  vpcLink: Input<string>;
}

/**
 * The `ApiGatewayV2PrivateRoute` component is internally used by the `ApiGatewayV2` component
 * to add routes to [Amazon API Gateway HTTP API](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api.html).
 *
 * :::note
 * This component is not intended to be created directly.
 * :::
 *
 * You'll find this component returned by the `routePrivate` method of the `ApiGatewayV2` component.
 */
export class ApiGatewayV2PrivateRoute extends Component {
  private readonly apiRoute: Output<apigatewayv2.Route>;
  private readonly integration: apigatewayv2.Integration;

  constructor(name: string, args: Args, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);

    const self = this;
    const api = output(args.api);

    const integration = createIntegration();
    const apiRoute = createApiRoute(name, args, integration.id, self);

    this.apiRoute = apiRoute;
    this.integration = integration;

    function createIntegration() {
      return new apigatewayv2.Integration(
        ...transform(
          args.transform?.integration,
          `${name}Integration`,
          {
            apiId: api.id,
            connectionId: args.vpcLink,
            connectionType: "VPC_LINK",
            integrationType: "HTTP_PROXY",
            integrationUri: args.arn,
            integrationMethod: "ANY",
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
    return {
      /**
       * The API Gateway HTTP API route.
       */
      route: this.apiRoute,
      /**
       * The API Gateway HTTP API integration.
       */
      integration: this.integration,
    };
  }
}

const __pulumiType = "sst:aws:ApiGatewayV2PrivateRoute";
// @ts-expect-error
ApiGatewayV2PrivateRoute.__pulumiType = __pulumiType;
