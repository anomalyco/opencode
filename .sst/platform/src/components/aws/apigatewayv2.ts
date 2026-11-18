import { ComponentResourceOptions, Output, all, output } from "@pulumi/pulumi";
import {
  Component,
  outputId,
  Prettify,
  Transform,
  transform,
} from "../component";
import { Link } from "../link";
import type { Input } from "../input";
import { FunctionArgs, FunctionArn } from "./function";
import { hashStringToPrettyString, physicalName, logicalName } from "../naming";
import { VisibleError } from "../error";
import { DnsValidatedCertificate } from "./dns-validated-certificate";
import { RETENTION } from "./logging";
import { dns as awsDns } from "./dns";
import { ApiGatewayV2DomainArgs } from "./helpers/apigatewayv2-domain";
import { ApiGatewayV2LambdaRoute } from "./apigatewayv2-lambda-route";
import { ApiGatewayV2Authorizer } from "./apigatewayv2-authorizer";
import { apigatewayv2, cloudwatch, types } from "@pulumi/aws";
import { ApiGatewayV2UrlRoute } from "./apigatewayv2-url-route";
import {
  Duration,
  DurationHours,
  DurationMinutes,
  toSeconds,
} from "../duration";
import { ApiGatewayV2PrivateRoute } from "./apigatewayv2-private-route";
import { Vpc } from "./vpc";

interface ApiGatewayV2CorsArgs {
  /**
   * Allow cookies or other credentials in requests to the HTTP API.
   * @default `false`
   * @example
   * ```js
   * {
   *   cors: {
   *     allowCredentials: true
   *   }
   * }
   * ```
   */
  allowCredentials?: Input<boolean>;
  /**
   * The HTTP headers that origins can include in requests to the HTTP API.
   * @default `["*"]`
   * @example
   * ```js
   * {
   *   cors: {
   *     allowHeaders: ["date", "keep-alive", "x-custom-header"]
   *   }
   * }
   * ```
   */
  allowHeaders?: Input<Input<string>[]>;
  /**
   * The origins that can access the HTTP API.
   * @default `["*"]`
   * @example
   * ```js
   * {
   *   cors: {
   *     allowOrigins: ["https://www.example.com", "http://localhost:60905"]
   *   }
   * }
   * ```
   * Or the wildcard for all origins.
   * ```js
   * {
   *   cors: {
   *     allowOrigins: ["*"]
   *   }
   * }
   * ```
   */
  allowOrigins?: Input<Input<string>[]>;
  /**
   * The HTTP methods that are allowed when calling the HTTP API.
   * @default `["*"]`
   * @example
   * ```js
   * {
   *   cors: {
   *     allowMethods: ["GET", "POST", "DELETE"]
   *   }
   * }
   * ```
   * Or the wildcard for all methods.
   * ```js
   * {
   *   cors: {
   *     allowMethods: ["*"]
   *   }
   * }
   * ```
   */
  allowMethods?: Input<
    Input<
      "*" | "DELETE" | "GET" | "HEAD" | "OPTIONS" | "PATCH" | "POST" | "PUT"
    >[]
  >;
  /**
   * The HTTP headers you want to expose in your function to an origin that calls the HTTP API.
   * @default `[]`
   * @example
   * ```js
   * {
   *   cors: {
   *     exposeHeaders: ["date", "keep-alive", "x-custom-header"]
   *   }
   * }
   * ```
   */
  exposeHeaders?: Input<Input<string>[]>;
  /**
   * The maximum amount of time the browser can cache results of a preflight request. By
   * default the browser doesn't cache the results. The maximum value is `86400 seconds` or `1 day`.
   * @default `"0 seconds"`
   * @example
   * ```js
   * {
   *   cors: {
   *     maxAge: "1 day"
   *   }
   * }
   * ```
   */
  maxAge?: Input<Duration>;
}

