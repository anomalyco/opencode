import { Input, Output, interpolate, output } from "@pulumi/pulumi";
import { Component, transform } from "../component";
import { ApiGatewayV2RouteArgs } from "./apigatewayv2";
import { apigatewayv2 } from "@pulumi/aws";

export interface ApiGatewayV2BaseRouteArgs extends ApiGatewayV2RouteArgs {
  /**
   * The API Gateway to use for the route.
   */
  api: Input<{
    /**
     * The name of the API Gateway.
     */
    name: Input<string>;
    /**
     * The ID of the API Gateway.
     */
    id: Input<string>;
    /**
     * The execution ARN of the API Gateway.
     */
    executionArn: Input<string>;
  }>;
  /**
   * The path for the route.
   */
  route: Input<string>;
}

export function createApiRoute(
  name: string,
  args: ApiGatewayV2BaseRouteArgs,
  integrationId: Output<string>,
  parent: Component,
) {
  const authArgs = output(args.auth).apply((auth) => {
    if (!auth) return { authorizationType: "NONE" };
    if (auth.iam) return { authorizationType: "AWS_IAM" };
    if (auth.lambda)
      return {
        authorizationType: "CUSTOM",
        authorizerId: auth.lambda,
      };
    if (auth.jwt)
      return {
        authorizationType: "JWT",
        authorizationScopes: auth.jwt.scopes,
        authorizerId: auth.jwt.authorizer,
      };
    return { authorizationType: "NONE" };
  });

  return authArgs.apply(
    (authArgs) =>
      new apigatewayv2.Route(
        ...transform(
          args.transform?.route,
          `${name}Route`,
          {
            apiId: output(args.api).id,
            routeKey: args.route,
            target: interpolate`integrations/${integrationId}`,
            ...authArgs,
          },
          { parent },
        ),
      ),
  );
}
