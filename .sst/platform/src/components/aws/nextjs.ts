import fs from "fs";
import path from "path";
import { ComponentResourceOptions, Output, all, output } from "@pulumi/pulumi";
import { Size } from "../size.js";
import { Function } from "./function.js";
import { VisibleError } from "../error.js";
import type { Input } from "../input.js";
import { Queue } from "./queue.js";
import { dynamodb, getRegionOutput, lambda } from "@pulumi/aws";
import { isALteB } from "../../util/compare-semver.js";
import { Plan, SsrSite, SsrSiteArgs } from "./ssr-site.js";
import { Bucket } from "./bucket.js";

const DEFAULT_OPEN_NEXT_VERSION = "3.6.6";

type BaseFunction = {
  handler: string;
  bundle: string;
};

type OpenNextFunctionOrigin = {
  type: "function";
  streaming?: boolean;
  wrapper: string;
  converter: string;
} & BaseFunction;

type OpenNextServerFunctionOrigin = OpenNextFunctionOrigin & {
  queue: string;
  incrementalCache: string;
  tagCache: string;
};

type OpenNextImageOptimizationOrigin = OpenNextFunctionOrigin & {
  imageLoader: string;
};

type OpenNextS3Origin = {
  type: "s3";
  originPath: string;
  copy: {
    from: string;
    to: string;
    cached: boolean;
    versionedSubDir?: string;
  }[];
};

interface OpenNextOutput {
  edgeFunctions: {
    [key: string]: BaseFunction;
  } & {
    middleware?: BaseFunction & { pathResolver: string };
  };
  origins: {
    s3: OpenNextS3Origin;
    default: OpenNextServerFunctionOrigin;
    imageOptimizer: OpenNextImageOptimizationOrigin;
  } & {
    [key: string]: OpenNextServerFunctionOrigin | OpenNextS3Origin;
  };
  behaviors: {
    pattern: string;
    origin?: string;
    edgeFunction?: string;
  }[];
  additionalProps?: {
    disableIncrementalCache?: boolean;
    disableTagCache?: boolean;
    initializationFunction?: BaseFunction;
    warmer?: BaseFunction;
    revalidationFunction?: BaseFunction;
  };
}