export interface ApiGatewayV2Args {
  /**
   * [Link resources](/docs/linking/) to all your API Gateway routes.
   *
   * Linked resources will be merged with the resources linked to each route.
   *
   * @example
   *
   * Takes a list of resources to link to all the routes.
   *
   * ```js
   * {
   *   link: [bucket, stripeKey]
   * }
   * ```
   */
  link?: FunctionArgs["link"];
  /**
   * Set a custom domain for your HTTP API.
   *
   * Automatically manages domains hosted on AWS Route 53, Cloudflare, and Vercel. For other
   * providers, you'll need to pass in a `cert` that validates domain ownership and add the
   * DNS records.
   *
   * :::tip
   * Built-in support for AWS Route 53, Cloudflare, and Vercel. And manual setup for other
   * providers.
   * :::
   *
   * @example
   *
   * By default this assumes the domain is hosted on Route 53.
   *
   * ```js
   * {
   *   domain: "example.com"
   * }
   * ```
   *
   * For domains hosted on Cloudflare.
   *
   * ```js
   * {
   *   domain: {
   *     name: "example.com",
   *     dns: sst.cloudflare.dns()
   *   }
   * }
   * ```
   */
  domain?: Input<string | Prettify<ApiGatewayV2DomainArgs>>;
  /**
   * Customize the CORS (Cross-origin resource sharing) settings for your HTTP API.
   * @default `true`
   * @example
   * Disable CORS.
   * ```js
   * {
   *   cors: false
   * }
   * ```
   * Only enable the `GET` and `POST` methods for `https://example.com`.
   * ```js
   * {
   *   cors: {
   *     allowMethods: ["GET", "POST"],
   *     allowOrigins: ["https://example.com"]
   *   }
   * }
   * ```
   */
  cors?: Input<boolean | Prettify<ApiGatewayV2CorsArgs>>;
  /**
   * Configure the [API Gateway logs](https://docs.aws.amazon.com/apigateway/latest/developerguide/view-cloudwatch-log-events-in-cloudwatch-console.html) in CloudWatch. By default, access logs are enabled and kept for 1 month.
   * @default `{retention: "1 month"}`
   * @example
   * ```js
   * {
   *   accessLog: {
   *     retention: "forever"
   *   }
   * }
   * ```
   */
  accessLog?: Input<{
    /**
     * The duration the API Gateway logs are kept in CloudWatch.
     * @default `1 month`
     */
    retention?: Input<keyof typeof RETENTION>;
  }>;
  /**
   * Configure the API to connect to private resources in a virtual private cloud or VPC.
   * This creates a VPC link for your HTTP API.
   *
   * @example
   * Create a `Vpc` component.
   *
   * ```js title="sst.config.ts"
   * const myVpc = new sst.aws.Vpc("MyVpc");
   * ```
   *
   * Or reference an existing VPC.
   *
   * ```js title="sst.config.ts"
   * const myVpc = sst.aws.Vpc.get("MyVpc", {
   *   id: "vpc-12345678901234567"
   * });
   * ```
   *
   * And pass it in. The VPC link will be placed in the public subnets.
   *
   * ```js
   * {
   *   vpc: myVpc
   * }
   * ```
   *
   * The above is equivalent to:
   *
   * ```js
   * {
   *   vpc: {
   *     securityGroups: myVpc.securityGroups,
   *     subnets: myVpc.publicSubnets
   *   }
   * }
   * ```
   */
  vpc?:
  | Vpc
  | Input<{
    /**
     * A list of VPC security group IDs.
     */
    securityGroups: Input<Input<string>[]>;
    /**
     * A list of VPC subnet IDs.
     */
    subnets: Input<Input<string>[]>;
  }>;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the API Gateway HTTP API resource.
     */
    api?: Transform<apigatewayv2.ApiArgs>;
    /**
     * Transform the API Gateway HTTP API stage resource.
     */
    stage?: Transform<apigatewayv2.StageArgs>;
    /**
     * Transform the API Gateway HTTP API domain name resource.
     */
    domainName?: Transform<apigatewayv2.DomainNameArgs>;
    /**
     * Transform the API Gateway HTTP API VPC link resource.
     */
    vpcLink?: Transform<apigatewayv2.VpcLinkArgs>;
    /**
     * Transform the CloudWatch LogGroup resource used for access logs.
     */
    logGroup?: Transform<cloudwatch.LogGroupArgs>;
    /**
     * Transform the routes. This is called for every route that is added.
     *
     * :::note
     * This is applied right before the resource is created.
     * :::
     *
     * You can use this to set any default props for all the routes and their handler function.
     * Like the other transforms, you can either pass in an object or a callback.
     *
     * @example
     *
     * Here we are setting a default memory of `2048 MB` for our routes.
     *
     * ```js
     * {
     *   transform: {
     *     route: {
     *       handler: (args, opts) => {
     *         // Set the default if it's not set by the route
     *         args.memory ??= "2048 MB";
     *       }
     *     }
     *   }
     * }
     * ```
     *
     * Defaulting to IAM auth for all our routes.
     *
     * ```js
     * {
     *   transform: {
     *     route: {
     *       args: (props) => {
     *         // Set the default if it's not set by the route
     *         props.auth ??= { iam: true };
     *       }
     *     }
     *   }
     * }
     * ```
     */
    route?: {
      /**
       * Transform the handler function of the route.
       */
      handler?: Transform<FunctionArgs>;
      /**
       * Transform the arguments for the route.
       */
      args?: Transform<ApiGatewayV2RouteArgs>;
    };
  };
}

