import fs from "fs";
import path from "path";
import crypto from "crypto";
import archiver from "archiver";
import type { BuildOptions, Loader } from "esbuild";
import { glob } from "glob";
import {
  all,
  asset,
  ComponentResourceOptions,
  interpolate,
  Output,
  output,
  secret,
  unsecret,
} from "@pulumi/pulumi";
import { bootstrap } from "./helpers/bootstrap.js";
import { Duration, DurationMinutes, toSeconds } from "../duration.js";
import { Size, toMBs } from "../size.js";
import { Component, Prettify, Transform, transform } from "../component.js";
import { Link } from "../link.js";
import { VisibleError } from "../error.js";
import type { Input } from "../input.js";
import { physicalName } from "../naming.js";
import { RETENTION } from "./logging.js";
import {
  cloudwatch,
  ecr,
  getCallerIdentityOutput,
  getPartitionOutput,
  getRegionOutput,
  iam,
  lambda,
  s3,
  types,
} from "@pulumi/aws";
import { Permission, permission } from "./permission.js";
import { Vpc } from "./vpc.js";
import { Image } from "@pulumi/docker-build";
import { rpc } from "../rpc/rpc.js";
import { parseRoleArn } from "./helpers/arn.js";
import { RandomBytes } from "@pulumi/random";
import { lazy } from "../../util/lazy.js";
import { Efs } from "./efs.js";
import { FunctionEnvironmentUpdate } from "./providers/function-environment-update.js";
import { warnOnce } from "../../util/warn.js";
import {
  normalizeRouteArgs,
  RouterRouteArgs,
  RouterRouteArgsDeprecated,
} from "./router.js";
import { KvRoutesUpdate } from "./providers/kv-routes-update.js";
import { KvKeys } from "./providers/kv-keys.js";

/**
 * Helper type to define function ARN type
 */
export type FunctionArn = `arn:${string}` & {};

export type FunctionPermissionArgs = {
  /**
   * Configures whether the permission is allowed or denied.
   * @default `"allow"`
   * @example
   * ```ts
   * {
   *   effect: "deny"
   * }
   * ```
   */
  effect?: "allow" | "deny";
  /**
   * The [IAM actions](https://docs.aws.amazon.com/service-authorization/latest/reference/reference_policies_actions-resources-contextkeys.html#actions_table) that can be performed.
   * @example
   * ```js
   * {
   *   actions: ["s3:*"]
   * }
   * ```
   */
  actions: string[];
  /**
   * The resourcess specified using the [IAM ARN format](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html).
   * @example
   * ```js
   * {
   *   resources: ["arn:aws:s3:::my-bucket/*"]
   * }
   * ```
   */
  resources: Input<Input<string>[]>;
};

interface FunctionUrlCorsArgs {
  /**
   * Allow cookies or other credentials in requests to the function URL.
   * @default `false`
   * @example
   * ```js
   * {
   *   url: {
   *     cors: {
   *       allowCredentials: true
   *     }
   *   }
   * }
   * ```
   */
  allowCredentials?: Input<boolean>;
  /**
   * The HTTP headers that origins can include in requests to the function URL.
   * @default `["*"]`
   * @example
   * ```js
   * {
   *   url: {
   *     cors: {
   *       allowHeaders: ["date", "keep-alive", "x-custom-header"]
   *     }
   *   }
   * }
   * ```
   */
  allowHeaders?: Input<Input<string>[]>;
  /**
   * The origins that can access the function URL.
   * @default `["*"]`
   * @example
   * ```js
   * {
   *   url: {
   *     cors: {
   *       allowOrigins: ["https://www.example.com", "http://localhost:60905"]
   *     }
   *   }
   * }
   * ```
   * Or the wildcard for all origins.
   * ```js
   * {
   *   url: {
   *     cors: {
   *       allowOrigins: ["*"]
   *     }
   *   }
   * }
   * ```
   */
  allowOrigins?: Input<Input<string>[]>;
  /**
   * The HTTP methods that are allowed when calling the function URL.
   * @default `["*"]`
   * @example
   * ```js
   * {
   *   url: {
   *     cors: {
   *       allowMethods: ["GET", "POST", "DELETE"]
   *     }
   *   }
   * }
   * ```
   * Or the wildcard for all methods.
   * ```js
   * {
   *   url: {
   *     cors: {
   *       allowMethods: ["*"]
   *     }
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
   * The HTTP headers you want to expose in your function to an origin that calls the function URL.
   * @default `[]`
   * @example
   * ```js
   * {
   *   url: {
   *     cors: {
   *       exposeHeaders: ["date", "keep-alive", "x-custom-header"]
   *     }
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
   *   url: {
   *     cors: {
   *       maxAge: "1 day"
   *     }
   *   }
   * }
   * ```
   */
  maxAge?: Input<Duration>;
}

