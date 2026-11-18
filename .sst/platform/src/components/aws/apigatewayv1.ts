import {
  ComponentResourceOptions,
  Output,
  all,
  interpolate,
  output,
} from "@pulumi/pulumi";
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
import { RETENTION } from "./logging";
import { ApiGatewayV1LambdaRoute } from "./apigatewayv1-lambda-route";
import { ApiGatewayV1Authorizer } from "./apigatewayv1-authorizer";
import { setupApiGatewayAccount } from "./helpers/apigateway-account";
import { apigateway, cloudwatch, getRegionOutput } from "@pulumi/aws";
import { Dns } from "../dns";
import { dns as awsDns } from "./dns";
import { DnsValidatedCertificate } from "./dns-validated-certificate";
import { ApiGatewayV1IntegrationRoute } from "./apigatewayv1-integration-route";
import { ApiGatewayV1UsagePlan } from "./apigatewayv1-usage-plan";
import { useProvider } from "./helpers/provider";

export interface ApiGatewayV1DomainArgs {
  /**
   * Use an existing API Gateway domain name.
   *
   * By default, a new API Gateway domain name is created. If you'd like to use an existing
   * domain name, set the `nameId` to the ID of the domain name and **do not** pass in `name`.
   *
   * @example
   * ```js
   * {
   *   domain: {
   *     nameId: "example.com"
   *   }
   * }
   * ```
   */
  nameId?: Input<string>;
  /**
   * The custom domain you want to use.
   *
   * @example
   * ```js
   * {
   *   domain: {
   *     name: "example.com"
   *   }
   * }
   * ```
   *
   * Can also include subdomains based on the current stage.
   *
   * ```js
   * {
   *   domain: {
   *     name: `${$app.stage}.example.com`
   *   }
   * }
   * ```
   */
  name: Input<string>;
  /**
   * The base mapping for the custom domain. This adds a suffix to the URL of the API.
   *
   * @example
   *
   * Given the following base path and domain name.
   *
   * ```js
   * {
   *   domain: {
   *     name: "api.example.com",
   *     path: "v1"
   *   }
   * }
   * ```
   *
   * The full URL of the API will be `https://api.example.com/v1/`.
   *
   * :::note
   * There's an extra trailing slash when a base path is set.
   * :::
   *
   * By default there is no base path, so if the `name` is `api.example.com`, the full URL will be `https://api.example.com`.
   */
  path?: Input<string>;
  /**
   * The ARN of an ACM (AWS Certificate Manager) certificate that proves ownership of the
   * domain. By default, a certificate is created and validated automatically.
   *
   * :::tip
   * You need to pass in a `cert` for domains that are not hosted on supported `dns` providers.
   * :::
   *
   * To manually set up a domain on an unsupported provider, you'll need to:
   *
   * 1. [Validate that you own the domain](https://docs.aws.amazon.com/acm/latest/userguide/domain-ownership-validation.html) by creating an ACM certificate. You can either validate it by setting a DNS record or by verifying an email sent to the domain owner.
   * 2. Once validated, set the certificate ARN as the `cert` and set `dns` to `false`.
   * 3. Add the DNS records in your provider to point to the API Gateway URL.
   *
   * @example
   * ```js
   * {
   *   domain: {
   *     name: "example.com",
   *     dns: false,
   *     cert: "arn:aws:acm:us-east-1:112233445566:certificate/3a958790-8878-4cdc-a396-06d95064cf63"
   *   }
   * }
   * ```
   */
  cert?: Input<string>;
  /**
   * The DNS provider to use for the domain. Defaults to the AWS.
   *
   * Takes an adapter that can create the DNS records on the provider. This can automate
   * validating the domain and setting up the DNS routing.
   *
   * Supports Route 53, Cloudflare, and Vercel adapters. For other providers, you'll need
   * to set `dns` to `false` and pass in a certificate validating ownership via `cert`.
   *
   * @default `sst.aws.dns`
   *
   * @example
   *
   * Specify the hosted zone ID for the Route 53 domain.
   *
   * ```js
   * {
   *   domain: {
   *     name: "example.com",
   *     dns: sst.aws.dns({
   *       zone: "Z2FDTNDATAQYW2"
   *     })
   *   }
   * }
   * ```
   *
   * Use a domain hosted on Cloudflare, needs the Cloudflare provider.
   *
   * ```js
   * {
   *   domain: {
   *     name: "example.com",
   *     dns: sst.cloudflare.dns()
   *   }
   * }
   * ```
   *
   * Use a domain hosted on Vercel, needs the Vercel provider.
   *
   * ```js
   * {
   *   domain: {
   *     name: "example.com",
   *     dns: sst.vercel.dns()
   *   }
   * }
   * ```
   */
  dns?: Input<false | (Dns & {})>;
}