export interface ApiGatewayV2AuthorizerArgs {
  /**
   * The name of the authorizer.
   * @example
   * ```js
   * {
   *   name: "myAuthorizer"
   * }
   * ```
   */
  name: string;
  /**
   * Create a JWT or JSON Web Token authorizer that can be used by the routes.
   *
   * @example
   * Configure JWT auth.
   *
   * ```js
   * {
   *   jwt: {
   *     issuer: "https://issuer.com/",
   *     audiences: ["https://api.example.com"],
   *     identitySource: "$request.header.AccessToken"
   *   }
   * }
   * ```
   *
   * You can also use Cognito as the identity provider.
   *
   * ```js
   * {
   *   jwt: {
   *     audiences: [userPoolClient.id],
   *     issuer: $interpolate`https://cognito-idp.${aws.getArnOutput(userPool).region}.amazonaws.com/${userPool.id}`,
   *   }
   * }
   * ```
   *
   * Where `userPool` and `userPoolClient` are:
   *
   * ```js
   * const userPool = new aws.cognito.UserPool();
   * const userPoolClient = new aws.cognito.UserPoolClient();
   * ```
   */
  jwt?: Input<{
    /**
     * Base domain of the identity provider that issues JSON Web Tokens.
     * @example
     * ```js
     * {
     *   issuer: "https://issuer.com/"
     * }
     * ```
     */
    issuer: Input<string>;
    /**
     * List of the intended recipients of the JWT. A valid JWT must provide an `aud` that matches at least one entry in this list.
     */
    audiences: Input<Input<string>[]>;
    /**
     * Specifies where to extract the JWT from the request.
     * @default `"$request.header.Authorization"`
     */
    identitySource?: Input<string>;
  }>;
  /**
   * Create a Lambda authorizer that can be used by the routes.
   *
   * @example
   * Configure Lambda auth.
   *
   * ```js
   * {
   *   lambda: {
   *     function: "src/authorizer.index"
   *   }
   * }
   * ```
   */
  lambda?: Input<{
    /**
     * The Lambda authorizer function. Takes the handler path or the function args.
     * @example
     * Add a simple authorizer.
     *
     * ```js
     * {
     *   function: "src/authorizer.index"
     * }
     * ```
     *
     * Customize the authorizer handler.
     *
     * ```js
     * {
     *   function: {
     *     handler: "src/authorizer.index",
     *     memory: "2048 MB"
     *   }
     * }
     * ```
     */
    function: Input<string | FunctionArgs | FunctionArn>;
    /**
     * The JWT payload version.
     * @default `"2.0"`
     * @example
     * ```js
     * {
     *   payload: "2.0"
     * }
     * ```
     */
    payload?: Input<"1.0" | "2.0">;
    /**
     * The response type.
     * @default `"simple"`
     * @example
     * ```js
     * {
     *   response: "iam"
     * }
     * ```
     */
    response?: Input<"simple" | "iam">;
    /**
     * The time to live (TTL) for the authorizer.
     * @default Not cached
     * @example
     * ```js
     * {
     *   ttl: "300 seconds"
     * }
     * ```
     */
    ttl?: Input<DurationHours>;
    /**
     * Specifies where to extract the identity from.
     * @default `["$request.header.Authorization"]`
     * @example
     * ```js
     * {
     *   identitySources: ["$request.header.RequestToken"]
     * }
     * ```
     */
    identitySources?: Input<Input<string>[]>;
  }>;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the API Gateway authorizer resource.
     */
    authorizer?: Transform<apigatewayv2.AuthorizerArgs>;
  };
}

export interface ApiGatewayV2RouteArgs {
  /**
   * Enable auth for your HTTP API. By default, auth is disabled.
   *
   * @default `false`
   * @example
   * ```js
   * {
   *   auth: {
   *     iam: true
   *   }
   * }
   * ```
   */
  auth?: Input<
    | false
    | {
      /**
       * Enable IAM authorization for a given API route. When IAM auth is enabled, clients
       * need to use Signature Version 4 to sign their requests with their AWS credentials.
       */
      iam?: Input<boolean>;
      /**
       * Enable JWT or JSON Web Token authorization for a given API route. When JWT auth is enabled, clients need to include a valid JWT in their requests.
       *
       * @example
       * You can configure JWT auth.
       *
       * ```js
       * {
       *   auth: {
       *     jwt: {
       *       authorizer: myAuthorizer.id,
       *       scopes: ["read:profile", "write:profile"]
       *     }
       *   }
       * }
       * ```
       *
       * Where `myAuthorizer` is created by calling the `addAuthorizer` method.
       */
      jwt?: Input<{
        /**
         * Authorizer ID of the JWT authorizer.
         */
        authorizer: Input<string>;
        /**
         * Defines the permissions or access levels that the JWT grants. If the JWT does not have the required scope, the request is rejected. By default it does not require any scopes.
         */
        scopes?: Input<Input<string>[]>;
      }>;
      /**
       * Enable custom Lambda authorization for a given API route. Pass in the authorizer ID.
       *
       * @example
       * ```js
       * {
       *   auth: {
       *     lambda: myAuthorizer.id
       *   }
       * }
       * ```
       *
       * Where `myAuthorizer` is created by calling the `addAuthorizer` method.
       */
      lambda?: Input<string>;
    }
  >;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the API Gateway HTTP API integration resource.
     */
    integration?: Transform<apigatewayv2.IntegrationArgs>;
    /**
     * Transform the API Gateway HTTP API route resource.
     */
    route?: Transform<apigatewayv2.RouteArgs>;
  };
}