export interface FunctionArgs {
  /**
   * Disable running this function [Live](/docs/live/) in `sst dev`.
   * @deprecated Use `dev` instead.
   * @default `true`
   * @example
   * ```js
   * {
   *   live: false
   * }
   * ```
   */
  live?: Input<false>;
  /**
   * Disable running this function [_Live_](/docs/live/) in `sst dev`.
   *
   * By default, the functions in your app are run locally in `sst dev`. To do this, a _stub_
   * version of your function is deployed, instead of the real function.
   *
   * :::note
   * In `sst dev` a _stub_ version of your function is deployed.
   * :::
   *
   * This shows under the **Functions** tab in the multiplexer sidebar where your invocations
   * are logged. You can turn this off by setting `dev` to `false`.
   *
   * Read more about [Live](/docs/live/) and [`sst dev`](/docs/reference/cli/#dev).
   *
   * @default `true`
   * @example
   * ```js
   * {
   *   dev: false
   * }
   * ```
   */
  dev?: Input<false>;
  /**
   * Configure the maximum number of retry attempts for this function when invoked
   * asynchronously.
   *
   * This only affects asynchronous invocations of the function, ie. when subscribed to
   * Topics, EventBuses, or Buckets. And not when directly invoking the function.
   *
   * Valid values are between 0 and 2.
   *
   * @default `2`
   * @example
   * ```js
   * {
   *   retries: 0
   * }
   * ```
   */
  retries?: Input<number>;
  /**
   * The name for the function.
   *
   * By default, the name is generated from the app name, stage name, and component name. This
   * is displayed in the AWS Console for this function.
   *
   * :::caution
   * To avoid the name from thrashing, you want to make sure that it includes the app and stage
   * name.
   * :::
   *
   * If you are going to set the name, you need to make sure:
   * 1. It's unique across your app.
   * 2. Uses the app and stage name, so it doesn't thrash when you deploy to different stages.
   *
   * Also, changing the name after your've deployed it once will create a new function and delete
   * the old one.
   *
   * @example
   * ```js
   * {
   *   name: `${$app.name}-${$app.stage}-my-function`
   * }
   * ```
   */
  name?: Input<string>;
  /**
   * A description for the function. This is displayed in the AWS Console.
   * @example
   * ```js
   * {
   *   description: "Handler function for my nightly cron job."
   * }
   * ```
   */
  description?: Input<string>;
  /**
   * The language runtime for the function.
   *
   * Node.js and Golang are officially supported. While, Python and Rust are
   * community supported. Support for other runtimes are on the roadmap.
   *
   * @default `"nodejs20.x"`
   *
   * @example
   * ```js
   * {
   *   runtime: "nodejs22.x"
   * }
   * ```
   */
  runtime?: Input<
    | "nodejs18.x"
    | "nodejs20.x"
    | "nodejs22.x"
    | "go"
    | "rust"
    | "provided.al2023"
    | "python3.9"
    | "python3.10"
    | "python3.11"
    | "python3.12"
  >;
  /**
   * Path to the source code directory for the function. By default, the handler is
   * bundled with [esbuild](https://esbuild.github.io/). Use `bundle` to skip bundling.
   *
   * :::caution
   * Use `bundle` only when you want to bundle the function yourself.
   * :::
   *
   * If the `bundle` option is specified, the `handler` needs to be in the root of the bundle.
   *
   * @example
   *
   * Here, the entire `packages/functions/src` directory is zipped. And the handler is
   * in the `src` directory.
   *
   * ```js
   * {
   *   bundle: "packages/functions/src",
   *   handler: "index.handler"
   * }
   * ```
   */
  bundle?: Input<string>;
  /**
   * Path to the handler for the function.
   *
   * - For Node.js this is in the format `{path}/{file}.{method}`.
   * - For Python this is also `{path}/{file}.{method}`.
   * - For Golang this is `{path}` to the Go module.
   * - For Rust this is `{path}` to the Rust crate.
   *
   * @example
   *
   * ##### Node.js
   *
   * For example with Node.js you might have.
   *
   * ```js
   * {
   *   handler: "packages/functions/src/main.handler"
   * }
   * ```
   *
   * Where `packages/functions/src` is the path. And `main` is the file, where you might have
   * a `main.ts` or `main.js`. And `handler` is the method exported in that file.
   *
   * :::note
   * You don't need to specify the file extension.
   * :::
   *
   * If `bundle` is specified, the handler needs to be in the root of the bundle directory.
   *
   * ```js
   * {
   *   bundle: "packages/functions/src",
   *   handler: "index.handler"
   * }
   * ```
   *
   * ##### Python
   *
   * For Python, [uv](https://docs.astral.sh/uv/) is used to package the function.
   * You need to have it installed.
   *
   * :::note
   * You need uv installed for Python functions.
   * :::
   *
   * The functions need to be in a [uv workspace](https://docs.astral.sh/uv/concepts/projects/workspaces/#workspace-sources).
   *
   * ```js
   * {
   *   handler: "functions/src/functions/api.handler"
   * }
   * ```
   *
   * The project structure might look something like this. Where there is a
   * `pyproject.toml` file in the root and the `functions/` directory is a uv
   * workspace with its own `pyproject.toml`.
   *
   * ```txt
   * ├── sst.config.ts
   * ├── pyproject.toml
   * └── functions
   *     ├── pyproject.toml
   *     └── src
   *         └── functions
   *             ├── __init__.py
   *             └── api.py
   * ```
   *
   * To make sure that the right runtime is used in `sst dev`, make sure to set the
   * version of Python in your `pyproject.toml` to match the runtime you are using.
   *
   * ```toml title="functions/pyproject.toml"
   * requires-python = "==3.11.*"
   * ```
   *
   * You can refer to [this example of deploying a Python function](/docs/examples/#aws-lambda-python).
   *
   * ##### Golang
   *
   * For Golang the handler looks like.
   *
   * ```js
   * {
   *   handler: "packages/functions/go/some_module"
   * }
   * ```
   *
   * Where `packages/functions/go/some_module` is the path to the Go module. This
   * includes the name of the module in your `go.mod`. So in this case your `go.mod`
   * might be in `packages/functions/go` and `some_module` is the name of the
   * module.
   *
   * You can refer to [this example of deploying a Go function](/docs/examples/#aws-lambda-go).
   *
   * ##### Rust
   *
   * For Rust, the handler looks like.
   *
   * ```js
   * {
   *   handler: "crates/api"
   * }
   * ```
   *
   * Where `crates/api` is the path to the Rust crate. This means there is a
   * `Cargo.toml` file in `crates/api`, and the main() function handles the lambda.
   */
  handler: Input<string>;
  /**
   * The maximum amount of time the function can run. The minimum timeout is 1 second and the maximum is 900 seconds or 15 minutes.
   *
   * :::note
   * If a function is connected to another service, the request will time out based on the service's limits.
   * :::
   *
   * While the maximum timeout is 15 minutes, if a function is connected to other
   * services, it'll time out based on those limits.
   *
   * - API Gateway has a timeout of 30 seconds. So even if the function has a
   *   timeout of 15 minutes, the API request will time out after 30 seconds.
   * - CloudFront has a default timeout of 60 seconds. You can have this limit
   *   increased by [contacting AWS Support](https://console.aws.amazon.com/support/home#/case/create?issueType=service-limit-increase).
   *
   * @default `"20 seconds"`
   * @example
   * ```js
   * {
   *   timeout: "900 seconds"
   * }
   * ```
   */
  timeout?: Input<DurationMinutes>;
  /**
   * The amount of memory allocated for the function. Takes values between 128 MB
   * and 10240 MB in 1 MB increments.  The amount of memory affects the amount of
   * virtual CPU available to the function.
   *
   * :::tip
   * While functions with less memory are cheaper, larger functions can process faster.
   * And might end up being more [cost effective](https://docs.aws.amazon.com/lambda/latest/operatorguide/computing-power.html).
   * :::
   *
   * @default `"1024 MB"`
   * @example
   * ```js
   * {
   *   memory: "10240 MB"
   * }
   * ```
   */
  memory?: Input<Size>;
  /**
   * The amount of ephemeral storage allocated for the function. This sets the ephemeral
   * storage of the lambda function (/tmp). Must be between "512 MB" and "10240 MB" ("10 GB")
   * in 1 MB increments.
   *
   * @default `"512 MB"`
   * @example
   * ```js
   * {
   *   storage: "5 GB"
   * }
   * ```
   */
  storage?: Input<Size>;
  /**
   * Key-value pairs of values that are set as [Lambda environment variables](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html).
   * The keys need to:
   * - Start with a letter
   * - Be at least 2 characters long
   * - Contain only letters, numbers, or underscores
   *
   * They can be accessed in your function using `process.env.<key>`.
   *
   * :::note
   * The total size of the environment variables cannot exceed 4 KB.
   * :::
   *
   * @example
   *
   * ```js
   * {
   *   environment: {
   *     DEBUG: "true"
   *   }
   * }
   * ```
   */
  environment?: Input<Record<string, Input<string>>>;
  /**
   * Permissions and the resources that the function needs to access. These permissions are
   * used to create the function's IAM role.
   *
   * :::tip
   * If you `link` the function to a resource, the permissions to access it are
   * automatically added.
   * :::
   *
   * @example
   * Allow the function to read and write to an S3 bucket called `my-bucket`.
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
   * Allow the function to perform all actions on an S3 bucket called `my-bucket`.
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
   * Granting the function permissions to access all resources.
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
  permissions?: Input<Prettify<FunctionPermissionArgs>[]>;
  /**
   * Policies to attach to the function. These policies will be added to the
   * function's IAM role.
   *
   * Attaching policies lets you grant a set of predefined permissions to the
   * function without having to specify the permissions in the `permissions` prop.
   *
   * @example
   * For example, allow the function to have read-only access to all resources.
   * ```js
   * {
   *   policies: ["arn:aws:iam::aws:policy/ReadOnlyAccess"]
   * }
   * ```
   */
  policies?: Input<string[]>;
  /**
   * [Link resources](/docs/linking/) to your function. This will:
   *
   * 1. Grant the permissions needed to access the resources.
   * 2. Allow you to access it in your function using the [SDK](/docs/reference/sdk/).
   *
   * @example
   *
   * Takes a list of components to link to the function.
   *
   * ```js
   * {
   *   link: [bucket, stripeKey]
   * }
   * ```
   */
  link?: Input<any[]>;
  /**
   * Enable streaming for the function.
   *
   * Streaming is only supported when using the function `url` is enabled and not when using it
   * with API Gateway.
   *
   * You'll also need to [wrap your handler](https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html) with `awslambda.streamifyResponse` to enable streaming.
   *
   * :::note
   * Streaming is currently not supported in `sst dev`.
   * :::
   *
   * While `sst dev` doesn't support streaming, you can use the
   * [`lambda-stream`](https://github.com/astuyve/lambda-stream) package to test locally.
   *
   * Check out the [AWS Lambda streaming example](/docs/examples/#aws-lambda-streaming) for more
   * details.
   *
   * @default `false`
   * @example
   * ```js
   * {
   *   streaming: true
   * }
   * ```
   */
  streaming?: Input<boolean>;
  /**
   * @internal
   */
  injections?: Input<string[]>;
  /**
   * Configure the function logs in CloudWatch. Or pass in `false` to disable writing logs.
   * @default `{retention: "1 month", format: "text"}`
   * @example
   * ```js
   * {
   *   logging: false
   * }
   * ```
   * When set to `false`, the function is not given permissions to write to CloudWatch.
   * Logs.
   */
  logging?: Input<
    | false
    | {
      /**
       * The duration the function logs are kept in CloudWatch.
       *
       * Not application when an existing log group is provided.
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
       * Assigns the given CloudWatch log group name to the function. This allows you to pass in a previously created log group.
       *
       * By default, the function creates a new log group when it's created.
       *
       * @default Creates a log group
       * @example
       * ```js
       * {
       *   logging: {
       *     logGroup: "/existing/log-group"
       *   }
       * }
       * ```
       */
      logGroup?: Input<string>;
      /**
       * The [log format](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs-advanced.html)
       * of the Lambda function.
       * @default `"text"`
       * @example
       * ```js
       * {
       *   logging: {
       *     format: "json"
       *   }
       * }
       * ```
       */
      format?: Input<"text" | "json">;
    }
  >;
  /**
   * The [architecture](https://docs.aws.amazon.com/lambda/latest/dg/foundation-arch.html)
   * of the Lambda function.
   *
   * @default `"x86_64"`
   * @example
   * ```js
   * {
   *   architecture: "arm64"
   * }
   * ```
   */
  architecture?: Input<"x86_64" | "arm64">;
  /**
   * Assigns the given IAM role ARN to the function. This allows you to pass in a previously created role.
   *
   * :::caution
   * When you pass in a role, the function will not update it if you add `permissions` or `link` resources.
   * :::
   *
   * By default, the function creates a new IAM role when it's created. It'll update this role if you add `permissions` or `link` resources.
   *
   * However, if you pass in a role, you'll need to update it manually if you add `permissions` or `link` resources.
   *
   * @default Creates a new role
   * @example
   * ```js
   * {
   *   role: "arn:aws:iam::123456789012:role/my-role"
   * }
   * ```
   */
  role?: Input<string>;
  /**
   * Enable [Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/lambda-urls.html).
   * These are dedicated endpoints for your Lambda functions.
   * @default `false`
   * @example
   * Enable it with the default options.
   * ```js
   * {
   *   url: true
   * }
   * ```
   *
   * Configure the authorization and CORS settings for the endpoint.
   * ```js
   * {
   *   url: {
   *     authorization: "iam",
   *     cors: {
   *       allowOrigins: ['https://example.com']
   *     }
   *   }
   * }
   * ```
   */
  url?: Input<
    | boolean
    | {
      /**
       * @deprecated The `url.router` prop is now the recommended way to serve your
       * function URL through a `Router` component.
       */
      route?: Prettify<RouterRouteArgsDeprecated>;
      /**
       * Serve your function URL through a `Router` instead of a standalone Function URL.
       *
       * By default, this component creates a direct function URL endpoint. But you might
       * want to serve it through the distribution of your `Router` as a:
       *
       * - A path like `/api/users`
       * - A subdomain like `api.example.com`
       * - Or a combined pattern like `dev.example.com/api`
       *
       * @example
       *
       * To serve your function **from a path**, you'll need to configure the root domain
       * in your `Router` component.
       *
       * ```ts title="sst.config.ts" {2}
       * const router = new sst.aws.Router("Router", {
       *   domain: "example.com"
       * });
       * ```
       *
       * Now set the `router` and the `path` in the `url` prop.
       *
       * ```ts {4,5}
       * {
       *   url: {
       *     router: {
       *       instance: router,
       *       path: "/api/users"
       *     }
       *   }
       * }
       * ```
       *
       * To serve your function **from a subdomain**, you'll need to configure the
       * domain in your `Router` component to match both the root and the subdomain.
       *
       * ```ts title="sst.config.ts" {3,4}
       * const router = new sst.aws.Router("Router", {
       *   domain: {
       *     name: "example.com",
       *     aliases: ["*.example.com"]
       *   }
       * });
       * ```
       *
       * Now set the `domain` in the `router` prop.
       *
       * ```ts {5}
       * {
       *   url: {
       *     router: {
       *       instance: router,
       *       domain: "api.example.com"
       *     }
       *   }
       * }
       * ```
       *
       * Finally, to serve your function **from a combined pattern** like
       * `dev.example.com/api`, you'll need to configure the domain in your `Router` to
       * match the subdomain.
       *
       * ```ts title="sst.config.ts" {3,4}
       * const router = new sst.aws.Router("Router", {
       *   domain: {
       *     name: "example.com",
       *     aliases: ["*.example.com"]
       *   }
       * });
       * ```
       *
       * And set the `domain` and the `path`.
       *
       * ```ts {5,6}
       * {
       *   url: {
       *     router: {
       *       instance: router,
       *       domain: "dev.example.com",
       *       path: "/api/users"
       *     }
       *   }
       * }
       * ```
       */
      router?: Prettify<RouterRouteArgs>;
      /**
       * The authorization used for the function URL. Supports [IAM authorization](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html).
       * @default `"none"`
       * @example
       * ```js
       * {
       *   url: {
       *     authorization: "iam"
       *   }
       * }
       * ```
       */
      authorization?: Input<"none" | "iam">;
      /**
       * Customize the CORS (Cross-origin resource sharing) settings for the function URL.
       * @default `true`
       * @example
       * Disable CORS.
       * ```js
       * {
       *   url: {
       *     cors: false
       *   }
       * }
       * ```
       * Only enable the `GET` and `POST` methods for `https://example.com`.
       * ```js
       * {
       *   url: {
       *     cors: {
       *       allowMethods: ["GET", "POST"],
       *       allowOrigins: ["https://example.com"]
       *     }
       *   }
       * }
       * ```
       */
      cors?: Input<boolean | Prettify<FunctionUrlCorsArgs>>;
    }
  >;
  /**
   * Configure how your function is bundled.
   *
   * By default, SST will bundle your function
   * code using [esbuild](https://esbuild.github.io/). This tree shakes your code to
   * only include what's used; reducing the size of your function package and improving
   * cold starts.
   */
  nodejs?: Input<{
    /**
     * @internal
     * Point to a file that exports a list of esbuild plugins to use.
     *
     * @example
     * ```js
     * {
     *   nodejs: {
     *     plugins: "./plugins.mjs"
     *   }
     * }
     * ```
     *
     * The path is relative to the location of the `sst.config.ts`.
     *
     * ```js title="plugins.mjs"
     * import { somePlugin } from "some-plugin";
     *
     * export default [
     *   somePlugin()
     * ];
     * ```
     *
     * You'll also need to install the npm package of the plugin.
     */
    plugins?: Input<string>;
    /**
     * Configure additional esbuild loaders for other file extensions. This is useful
     * when your code is importing non-JS files like `.png`, `.css`, etc.
     *
     * @example
     * ```js
     * {
     *   nodejs: {
     *     loader: {
     *      ".png": "file"
     *     }
     *   }
     * }
     * ```
     */
    loader?: Input<Record<string, Loader>>;
    /**
     * Dependencies that need to be excluded from the function package.
     *
     * Certain npm packages cannot be bundled using esbuild. This allows you to exclude them
     * from the bundle. Instead they'll be moved into a `node_modules/` directory in the
     * function package.
     *
     * :::tip
     * If esbuild is giving you an error about a package, try adding it to the `install` list.
     * :::
     *
     * This will allow your functions to be able to use these dependencies when deployed. They
     * just won't be tree shaken. You however still need to have them in your `package.json`.
     *
     * :::caution
     * Packages listed here still need to be in your `package.json`.
     * :::
     *
     * Esbuild will ignore them while traversing the imports in your code. So these are the
     * **package names as seen in the imports**. It also works on packages that are not directly
     * imported by your code.
     *
     * @example
     * ```js
     * {
     *   nodejs: {
     *     install: ["pg"]
     *   }
     * }
     * ```
     */
    install?: Input<string[]>;
    /**
     * Use this to insert a string at the beginning of the generated JS file.
     *
     * @example
     * ```js
     * {
     *   nodejs: {
     *     banner: "console.log('Function starting')"
     *   }
     * }
     * ```
     */
    banner?: Input<string>;
    /**
     * This allows you to customize esbuild config that is used.
     *
     * :::tip
     * Check out the _JS tab_ in the code snippets in the esbuild docs for the
     * [`BuildOptions`](https://esbuild.github.io/api/#build).
     * :::
     */
    esbuild?: Input<BuildOptions>;
    /**
     * Disable if the function code is minified when bundled.
     *
     * @default `true`
     *
     * @example
     * ```js
     * {
     *   nodejs: {
     *     minify: false
     *   }
     * }
     * ```
     */
    minify?: Input<boolean>;
    /**
     * Configure the format of the generated JS code; ESM or CommonJS.
     *
     * @default `"esm"`
     *
     * @example
     * ```js
     * {
     *   nodejs: {
     *     format: "cjs"
     *   }
     * }
     * ```
     */
    format?: Input<"cjs" | "esm">;
    /**
     * Configure if source maps are added to the function bundle when **deployed**. Since they
     * increase payload size and potentially cold starts, they are not added by default.
     * However, they are always generated during `sst dev`.
     *
     * :::tip[SST Console]
     * For the [Console](/docs/console/), source maps are always generated and uploaded
     * to your bootstrap bucket. These are then downloaded and used to display
     * Issues in the console.
     * :::
     *
     * @default `false`
     *
     * @example
     * ```js
     * {
     *   nodejs: {
     *     sourcemap: true
     *   }
     * }
     * ```
     */
    sourcemap?: Input<boolean>;
    /**
     * If enabled, modules that are dynamically imported will be bundled in their own files
     * with common dependencies placed in shared chunks. This can help reduce cold starts
     * as your function grows in size.
     *
     * @default `false`
     *
     * @example
     * ```js
     * {
     *   nodejs: {
     *     splitting: true
     *   }
     * }
     * ```
     */
    splitting?: Input<boolean>;
  }>;
  /**
   * Configure how your Python function is packaged.
   */
  python?: Input<{
    /**
     * Set this to `true` if you want to deploy this function as a container image.
     * There are a couple of reasons why you might want to do this.
     *
     * 1. The Lambda package size has an unzipped limit of 250MB. Whereas the
     *    container image size has a limit of 10GB.
     * 2. Even if you are below the 250MB limit, larger Lambda function packages
     *    have longer cold starts when compared to container image.
     * 3. You might want to use a custom Dockerfile to handle complex builds.
     *
     * @default `false`
     * @example
     * ```ts
     * {
     *   python: {
     *     container: true
     *   }
     * }
     * ```
     *
     * When you run `sst deploy`, it uses a built-in Dockerfile. It also needs
     * the Docker daemon to be running.
     *
     * :::note
     * This needs the Docker daemon to be running.
     * :::
     *
     * To use a custom Dockerfile, add one to the rooot of the uv workspace
     * of the function.
     *
     *
     * ```txt {5}
     * ├── sst.config.ts
     * ├── pyproject.toml
     * └── function
     *     ├── pyproject.toml
     *     ├── Dockerfile
     *     └── src
     *         └── function
     *             └── api.py
     * ```
     *
     * You can refer to [this example of using a container image](/docs/examples/#aws-lambda-python-container).
     */
    container?: Input<boolean>;
  }>;
  /**
   * Add additional files to copy into the function package. Takes a list of objects
   * with `from` and `to` paths. These will be copied over before the function package
   * is zipped up.
   *
   * @example
   *
   * Copying over a single file from the `src` directory to the `src/` directory of the
   * function package.
   *
   * ```js
   * {
   *   copyFiles: [{ from: "src/index.js" }]
   * }
   * ```
   *
   * Copying over a single file from the `src` directory to the `core/src` directory in
   * the function package.
   *
   * ```js
   * {
   *   copyFiles: [{ from: "src/index.js", to: "core/src/index.js" }]
   * }
   * ```
   *
   * Copying over a couple of files.
   *
   * ```js
   * {
   *   copyFiles: [
   *     { from: "src/this.js", to: "core/src/this.js" },
   *     { from: "src/that.js", to: "core/src/that.js" }
   *   ]
   * }
   * ```
   */
  copyFiles?: Input<
    {
      /**
       * Source path relative to the `sst.config.ts`.
       */
      from: Input<string>;
      /**
       * Destination path relative to function root in the package. By default, it
       * creates the same directory structure as the `from` path and copies the file.
       *
       * @default The `from` path in the function package
       */
      to?: Input<string>;
    }[]
  >;
  /**
   * Configure the concurrency settings for the function.
   *
   * @default No concurrency settings set
   * @example
   * ```js
   * {
   *   concurrency: {
   *     provisioned: 10,
   *     reserved: 50
   *   }
   * }
   * ```
   */
  concurrency?: Input<{
    /**
     * Provisioned concurrency ensures a specific number of Lambda instances are always
     * ready to handle requests, reducing cold start times. Enabling this will incur
     * extra charges.
     *
     * :::note
     * Enabling provisioned concurrency will incur extra charges.
     * :::
     *
     * Note that `versioning` needs to be enabled for provisioned concurrency.
     *
     * @default No provisioned concurrency
     * @example
     * ```js
     * {
     *   concurrency: {
     *     provisioned: 10
     *   }
     * }
     * ```
     */
    provisioned?: Input<number>;
    /**
     * Reserved concurrency limits the maximum number of concurrent executions for a
     * function, ensuring critical functions always have capacity. It does not incur
     * extra charges.
     *
     * :::note
     * Setting this to `0` will disable the function from being triggered.
     * :::
     *
     * @default No reserved concurrency
     * @example
     * ```js
     * {
     *   concurrency: {
     *     reserved: 50
     *   }
     * }
     * ```
     */
    reserved?: Input<number>;
  }>;
  /**
   * Enable versioning for the function.
   *
   * @default `false`
   * @example
   * ```js
   * {
   *   versioning: true
   * }
   * ```
   */
  versioning?: Input<boolean>;
  /**
   * A list of Lambda layer ARNs to add to the function.
   *
   * :::note
   * Layers are only added when the function is deployed.
   * :::
   *
   * These are only added when the function is deployed. In `sst dev`, your functions are run
   * locally, so the layers are not used. Instead you should use a local version of what's
   * in the layer.
   *
   * @example
   * ```js
   * {
   *   layers: ["arn:aws:lambda:us-east-1:123456789012:layer:my-layer:1"]
   * }
   * ```
   */
  layers?: Input<Input<string>[]>;
  /**
   * Mount an EFS file system to the function.
   *
   * @example
   * Create an EFS file system.
   *
   * ```ts title="sst.config.ts"
   * const vpc = new sst.aws.Vpc("MyVpc");
   * const fileSystem = new sst.aws.Efs("MyFileSystem", { vpc });
   * ```
   *
   * And pass it in.
   *
   * ```js
   * {
   *   volume: {
   *     efs: fileSystem
   *   }
   * }
   * ```
   *
   * By default, the file system will be mounted to `/mnt/efs`. You can change this by
   * passing in the `path` property.
   *
   * ```js
   * {
   *   volume: {
   *     efs: fileSystem,
   *     path: "/mnt/my-files"
   *   }
   * }
   * ```
   *
   * To use an existing EFS, you can pass in an EFS access point ARN.
   *
   * ```js
   * {
   *   volume: {
   *     efs: "arn:aws:elasticfilesystem:us-east-1:123456789012:access-point/fsap-12345678",
   *   }
   * }
   * ```
   */
  volume?: Input<{
    /**
     * The EFS file system to mount. Or an EFS access point ARN.
     */
    efs: Input<Efs | string>;
    /**
     * The path to mount the volume.
     * @default `"/mnt/efs"`
     */
    path?: Input<string>;
  }>;
  /**
   * A list of tags to add to the function.
   *
   * @example
   * ```js
   * {
   *   tags: {
   *     "my-tag": "my-value"
   *   }
   * }
   * ```
   */
  tags?: Input<Record<string, Input<string>>>;
  /**
   * Configure the function to connect to private subnets in a virtual private cloud or VPC. This allows your function to access private resources.
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
   * And pass it in.
   *
   * ```js
   * {
   *   vpc: myVpc
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
    privateSubnets: Input<Input<string>[]>;
    /**
     * A list of VPC subnet IDs.
     * @deprecated Use `privateSubnets` instead.
     */
    subnets?: Input<Input<string>[]>;
  }>;

  /**
   * Hook into the Lambda function build process.
   */
  hook?: {
    /**
     * Specify a callback that'll be run after the Lambda function is built.
     *
     * :::note
     * This is not called in `sst dev`.
     * :::
     *
     * Useful for modifying the generated Lambda function code before it's
     * deployed to AWS. It can also be used for uploading the generated sourcemaps
     * to a service like Sentry.
     *
     * @param dir The directory where the function code is generated.
     */
    postbuild(dir: string): Promise<void>;
  };
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the Lambda Function resource.
     */
    function?: Transform<lambda.FunctionArgs>;
    /**
     * Transform the IAM Role resource.
     */
    role?: Transform<iam.RoleArgs>;
    /**
     * Transform the CloudWatch LogGroup resource.
     */
    logGroup?: Transform<cloudwatch.LogGroupArgs>;
    /**
     * Transform the Function Event Invoke Config resource. This is only created
     * when the `retries` property is set.
     */
    eventInvokeConfig?: Transform<lambda.FunctionEventInvokeConfigArgs>;
  };
  /**
   * @internal
   */
  _skipMetadata?: boolean;
  /**
   * @internal
   */
  _skipHint?: boolean;
}