export interface ApiGatewayV1Args {
  /**
   * Set a custom domain for your REST API.
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
  domain?: Input<string | Prettify<ApiGatewayV1DomainArgs>>;
  /**
   * Configure the type of API Gateway REST API endpoint.
   *
   * - `edge`: The default; it creates a CloudFront distribution for the API.
   *   Useful for cases where requests are geographically distributed.
   * - `regional`: Endpoints are deployed in specific AWS regions and are
   *   intended to be accessed directly by clients within or near that region.
   * - `private`: Endpoints allows access to the API only from within a specified
   *   Amazon VPC (Virtual Private Cloud) using VPC endpoints. These do not expose
   *   the API to the public internet.
   *
   * Learn more about the [different types of endpoints](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-api-endpoint-types.html).
   *
   * @default `{type: "edge"}`
   * @example
   *
   * For example, to create a regional endpoint.
   * ```js
   * {
   *   endpoint: {
   *     type: "regional"
   *   }
   * }
   * ```
   *
   * And to create a private endpoint.
   * ```js
   * {
   *   endpoint: {
   *     type: "private",
   *     vpcEndpointIds: ["vpce-0dccab6fb1e828f36"]
   *   }
   * }
   * ```
   */
  endpoint?: Input<{
    /**
     * The type of the API Gateway REST API endpoint.
     */
    type: "edge" | "regional" | "private";
    /**
     * The VPC endpoint IDs for the `private` endpoint.
     */
    vpcEndpointIds?: Input<Input<string>[]>;
  }>;
  /**
   * Enable the CORS or Cross-origin resource sharing for your API.
   * @default `true`
   * @example
   * Disable CORS.
   * ```js
   * {
   *   cors: false
   * }
   * ```
   */
  cors?: Input<boolean>;
  /**
   * Configure the [API Gateway logs](https://docs.aws.amazon.com/apigateway/latest/developerguide/view-cloudwatch-log-events-in-cloudwatch-console.html) in CloudWatch. By default, access logs are enabled and retained for 1 month.
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
     * The duration the API Gateway logs are retained in CloudWatch.
     * @default `1 month`
     */
    retention?: Input<keyof typeof RETENTION>;
  }>;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the API Gateway REST API resource.
     */
    api?: Transform<apigateway.RestApiArgs>;
    /**
     * Transform the API Gateway REST API stage resource.
     */
    stage?: Transform<apigateway.StageArgs>;
    /**
     * Transform the API Gateway REST API deployment resource.
     */
    deployment?: Transform<apigateway.DeploymentArgs>;
    /**
     * Transform the CloudWatch LogGroup resource used for access logs.
     */
    accessLog?: Transform<cloudwatch.LogGroupArgs>;
    /**
     * Transform the API Gateway REST API domain name resource.
     */
    domainName?: Transform<apigateway.DomainNameArgs>;
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
      args?: Transform<ApiGatewayV1RouteArgs>;
    };
  };
}

export interface ApiGatewayV1AuthorizerArgs {
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
   * The Lambda token authorizer function. Takes the handler path or the function args.
   * @example
   * ```js
   * {
   *   tokenFunction: "src/authorizer.index"
   * }
   * ```
   */
  tokenFunction?: Input<string | FunctionArgs>;
  /**
   * The Lambda request authorizer function. Takes the handler path or the function args.
   * @example
   * ```js
   * {
   *   requestFunction: "src/authorizer.index"
   * }
   * ```
   */
  requestFunction?: Input<string | FunctionArgs>;
  /**
   * A list of user pools used as the authorizer.
   * @example
   * ```js
   * {
   *   name: "myAuthorizer",
   *   userPools: [userPool.arn]
   * }
   * ```
   *
   * Where `userPool` is:
   *
   * ```js
   * const userPool = new aws.cognito.UserPool();
   * ```
   */
  userPools?: Input<Input<string>[]>;
  /**
   * Time to live for cached authorizer results in seconds.
   * @default `300`
   * @example
   * ```js
   * {
   *   ttl: 30
   * }
   * ```
   */
  ttl?: Input<number>;
  /**
   * Specifies where to extract the authorization token from the request.
   * @default `"method.request.header.Authorization"`
   * @example
   * ```js
   * {
   *   identitySource: "method.request.header.AccessToken"
   * }
   * ```
   */
  identitySource?: Input<string>;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the API Gateway authorizer resource.
     */
    authorizer?: Transform<apigateway.AuthorizerArgs>;
  };
}