/**
 * The `ApiGatewayV2` component lets you add an [Amazon API Gateway HTTP API](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api.html) to your app.
 *
 * @example
 *
 * #### Create the API
 *
 * ```ts title="sst.config.ts"
 * const api = new sst.aws.ApiGatewayV2("MyApi");
 * ```
 *
 * #### Add a custom domain
 *
 * ```js {2} title="sst.config.ts"
 * new sst.aws.ApiGatewayV2("MyApi", {
 *   domain: "api.example.com"
 * });
 * ```
 *
 * #### Add routes
 *
 * ```ts title="sst.config.ts"
 * api.route("GET /", "src/get.handler");
 * api.route("POST /", "src/post.handler");
 * ```
 *
 * #### Configure the routes
 *
 * You can configure the route.
 *
 * ```ts title="sst.config.ts"
 * api.route("GET /", "src/get.handler", {
 *   auth: { iam: true }
 * });
 * ```
 *
 * #### Configure the route handler
 *
 * You can configure the route handler function.
 *
 * ```ts title="sst.config.ts"
 * api.route("POST /", {
 *   handler: "src/post.handler",
 *   memory: "2048 MB"
 * });
 * ```
 *
 * #### Default props for all routes
 *
 * You can use the `transform` to set some default props for all your routes. For example,
 * instead of setting the `memory` for each route.
 *
 * ```ts title="sst.config.ts"
 * api.route("GET /", { handler: "src/get.handler", memory: "2048 MB" });
 * api.route("POST /", { handler: "src/post.handler", memory: "2048 MB" });
 * ```
 *
 * You can set it through the `transform`.
 *
 * ```ts title="sst.config.ts" {6}
 * const api = new sst.aws.ApiGatewayV2("MyApi", {
 *   transform: {
 *     route: {
 *       handler: (args, opts) => {
 *         // Set the default if it's not set by the route
 *         args.memory ??= "2048 MB";
 *       }
 *     }
 *   }
 * });
 *
 * api.route("GET /", "src/get.handler");
 * api.route("POST /", "src/post.handler");
 * ```
 *
 * With this we set the `memory` if it's not overridden by the route.
 */
export class ApiGatewayV2 extends Component implements Link.Linkable {
  private constructorName: string;
  private constructorArgs: ApiGatewayV2Args;
  private constructorOpts: ComponentResourceOptions;
  private api: apigatewayv2.Api;
  private apigDomain?: Output<apigatewayv2.DomainName>;
  private apiMapping?: Output<apigatewayv2.ApiMapping>;
  private logGroup: cloudwatch.LogGroup;
  private vpcLink?: apigatewayv2.VpcLink;

