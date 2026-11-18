import {
  ComponentResourceOptions,
  Input,
  interpolate,
  output,
} from "@pulumi/pulumi";
import { Component, transform } from "../component";
import { ApiGatewayV2AuthorizerArgs } from "./apigatewayv2";
import { apigatewayv2, lambda } from "@pulumi/aws";
import { VisibleError } from "../error";
import { toSeconds } from "../duration";
import { functionBuilder } from "./helpers/function-builder";

export interface AuthorizerArgs extends ApiGatewayV2AuthorizerArgs {
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
   * The type of the API Gateway.
   */
  type: "http" | "websocket";
}

/**
 * The `ApiGatewayV2Authorizer` component is internally used by the `ApiGatewayV2` component
 * to add authorizers to [Amazon API Gateway HTTP API](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api.html).
 *
 * :::note
 * This component is not intended to be created directly.
 * :::
 *
 * You'll find this component returned by the `addAuthorizer` method of the `ApiGatewayV2` component.
 */
export class ApiGatewayV2Authorizer extends Component {
  private readonly authorizer: apigatewayv2.Authorizer;

  constructor(
    name: string,
    args: AuthorizerArgs,
    opts?: ComponentResourceOptions,
  ) {
    super(__pulumiType, name, args, opts);

    const self = this;

    const api = output(args.api);
    const lamb = args.lambda && output(args.lambda);
    const jwt = args.jwt && output(args.jwt);

    validateSingleAuthorizer();
    const fn = createFunction();
    const authorizer = createAuthorizer();
    createPermission();

    this.authorizer = authorizer;

    function validateSingleAuthorizer() {
      const authorizers = [lamb, jwt].filter((e) => e);

      if (authorizers.length === 0)
        throw new VisibleError(
          `Please provide one of "lambda" or "jwt" for the ${args.name} authorizer.`,
        );

      if (authorizers.length > 1)
        throw new VisibleError(
          `Please provide only one of "lambda" or "jwt" for the ${args.name} authorizer.`,
        );
    }

    function createFunction() {
      if (!lamb) return;

      return functionBuilder(
        `${name}Handler`,
        lamb.function,
        {
          description: interpolate`${api.name} authorizer`,
        },
        undefined,
        { parent: self },
      );
    }

    function createAuthorizer() {
      const defaultIdentitySource =
        args.type === "http"
          ? "$request.header.Authorization"
          : "route.request.header.Authorization";

      return new apigatewayv2.Authorizer(
        ...transform(
          args.transform?.authorizer,
          `${name}Authorizer`,
          {
            apiId: api.id,
            ...(lamb
              ? {
                  authorizerType: "REQUEST",
                  identitySources: lamb.apply(
                    (lamb) => lamb.identitySources ?? [defaultIdentitySource],
                  ),
                  authorizerUri: fn!.invokeArn,
                  ...(args.type === "http"
                    ? {
                        authorizerResultTtlInSeconds: lamb.apply((lamb) =>
                          toSeconds(lamb.ttl ?? "0 seconds"),
                        ),
                        authorizerPayloadFormatVersion: lamb.apply(
                          (lamb) => lamb.payload ?? "2.0",
                        ),
                        enableSimpleResponses: lamb.apply(
                          (lamb) => (lamb.response ?? "simple") === "simple",
                        ),
                      }
                    : {}),
                }
              : {
                  authorizerType: "JWT",
                  identitySources: [
                    jwt!.apply(
                      (jwt) => jwt.identitySource ?? defaultIdentitySource,
                    ),
                  ],
                  jwtConfiguration: jwt!.apply((jwt) => ({
                    audiences: jwt.audiences,
                    issuer: jwt.issuer,
                  })),
                }),
          },
          { parent: self },
        ),
      );
    }

    function createPermission() {
      if (!fn) return;

      return new lambda.Permission(
        `${name}Permission`,
        {
          action: "lambda:InvokeFunction",
          function: fn.arn,
          principal: "apigateway.amazonaws.com",
          sourceArn: interpolate`${api.executionArn}/authorizers/${authorizer.id}`,
        },
        { parent: self },
      );
    }
  }

  /**
   * The ID of the authorizer.
   */
  public get id() {
    return this.authorizer.id;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The API Gateway V2 authorizer.
       */
      authorizer: this.authorizer,
    };
  }
}

const __pulumiType = "sst:aws:ApiGatewayV2Authorizer";
// @ts-expect-error
ApiGatewayV2Authorizer.__pulumiType = __pulumiType;