export interface ApiGatewayV1UsagePlanArgs {
  /**
   * Configure rate limits to protect your API from being overwhelmed by too many
   * requests at once.
   *
   * @example
   * ```js
   * {
   *   throttle: {
   *     rate: 100,
   *     burst: 200
   *   }
   * }
   * ```
   */
  throttle?: Input<{
    /**
     * The maximum number of requests permitted in a short-term spike beyond the
     * rate limit.
     */
    burst?: Input<number>;
    /**
     * The steady-state maximum number of requests allowed per second.
     */
    rate?: Input<number>;
  }>;
  /**
   * Configure a cap on the total number of requests allowed within a specified time
   * period.
   * @example
   * ```js
   * {
   *   quota: {
   *     limit: 1000,
   *     period: "month",
   *     offset: 0
   *   }
   * }
   * ```
   */
  quota?: Input<{
    /**
     * The maximum number of requests that can be made in the specified period of
     * time.
     */
    limit: Input<number>;
    /**
     * The time period for which the quota applies.
     */
    period: Input<"day" | "week" | "month">;
    /**
     * The number of days into the period when the quota counter is reset.
     *
     * For example, this resets the quota at the beginning of each month.
     *
     * ```js
     * {
     *   period: "month",
     *   offset: 0
     * }
     * ```
     */
    offset?: Input<number>;
  }>;
}

export interface ApiGatewayV1ApiKeyArgs {
  /**
   * The value of the API key. If not provided, it will be generated automatically.
   * @example
   * ```js
   * {
   *   value: "d41d8cd98f00b204e9800998ecf8427e"
   * }
   * ```
   */
  value?: Input<string>;
}

export interface ApiGatewayV1RouteArgs {
  /**
   * Enable auth for your REST API. By default, auth is disabled.
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
       * Enable IAM authorization for a given API route.
       *
       * When IAM auth is enabled, clients need to use Signature Version 4 to sign their requests with their AWS credentials.
       */
      iam?: Input<boolean>;
      /**
       * Enable custom Lambda authorization for a given API route. Pass in the authorizer ID.
       * @example
       * ```js
       * {
       *   auth: {
       *     custom: myAuthorizer.id
       *   }
       * }
       * ```
       *
       * Where `myAuthorizer` is:
       *
       * ```js
       * const userPool = new aws.cognito.UserPool();
       * const myAuthorizer = api.addAuthorizer({
       *   name: "MyAuthorizer",
       *   userPools: [userPool.arn]
       * });
       * ```
       */
      custom?: Input<string>;
      /**
       * Enable Cognito User Pool authorization for a given API route.
       *
       * @example
       * You can configure JWT auth.
       *
       * ```js
       * {
       *   auth: {
       *     cognito: {
       *       authorizer: myAuthorizer.id,
       *       scopes: ["read:profile", "write:profile"]
       *     }
       *   }
       * }
       * ```
       *
       * Where `myAuthorizer` is:
       *
       * ```js
       * const userPool = new aws.cognito.UserPool();
       *
       * const myAuthorizer = api.addAuthorizer({
       *   name: "MyAuthorizer",
       *   userPools: [userPool.arn]
       * });
       * ```
       */
      cognito?: Input<{
        /**
         * Authorizer ID of the Cognito User Pool authorizer.
         */
        authorizer: Input<string>;
        /**
         * Defines the permissions or access levels that the authorization token grants.
         */
        scopes?: Input<Input<string>[]>;
      }>;
    }
  >;
  /**
   * Specify if an API key is required for the route. By default, an API key is not
   * required.
   * @default `false`
   * @example
   * ```js
   * {
   *   apiKey: true
   * }
   * ```
   */
  apiKey?: Input<boolean>;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the API Gateway REST API method resource.
     */
    method?: Transform<apigateway.MethodArgs>;
    /**
     * Transform the API Gateway REST API integration resource.
     */
    integration?: Transform<apigateway.IntegrationArgs>;
  };
}

export interface ApiGatewayV1IntegrationArgs {
  /**
   * The type of the API Gateway REST API integration.
   */
  type: Input<"aws" | "aws-proxy" | "mock" | "http" | "http-proxy">;
  /**
   * The URI of the API Gateway REST API integration.
   */
  uri?: Input<string>;
  /**
   * The credentials to use to call the AWS service.
   */
  credentials?: Input<string>;
  /**
   * The HTTP method to use to call the integration.
   */
  integrationHttpMethod?: Input<
    "GET" | "POST" | "PUT" | "DELETE" | "HEAD" | "OPTIONS" | "ANY" | "PATCH"
  >;
  /**
   * Map of request query string parameters and headers that should be passed to the backend responder.
   */
  requestParameters?: Input<Record<string, Input<string>>>;
  /**
   * Map of the integration's request templates.
   */
  requestTemplates?: Input<Record<string, Input<string>>>;
  /**
   * The passthrough behavior to use to call the integration.
   *
   * Required if `requestTemplates` is set.
   */
  passthroughBehavior?: Input<"when-no-match" | "never" | "when-no-templates">;
}