  constructor(
    name: string,
    args: ApiGatewayV2Args = {},
    opts: ComponentResourceOptions = {},
  ) {
    super(__pulumiType, name, args, opts);

    const parent = this;

    const accessLog = normalizeAccessLog();
    const domain = normalizeDomain();
    const cors = normalizeCors();
    const vpc = normalizeVpc();

    const vpcLink = createVpcLink();
    const api = createApi();
    const logGroup = createLogGroup();
    const stage = createStage();

    const certificateArn = createSsl();
    const apigDomain = createDomainName();
    createDnsRecords();
    const apiMapping = createDomainMapping();

    this.constructorName = name;
    this.constructorArgs = args;
    this.constructorOpts = opts;
    this.api = api;
    this.apigDomain = apigDomain;
    this.apiMapping = apiMapping;
    this.logGroup = logGroup;
    this.vpcLink = vpcLink;

    this.registerOutputs({
      _hint: this.url,
    });

    function normalizeAccessLog() {
      return output(args.accessLog).apply((accessLog) => ({
        ...accessLog,
        retention: accessLog?.retention ?? "1 month",
      }));
    }

    function normalizeDomain() {
      if (!args.domain) return;

      return output(args.domain).apply((domain) => {
        // validate
        if (typeof domain !== "string") {
          if (domain.name && domain.nameId)
            throw new VisibleError(
              `Cannot configure both domain "name" and "nameId" for the "${name}" API.`,
            );
          if (!domain.name && !domain.nameId)
            throw new VisibleError(
              `Either domain "name" or "nameId" is required for the "${name}" API.`,
            );
          if (domain.dns === false && !domain.cert)
            throw new VisibleError(
              `Domain "cert" is required when "dns" is disabled for the "${name}" API.`,
            );
        }

        // normalize
        const norm = typeof domain === "string" ? { name: domain } : domain;
        return {
          name: norm.name,
          nameId: norm.nameId,
          path: norm.path,
          dns: norm.dns === false ? undefined : norm.dns ?? awsDns(),
          cert: norm.cert,
        };
      });
    }

    function normalizeCors() {
      return output(args.cors).apply((cors) => {
        if (cors === false) return {};

        const defaultCors: types.input.apigatewayv2.ApiCorsConfiguration = {
          allowHeaders: ["*"],
          allowMethods: ["*"],
          allowOrigins: ["*"],
        };
        return cors === true || cors === undefined
          ? defaultCors
          : {
            ...defaultCors,
            ...cors,
            maxAge: cors.maxAge && toSeconds(cors.maxAge),
          };
      });
    }

    function normalizeVpc() {
      // "vpc" is undefined
      if (!args.vpc) return;

      // "vpc" is a Vpc component
      if (args.vpc instanceof Vpc) {
        return {
          subnets: args.vpc.publicSubnets,
          securityGroups: args.vpc.securityGroups,
        };
      }

      // "vpc" is object
      return output(args.vpc);
    }

    function createVpcLink() {
      if (!vpc) return;

      return new apigatewayv2.VpcLink(
        ...transform(
          args.transform?.vpcLink,
          `${name}VpcLink`,
          {
            securityGroupIds: vpc.securityGroups,
            subnetIds: vpc.subnets,
          },
          { parent },
        ),
      );
    }

    function createApi() {
      return new apigatewayv2.Api(
        ...transform(
          args.transform?.api,
          `${name}Api`,
          {
            protocolType: "HTTP",
            corsConfiguration: cors,
          },
          { parent },
        ),
      );
    }

    function createLogGroup() {
      return new cloudwatch.LogGroup(
        ...transform(
          args.transform?.logGroup,
          `${name}AccessLog`,
          {
            name: `/aws/vendedlogs/apis/${physicalName(64, name)}`,
            retentionInDays: accessLog.apply(
              (accessLog) => RETENTION[accessLog.retention],
            ),
          },
          { parent, ignoreChanges: ["name"] },
        ),
      );
    }

    function createStage() {
      return new apigatewayv2.Stage(
        ...transform(
          args.transform?.stage,
          `${name}Stage`,
          {
            apiId: api.id,
            autoDeploy: true,
            name: "$default",
            accessLogSettings: {
              destinationArn: logGroup.arn,
              format: JSON.stringify({
                // request info
                requestTime: `"$context.requestTime"`,
                requestId: `"$context.requestId"`,
                httpMethod: `"$context.httpMethod"`,
                path: `"$context.path"`,
                routeKey: `"$context.routeKey"`,
                status: `$context.status`, // integer value, do not wrap in quotes
                responseLatency: `$context.responseLatency`, // integer value, do not wrap in quotes
                // integration info
                integrationRequestId: `"$context.integration.requestId"`,
                integrationStatus: `"$context.integration.status"`,
                integrationLatency: `"$context.integration.latency"`,
                integrationServiceStatus: `"$context.integration.integrationStatus"`,
                // caller info
                ip: `"$context.identity.sourceIp"`,
                userAgent: `"$context.identity.userAgent"`,
                //cognitoIdentityId:`"$context.identity.cognitoIdentityId"`, // not supported in us-west-2 region
              }),
            },
          },
          { parent },
        ),
      );
    }

    function createSsl() {
      if (!domain) return output(undefined);

      return domain.apply((domain) => {
        if (domain.cert) return output(domain.cert);
        if (domain.nameId) return output(undefined);

        return new DnsValidatedCertificate(
          `${name}Ssl`,
          {
            domainName: domain.name!,
            dns: domain.dns!,
          },
          { parent },
        ).arn;
      });
    }

    function createDomainName() {
      if (!domain || !certificateArn) return;

      return output(domain).apply((domain) => {
        return domain.nameId
          ? apigatewayv2.DomainName.get(
            `${name}DomainName`,
            domain.nameId,
            {},
            { parent },
          )
          : new apigatewayv2.DomainName(
            ...transform(
              args.transform?.domainName,
              `${name}DomainName`,
              {
                domainName: domain.name!,
                domainNameConfiguration: certificateArn.apply(
                  (certificateArn) => ({
                    certificateArn: certificateArn!,
                    endpointType: "REGIONAL",
                    securityPolicy: "TLS_1_2",
                  }),
                ),
              },
              { parent },
            ),
          );
      });
    }

    function createDnsRecords(): void {
      if (!domain || !apigDomain) return;

      domain.apply((domain) => {
        if (!domain.dns) return;
        if (domain.nameId) return;

        domain.dns.createAlias(
          name,
          {
            name: domain.name!,
            aliasName: apigDomain.domainNameConfiguration.targetDomainName,
            aliasZone: apigDomain.domainNameConfiguration.hostedZoneId,
          },
          { parent },
        );
      });
    }

    function createDomainMapping() {
      if (!domain || !apigDomain) return;

      return domain.path?.apply(
        (path) =>
          new apigatewayv2.ApiMapping(
            `${name}DomainMapping`,
            {
              apiId: api.id,
              domainName: apigDomain.id,
              stage: stage.name,
              apiMappingKey: path,
            },
            { parent },
          ),
      );
    }
  }