/**
 * The `Function` component lets you add serverless functions to your app.
 * It uses [AWS Lambda](https://aws.amazon.com/lambda/).
 *
 * #### Supported runtimes
 *
 * Currently supports **Node.js** and **Golang** functions. **Python** and **Rust**
 * are community supported. Other runtimes are on the roadmap.
 *
 * @example
 *
 * #### Minimal example
 *
 *
 * <Tabs>
 *   <TabItem label="Node">
 *   Pass in the path to your handler function.
 *
 *   ```ts title="sst.config.ts"
 *   new sst.aws.Function("MyFunction", {
 *     handler: "src/lambda.handler"
 *   });
 *   ```
 *
 *   [Learn more below](#handler).
 *   </TabItem>
 *   <TabItem label="Python">
 *   Pass in the path to your handler function.
 *
 *   ```ts title="sst.config.ts"
 *   new sst.aws.Function("MyFunction", {
 *     runtime: "python3.11",
 *     handler: "functions/src/functions/api.handler"
 *   });
 *   ```
 *
 *   You need to have uv installed and your handler function needs to be in a uv workspace. [Learn more below](#handler).
 *   </TabItem>
 *   <TabItem label="Go">
 *   Pass in the directory to your Go module.
 *
 *   ```ts title="sst.config.ts"
 *   new sst.aws.Function("MyFunction", {
 *     runtime: "go",
 *     handler: "./src"
 *   });
 *   ```
 *
 *   [Learn more below](#handler).
 *   </TabItem>
 *   <TabItem label="Rust">
 *   Pass in the directory where your Cargo.toml lives.
 *
 *   ```ts title="sst.config.ts"
 *   new sst.aws.Function("MyFunction", {
 *     runtime: "rust",
 *     handler: "./crates/api/"
 *   });
 *   ```
 *
 *   [Learn more below](#handler).
 *   </TabItem>
 * </Tabs>
 *
 * #### Set additional config
 *
 * Pass in additional Lambda config.
 *
 * ```ts {3,4} title="sst.config.ts"
 * new sst.aws.Function("MyFunction", {
 *   handler: "src/lambda.handler",
 *   timeout: "3 minutes",
 *   memory: "1024 MB"
 * });
 * ```
 *
 * #### Link resources
 *
 * [Link resources](/docs/linking/) to the function. This will grant permissions
 * to the resources and allow you to access it in your handler.
 *
 * ```ts {5} title="sst.config.ts"
 * const bucket = new sst.aws.Bucket("MyBucket");
 *
 * new sst.aws.Function("MyFunction", {
 *   handler: "src/lambda.handler",
 *   link: [bucket]
 * });
 * ```
 *
 * You can use the [SDK](/docs/reference/sdk/) to access the linked resources
 * in your handler.
 *
 * <Tabs>
 *   <TabItem label="Node">
 *   ```ts title="src/lambda.ts"
 *   import { Resource } from "sst";
 *
 *   console.log(Resource.MyBucket.name);
 *   ```
 *   </TabItem>
 *   <TabItem label="Python">
 *   ```ts title="functions/src/functions/api.py"
 *   from sst import Resource
 *
 *   def handler(event, context):
 *       print(Resource.MyBucket.name)
 *   ```
 *
 *   Where the `sst` package can be added to your `pyproject.toml`.
 *
 *   ```toml title="functions/pyproject.toml"
 *   [tool.uv.sources]
 *   sst = { git = "https://github.com/sst/sst.git", subdirectory = "sdk/python", branch = "dev" }
 *   ```
 *   </TabItem>
 *   <TabItem label="Go">
 *   ```go title="src/main.go"
 *   import (
 *     "github.com/sst/sst/v3/sdk/golang/resource"
 *   )
 *
 *   resource.Get("MyBucket", "name")
 *   ```
 *   </TabItem>
 *   <TabItem label="Rust">
 *   ```rust title="src/main.rs"
 *   use sst_sdk::Resource;
 *   #[derive(serde::Deserialize, Debug)]
 *   struct Bucket {
 *      name: String,
 *   }
 *
 *   let resource = Resource::init().unwrap();
 *   let Bucket { name } = resource.get("Bucket").unwrap();
 *   ```
 *   </TabItem>
 * </Tabs>
 *
 * #### Set environment variables
 *
 * Set environment variables that you can read in your function. For example, using
 * `process.env` in your Node.js functions.
 *
 * ```ts {4} title="sst.config.ts"
 * new sst.aws.Function("MyFunction", {
 *   handler: "src/lambda.handler",
 *   environment: {
 *     DEBUG: "true"
 *   }
 * });
 * ```
 *
 * #### Enable function URLs
 *
 * Enable function URLs to invoke the function over HTTP.
 *
 * ```ts {3} title="sst.config.ts"
 * new sst.aws.Function("MyFunction", {
 *   handler: "src/lambda.handler",
 *   url: true
 * });
 * ```
 *
 * #### Bundling
 *
 * Customize how SST uses [esbuild](https://esbuild.github.io/) to bundle your Node.js
 * functions with the `nodejs` property.
 *
 * ```ts title="sst.config.ts" {3-5}
 * new sst.aws.Function("MyFunction", {
 *   handler: "src/lambda.handler",
 *   nodejs: {
 *     install: ["pg"]
 *   }
 * });
 * ```
 *
 * Or override it entirely by passing in your own function `bundle`.
 */