/**
 * The `ApiGatewayV1` component lets you add an [Amazon API Gateway REST API](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-rest-api.html) to your app.
 *
 * @example
 *
 * #### Create the API
 *
 * ```ts title="sst.config.ts"
 * const api = new sst.aws.ApiGatewayV1("MyApi");
 * ```
 *
 * #### Add routes
 *
 * ```ts title="sst.config.ts"
 * api.route("GET /", "src/get.handler");
 * api.route("POST /", "src/post.handler");
 *
 * api.deploy();
 * ```
 *
 * :::note
 * You need to call `deploy` after you've added all your routes.
 * :::
 *
 * #### Configure the routes
 *
 * ```ts title="sst.config.ts"
 * api.route("GET /", "src/get.handler", {
 *   auth: { iam: true }
 * });
 * ```
 *
 * #### Configure the route handler
 *
 * You can configure the Lambda function that'll handle the route.
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
 * You can use a `transform` to set some default props for all your routes. For
 * example, instead of setting the `memory` for each route.
 *
 * ```ts title="sst.config.ts"
 * api.route("GET /", { handler: "src/get.handler", memory: "2048 MB" });
 * api.route("POST /", { handler: "src/post.handler", memory: "2048 MB" });
 * ```
 *
 * You can set it through the `transform`.
 *
 * ```ts title="sst.config.ts" {6}
 * const api = new sst.aws.ApiGatewayV1("MyApi", {
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
export class ApiGatewayV1 extends Component implements Link.Linkable {
  private constructorName: string;
  private constructorArgs: ApiGatewayV1Args;
  private constructorOpts: ComponentResourceOptions;
  private api: apigateway.RestApi;
  private apigDomain?: Output<apigateway.DomainName>;
  private apiMapping?: Output<apigateway.BasePathMapping>;
  private region: Output<string>;
  private resources: Record<string, Output<string>> = {};
  private routes: (ApiGatewayV1LambdaRoute | ApiGatewayV1IntegrationRoute)[] =
    [];
  private stage?: apigateway.Stage;
  private logGroup?: cloudwatch.LogGroup;
  private endpointType: Output<"EDGE" | "REGIONAL" | "PRIVATE">;
  private deployed: boolean = false;

  constructor(
    name: string,
    args: ApiGatewayV1Args = {},
    opts: ComponentResourceOptions = {},
  ) {
    super(__pulumiType, name, args, opts);

    const parent = this;

    const region = normalizeRegion();
    const endpoint = normalizeEndpoint();
    const apigAccount = setupApiGatewayAccount(name, opts);
    const api = createApi();

    this.resources["/"] = api.rootResourceId;
    this.constructorName = name;
    this.constructorArgs = args;
    this.constructorOpts = opts;
    this.api = api;
    this.region = region;
    this.endpointType = endpoint.types;

    function normalizeRegion() {
      return getRegionOutput(undefined, { parent }).name;
    }

    function normalizeEndpoint() {
      return output(args.endpoint).apply((endpoint) => {
        if (!endpoint) return { types: "EDGE" as const };

        if (endpoint.type === "private" && !endpoint.vpcEndpointIds)
          throw new VisibleError(
            "Please provide the VPC endpoint IDs for the private endpoint.",
          );

        return endpoint.type === "regional"
          ? { types: "REGIONAL" as const }
          : endpoint.type === "private"
            ? {
              types: "PRIVATE" as const,
              vpcEndpointIds: endpoint.vpcEndpointIds,
            }
            : { types: "EDGE" as const };
      });
    }

    function createApi() {
      return new apigateway.RestApi(
        ...transform(
          args.transform?.api,
          `${name}Api`,
          {
            endpointConfiguration: endpoint,
          },
          { parent, dependsOn: apigAccount },
        ),
      );
    }
  }

  /**
   * The URL of the API.
   */
  public get url() {
    return this.apigDomain && this.apiMapping
      ? all([this.apigDomain.domainName, this.apiMapping.basePath]).apply(
        ([domain, key]) =>
          key ? `https://${domain}/${key}/` : `https://${domain}`,
      )
      : interpolate`https://${this.api.id}.execute-api.${this.region}.amazonaws.com/${$app.stage}/`;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    const self = this;
    return {
      /**
       * The Amazon API Gateway REST API
       */
      api: this.api,
      /**
       * The Amazon API Gateway REST API stage
       */
      stage: this.stage,
      /**
       * The CloudWatch LogGroup for the access logs.
       */
      logGroup: this.logGroup,
      /**
       * The API Gateway REST API domain name.
       */
      get domainName() {
        if (!self.deployed)
          throw new VisibleError(
            `"nodes.domainName" is not available before the "${self.constructorName}" API is deployed.`,
          );
        if (!self.apigDomain)
          throw new VisibleError(
            `"nodes.domainName" is not available when domain is not configured for the "${self.constructorName}" API.`,
          );
        return self.apigDomain;
      },
    };
  }

  /**
   * Add a route to the API Gateway REST API. The route is a combination of an HTTP method and a path, `{METHOD} /{path}`.
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
   * When a request comes in, the API Gateway will look for the most specific match.
   *
   * :::note
   * You cannot have duplicate routes.
   * :::
   *
   * @param route The path for the route.
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
   * Add a default or fallback route. Here for every request other than `GET /hi`,
   * the `default.handler` function will be invoked.
   *
   * ```js title="sst.config.ts"
   * api.route("GET /hi", "src/get.handler");
   *
   * api.route("ANY /", "src/default.handler");
   * api.route("ANY /{proxy+}", "src/default.handler");
   * ```
   *
   * The `/{proxy+}` matches any path that starts with `/`, so if you want a
   * fallback route for the root `/` path, you need to add a `ANY /` route as well.
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
    route: string,
    handler: Input<string | FunctionArgs | FunctionArn>,
    args: ApiGatewayV1RouteArgs = {},
  ) {
    const { method, path } = this.parseRoute(route);
    this.createResource(path);

    const transformed = transform(
      this.constructorArgs.transform?.route?.args,
      this.buildRouteId(method, path),
      args,
      { provider: this.constructorOpts.provider },
    );

    const apigRoute = new ApiGatewayV1LambdaRoute(
      transformed[0],
      {
        api: {
          name: this.constructorName,
          id: this.api.id,
          executionArn: this.api.executionArn,
        },
        method,
        path,
        resourceId: this.resources[path],
        handler,
        handlerTransform: this.constructorArgs.transform?.route?.handler,
        ...transformed[1],
      },
      transformed[2],
    );

    this.routes.push(apigRoute);

    return apigRoute;
  }

  /**
   * Add a custom integration to the API Gateway REST API. [Learn more about
   * integrations](https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-integration-settings.html).
   *
   * @param route The path for the route.
   * @param integration The integration configuration.
   * @param args Configure the route.
   *
   * @example
   * Add a route to trigger a Step Function state machine execution.
   *
   * ```js title="sst.config.ts"
   * api.routeIntegration("POST /run-my-state-machine", {
   *   type: "aws",
   *   uri: "arn:aws:apigateway:us-east-1:states:startExecution",
   *   credentials: "arn:aws:iam::123456789012:role/apigateway-execution-role",
   *   integrationHttpMethod: "POST",
   *   requestTemplates: {
   *     "application/json": JSON.stringify({
   *       input: "$input.json('$')",
   *       stateMachineArn: "arn:aws:states:us-east-1:123456789012:stateMachine:MyStateMachine"
   *     })
   *   },
   *   passthroughBehavior: "when-no-match"
   * });
   * ```
   */
  public routeIntegration(
    route: string,
    integration: ApiGatewayV1IntegrationArgs,
    args: ApiGatewayV1RouteArgs = {},
  ) {
    const { method, path } = this.parseRoute(route);
    this.createResource(path);

    const transformed = transform(
      this.constructorArgs.transform?.route?.args,
      this.buildRouteId(method, path),
      args,
      { provider: this.constructorOpts.provider },
    );

    const apigRoute = new ApiGatewayV1IntegrationRoute(
      transformed[0],
      {
        api: {
          name: this.constructorName,
          id: this.api.id,
          executionArn: this.api.executionArn,
        },
        method,
        path,
        resourceId: this.resources[path],
        integration,
        ...transformed[1],
      },
      transformed[2],
    );

    this.routes.push(apigRoute);

    return apigRoute;
  }

  private parseRoute(route: string) {
    const parts = route.split(" ");
    if (parts.length !== 2) {
      throw new VisibleError(
        `Invalid route ${route}. A route must be in the format "METHOD /path".`,
      );
    }
    const [methodRaw, path] = route.split(" ");
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
      throw new VisibleError(`Invalid method ${methodRaw} in route ${route}`);

    if (!path.startsWith("/"))
      throw new VisibleError(
        `Invalid path ${path} in route ${route}. Path must start with "/".`,
      );

    return { method, path };
  }

  private buildRouteId(method: string, path: string) {
    const suffix = logicalName(
      hashStringToPrettyString([outputId, method, path].join(""), 6),
    );
    return `${this.constructorName}Route${suffix}`;
  }

  private createResource(path: string) {
    const pathParts = path.replace(/^\//, "").split("/");
    for (let i = 0, l = pathParts.length; i < l; i++) {
      const parentPath = "/" + pathParts.slice(0, i).join("/");
      const subPath = "/" + pathParts.slice(0, i + 1).join("/");
      if (!this.resources[subPath]) {
        const suffix = logicalName(
          hashStringToPrettyString([this.api.id, subPath].join(""), 6),
        );
        const resource = new apigateway.Resource(
          `${this.constructorName}Resource${suffix}`,
          {
            restApi: this.api.id,
            parentId:
              parentPath === "/"
                ? this.api.rootResourceId
                : this.resources[parentPath],
            pathPart: pathParts[i],
          },
          { parent: this },
        );

        this.resources[subPath] = resource.id;
      }
    }
  }

  /**
   * Add an authorizer to the API Gateway REST API.
   *
   * @param args Configure the authorizer.
   * @example
   * For example, add a Lambda token authorizer.
   *
   * ```js title="sst.config.ts"
   * api.addAuthorizer({
   *   name: "myAuthorizer",
   *   tokenFunction: "src/authorizer.index"
   * });
   * ```
   *
   * Add a Lambda REQUEST authorizer.
   *
   * ```js title="sst.config.ts"
   * api.addAuthorizer({
   *   name: "myAuthorizer",
   *   requestFunction: "src/authorizer.index"
   * });
   * ```
   *
   * Add a Cognito User Pool authorizer.
   *
   * ```js title="sst.config.ts"
   * const userPool = new aws.cognito.UserPool();
   *
   * api.addAuthorizer({
   *   name: "myAuthorizer",
   *   userPools: [userPool.arn]
   * });
   * ```
   *
   * You can also customize the authorizer.
   *
   * ```js title="sst.config.ts"
   * api.addAuthorizer({
   *   name: "myAuthorizer",
   *   tokenFunction: "src/authorizer.index",
   *   ttl: 30
   * });
   * ```
   */
  public addAuthorizer(args: ApiGatewayV1AuthorizerArgs) {
    const self = this;
    const selfName = this.constructorName;
    const nameSuffix = logicalName(args.name);

    return new ApiGatewayV1Authorizer(
      `${selfName}Authorizer${nameSuffix}`,
      {
        api: {
          id: self.api.id,
          name: selfName,
          executionArn: self.api.executionArn,
        },
        ...args,
      },
      { provider: this.constructorOpts.provider },
    );
  }

  /**
   * Add a usage plan to the API Gateway REST API.
   *
   * @param name The name of the usage plan.
   * @param args Configure the usage plan.
   * @example
   *
   * To add a usage plan to an API, you need to enable the API key for a route, and
   * then deploy the API.
   *
   * ```ts title="sst.config.ts" {4}
   * const api = new sst.aws.ApiGatewayV1("MyApi");
   *
   * api.route("GET /", "src/get.handler", {
   *   apiKey: true
   * });
   *
   * api.deploy();
   * ```
   *
   * Then define your usage plan.
   *
   * ```js title="sst.config.ts"
   * const plan = api.addUsagePlan("MyPlan", {
   *   throttle: {
   *     rate: 100,
   *     burst: 200
   *   },
   *   quota: {
   *     limit: 1000,
   *     period: "month",
   *     offset: 0
   *   }
   * });
   * ```
   *
   * And create the API key for the plan.
   *
   * ```js title="sst.config.ts"
   * const key = plan.addApiKey("MyKey");
   * ```
   *
   * You can now link the API and API key to other resources, like a function.
   *
   * ```ts title="sst.config.ts"
   * new sst.aws.Function("MyFunction", {
   *   handler: "src/lambda.handler",
   *   link: [api, key]
   * });
   * ```
   *
   * Once linked, include the key in the `x-api-key` header with your requests.
   *
   * ```ts title="src/lambda.ts"
   * import { Resource } from "sst";
   *
   * await fetch(Resource.MyApi.url, {
   *   headers: {
   *     "x-api-key": Resource.MyKey.value
   *   }
   * });
   * ```
   */
  public addUsagePlan(name: string, args: ApiGatewayV1UsagePlanArgs) {
    if (!this.stage)
      throw new VisibleError(
        `Cannot add a usage plan to the "${this.constructorName}" API before it's deployed. Make sure to call deploy() to deploy the API first.`,
      );

    return new ApiGatewayV1UsagePlan(
      name,
      {
        apiId: this.api.id,
        apiStage: this.stage.stageName,
        ...args,
      },
      { provider: this.constructorOpts.provider },
    );
  }

  /**
   * Creates a deployment for the API Gateway REST API.
   *
   * :::caution
   * Your routes won't be added if `deploy` isn't called.
   * :::
   *
   * Your routes won't be added if this isn't called after you've added them. This
   * is due to a quirk in the way API Gateway V1 is created internally.
   */
  public deploy() {
    const name = this.constructorName;
    const args = this.constructorArgs;
    const parent = this;
    const api = this.api;
    const routes = this.routes;
    const region = this.region;
    const endpointType = this.endpointType;
    const accessLog = normalizeAccessLog();
    const domain = normalizeDomain();
    const corsRoutes = createCorsRoutes();
    const corsResponses = createCorsResponses();
    const deployment = createDeployment();
    const logGroup = createLogGroup();
    const stage = createStage();

    const certificateArn = createSsl();
    const apigDomain = createDomainName();
    createDnsRecords();
    const apiMapping = createDomainMapping();

    this.deployed = true;
    this.logGroup = logGroup;
    this.stage = stage;
    this.apigDomain = apigDomain;
    this.apiMapping = apiMapping;

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

    function createCorsRoutes() {
      const resourceIds = routes.map(
        (route) => route.nodes.integration.resourceId,
      );

      return all([args.cors, resourceIds]).apply(([cors, resourceIds]) => {
        if (cors === false) return [];

        // filter unique resource ids
        const uniqueResourceIds = [...new Set(resourceIds)];

        // create cors integrations for the paths
        return uniqueResourceIds.map((resourceId) => {
          const method = new apigateway.Method(
            `${name}CorsMethod${resourceId}`,
            {
              restApi: api.id,
              resourceId,
              httpMethod: "OPTIONS",
              authorization: "NONE",
            },
            { parent },
          );

          const methodResponse = new apigateway.MethodResponse(
            `${name}CorsMethodResponse${resourceId}`,
            {
              restApi: api.id,
              resourceId,
              httpMethod: method.httpMethod,
              statusCode: "204",
              responseParameters: {
                "method.response.header.Access-Control-Allow-Headers": true,
                "method.response.header.Access-Control-Allow-Methods": true,
                "method.response.header.Access-Control-Allow-Origin": true,
              },
            },
            { parent },
          );

          const integration = new apigateway.Integration(
            `${name}CorsIntegration${resourceId}`,
            {
              restApi: api.id,
              resourceId,
              httpMethod: method.httpMethod,
              type: "MOCK",
              requestTemplates: {
                "application/json": "{ statusCode: 200 }",
              },
            },
            { parent },
          );

          const integrationResponse = new apigateway.IntegrationResponse(
            `${name}CorsIntegrationResponse${resourceId}`,
            {
              restApi: api.id,
              resourceId,
              httpMethod: method.httpMethod,
              statusCode: methodResponse.statusCode,
              responseParameters: {
                "method.response.header.Access-Control-Allow-Headers": "'*'",
                "method.response.header.Access-Control-Allow-Methods":
                  "'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'",
                "method.response.header.Access-Control-Allow-Origin": "'*'",
              },
            },
            { parent, dependsOn: [integration] },
          );

          return { method, methodResponse, integration, integrationResponse };
        });
      });
    }

    function createCorsResponses() {
      return output(args.cors).apply((cors) => {
        if (cors === false) return [];

        return ["4XX", "5XX"].map(
          (type) =>
            new apigateway.Response(
              `${name}Cors${type}Response`,
              {
                restApiId: api.id,
                responseType: `DEFAULT_${type}`,
                responseParameters: {
                  "gatewayresponse.header.Access-Control-Allow-Origin": "'*'",
                  "gatewayresponse.header.Access-Control-Allow-Headers": "'*'",
                },
                responseTemplates: {
                  "application/json":
                    '{"message":$context.error.messageString}',
                },
              },
              { parent },
            ),
        );
      });
    }

    function createDeployment() {
      const resources = all([corsRoutes, corsResponses]).apply(
        ([corsRoutes, corsResponses]) =>
          [
            api,
            corsRoutes.map((v) => Object.values(v)),
            corsResponses,
            routes.map((route) => [
              route.nodes.integration,
              route.nodes.method,
            ]),
          ].flat(3),
      );

      // filter serializable output values
      const resourcesSanitized = all([resources]).apply(([resources]) =>
        resources.map((resource) =>
          Object.fromEntries(
            Object.entries(resource).filter(
              ([k, v]) => !k.startsWith("_") && typeof v !== "function",
            ),
          ),
        ),
      );

      return new apigateway.Deployment(
        ...transform(
          args.transform?.deployment,
          `${name}Deployment`,
          {
            restApi: api.id,
            triggers: all([resourcesSanitized]).apply(([resources]) =>
              Object.fromEntries(
                resources.map((resource) => [
                  resource.urn,
                  JSON.stringify(resource),
                ]),
              ),
            ),
          },
          { parent },
        ),
      );
    }

    function createLogGroup() {
      return new cloudwatch.LogGroup(
        ...transform(
          args.transform?.accessLog,
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
      return new apigateway.Stage(
        ...transform(
          args.transform?.stage,
          `${name}Stage`,
          {
            restApi: api.id,
            stageName: $app.stage,
            deployment: deployment.id,
            accessLogSettings: {
              destinationArn: logGroup.arn,
              format: JSON.stringify({
                // request info
                requestTime: `"$context.requestTime"`,
                requestId: `"$context.requestId"`,
                httpMethod: `"$context.httpMethod"`,
                path: `"$context.path"`,
                resourcePath: `"$context.resourcePath"`,
                status: `$context.status`, // integer value, do not wrap in quotes
                responseLatency: `$context.responseLatency`, // integer value, do not wrap in quotes
                xrayTraceId: `"$context.xrayTraceId"`,
                // integration info
                functionResponseStatus: `"$context.integration.status"`,
                integrationRequestId: `"$context.integration.requestId"`,
                integrationLatency: `"$context.integration.latency"`,
                integrationServiceStatus: `"$context.integration.integrationStatus"`,
                // caller info
                ip: `"$context.identity.sourceIp"`,
                userAgent: `"$context.identity.userAgent"`,
                principalId: `"$context.authorizer.principalId"`,
              }),
            },
          },
          { parent },
        ),
      );
    }

    function createSsl() {
      if (!domain) return;

      return all([domain, endpointType, region]).apply(
        ([domain, endpointType, region]) => {
          if (domain.cert) return output(domain.cert);
          if (domain.nameId) return output(undefined);

          return new DnsValidatedCertificate(
            `${name}Ssl`,
            {
              domainName: domain.name,
              dns: domain.dns!,
            },
            {
              parent,
              provider:
                endpointType === "EDGE" && region !== "us-east-1"
                  ? useProvider("us-east-1")
                  : undefined,
            },
          ).arn;
        },
      );
    }

    function createDomainName() {
      if (!domain || !certificateArn) return;

      return all([domain, endpointType]).apply(([domain, endpointType]) =>
        domain.nameId
          ? apigateway.DomainName.get(
            `${name}DomainName`,
            domain.nameId,
            {},
            { parent },
          )
          : new apigateway.DomainName(
            ...transform(
              args.transform?.domainName,
              `${name}DomainName`,
              {
                domainName: domain?.name,
                endpointConfiguration: { types: endpointType },
                ...(endpointType === "REGIONAL"
                  ? {
                    regionalCertificateArn:
                      certificateArn as Output<string>,
                  }
                  : { certificateArn: certificateArn as Output<string> }),
              },
              { parent },
            ),
          ),
      );
    }

    function createDnsRecords(): void {
      if (!domain || !apigDomain) return;

      domain.apply((domain) => {
        if (!domain.dns) return;
        if (domain.nameId) return;

        domain.dns.createAlias(
          name,
          {
            name: domain.name,
            aliasName: endpointType.apply((v) =>
              v === "EDGE"
                ? apigDomain.cloudfrontDomainName
                : apigDomain.regionalDomainName,
            ),
            aliasZone: endpointType.apply((v) =>
              v === "EDGE"
                ? apigDomain.cloudfrontZoneId
                : apigDomain.regionalZoneId,
            ),
          },
          { parent },
        );
      });
    }

    function createDomainMapping() {
      if (!domain || !apigDomain) return;

      return domain.path?.apply(
        (path) =>
          new apigateway.BasePathMapping(
            `${name}DomainMapping`,
            {
              restApi: api.id,
              domainName: apigDomain.id,
              stageName: stage.stageName,
              basePath: path,
            },
            { parent },
          ),
      );
    }
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

const __pulumiType = "sst:aws:ApiGatewayV1";
// @ts-expect-error
ApiGatewayV1.__pulumiType = __pulumiType;