  /**
   * The URL of the API.
   *
   * If the `domain` is set, this is the URL with the custom domain.
   * Otherwise, it's the auto-generated API Gateway URL.
   */
  public get url() {
    // Note: If mapping key is set, the URL needs a trailing slash. Without the
    //       trailing slash, the API fails with the error {"message":"Not Found"}
    return this.apigDomain && this.apiMapping
      ? all([this.apigDomain.domainName, this.apiMapping.apiMappingKey]).apply(
        ([domain, key]) =>
          key ? `https://${domain}/${key}/` : `https://${domain}`,
      )
      : this.api.apiEndpoint;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    const self = this;
    return {
      /**
       * The Amazon API Gateway HTTP API.
       */
      api: this.api,
      /**
       * The API Gateway HTTP API domain name.
       */
      get domainName() {
        if (!self.apigDomain)
          throw new VisibleError(
            `"nodes.domainName" is not available when domain is not configured for the "${self.constructorName}" API.`,
          );
        return self.apigDomain;
      },
      /**
       * The CloudWatch LogGroup for the access logs.
       */
      logGroup: this.logGroup,
      /**
       * The API Gateway HTTP API VPC link.
       */
      vpcLink: this.vpcLink,
    };
  }

  /**
   * Add a route to the API Gateway HTTP API. The route is a combination of
   * - An HTTP method and a path, `{METHOD} /{path}`.
   * - Or a `$default` route.
   *
   * :::tip
   * The `$default` route is a default or catch-all route. It'll match if no other route matches.
   * :::
   *
   * A method could be one of `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`, `OPTIONS`, or `ANY`. Here `ANY` matches any HTTP method.
   *
   * The path can be a combination of
   * - Literal segments, `/notes`, `/notes/new`, etc.
   * - Parameter segments, `/notes/{noteId}`, `/notes/{noteId}/attachments/{attachmentId}`, etc.
   * - Greedy segments, `/{proxy+}`, `/notes/{proxy+}`,  etc. The `{proxy+}` segment is a greedy segment that matches all child paths. It needs to be at the end of the path.
   *
   * :::tip
   * The `{proxy+}` is a greedy segment, it matches all its child paths.
   * :::
   *
   * The `$default` is a reserved keyword for the default route. It'll be matched
   * if no other route matches. When a request comes in, the API Gateway will look
   * for the most specific match. If no route matches, the `$default` route will
   * be invoked.
   *
   * :::note
   * You cannot have duplicate routes.
   * :::
   *
   * @param rawRoute The path for the route.
   * @param handler The function that'll be invoked.
   * @param args Configure the route.
   *
   * @example
   * Add a simple route.
   *
   * ```js title="sst.config.ts"
   * api.route("GET /", "src/get.handler");
   * ```
   *
   * Match any HTTP method.
   *
   * ```js title="sst.config.ts"
   * api.route("ANY /", "src/route.handler");
   * ```
   *
   * Add a default or fallback route. Here for every request other than `GET /`,
   * the `$default` route will be invoked.
   *
   * ```js title="sst.config.ts"
   * api.route("GET /", "src/get.handler");
   *
   * api.route("$default", "src/default.handler");
   * ```
   *
   * Add a parameterized route.
   *
   * ```js title="sst.config.ts"
   * api.route("GET /notes/{id}", "src/get.handler");
   * ```
   *
   * Add a greedy route.
   *
   * ```js title="sst.config.ts"
   * api.route("GET /notes/{proxy+}", "src/greedy.handler");
   * ```
   *
   * Enable auth for a route.
   *
   * ```js title="sst.config.ts"
   * api.route("GET /", "src/get.handler")
   * api.route("POST /", "src/post.handler", {
   *   auth: {
   *     iam: true
   *   }
   * });
   * ```
   *
   * Customize the route handler.
   *
   * ```js title="sst.config.ts"
   * api.route("GET /", {
   *   handler: "src/get.handler",
   *   memory: "2048 MB"
   * });
   * ```
   *
   * Or pass in the ARN of an existing Lambda function.
   *
   * ```js title="sst.config.ts"
   * api.route("GET /", "arn:aws:lambda:us-east-1:123456789012:function:my-function");
   * ```
   */
  public route(
    rawRoute: string,
    handler: Input<string | FunctionArgs | FunctionArn>,
    args: ApiGatewayV2RouteArgs = {},
  ) {
    const route = this.parseRoute(rawRoute);
    const transformed = transform(
      this.constructorArgs.transform?.route?.args,
      this.buildRouteId(route),
      args,
      { provider: this.constructorOpts.provider },
    );
    return new ApiGatewayV2LambdaRoute(
      transformed[0],
      {
        api: {
          name: this.constructorName,
          id: this.api.id,
          executionArn: this.api.executionArn,
        },
        route,
        handler,
        handlerLink: this.constructorArgs.link,
        handlerTransform: this.constructorArgs.transform?.route?.handler,
        ...transformed[1],
      },
      transformed[2],
    );
  }