export interface NextjsArgs extends SsrSiteArgs {
  /**
   * Configure how this component works in `sst dev`.
   *
   * :::note
   * In `sst dev` your Next.js app is run in dev mode; it's not deployed.
   * :::
   *
   * Instead of deploying your Next.js app, this starts it in dev mode. It's run
   * as a separate process in the `sst dev` multiplexer. Read more about
   * [`sst dev`](/docs/reference/cli/#dev).
   *
   * To disable dev mode, pass in `false`.
   */
  dev?: SsrSiteArgs["dev"];
  /**
   * Permissions and the resources that the [server function](#nodes-server) in your Next.js app needs to access. These permissions are used to create the function's IAM role.
   *
   * :::tip
   * If you `link` the function to a resource, the permissions to access it are
   * automatically added.
   * :::
   *
   * @example
   * Allow reading and writing to an S3 bucket called `my-bucket`.
   * ```js
   * {
   *   permissions: [
   *     {
   *       actions: ["s3:GetObject", "s3:PutObject"],
   *       resources: ["arn:aws:s3:::my-bucket/*"]
   *     },
   *   ]
   * }
   * ```
   *
   * Perform all actions on an S3 bucket called `my-bucket`.
   *
   * ```js
   * {
   *   permissions: [
   *     {
   *       actions: ["s3:*"],
   *       resources: ["arn:aws:s3:::my-bucket/*"]
   *     },
   *   ]
   * }
   * ```
   *
   * Grant permissions to access all resources.
   *
   * ```js
   * {
   *   permissions: [
   *     {
   *       actions: ["*"],
   *       resources: ["*"]
   *     },
   *   ]
   * }
   * ```
   */
  permissions?: SsrSiteArgs["permissions"];
  /**
   * Path to the directory where your Next.js app is located. This path is relative to your `sst.config.ts`.
   *
   * By default this assumes your Next.js app is in the root of your SST app.
   * @default `"."`
   *
   * @example
   *
   * If your Next.js app is in a package in your monorepo.
   *
   * ```js
   * {
   *   path: "packages/web"
   * }
   * ```
   */
  path?: SsrSiteArgs["path"];
  /**
   * [Link resources](/docs/linking/) to your Next.js app. This will:
   *
   * 1. Grant the permissions needed to access the resources.
   * 2. Allow you to access it in your site using the [SDK](/docs/reference/sdk/).
   *
   * @example
   *
   * Takes a list of resources to link to the function.
   *
   * ```js
   * {
   *   link: [bucket, stripeKey]
   * }
   * ```
   */
  link?: SsrSiteArgs["link"];
  /**
   * Configure how the CloudFront cache invalidations are handled. This is run after your Next.js app has been deployed.
   * :::tip
   * You get 1000 free invalidations per month. After that you pay $0.005 per invalidation path. [Read more here](https://aws.amazon.com/cloudfront/pricing/).
   * :::
   * @default `{paths: "all", wait: false}`
   * @example
   * Turn off invalidations.
   * ```js
   * {
   *   invalidation: false
   * }
   * ```
   * Wait for all paths to be invalidated.
   * ```js
   * {
   *   invalidation: {
   *     paths: "all",
   *     wait: true
   *   }
   * }
   * ```
   */
  invalidation?: SsrSiteArgs["invalidation"];
  /**
   * The command used internally to build your Next.js app. It uses OpenNext with the `openNextVersion`.
   *
   * @default `"npx --yes open-next@OPEN_NEXT_VERSION build"`
   *
   * @example
   *
   * If you want to use a custom `build` script from your `package.json`. This is useful if you have a custom build process or want to use a different version of OpenNext.
   * OpenNext by default uses the `build` script for building next-js app in your `package.json`. You can customize the build command in OpenNext configuration.
   * ```js
   * {
   *   buildCommand: "npm run build:open-next"
   * }
   * ```
   */
  buildCommand?: SsrSiteArgs["buildCommand"];
  /**
   * Set [environment variables](https://nextjs.org/docs/pages/building-your-application/configuring/environment-variables) in your Next.js app. These are made available:
   *
   * 1. In `next build`, they are loaded into `process.env`.
   * 2. Locally while running through `sst dev`.
   *
   * :::tip
   * You can also `link` resources to your Next.js app and access them in a type-safe way with the [SDK](/docs/reference/sdk/). We recommend linking since it's more secure.
   * :::
   *
   * Recall that in Next.js, you need to prefix your environment variables with `NEXT_PUBLIC_` to access these in the browser. [Read more here](https://nextjs.org/docs/pages/building-your-application/configuring/environment-variables#bundling-environment-variables-for-the-browser).
   *
   * @example
   * ```js
   * {
   *   environment: {
   *     API_URL: api.url,
   *     // Accessible in the browser
   *     NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_123"
   *   }
   * }
   * ```
   */
  environment?: SsrSiteArgs["environment"];
  /**
   * Serve your Next.js app through a `Router` instead of a standalone CloudFront
   * distribution.
   *
   * By default, this component creates a new CloudFront distribution. But you might
   * want to serve it through the distribution of your `Router` as a:
   *
   * - A path like `/docs`
   * - A subdomain like `docs.example.com`
   * - Or a combined pattern like `dev.example.com/docs`
   *
   * @example
   *
   * To serve your Next.js app **from a path**, you'll need to configure the root domain
   * in your `Router` component.
   *
   * ```ts title="sst.config.ts" {2}
   * const router = new sst.aws.Router("Router", {
   *   domain: "example.com"
   * });
   * ```
   *
   * Now set the `router` and the `path`.
   *
   * ```ts {3,4}
   * {
   *   router: {
   *     instance: router,
   *     path: "/docs"
   *   }
   * }
   * ```
   *
   * You also need to set the [`basePath`](https://nextjs.org/docs/app/api-reference/config/next-config-js/basePath)
   * in your `next.config.js`.
   *
   * :::caution
   * If routing to a path, you need to set that as the base path in your Next.js
   * app as well.
   * :::
   *
   * ```js title="next.config.js" {2}
   * export default defineConfig({
   *   basePath: "/docs"
   * });
   * ```
   *
   * To serve your Next.js app **from a subdomain**, you'll need to configure the
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
   * ```ts {4}
   * {
   *   router: {
   *     instance: router,
   *     domain: "docs.example.com"
   *   }
   * }
   * ```
   *
   * Finally, to serve your Next.js app **from a combined pattern** like
   * `dev.example.com/docs`, you'll need to configure the domain in your `Router` to
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
   * ```ts {4,5}
   * {
   *   router: {
   *     instance: router,
   *     domain: "dev.example.com",
   *     path: "/docs"
   *   }
   * }
   * ```
   *
   * Also, make sure to set this as the `basePath` in your `next.config.js`, like
   * above.
   */
  router?: SsrSiteArgs["router"];
  /**
   * Set a custom domain for your Next.js app.
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
   *
   * Specify a `www.` version of the custom domain.
   *
   * ```js
   * {
   *   domain: {
   *     name: "domain.com",
   *     redirects: ["www.domain.com"]
   *   }
   * }
   * ```
   */
  domain?: SsrSiteArgs["domain"];
  /**
   * Configure how the Next.js app assets are uploaded to S3.
   *
   * By default, this is set to the following. Read more about these options below.
   * ```js
   * {
   *   assets: {
   *     textEncoding: "utf-8",
   *     versionedFilesCacheHeader: "public,max-age=31536000,immutable",
   *     nonVersionedFilesCacheHeader: "public,max-age=0,s-maxage=86400,stale-while-revalidate=8640"
   *   }
   * }
   * ```
   * Read more about these options below.
   * @default `Object`
   */
  assets?: SsrSiteArgs["assets"];
  /**
   * Configure the [OpenNext](https://opennext.js.org) version used to build the Next.js app.
   *
   * :::note
   * This does not automatically update to the latest OpenNext version. It remains pinned to the version of SST you have.
   * :::
   *
   * By default, this is pinned to the version of OpenNext that was released with the SST version you are using. You can [find this in the source](https://github.com/sst/sst/blob/dev/platform/src/components/aws/nextjs.ts#L30) under `DEFAULT_OPEN_NEXT_VERSION`.
   * OpenNext changed its package name from `open-next` to `@opennextjs/aws` in version `3.1.4`. SST will choose the correct one based on the version you provide.
   *
   * @default The latest version of OpenNext pinned to the version of SST you are using.
   * @example
   * ```js
   * {
   *   openNextVersion: "3.4.1"
   * }
   * ```
   */
  openNextVersion?: Input<string>;
  /**
   * Configure the Lambda function used for image optimization.
   * @default `{memory: "1024 MB"}`
   */
  imageOptimization?: {
    /**
     * The amount of memory allocated to the image optimization function.
     * Takes values between 128 MB and 10240 MB in 1 MB increments.
     *
     * @default `"1536 MB"`
     * @example
     * ```js
     * {
     *   imageOptimization: {
     *     memory: "512 MB"
     *   }
     * }
     * ```
     */
    memory?: Size;
    /**
     * If set to true, a previously computed image will return _304 Not Modified_.
     * This means that image needs to be **immutable**.
     *
     * The etag will be computed based on the image href, format and width and the next
     * BUILD_ID.
     *
     * @default `false`
     * @example
     * ```js
     * {
     *   imageOptimization: {
     *     staticEtag: true,
     *   }
     * }
     * ```
     */
    staticEtag?: boolean;
  };
  /**
   * Configure the Next.js app to use an existing CloudFront cache policy.
   *
   * :::note
   * CloudFront has a limit of 20 cache policies per account, though you can request a limit
   * increase.
   * :::
   *
   * By default, a new cache policy is created for it. This allows you to reuse an existing
   * policy instead of creating a new one.
   *
   * @default A new cache policy is created
   *
   * @example
   * ```js
   * {
   *   cachePolicy: "658327ea-f89d-4fab-a63d-7e88639e58f6"
   * }
   * ```
   */
  cachePolicy?: SsrSiteArgs["cachePolicy"];
}