export class Function extends Component implements Link.Linkable {
  private constructorName: string;
  private function: Output<lambda.Function>;
  private role: iam.Role;
  private logGroup: Output<cloudwatch.LogGroup | undefined>;
  private urlEndpoint: Output<string | undefined>;
  private eventInvokeConfig?: lambda.FunctionEventInvokeConfig;

  private static readonly encryptionKey = lazy(
    () =>
      new RandomBytes("LambdaEncryptionKey", {
        length: 32,
      }),
  );

  public static readonly appsync = lazy(() =>
    rpc.call("Provider.Aws.Appsync", {}),
  );

  constructor(
    name: string,
    args: FunctionArgs,
    opts?: ComponentResourceOptions,
  ) {
    super(__pulumiType, name, args, opts);
    this.constructorName = name;

    const parent = this;
    const dev = normalizeDev();
    const isContainer = all([args.python, dev]).apply(
      ([python, dev]) => !dev && (python?.container ?? false),
    );
    const partition = getPartitionOutput({}, opts).partition;
    const region = getRegionOutput({}, opts).name;
    const bootstrapData = region.apply((region) => bootstrap.forRegion(region));
    const injections = normalizeInjections();
    const runtime = output(args.runtime ?? "nodejs20.x");
    const timeout = normalizeTimeout();
    const memory = normalizeMemory();
    const storage = output(args.storage).apply((v) => v ?? "512 MB");
    const architecture = output(args.architecture).apply((v) => v ?? "x86_64");
    const environment = normalizeEnvironment();
    const streaming = normalizeStreaming();
    const logging = normalizeLogging();
    const volume = normalizeVolume();
    const url = normalizeUrl();
    const copyFiles = normalizeCopyFiles();
    const policies = output(args.policies ?? []);
    const vpc = normalizeVpc();

    const linkData = buildLinkData();
    const linkPermissions = buildLinkPermissions();
    const { bundle, handler: handler0, sourcemaps } = buildHandler();
    const { handler, wrapper } = buildHandlerWrapper();
    const role = createRole();
    const imageAsset = createImageAsset();
    const logGroup = createLogGroup();
    const zipAsset = createZipAsset();
    const fn = createFunction();
    const urlEndpoint = createUrl();
    createProvisioned();
    const eventInvokeConfig = createEventInvokeConfig();

    const links = linkData.apply((input) => input.map((item) => item.name));

    this.function = fn;
    this.role = role;
    this.logGroup = logGroup;
    this.urlEndpoint = urlEndpoint;
    this.eventInvokeConfig = eventInvokeConfig;

    const buildInput = output({
      functionID: name,
      handler: args.handler,
      bundle: args.bundle,
      logGroup: logGroup.apply((l) => l?.name),
      encryptionKey: Function.encryptionKey().base64,
      runtime,
      links: output(linkData).apply((input) =>
        Object.fromEntries(input.map((item) => [item.name, item.properties])),
      ),
      copyFiles,
      properties: output({ nodejs: args.nodejs, python: args.python }).apply(
        (val) => ({
          ...(val.nodejs || val.python),
          architecture,
        }),
      ),
      dev,
    });

    buildInput.apply(async (input) => {
      if (!input.dev) return;
      await rpc.call("Runtime.AddTarget", input);
    });

    this.registerOutputs({
      _live: unsecret(
        output(dev).apply((dev) => {
          if (!dev) return undefined;
          return all([
            name,
            links,
            args.handler,
            args.bundle,
            args.runtime,
            args.nodejs,
            copyFiles,
          ]).apply(
            ([name, links, handler, bundle, runtime, nodejs, copyFiles]) => {
              return {
                functionID: name,
                links,
                handler: handler,
                bundle: bundle,
                runtime: runtime || "nodejs20.x",
                copyFiles,
                properties: nodejs,
              };
            },
          );
        }),
      ),
      _metadata: {
        handler: args.handler,
        internal: args._skipMetadata,
        dev: dev,
      },
      _hint: args._skipHint ? undefined : urlEndpoint,
    });

    function normalizeDev() {
      return all([args.dev, args.live]).apply(
        ([d, l]) => $dev && d !== false && l !== false,
      );
    }

    function normalizeInjections() {
      return output(args.injections).apply((injections) => injections ?? []);
    }

    function normalizeTimeout() {
      return output(args.timeout).apply((timeout) => timeout ?? "20 seconds");
    }

    function normalizeMemory() {
      return output(args.memory).apply((memory) => memory ?? "1024 MB");
    }

    function normalizeEnvironment() {
      return all([
        args.environment,
        dev,
        bootstrapData,
        Function.encryptionKey().base64,
        args.link,
      ]).apply(async ([environment, dev, bootstrap, key, link]) => {
        const result = environment ?? {};
        result.SST_RESOURCE_App = JSON.stringify({
          name: $app.name,
          stage: $app.stage,
        });
        for (const linkable of link || []) {
          if (!Link.isLinkable(linkable)) continue;
          const def = linkable.getSSTLink();
          for (const item of def.include || []) {
            if (item.type === "environment") Object.assign(result, item.env);
          }
        }
        result.SST_KEY = key;
        result.SST_KEY_FILE = "resource.enc";
        if (dev) {
          const appsync = await Function.appsync();
          result.SST_REGION = process.env.SST_AWS_REGION!;
          result.SST_APPSYNC_HTTP = appsync.http;
          result.SST_APPSYNC_REALTIME = appsync.realtime;
          result.SST_FUNCTION_ID = name;
          result.SST_APP = $app.name;
          result.SST_STAGE = $app.stage;
          result.SST_ASSET_BUCKET = bootstrap.asset;
          if (process.env.SST_FUNCTION_TIMEOUT) {
            result.SST_FUNCTION_TIMEOUT = process.env.SST_FUNCTION_TIMEOUT;
          }
        }
        return result;
      });
    }

    function normalizeStreaming() {
      return output(args.streaming).apply((streaming) => streaming ?? false);
    }

    function normalizeLogging() {
      return output(args.logging).apply((logging) => {
        if (logging === false) return undefined;

        if (logging?.retention && logging?.logGroup) {
          throw new VisibleError(
            `Cannot set both "logging.retention" and "logging.logGroup"`,
          );
        }

        return {
          logGroup: logging?.logGroup,
          retention: logging?.retention ?? "1 month",
          format: logging?.format ?? "text",
        };
      });
    }

    function normalizeVolume() {
      if (!args.volume) return;

      return output(args.volume).apply((volume) => ({
        efs:
          volume.efs instanceof Efs
            ? volume.efs.nodes.accessPoint.arn
            : output(volume.efs),
        path: volume.path ?? "/mnt/efs",
      }));
    }

    function normalizeUrl() {
      return output(args.url).apply((url) => {
        if (url === false || url === undefined) return;
        if (url === true) {
          url = {};
        }

        // normalize authorization
        const defaultAuthorization = "none" as const;
        const authorization = url.authorization ?? defaultAuthorization;

        // normalize cors
        const defaultCors: types.input.lambda.FunctionUrlCors = {
          allowHeaders: ["*"],
          allowMethods: ["*"],
          allowOrigins: ["*"],
        };
        const cors =
          url.cors === false
            ? undefined
            : url.cors === true || url.cors === undefined
              ? defaultCors
              : {
                ...defaultCors,
                ...url.cors,
                maxAge: url.cors.maxAge && toSeconds(url.cors.maxAge),
              };

        return {
          authorization,
          cors,
          route: normalizeRouteArgs(url.router, url.route),
        };
      });
    }

    function normalizeCopyFiles() {
      return output(args.copyFiles ?? []).apply((copyFiles) =>
        Promise.all(
          copyFiles.map(async (entry) => {
            const from = path.join($cli.paths.root, entry.from);
            const to = entry.to || entry.from;
            if (path.isAbsolute(to)) {
              throw new VisibleError(
                `Copy destination path "${to}" must be relative`,
              );
            }

            const stats = await fs.promises.stat(from);
            const isDir = stats.isDirectory();

            return { from, to, isDir };
          }),
        ),
      );
    }

    function normalizeVpc() {
      // "vpc" is undefined
      if (!args.vpc) return;

      // "vpc" is a Vpc component
      if (args.vpc instanceof Vpc) {
        const result = {
          privateSubnets: args.vpc.privateSubnets,
          securityGroups: args.vpc.securityGroups,
        };
        return all([
          args.vpc.id,
          args.vpc.nodes.natGateways,
          args.vpc.nodes.natInstances,
        ]).apply(([id, natGateways, natInstances]) => {
          if (natGateways.length === 0 && natInstances.length === 0) {
            warnOnce(
              `\nWarning: One or more functions are deployed in the "${id}" VPC, which does not have a NAT gateway. As a result, these functions cannot access the internet. If your functions need internet access, enable it by setting the "nat" prop on the "Vpc" component.\n`,
            );
          }
          return result;
        });
      }

      return output(args.vpc).apply((vpc) => {
        // "vpc" is object
        if (vpc.subnets) {
          throw new VisibleError(
            `The "vpc.subnets" property has been renamed to "vpc.privateSubnets". Update your code to use "vpc.privateSubnets" instead.`,
          );
        }

        return vpc;
      });
    }

    function buildLinkData() {
      return output(args.link || []).apply((links) => Link.build(links));
    }

    function buildLinkPermissions() {
      return Link.getInclude<Permission>("aws.permission", args.link);
    }

    function buildHandler() {
      return all([runtime, dev, isContainer]).apply(
        async ([runtime, dev, isContainer]) => {
          if (dev) {
            return {
              handler: "bootstrap",
              bundle: path.join($cli.paths.platform, "dist", "bridge"),
            };
          }

          const buildResult = buildInput.apply(async (input) => {
            const result = await rpc.call<{
              handler: string;
              out: string;
              errors: string[];
              sourcemaps: string[];
            }>("Runtime.Build", { ...input, isContainer });
            if (result.errors.length > 0) {
              throw new Error(result.errors.join("\n"));
            }
            if (args.hook?.postbuild) await args.hook.postbuild(result.out);
            return result;
          });

          return {
            handler: buildResult.handler,
            bundle: buildResult.out,
            sourcemaps: buildResult.sourcemaps,
          };
        },
      );
    }

    function buildHandlerWrapper() {
      const ret = all([
        dev,
        bundle,
        handler0,
        linkData,
        streaming,
        injections,
        runtime,
      ]).apply(
        async ([
          dev,
          bundle,
          handler,
          linkData,
          streaming,
          injections,
          runtime,
        ]) => {
          if (dev) return { handler };
          if (!runtime.startsWith("nodejs")) {
            return { handler };
          }

          const hasUserInjections = injections.length > 0;

          if (!hasUserInjections) return { handler };

          const parsed = path.posix.parse(handler);
          const handlerDir = parsed.dir;
          const oldHandlerFileName = parsed.name;
          const oldHandlerFunction = parsed.ext.replace(/^\./, "");
          const newHandlerFileName = "server-index";
          const newHandlerFunction = "handler";

          // Validate handler file exists
          const newHandlerFileExt = [".js", ".mjs", ".cjs"].find((ext) =>
            fs.existsSync(
              path.join(bundle!, handlerDir, oldHandlerFileName + ext),
            ),
          );
          if (!newHandlerFileExt) {
            throw new VisibleError(
              `Could not find handler file "${handler}" for function "${name}"`,
            );
          }

          const split = injections.reduce(
            (acc, item) => {
              if (item.startsWith("outer:")) {
                acc.outer.push(item.substring("outer:".length));
                return acc;
              }
              acc.inner.push(item);
              return acc;
            },
            { outer: [] as string[], inner: [] as string[] },
          );

          return {
            handler: path.posix.join(
              handlerDir,
              `${newHandlerFileName}.${newHandlerFunction}`,
            ),
            wrapper: {
              name: path.posix.join(handlerDir, `${newHandlerFileName}.mjs`),
              content: streaming
                ? [
                  ...split.outer,
                  `export const ${newHandlerFunction} = awslambda.streamifyResponse(async (event, responseStream, context) => {`,
                  ...split.inner,
                  `  const { ${oldHandlerFunction}: rawHandler} = await import("./${oldHandlerFileName}${newHandlerFileExt}");`,
                  `  return rawHandler(event, responseStream, context);`,
                  `});`,
                ].join("\n")
                : [
                  ...split.outer,
                  `export const ${newHandlerFunction} = async (event, context) => {`,
                  ...split.inner,
                  `  const { ${oldHandlerFunction}: rawHandler} = await import("./${oldHandlerFileName}${newHandlerFileExt}");`,
                  `  return rawHandler(event, context);`,
                  `};`,
                ].join("\n"),
            },
          };
        },
      );
      return {
        handler: ret.handler,
        wrapper: ret.wrapper,
      };
    }

    function createRole() {
      if (args.role) {
        return iam.Role.get(
          `${name}Role`,
          output(args.role).apply(parseRoleArn).roleName,
          {},
          { parent },
        );
      }

      const policy = all([args.permissions || [], linkPermissions, dev]).apply(
        ([argsPermissions, linkPermissions, dev]) =>
          iam.getPolicyDocumentOutput({
            statements: [
              ...argsPermissions,
              ...linkPermissions,
              ...(dev
                ? [
                  {
                    effect: "allow",
                    actions: ["appsync:*"],
                    resources: ["*"],
                  },
                  {
                    effect: "allow",
                    actions: ["s3:*"],
                    resources: [
                      interpolate`arn:${partition}:s3:::${bootstrapData.asset}`,
                      interpolate`arn:${partition}:s3:::${bootstrapData.asset}/*`,
                    ],
                  },
                ]
                : []),
            ].map((item) => ({
              effect: (() => {
                const effect = item.effect ?? "allow";
                return effect.charAt(0).toUpperCase() + effect.slice(1);
              })(),
              actions: item.actions,
              resources: item.resources,
            })),
          }),
      );

      return new iam.Role(
        ...transform(
          args.transform?.role,
          `${name}Role`,
          {
            assumeRolePolicy: !dev
              ? iam.assumeRolePolicyForPrincipal({
                Service: "lambda.amazonaws.com",
              })
              : iam.getPolicyDocumentOutput({
                statements: [
                  {
                    actions: ["sts:AssumeRole"],
                    principals: [
                      {
                        type: "Service",
                        identifiers: ["lambda.amazonaws.com"],
                      },
                      {
                        type: "AWS",
                        identifiers: [
                          interpolate`arn:${partition}:iam::${getCallerIdentityOutput({}, opts).accountId
                            }:root`,
                        ],
                      },
                    ],
                  },
                ],
              }).json,
            // if there are no statements, do not add an inline policy.
            // adding an inline policy with no statements will cause an error.
            inlinePolicies: policy.apply(({ statements }) =>
              statements ? [{ name: "inline", policy: policy.json }] : [],
            ),
            managedPolicyArns: all([logging, policies]).apply(
              ([logging, policies]) => [
                ...policies,
                ...(logging
                  ? [
                    interpolate`arn:${partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole`,
                  ]
                  : []),
                ...(vpc
                  ? [
                    interpolate`arn:${partition}:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole`,
                  ]
                  : []),
              ],
            ),
          },
          { parent },
        ),
      );
    }

    function createImageAsset() {
      // The build artifact directory already exists, with all the user code and
      // config files. It also has the dockerfile, we need to now just build and push to
      // the container registry.
      return all([isContainer, dev, bundle]).apply(
        ([
          isContainer,
          dev,
          bundle, // We need the bundle to be resolved because of implicit dockerfiles even though we don't use it here
        ]) => {
          if (!isContainer || dev) return;

          const authToken = ecr.getAuthorizationTokenOutput({
            registryId: bootstrapData.assetEcrRegistryId,
          });

          return new Image(
            `${name}Image`,
            {
              tags: [$interpolate`${bootstrapData.assetEcrUrl}:latest`],
              context: {
                location: path.join(
                  $cli.paths.work,
                  "artifacts",
                  `${name}-src`,
                ),
              },
              cacheFrom: [
                {
                  registry: {
                    ref: $interpolate`${bootstrapData.assetEcrUrl}:${name}-cache`,
                  },
                },
              ],
              cacheTo: [
                {
                  registry: {
                    ref: $interpolate`${bootstrapData.assetEcrUrl}:${name}-cache`,
                    imageManifest: true,
                    ociMediaTypes: true,
                    mode: "max",
                  },
                },
              ],
              platforms: [
                architecture.apply((v) =>
                  v === "arm64" ? "linux/arm64" : "linux/amd64",
                ),
              ],
              push: true,
              registries: [
                authToken.apply((authToken) => ({
                  address: authToken.proxyEndpoint,
                  username: authToken.userName,
                  password: secret(authToken.password),
                })),
              ],
            },
            { parent },
          );
        },
      );
    }

    function createZipAsset() {
      // Note: cannot point the bundle to the `.open-next/server-function`
      //       b/c the folder contains node_modules. And pnpm node_modules
      //       contains symlinks. Pulumi cannot zip symlinks correctly.
      //       We will zip the folder ourselves.
      return all([
        bundle,
        wrapper,
        sourcemaps,
        copyFiles,
        isContainer,
        logGroup.apply((l) => l?.arn),
        dev,
      ]).apply(
        async ([
          bundle,
          wrapper,
          sourcemaps,
          copyFiles,
          isContainer,
          logGroupArn,
          dev,
        ]) => {
          if (isContainer) return;

          const zipPath = path.resolve(
            $cli.paths.work,
            "artifacts",
            name,
            "code.zip",
          );
          await fs.promises.mkdir(path.dirname(zipPath), {
            recursive: true,
          });

          await new Promise(async (resolve, reject) => {
            const ws = fs.createWriteStream(zipPath);
            const archive = archiver("zip", {
              // Ensure deterministic zip file hashes
              // https://github.com/archiverjs/node-archiver/issues/397#issuecomment-554327338
              statConcurrency: 1,
            });
            archive.on("warning", reject);
            archive.on("error", reject);
            // archive has been finalized and the output file descriptor has closed, resolve promise
            // this has to be done before calling `finalize` since the events may fire immediately after.
            // see https://www.npmjs.com/package/archiver
            ws.once("close", () => {
              resolve(zipPath);
            });
            archive.pipe(ws);

            const files = [];

            for (const item of [
              {
                from: bundle,
                to: ".",
                isDir: true,
              },
              ...(!dev ? copyFiles : []),
            ]) {
              if (!item.isDir) {
                files.push({
                  from: item.from,
                  to: item.to,
                });
              }
              const found = await glob("**", {
                cwd: item.from,
                dot: true,
                ignore:
                  sourcemaps?.map((item) => path.relative(bundle, item)) || [],
              });
              files.push(
                ...found.map((file) => ({
                  from: path.join(item.from, file),
                  to: path.join(item.to, file),
                })),
              );
            }
            files.sort((a, b) => a.to.localeCompare(b.to));
            for (const file of files) {
              archive.file(file.from, {
                name: file.to,
                date: new Date(0),
              });
            }

            // Add handler wrapper into the zip
            if (wrapper) {
              archive.append(wrapper.content, {
                name: wrapper.name,
                date: new Date(0),
              });
            }

            await archive.finalize();
          });

          // Calculate hash of the zip file
          const hash = crypto.createHash("sha256");
          hash.update(await fs.promises.readFile(zipPath, "utf-8"));
          const hashValue = hash.digest("hex");
          const assetBucket = region.apply((region) =>
            bootstrap.forRegion(region).then((d) => d.asset),
          );
          if (logGroupArn && sourcemaps) {
            let index = 0;
            for (const file of sourcemaps) {
              new s3.BucketObjectv2(
                `${name}Sourcemap${index}`,
                {
                  key: interpolate`sourcemap/${logGroupArn}/${hashValue}.${path.basename(
                    file,
                  )}`,
                  bucket: assetBucket,
                  source: new asset.FileAsset(file),
                },
                { parent, retainOnDelete: true },
              );
              index++;
            }
          }

          return new s3.BucketObjectv2(
            `${name}Code`,
            {
              key: interpolate`assets/${name}-code-${hashValue}.zip`,
              bucket: assetBucket,
              source: new asset.FileArchive(zipPath),
            },
            { parent },
          );
        },
      );
    }

    function createLogGroup() {
      return logging.apply((logging) => {
        if (!logging) return;
        if (logging.logGroup) return;

        return new cloudwatch.LogGroup(
          ...transform(
            args.transform?.logGroup,
            `${name}LogGroup`,
            {
              name: interpolate`/aws/lambda/${args.name ?? physicalName(64, `${name}Function`)
                }`,
              retentionInDays: RETENTION[logging.retention],
            },
            { parent, ignoreChanges: ["name"] },
          ),
        );
      });
    }

    function createFunction() {
      return all([
        logging,
        logGroup,
        isContainer,
        imageAsset,
        zipAsset,
        args.concurrency,
        dev,
      ]).apply(
        ([
          logging,
          logGroup,
          isContainer,
          imageAsset,
          zipAsset,
          concurrency,
          dev,
        ]) => {
          // This is a hack to avoid handler being marked as having propertyDependencies.
          // There is an unresolved bug in pulumi that causes issues when it does
          // @ts-expect-error
          handler.allResources = () => Promise.resolve(new Set());
          const transformed = transform(
            args.transform?.function,
            `${name}Function`,
            {
              name: args.name,
              description: args.description ?? "",
              role: args.role ?? role!.arn,
              timeout: timeout.apply((timeout) => toSeconds(timeout)),
              memorySize: memory.apply((memory) => toMBs(memory)),
              ephemeralStorage: { size: storage.apply((v) => toMBs(v)) },
              environment: {
                variables: environment,
              },
              architectures: [architecture],
              loggingConfig: logging && {
                logFormat: logging.format === "json" ? "JSON" : "Text",
                logGroup: logging.logGroup ?? logGroup!.name,
              },
              vpcConfig: vpc && {
                securityGroupIds: vpc.securityGroups,
                subnetIds: vpc.privateSubnets,
              },
              fileSystemConfig: volume && {
                arn: volume.efs,
                localMountPath: volume.path,
              },
              layers: args.layers,
              tags: args.tags,
              publish: output(args.versioning).apply((v) => v ?? false),
              reservedConcurrentExecutions: concurrency?.reserved,
              ...(isContainer
                ? {
                  packageType: "Image",
                  imageUri: imageAsset!.ref.apply(
                    (ref) => ref?.replace(":latest", ""),
                  ),
                  imageConfig: {
                    commands: [
                      all([handler, runtime]).apply(([handler, runtime]) => {
                        // If a python container image we have to rewrite the handler path so lambdaric is happy
                        // This means no leading . and replace all / with .
                        if (isContainer && runtime.includes("python")) {
                          return handler
                            .replace(/\.\//g, "")
                            .replace(/\//g, ".");
                        }
                        return handler;
                      }),
                    ],
                  },
                }
                : {
                  packageType: "Zip",
                  s3Bucket: zipAsset!.bucket,
                  s3Key: zipAsset!.key,
                  handler: unsecret(handler),
                  runtime: runtime.apply((v) =>
                    v === "go" || v === "rust" ? "provided.al2023" : v,
                  ),
                }),
            },
            { parent },
          );
          return new lambda.Function(
            transformed[0],
            {
              ...transformed[1],
              ...(dev
                ? {
                  description: transformed[1].description
                    ? output(transformed[1].description).apply(
                      (v) => `${v.substring(0, 240)} (live)`,
                    )
                    : "live",
                  runtime: "provided.al2023",
                  architectures: ["x86_64"],
                }
                : {}),
            },
            transformed[2],
          );
        },
      );
    }

    function createUrl() {
      return url.apply((url) => {
        if (url === undefined) return output(undefined);

        // create the function url
        const fnUrl = new lambda.FunctionUrl(
          `${name}Url`,
          {
            functionName: fn.name,
            authorizationType: url.authorization === "iam" ? "AWS_IAM" : "NONE",
            invokeMode: streaming.apply((streaming) =>
              streaming ? "RESPONSE_STREAM" : "BUFFERED",
            ),
            cors: url.cors,
          },
          { parent },
        );
        if (!url.route) return fnUrl.functionUrl;

        // add router route
        const routeNamespace = crypto
          .createHash("md5")
          .update(`${$app.name}-${$app.stage}-${name}`)
          .digest("hex")
          .substring(0, 4);
        new KvKeys(
          `${name}RouteKey`,
          {
            store: url.route.routerKvStoreArn,
            namespace: routeNamespace,
            entries: fnUrl.functionUrl.apply((fnUrl) => ({
              metadata: JSON.stringify({
                host: new URL(fnUrl).host,
              }),
            })),
            purge: false,
          },
          { parent },
        );
        new KvRoutesUpdate(
          `${name}RoutesUpdate`,
          {
            store: url.route.routerKvStoreArn,
            namespace: url.route.routerKvNamespace,
            key: "routes",
            entry: url.route.apply((route) =>
              ["url", routeNamespace, route.hostPattern, route.pathPrefix].join(
                ",",
              ),
            ),
          },
          { parent },
        );
        return url.route.routerUrl;
      });
    }

    function createProvisioned() {
      return all([args.concurrency, fn.publish]).apply(
        ([concurrency, publish]) => {
          if (!concurrency?.provisioned || concurrency.provisioned === 0) {
            return;
          }

          if (publish !== true) {
            throw new VisibleError(
              `Provisioned concurrency requires function versioning. Set "versioning: true" to enable function versioning.`,
            );
          }

          return new lambda.ProvisionedConcurrencyConfig(
            `${name}Provisioned`,
            {
              functionName: fn.name,
              qualifier: fn.version,
              provisionedConcurrentExecutions: concurrency.provisioned,
            },
            { parent },
          );
        },
      );
    }

    function createEventInvokeConfig() {
      if (args.retries === undefined) {
        return undefined;
      }

      return new lambda.FunctionEventInvokeConfig(
        ...transform(
          args.transform?.eventInvokeConfig,
          `${name}EventInvokeConfig`,
          {
            functionName: fn.name,
            maximumRetryAttempts: args.retries,
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
    return {
      /**
       * The IAM Role the function will use.
       */
      role: this.role,
      /**
       * The AWS Lambda function.
       */
      function: this.function,
      /**
       * The CloudWatch Log Group the function logs are stored.
       */
      logGroup: this.logGroup,
      /**
       * The Function Event Invoke Config resource if retries are configured.
       */
      eventInvokeConfig: this.eventInvokeConfig,
    };
  }

  /**
   * The Lambda function URL if `url` is enabled.
   */
  public get url() {
    return this.urlEndpoint.apply((url) => {
      if (!url) {
        throw new VisibleError(
          `Function URL is not enabled. Enable it with "url: true".`,
        );
      }
      return url;
    });
  }

  /**
   * The name of the Lambda function.
   */
  public get name() {
    return this.function.name;
  }

  /**
   * The ARN of the Lambda function.
   */
  public get arn() {
    return this.function.arn;
  }

  /**
   * Add environment variables lazily to the function after the function is created.
   *
   * This is useful for adding environment variables that are only available after the
   * function is created, like the function URL.
   *
   * @param environment The environment variables to add to the function.
   *
   * @example
   * Add the function URL as an environment variable.
   *
   * ```ts title="sst.config.ts"
   * const fn = new sst.aws.Function("MyFunction", {
   *   handler: "src/handler.handler",
   *   url: true,
   * });
   *
   * fn.addEnvironment({
   *   URL: fn.url,
   * });
   * ```
   */
  public addEnvironment(environment: Input<Record<string, Input<string>>>) {
    return new FunctionEnvironmentUpdate(
      `${this.constructorName}EnvironmentUpdate`,
      {
        functionName: this.name,
        environment,
        region: getRegionOutput(undefined, { parent: this }).name,
      },
      { parent: this },
    );
  }

  /** @internal */
  static fromDefinition(
    name: string,
    definition: Input<string | FunctionArgs>,
    override: Pick<FunctionArgs, "description" | "permissions">,
    argsTransform?: Transform<FunctionArgs>,
    opts?: ComponentResourceOptions,
  ) {
    return output(definition).apply((definition) => {
      if (typeof definition === "string") {
        return new Function(
          ...transform(
            argsTransform,
            name,
            { handler: definition, ...override },
            opts || {},
          ),
        );
      } else if (definition.handler) {
        return new Function(
          ...transform(
            argsTransform,
            name,
            {
              ...definition,
              ...override,
              permissions: all([
                definition.permissions,
                override?.permissions,
              ]).apply(([permissions, overridePermissions]) => [
                ...(permissions ?? []),
                ...(overridePermissions ?? []),
              ]),
            },
            opts || {},
          ),
        );
      }
      throw new Error(`Invalid function definition for the "${name}" Function`);
    });
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        name: this.name,
        url: this.urlEndpoint,
      },
      include: [
        permission({
          actions: ["lambda:InvokeFunction"],
          resources: [this.function.arn],
        }),
      ],
    };
  }
}

const __pulumiType = "sst:aws:Function";
// @ts-expect-error
Function.__pulumiType = __pulumiType;