  /**
   * Add a URL route to the API Gateway HTTP API.
   *
   * @param rawRoute The path for the route.
   * @param url The URL to forward to.
   * @param args Configure the route.
   *
   * @example
   * Add a simple route.
   *
   * ```js title="sst.config.ts"
   * api.routeUrl("GET /", "https://google.com");
   * ```
   *
   * Enable auth for a route.
   *
   * ```js title="sst.config.ts"
   * api.routeUrl("POST /", "https://google.com", {
   *   auth: {
   *     iam: true
   *   }
   * });
   * ```
   */
  public routeUrl(
    rawRoute: string,
    url: Input<string>,
    args: ApiGatewayV2RouteArgs = {},
  ) {
    const route = this.parseRoute(rawRoute);
    const transformed = transform(
      this.constructorArgs.transform?.route?.args,
      this.buildRouteId(route),
      args,
      { provider: this.constructorOpts.provider },
    );
    return new ApiGatewayV2UrlRoute(
      transformed[0],
      {
        api: {
          name: this.constructorName,
          id: this.api.id,
          executionArn: this.api.executionArn,
        },
        route,
        url,
        ...transformed[1],
      },
      transformed[2],
    );
  }

  /**
   * Adds a private route to the API Gateway HTTP API.
   *
   * To add private routes, you need to have a VPC link. Make sure to pass in a `vpc`.
   * Learn more about [adding private routes](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-private.html).
   *
   * :::tip
   * You need to pass `vpc` to add a private route.
   * :::
   *
   * A couple of things to note:
   *
   * 1. Your API Gateway HTTP API also needs to be in the **same VPC** as the service.
   *
   * 2. You also need to verify that your VPC's [**availability zones support VPC link**](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vpc-links.html#http-api-vpc-link-availability).
   *
   * 3. Run `aws ec2 describe-availability-zones` to get a list of AZs for your
   *    account.
   *
   * 4. Only list the AZ ID's that support VPC link.
   *    ```ts title="sst.config.ts" {4}
   *    vpc: {
   *      az: ["eu-west-3a", "eu-west-3c"]
   *    }
   *    ```
   *    If the VPC picks an AZ automatically that doesn't support VPC link, you'll get
   *    the following error:
   *    ```
   *    operation error ApiGatewayV2: BadRequestException: Subnet is in Availability
   *    Zone 'euw3-az2' where service is not available
   *    ```
   *
   * @param rawRoute The path for the route.
   * @param arn The ARN of the AWS Load Balancer or Cloud Map service.
   * @param args Configure the route.
   *
   * @example
   * Here are a few examples using the private route. Add a route to Application Load Balancer.
   *
   * ```js title="sst.config.ts"
   * const loadBalancerArn = "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/my-load-balancer/50dc6c495c0c9188";
   * api.routePrivate("GET /", loadBalancerArn);
   * ```
   *
   * Add a route to AWS Cloud Map service.
   *
   * ```js title="sst.config.ts"
   * const serviceArn = "arn:aws:servicediscovery:us-east-2:123456789012:service/srv-id?stage=prod&deployment=green_deployment";
   * api.routePrivate("GET /", serviceArn);
   * ```
   *
   * Enable IAM authentication for a route.
   *
   * ```js title="sst.config.ts"
   * api.routePrivate("GET /", serviceArn, {
   *   auth: {
   *     iam: true
   *   }
   * });
   * ```
   */
  public routePrivate(
    rawRoute: string,
    arn: Input<string>,
    args: ApiGatewayV2RouteArgs = {},
  ) {
    if (!this.vpcLink)
      throw new VisibleError(
        `To add private routes, you need to have a VPC link. Configure "vpc" for the "${this.constructorName}" API to create a VPC link.`,
      );

    const route = this.parseRoute(rawRoute);
    const transformed = transform(
      this.constructorArgs.transform?.route?.args,
      this.buildRouteId(route),
      args,
      { provider: this.constructorOpts.provider },
    );
    return new ApiGatewayV2PrivateRoute(
      transformed[0],
      {
        api: {
          name: this.constructorName,
          id: this.api.id,
          executionArn: this.api.executionArn,
        },
        route,
        vpcLink: this.vpcLink.id,
        arn,
        ...transformed[1],
      },
      transformed[2],
    );
  }