/**
 * The `Nextjs` component lets you deploy [Next.js](https://nextjs.org) apps on AWS. It uses
 * [OpenNext](https://open-next.js.org) to build your Next.js app, and transforms the build
 * output to a format that can be deployed to AWS.
 *
 * @example
 *
 * #### Minimal example
 *
 * Deploy the Next.js app that's in the project root.
 *
 * ```js title="sst.config.ts"
 * new sst.aws.Nextjs("MyWeb");
 * ```
 *
 * #### Change the path
 *
 * Deploys a Next.js app in the `my-next-app/` directory.
 *
 * ```js {2} title="sst.config.ts"
 * new sst.aws.Nextjs("MyWeb", {
 *   path: "my-next-app/"
 * });
 * ```
 *
 * #### Add a custom domain
 *
 * Set a custom domain for your Next.js app.
 *
 * ```js {2} title="sst.config.ts"
 * new sst.aws.Nextjs("MyWeb", {
 *   domain: "my-app.com"
 * });
 * ```
 *
 * #### Redirect www to apex domain
 *
 * Redirect `www.my-app.com` to `my-app.com`.
 *
 * ```js {4} title="sst.config.ts"
 * new sst.aws.Nextjs("MyWeb", {
 *   domain: {
 *     name: "my-app.com",
 *     redirects: ["www.my-app.com"]
 *   }
 * });
 * ```
 *
 * #### Link resources
 *
 * [Link resources](/docs/linking/) to your Next.js app. This will grant permissions
 * to the resources and allow you to access it in your app.
 *
 * ```ts {4} title="sst.config.ts"
 * const bucket = new sst.aws.Bucket("MyBucket");
 *
 * new sst.aws.Nextjs("MyWeb", {
 *   link: [bucket]
 * });
 * ```
 *
 * You can use the [SDK](/docs/reference/sdk/) to access the linked resources
 * in your Next.js app.
 *
 * ```ts title="app/page.tsx"
 * import { Resource } from "sst";
 *
 * console.log(Resource.MyBucket.name);
 * ```
 */
