import { Input, Output, interpolate, output } from "@pulumi/pulumi";
import { Component, transform } from "../component";
import { apigateway } from "@pulumi/aws";
import { ApiGatewayV1RouteArgs } from "./apigatewayv1";

export interface ApiGatewayV1BaseRouteArgs extends ApiGatewayV1RouteArgs {
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
   * The route method.
   */
  method: string;
  /**
   * The route path.
   */
  path: string;
  /**
   * The route resource ID.
   */
  resourceId: Input<string>;
}

export function createMethod(
  name: string,
  args: ApiGatewayV1BaseRouteArgs,
  parent: Component,
) {
  const { api, method, resourceId, auth, apiKey } = args;

  const authArgs = output(auth).apply((auth) => {
    if (!auth) return { authorization: "NONE" };
    if (auth.iam) return { authorization: "AWS_IAM" };
    if (auth.custom)
      return { authorization: "CUSTOM", authorizerId: auth.custom };
    if (auth.cognito)
      return {
        authorization: "COGNITO_USER_POOLS",
        authorizerId: auth.cognito.authorizer,
        authorizationScopes: auth.cognito.scopes,
      };
    return { authorization: "NONE" };
  });

  return authArgs.apply(
    (authArgs) =>
      new apigateway.Method(
        ...transform(
          args.transform?.method,
          `${name}Method`,
          {
            restApi: output(api).id,
            resourceId: resourceId,
            httpMethod: method,
            authorization: authArgs.authorization,
            authorizerId: authArgs.authorizerId,
            authorizationScopes: authArgs.authorizationScopes,
            apiKeyRequired: apiKey,
          },
          { parent },
        ),
      ),
  );
}