  private parseRoute(rawRoute: string) {
    if (rawRoute.toLowerCase() === "$default") return "$default";

    const parts = rawRoute.split(" ");
    if (parts.length !== 2) {
      throw new VisibleError(
        `Invalid route ${rawRoute}. A route must be in the format "METHOD /path".`,
      );
    }
    const [methodRaw, path] = rawRoute.split(" ");
    const method = methodRaw.toUpperCase();
    if (
      ![
        "ANY",
        "DELETE",
        "GET",
        "HEAD",
        "OPTIONS",
        "PATCH",
        "POST",
        "PUT",
      ].includes(method)
    )
      throw new VisibleError(
        `Invalid method ${methodRaw} in route ${rawRoute}`,
      );

    if (!path.startsWith("/"))
      throw new VisibleError(
        `Invalid path ${path} in route ${rawRoute}. Path must start with "/".`,
      );

    return `${method} ${path}`;
  }

  private buildRouteId(route: string) {
    const suffix = logicalName(
      hashStringToPrettyString([outputId, route].join(""), 6),
    );
    return `${this.constructorName}Route${suffix}`;
  }

  /**
   * Add an authorizer to the API Gateway HTTP API.
   *
   * @param args Configure the authorizer.
   * @example
   * Add a Lambda authorizer.
   *
   * ```js title="sst.config.ts"
   * api.addAuthorizer({
   *   name: "myAuthorizer",
   *   lambda: {
   *     function: "src/authorizer.index"
   *   }
   * });
   * ```
   *
   * Add a JWT authorizer.
   *
   * ```js title="sst.config.ts"
   * const authorizer = api.addAuthorizer({
   *   name: "myAuthorizer",
   *   jwt: {
   *     issuer: "https://issuer.com/",
   *     audiences: ["https://api.example.com"],
   *     identitySource: "$request.header.AccessToken"
   *   }
   * });
   * ```
   *
   * Add a Cognito UserPool as a JWT authorizer.
   *
   * ```js title="sst.config.ts"
   * const pool = new sst.aws.CognitoUserPool("MyUserPool");
   * const poolClient = userPool.addClient("Web");
   *
   * const authorizer = api.addAuthorizer({
   *   name: "myCognitoAuthorizer",
   *   jwt: {
   *     issuer: $interpolate`https://cognito-idp.${aws.getRegionOutput().name}.amazonaws.com/${pool.id}`,
   *     audiences: [poolClient.id]
   *   }
   * });
   * ```
   *
   * Now you can use the authorizer in your routes.
   *
   * ```js title="sst.config.ts"
   * api.route("GET /", "src/get.handler", {
   *   auth: {
   *     jwt: {
   *       authorizer: authorizer.id
   *     }
   *   }
   * });
   * ```
   */
  public addAuthorizer(args: ApiGatewayV2AuthorizerArgs) {
    const self = this;
    const selfName = this.constructorName;
    const nameSuffix = logicalName(args.name);

    return new ApiGatewayV2Authorizer(
      `${selfName}Authorizer${nameSuffix}`,
      {
        api: {
          id: self.api.id,
          name: selfName,
          executionArn: this.api.executionArn,
        },
        type: "http",
        ...args,
      },
      { provider: this.constructorOpts.provider },
    );
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        url: this.url,
      },
    };
  }
}

const __pulumiType = "sst:aws:ApiGatewayV2";
// @ts-expect-error
ApiGatewayV2.__pulumiType = __pulumiType;