export class Nextjs extends SsrSite {
  private revalidationQueue?: Output<Queue | undefined>;
  private revalidationTable?: Output<dynamodb.Table | undefined>;
  private revalidationFunction?: Output<Function | undefined>;

  constructor(
    name: string,
    args: NextjsArgs = {},
    opts: ComponentResourceOptions = {},
  ) {
    super(__pulumiType, name, args, opts);
  }

  protected normalizeBuildCommand(args: NextjsArgs) {
    return all([args?.buildCommand, args?.openNextVersion]).apply(
      ([buildCommand, openNextVersion]) => {
        if (buildCommand) return buildCommand;
        const version = openNextVersion ?? DEFAULT_OPEN_NEXT_VERSION;
        const packageName = isALteB(version, "3.1.3")
          ? "open-next"
          : "@opennextjs/aws";
        return `npx --yes ${packageName}@${version} build`;
      },
    );
  }

  protected buildPlan(
    outputPath: Output<string>,
    name: string,
    args: NextjsArgs,
    { bucket }: { bucket: Bucket },
  ): Output<Plan> {
    const parent = this;

    const ret = all([outputPath, args?.imageOptimization]).apply(
      ([outputPath, imageOptimization]) => {
        const { openNextOutput, buildId, prerenderManifest, base } =
          loadBuildOutput();

        if (Object.entries(openNextOutput.edgeFunctions).length) {
          throw new VisibleError(
            `Lambda@Edge runtime is deprecated. Update your OpenNext configuration to use the standard Lambda runtime and deploy to multiple regions using the "regions" option in your Nextjs component.`,
          );
        }

        const { revalidationQueue, revalidationFunction } =
          createRevalidationQueue();
        const revalidationTable = createRevalidationTable();
        createRevalidationTableSeeder();

        const serverOrigin = openNextOutput.origins["default"];
        const imageOptimizerOrigin = openNextOutput.origins["imageOptimizer"];
        const s3Origin = openNextOutput.origins["s3"];
        const plan = all([
          revalidationTable?.arn,
          revalidationTable?.name,
          bucket.arn,
          bucket.name,
          getRegionOutput(undefined, { parent: bucket }).name,
          revalidationQueue?.arn,
          revalidationQueue?.url,
          getRegionOutput(undefined, { parent: revalidationQueue }).name,
        ]).apply(
          ([
            tableArn,
            tableName,
            bucketArn,
            bucketName,
            bucketRegion,
            queueArn,
            queueUrl,
            queueRegion,
          ]) => ({
            base,
            server: {
              description: `${name} server`,
              bundle: path.join(outputPath, serverOrigin.bundle),
              handler: serverOrigin.handler,
              streaming: serverOrigin.streaming,
              runtime: "nodejs20.x" as const,
              environment: {
                CACHE_BUCKET_NAME: bucketName,
                CACHE_BUCKET_KEY_PREFIX: "_cache",
                CACHE_BUCKET_REGION: bucketRegion,
                ...(queueUrl && {
                  REVALIDATION_QUEUE_URL: queueUrl,
                  REVALIDATION_QUEUE_REGION: queueRegion,
                }),
                ...(tableName && {
                  CACHE_DYNAMO_TABLE: tableName,
                }),
              },
              permissions: [
                // access to the cache data
                {
                  actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
                  resources: [`${bucketArn}/*`],
                },
                {
                  actions: ["s3:ListBucket"],
                  resources: [bucketArn],
                },
                ...(queueArn
                  ? [
                      {
                        actions: [
                          "sqs:SendMessage",
                          "sqs:GetQueueAttributes",
                          "sqs:GetQueueUrl",
                        ],
                        resources: [queueArn],
                      },
                    ]
                  : []),
                ...(tableArn
                  ? [
                      {
                        actions: [
                          "dynamodb:BatchGetItem",
                          "dynamodb:GetRecords",
                          "dynamodb:GetShardIterator",
                          "dynamodb:Query",
                          "dynamodb:GetItem",
                          "dynamodb:Scan",
                          "dynamodb:ConditionCheckItem",
                          "dynamodb:BatchWriteItem",
                          "dynamodb:PutItem",
                          "dynamodb:UpdateItem",
                          "dynamodb:DeleteItem",
                          "dynamodb:DescribeTable",
                        ],
                        resources: [tableArn, `${tableArn}/*`],
                      },
                    ]
                  : []),
              ],
              injections: [
                [
                  `outer:if (process.env.SST_KEY_FILE) {`,
                  `  const { readFileSync } = await import("fs")`,
                  `  const { createDecipheriv } = await import("crypto")`,
                  `  const key = Buffer.from(process.env.SST_KEY, "base64");`,
                  `  const encryptedData = readFileSync(process.env.SST_KEY_FILE);`,
                  `  const nonce = Buffer.alloc(12, 0);`,
                  `  const decipher = createDecipheriv("aes-256-gcm", key, nonce);`,
                  `  const authTag = encryptedData.slice(-16);`,
                  `  const actualCiphertext = encryptedData.slice(0, -16);`,
                  `  decipher.setAuthTag(authTag);`,
                  `  let decrypted = decipher.update(actualCiphertext);`,
                  `  decrypted = Buffer.concat([decrypted, decipher.final()]);`,
                  `  const decryptedData = JSON.parse(decrypted.toString());`,
                  `  globalThis.SST_KEY_FILE_DATA = decryptedData;`,
                  `}`,
                ].join("\n"),
              ],
            },
            imageOptimizer: {
              prefix: "/_next/image",
              function: {
                description: `${name} image optimizer`,
                handler: imageOptimizerOrigin.handler,
                bundle: path.join(outputPath, imageOptimizerOrigin.bundle),
                runtime: "nodejs20.x" as const,
                architecture: "arm64" as const,
                environment: {
                  BUCKET_NAME: bucketName,
                  BUCKET_KEY_PREFIX: "_assets",
                  ...(imageOptimization?.staticEtag
                    ? { OPENNEXT_STATIC_ETAG: "true" }
                    : {}),
                },
                memory: imageOptimization?.memory ?? "1536 MB",
              },
            },
            assets: [
              {
                from: ".open-next/assets",
                to: "_assets",
                cached: true,
                versionedSubDir: "_next",
                deepRoute: "_next",
              },
            ],
            isrCache: {
              from: ".open-next/cache",
              to: "_cache",
            },
            buildId,
          }),
        );

        return {
          plan,
          revalidationQueue,
          revalidationTable,
          revalidationFunction,
        };

        function loadBuildOutput() {
          const openNextOutputPath = path.join(
            outputPath,
            ".open-next",
            "open-next.output.json",
          );
          if (!fs.existsSync(openNextOutputPath)) {
            throw new VisibleError(
              `Could not load OpenNext output file at "${openNextOutputPath}". Make sure your Next.js app was built correctly with OpenNext.`,
            );
          }
          const content = fs.readFileSync(openNextOutputPath).toString();
          const json = JSON.parse(content) as OpenNextOutput;
          // Currently open-next.output.json's initializationFunction value
          // is wrong, it is set to ".open-next/initialization-function"
          if (json.additionalProps?.initializationFunction) {
            json.additionalProps.initializationFunction = {
              handler: "index.handler",
              bundle: ".open-next/dynamodb-provider",
            };
          }
          return {
            openNextOutput: json,
            base: loadBasePath(),
            buildId: loadBuildId(),
            prerenderManifest: loadPrerenderManifest(),
          };
        }

        function loadBuildId() {
          try {
            return fs
              .readFileSync(path.join(outputPath, ".next/BUILD_ID"))
              .toString();
          } catch (e) {
            console.error(e);
            throw new VisibleError(
              `Build ID not found in ".next/BUILD_ID" for site "${name}". Ensure your Next.js app was built successfully.`,
            );
          }
        }

        function loadBasePath() {
          try {
            const content = fs.readFileSync(
              path.join(outputPath, ".next", "routes-manifest.json"),
              "utf-8",
            );
            const json = JSON.parse(content) as {
              basePath: string;
            };
            return json.basePath === "" ? undefined : json.basePath;
          } catch (e) {
            console.error(e);
            throw new VisibleError(
              `Base path configuration not found in ".next/routes-manifest.json" for site "${name}". Check your Next.js configuration.`,
            );
          }
        }

        function loadPrerenderManifest() {
          try {
            const content = fs
              .readFileSync(
                path.join(outputPath, ".next/prerender-manifest.json"),
              )
              .toString();
            return JSON.parse(content) as {
              version: number;
              routes: Record<string, unknown>;
            };
          } catch (e) {
            console.debug("Failed to load prerender-manifest.json", e);
          }
        }

        function createRevalidationQueue() {
          if (openNextOutput.additionalProps?.disableIncrementalCache)
            return {};

          const revalidationFunction =
            openNextOutput.additionalProps?.revalidationFunction;
          if (!revalidationFunction) return {};

          const queue = new Queue(
            `${name}RevalidationEvents`,
            {
              fifo: true,
              transform: {
                queue: (args) => {
                  args.receiveWaitTimeSeconds = 20;
                },
              },
            },
            { parent },
          );
          const subscriber = queue.subscribe(
            {
              description: `${name} ISR revalidator`,
              handler: revalidationFunction.handler,
              bundle: path.join(outputPath, revalidationFunction.bundle),
              runtime: "nodejs20.x",
              timeout: "30 seconds",
              permissions: [
                {
                  actions: [
                    "sqs:ChangeMessageVisibility",
                    "sqs:DeleteMessage",
                    "sqs:GetQueueAttributes",
                    "sqs:GetQueueUrl",
                    "sqs:ReceiveMessage",
                  ],
                  resources: [queue.arn],
                },
              ],
              dev: false,
              _skipMetadata: true,
            },
            {
              transform: {
                eventSourceMapping: (args) => {
                  args.batchSize = 5;
                },
              },
            },
            { parent },
          );
          return {
            revalidationQueue: queue,
            revalidationFunction: subscriber.nodes.function,
          };
        }

        function createRevalidationTable() {
          if (openNextOutput.additionalProps?.disableTagCache) return;

          return new dynamodb.Table(
            `${name}RevalidationTable`,
            {
              attributes: [
                { name: "tag", type: "S" },
                { name: "path", type: "S" },
                { name: "revalidatedAt", type: "N" },
              ],
              hashKey: "tag",
              rangeKey: "path",
              pointInTimeRecovery: {
                enabled: true,
              },
              billingMode: "PAY_PER_REQUEST",
              globalSecondaryIndexes: [
                {
                  name: "revalidate",
                  hashKey: "path",
                  rangeKey: "revalidatedAt",
                  projectionType: "ALL",
                },
              ],
            },
            { parent, retainOnDelete: false },
          );
        }

        function createRevalidationTableSeeder() {
          if (openNextOutput.additionalProps?.disableTagCache) return;
          if (!openNextOutput.additionalProps?.initializationFunction) return;

          // Provision 128MB of memory for every 4,000 prerendered routes,
          // 1GB per 40,000, up to 10GB. This tends to use ~70% of the memory
          // provisioned when testing.
          const prerenderedRouteCount = Object.keys(
            prerenderManifest?.routes ?? {},
          ).length;
          const seedFn = new Function(
            `${name}RevalidationSeeder`,
            {
              description: `${name} ISR revalidation data seeder`,
              handler:
                openNextOutput.additionalProps.initializationFunction.handler,
              bundle: path.join(
                outputPath,
                openNextOutput.additionalProps.initializationFunction.bundle,
              ),
              runtime: "nodejs20.x",
              timeout: "900 seconds",
              memory: `${Math.min(
                10240,
                Math.max(128, Math.ceil(prerenderedRouteCount / 4000) * 128),
              )} MB`,
              permissions: [
                {
                  actions: [
                    "dynamodb:BatchWriteItem",
                    "dynamodb:PutItem",
                    "dynamodb:DescribeTable",
                  ],
                  resources: [revalidationTable!.arn],
                },
              ],
              environment: {
                CACHE_DYNAMO_TABLE: revalidationTable!.name,
              },
              dev: false,
              _skipMetadata: true,
              _skipHint: true,
            },
            { parent },
          );
          new lambda.Invocation(
            `${name}RevalidationSeed`,
            {
              functionName: seedFn.nodes.function.name,
              triggers: {
                version: Date.now().toString(),
              },
              input: JSON.stringify({
                RequestType: "Create",
              }),
            },
            { parent },
          );
        }
      },
    );

    this.revalidationQueue = ret.revalidationQueue;
    this.revalidationTable = ret.revalidationTable;
    this.revalidationFunction = output(ret.revalidationFunction);

    return ret.plan;
  }

  /**
   * The URL of the Next.js app.
   *
   * If the `domain` is set, this is the URL with the custom domain.
   * Otherwise, it's the auto-generated CloudFront URL.
   */
  public get url() {
    return super.url;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      ...super.nodes,
      /**
       * The Amazon SQS queue that triggers the ISR revalidator.
       */
      revalidationQueue: this.revalidationQueue,
      /**
       * The Amazon DynamoDB table that stores the ISR revalidation data.
       */
      revalidationTable: this.revalidationTable,
      /**
       * The Lambda function that processes the ISR revalidation.
       */
      revalidationFunction: this.revalidationFunction,
    };
  }
}

const __pulumiType = "sst:aws:Nextjs";
// @ts-expect-error
Nextjs.__pulumiType = __pulumiType;
