import path from "path";
import fs from "fs";
import { globSync } from "glob";
import crypto from "crypto";
import type { Loader } from "esbuild";
import {
  Output,
  Unwrap,
  output,
  all,
  interpolate,
  ComponentResourceOptions,
  Resource,
} from "@pulumi/pulumi";
import { Cdn, CdnArgs } from "./cdn.js";
import { Function, FunctionArgs } from "./function.js";
import { Bucket, BucketArgs } from "./bucket.js";
import { BucketFile, BucketFiles } from "./providers/bucket-files.js";
import { logicalName } from "../naming.js";
import { Input } from "../input.js";
import {
  Component,
  Prettify,
  transform,
  type Transform,
} from "../component.js";
import { VisibleError } from "../error.js";
import { Cron } from "./cron.js";
import { BaseSiteFileOptions, getContentType } from "../base/base-site.js";
import { BaseSsrSiteArgs, buildApp } from "../base/base-ssr-site.js";
import { cloudfront, getRegionOutput, lambda, Region } from "@pulumi/aws";
import { KvKeys } from "./providers/kv-keys.js";
import { useProvider } from "./helpers/provider.js";
import { Link } from "../link.js";
import { URL_UNAVAILABLE } from "./linkable.js";
import {
  CF_ROUTER_INJECTION,
  CF_BLOCK_CLOUDFRONT_URL_INJECTION,
  KV_SITE_METADATA,
  RouterRouteArgsDeprecated,
  normalizeRouteArgs,
  RouterRouteArgs,
} from "./router.js";
import { DistributionInvalidation } from "./providers/distribution-invalidation.js";
import { toSeconds } from "../duration.js";
import { KvRoutesUpdate } from "./providers/kv-routes-update.js";
import { CONSOLE_URL, getQuota } from "./helpers/quota.js";
import { toPosix } from "../path.js";

const supportedRegions = {
  "af-south-1": { lat: -33.9249, lon: 18.4241 }, // Cape Town, South Africa
  "ap-east-1": { lat: 22.3193, lon: 114.1694 }, // Hong Kong
  "ap-northeast-1": { lat: 35.6895, lon: 139.6917 }, // Tokyo, Japan
  "ap-northeast-2": { lat: 37.5665, lon: 126.978 }, // Seoul, South Korea
  "ap-northeast-3": { lat: 34.6937, lon: 135.5023 }, // Osaka, Japan
  "ap-southeast-1": { lat: 1.3521, lon: 103.8198 }, // Singapore
  "ap-southeast-2": { lat: -33.8688, lon: 151.2093 }, // Sydney, Australia
  "ap-southeast-3": { lat: -6.2088, lon: 106.8456 }, // Jakarta, Indonesia
  "ap-southeast-4": { lat: -37.8136, lon: 144.9631 }, // Melbourne, Australia
  "ap-southeast-5": { lat: 3.139, lon: 101.6869 }, // Kuala Lumpur, Malaysia
  "ap-southeast-7": { lat: 13.7563, lon: 100.5018 }, // Bangkok, Thailand
  "ap-south-1": { lat: 19.076, lon: 72.8777 }, // Mumbai, India
  "ap-south-2": { lat: 17.385, lon: 78.4867 }, // Hyderabad, India
  "ca-central-1": { lat: 45.5017, lon: -73.5673 }, // Montreal, Canada
  "ca-west-1": { lat: 51.0447, lon: -114.0719 }, // Calgary, Canada
  "cn-north-1": { lat: 39.9042, lon: 116.4074 }, // Beijing, China
  "cn-northwest-1": { lat: 38.4872, lon: 106.2309 }, // Yinchuan, Ningxia
  "eu-central-1": { lat: 50.1109, lon: 8.6821 }, // Frankfurt, Germany
  "eu-central-2": { lat: 47.3769, lon: 8.5417 }, // Zurich, Switzerland
  "eu-north-1": { lat: 59.3293, lon: 18.0686 }, // Stockholm, Sweden
  "eu-south-1": { lat: 45.4642, lon: 9.19 }, // Milan, Italy
  "eu-south-2": { lat: 40.4168, lon: -3.7038 }, // Madrid, Spain
  "eu-west-1": { lat: 53.3498, lon: -6.2603 }, // Dublin, Ireland
  "eu-west-2": { lat: 51.5074, lon: -0.1278 }, // London, UK
  "eu-west-3": { lat: 48.8566, lon: 2.3522 }, // Paris, France
  "il-central-1": { lat: 32.0853, lon: 34.7818 }, // Tel Aviv, Israel
  "me-central-1": { lat: 25.2048, lon: 55.2708 }, // Dubai, UAE
  "me-south-1": { lat: 26.0667, lon: 50.5577 }, // Manama, Bahrain
  "mx-central-1": { lat: 19.4326, lon: -99.1332 }, // Mexico City, Mexico
  "sa-east-1": { lat: -23.5505, lon: -46.6333 }, // São Paulo, Brazil
  "us-east-1": { lat: 39.0438, lon: -77.4874 }, // Ashburn, VA
  "us-east-2": { lat: 39.9612, lon: -82.9988 }, // Columbus, OH
  "us-gov-east-1": { lat: 38.9696, lon: -77.3861 }, // Herndon, VA
  "us-gov-west-1": { lat: 34.0522, lon: -118.2437 }, // Los Angeles, CA
  "us-west-1": { lat: 37.7749, lon: -122.4194 }, // San Francisco, CA
  "us-west-2": { lat: 45.5122, lon: -122.6587 }, // Portland, OR
};

export type Plan = {
  // The base path of the site (ie. /docs). Note that S3 assets are not stored inside a
  // folder with this name. The CF router will stripe the base path from the request URI
  // when routing to S3.
  base?: string;
  server?: Unwrap<FunctionArgs>;
  imageOptimizer?: {
    function: Unwrap<FunctionArgs>;
    prefix: string;
  };
  assets: {
    from: string;
    // KV asset entries do not include the `to` value in their keys. The CF router will
    // add the `to` value to the request URI when routing to S3.
    to: string;
    cached: boolean;
    versionedSubDir?: string;
    deepRoute?: string;
  }[];
  isrCache?: {
    from: string;
    to: string;
  };
  custom404?: string;
  buildId?: string;
};

export interface SsrSiteArgs extends BaseSsrSiteArgs {
  domain?: CdnArgs["domain"];
  /**
   * @deprecated Use `router` instead.
   */
  route?: Prettify<RouterRouteArgsDeprecated>;
  router?: Prettify<RouterRouteArgs>;
  cachePolicy?: Input<string>;
  invalidation?: Input<
    | false
    | {
        /**
         * Configure if `sst deploy` should wait for the CloudFront cache invalidation to finish.
         *
         * :::tip
         * For non-prod environments it might make sense to pass in `false`.
         * :::
         *
         * Waiting for this process to finish ensures that new content will be available after the deploy finishes. However, this process can sometimes take more than 5 mins.
         * @default `false`
         * @example
         * ```js
         * {
         *   invalidation: {
         *     wait: true
         *   }
         * }
         * ```
         */
        wait?: Input<boolean>;
        /**
         * The paths to invalidate.
         *
         * You can either pass in an array of glob patterns to invalidate specific files. Or you can use one of these built-in options:
         * - `all`: All files will be invalidated when any file changes
         * - `versioned`: Only versioned files will be invalidated when versioned files change
         *
         * :::note
         * Each glob pattern counts as a single invalidation. Whereas, invalidating
         * `/*` counts as a single invalidation.
         * :::
         * @default `"all"`
         * @example
         * Invalidate the `index.html` and all files under the `products/` route.
         * ```js
         * {
         *   invalidation: {
         *     paths: ["/index.html", "/products/*"]
         *   }
         * }
         * ```
         * This counts as two invalidations.
         */
        paths?: Input<"all" | "versioned" | string[]>;
      }
  >;
  /**
   * Regions that the server function will be deployed to.
   *
   * By default, the server function is deployed to a single region, this is the
   * default region of your SST app.
   *
   * :::note
   * This does not use Lambda@Edge, it deploys multiple Lambda functions instead.
   * :::
   *
   * To deploy it to multiple regions, you can pass in a list of regions. And
   * any requests made will be routed to the nearest region based on the user's
   * location.
   *
   * @default The default region of the SST app
   *
   * @example
   * ```js
   * {
   *   regions: ["us-east-1", "eu-west-1"]
   * }
   * ```
   */
  regions?: Input<string[]>;
  permissions?: FunctionArgs["permissions"];
  /**
   * The number of instances of the [server function](#nodes-server) to keep warm. This is useful for cases where you are experiencing long cold starts. The default is to not keep any instances warm.
   *
   * This works by starting a serverless cron job to make _n_ concurrent requests to the server function every few minutes. Where _n_ is the number of instances to keep warm.
   *
   * @default `0`
   */
  warm?: Input<number>;
  /**
   * Configure the Lambda function used for server.
   * @default `{architecture: "x86_64", memory: "1024 MB"}`
   */
  server?: {
    /**
     * The amount of memory allocated to the server function.
     * Takes values between 128 MB and 10240 MB in 1 MB increments.
     *
     * @default `"1024 MB"`
     * @example
     * ```js
     * {
     *   server: {
     *     memory: "2048 MB"
     *   }
     * }
     * ```
     */
    memory?: FunctionArgs["memory"];
    /**
     * The runtime environment for the server function.
     *
     * @default `"nodejs20.x"`
     * @example
     * ```js
     * {
     *   server: {
     *     runtime: "nodejs22.x"
     *   }
     * }
     * ```
     */
    runtime?: Input<"nodejs18.x" | "nodejs20.x" | "nodejs22.x">;
    /**
     * The maximum amount of time the server function can run.
     *
     * While Lambda supports timeouts up to 900 seconds, your requests are served
     * through AWS CloudFront. And it has a default limit of 60 seconds.
     *
     * If you set a timeout that's longer than 60 seconds, this component will
     * check if your account can allow for that timeout. If not, it'll throw an
     * error.
     *
     * :::tip
     * If you need a timeout longer than 60 seconds, you'll need to request a
     * limit increase.
     * :::
     *
     * You can increase this to 180 seconds for your account by contacting AWS
     * Support and [requesting a limit increase](https://console.aws.amazon.com/support/home#/case/create?issueType=service-limit-increase).
     *
     * @default `"20 seconds"`
     * @example
     * ```js
     * {
     *   server: {
     *     timeout: "50 seconds"
     *   }
     * }
     * ```
     *
     * If you need a timeout longer than what CloudFront supports, we recommend
     * using a separate Lambda `Function` with the `url` enabled instead.
     */
    timeout?: FunctionArgs["timeout"];
    /**
     * The [architecture](https://docs.aws.amazon.com/lambda/latest/dg/foundation-arch.html)
     * of the server function.
     *
     * @default `"x86_64"`
     * @example
     * ```js
     * {
     *   server: {
     *     architecture: "arm64"
     *   }
     * }
     * ```
     */
    architecture?: FunctionArgs["architecture"];
    /**
     * Dependencies that need to be excluded from the server function package.
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
     *   server: {
     *     install: ["sharp"]
     *   }
     * }
     * ```
     */
    install?: Input<string[]>;
    /**
     * Configure additional esbuild loaders for other file extensions. This is useful
     * when your code is importing non-JS files like `.png`, `.css`, etc.
     *
     * @example
     * ```js
     * {
     *   server: {
     *     loader: {
     *      ".png": "file"
     *     }
     *   }
     * }
     * ```
     */
    loader?: Input<Record<string, Loader>>;
    /**
     * A list of Lambda layer ARNs to add to the server function.
     *
     * @example
     * ```js
     * {
     *   server: {
     *     layers: ["arn:aws:lambda:us-east-1:123456789012:layer:my-layer:1"]
     *   }
     * }
     * ```
     */
    layers?: Input<Input<string>[]>;
    /**
     * @deprecated The `server.edge` prop has been moved to the top level `edge` prop on the component.
     */
    edge?: Input<{
      viewerRequest?: Input<{
        injection: Input<string>;
        kvStore?: Input<string>;
        kvStores?: Input<Input<string>[]>;
      }>;
      viewerResponse?: Input<{
        injection: Input<string>;
        kvStore?: Input<string>;
        kvStores?: Input<Input<string>[]>;
      }>;
    }>;
  };
  /**
   * Configure CloudFront Functions to customize the behavior of HTTP requests and responses at the edge.
   */
  edge?: Input<{
    /**
     * Configure the viewer request function.
     *
     * The viewer request function can be used to modify incoming requests before they
     * reach your origin server. For example, you can redirect users, rewrite URLs,
     * or add headers.
     */
    viewerRequest?: Input<{
      /**
       * The code to inject into the viewer request function.
       *
       * By default, a viewer request function is created to:
       * - Disable CloudFront default URL if custom domain is set
       * - Add the `x-forwarded-host` header
       * - Route assets requests to S3 (static files stored in the bucket)
       * - Route server requests to server functions (dynamic rendering)
       *
       * The function manages routing by:
       * 1. First checking if the requested path exists in S3 (with variations like adding index.html)
       * 2. Serving a custom 404 page from S3 if configured and the path isn't found
       * 3. Routing image optimization requests to the image optimizer function
       * 4. Routing all other requests to the nearest server function
       *
       * The given code will be injected at the beginning of this function.
       *
       * ```js
       * async function handler(event) {
       *   // User injected code
       *
       *   // Default behavior code
       *
       *   return event.request;
       * }
       * ```
       *
       * @example
       * To add a custom header to all requests.
       *
       * ```js
       * {
       *   edge: {
       *     viewerRequest: {
       *       injection: `event.request.headers["x-foo"] = { value: "bar" };`
       *     }
       *   }
       * }
       * ```
       *
       * You can use this to add basic auth, [check out an example](/docs/examples/#aws-nextjs-basic-auth).
       */
      injection: Input<string>;
      /**
       * The KV store to associate with the viewer request function.
       *
       * @example
       * ```js
       * {
       *   edge: {
       *     viewerRequest: {
       *       kvStore: "arn:aws:cloudfront::123456789012:key-value-store/my-store"
       *     }
       *   }
       * }
       * ```
       */
      kvStore?: Input<string>;
    }>;
    /**
     * Configure the viewer response function.
     *
     * The viewer response function can be used to modify outgoing responses before they are
     * sent to the client. For example, you can add security headers or change the response
     * status code.
     *
     * By default, no viewer response function is set. A new function will be created
     * with the provided code.
     */
    viewerResponse?: Input<{
      /**
       * The code to inject into the viewer response function.
       *
       * ```js
       * async function handler(event) {
       *   // User injected code
       *
       *   return event.response;
       * }
       * ```
       *
       * @example
       * To add a custom header to all responses.
       *
       * ```js
       * {
       *   edge: {
       *     viewerResponse: {
       *       injection: `event.response.headers["x-foo"] = { value: "bar" };`
       *     }
       *   }
       * }
       * ```
       */
      injection: Input<string>;
      /**
       * The KV store to associate with the viewer response function.
       *
       * @example
       * ```js
       * {
       *   edge: {
       *     viewerResponse: {
       *       kvStore: "arn:aws:cloudfront::123456789012:key-value-store/my-store"
       *     }
       *   }
       * }
       * ```
       */
      kvStore?: Input<string>;
    }>;
  }>;
  /**
   * Configure the server function to connect to private subnets in a virtual private cloud or VPC. This allows it to access private resources.
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
  vpc?: FunctionArgs["vpc"];
  assets?: Input<{
    /**
     * Character encoding for text based assets, like HTML, CSS, JS. This is
     * used to set the `Content-Type` header when these files are served out.
     *
     * If set to `"none"`, then no charset will be returned in header.
     * @default `"utf-8"`
     * @example
     * ```js
     * {
     *   assets: {
     *     textEncoding: "iso-8859-1"
     *   }
     * }
     * ```
     */
    textEncoding?: Input<
      "utf-8" | "iso-8859-1" | "windows-1252" | "ascii" | "none"
    >;
    /**
     * The `Cache-Control` header used for versioned files, like `main-1234.css`. This is
     * used by both CloudFront and the browser cache.
     *
     * The default `max-age` is set to 1 year.
     * @default `"public,max-age=31536000,immutable"`
     * @example
     * ```js
     * {
     *   assets: {
     *     versionedFilesCacheHeader: "public,max-age=31536000,immutable"
     *   }
     * }
     * ```
     */
    versionedFilesCacheHeader?: Input<string>;
    /**
     * The `Cache-Control` header used for non-versioned files, like `index.html`. This is used by both CloudFront and the browser cache.
     *
     * The default is set to not cache on browsers, and cache for 1 day on CloudFront.
     * @default `"public,max-age=0,s-maxage=86400,stale-while-revalidate=8640"`
     * @example
     * ```js
     * {
     *   assets: {
     *     nonVersionedFilesCacheHeader: "public,max-age=0,no-cache"
     *   }
     * }
     * ```
     */
    nonVersionedFilesCacheHeader?: Input<string>;
    /**
     * Specify the `Content-Type` and `Cache-Control` headers for specific files. This allows
     * you to override the default behavior for specific files using glob patterns.
     *
     * @example
     * Apply `Cache-Control` and `Content-Type` to all zip files.
     * ```js
     * {
     *   assets: {
     *     fileOptions: [
     *       {
     *         files: "**\/*.zip",
     *         contentType: "application/zip",
     *         cacheControl: "private,no-cache,no-store,must-revalidate"
     *       }
     *     ]
     *   }
     * }
     * ```
     * Apply `Cache-Control` to all CSS and JS files except for CSS files with `index-`
     * prefix in the `main/` directory.
     * ```js
     * {
     *   assets: {
     *     fileOptions: [
     *       {
     *         files: ["**\/*.css", "**\/*.js"],
     *         ignore: "main\/index-*.css",
     *         cacheControl: "private,no-cache,no-store,must-revalidate"
     *       }
     *     ]
     *   }
     * }
     * ```
     */
    fileOptions?: Input<Prettify<BaseSiteFileOptions>[]>;
    /**
     * Configure if files from previous deployments should be purged from the bucket.
     * @default `true`
     * @example
     * ```js
     * {
     *   assets: {
     *     purge: false
     *   }
     * }
     * ```
     */
    purge?: Input<boolean>;
  }>;
  /**
   * @deprecated The `route` prop is now the recommended way to use the `Router` component
   * to serve your site. Setting `route` will not create a standalone CloudFront
   * distribution.
   */
  cdn?: Input<boolean>;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the Bucket resource used for uploading the assets.
     */
    assets?: Transform<BucketArgs>;
    /**
     * Transform the server Function resource.
     */
    server?: Transform<FunctionArgs>;
    /**
     * Transform the CloudFront CDN resource.
     */
    cdn?: Transform<CdnArgs>;
  };
}

export abstract class SsrSite extends Component implements Link.Linkable {
  private cdn?: Cdn;
  private bucket?: Bucket;
  private server?: Output<Function>;
  private devUrl?: Output<string>;
  private prodUrl?: Output<string | undefined>;

  protected abstract normalizeBuildCommand(
    args: SsrSiteArgs,
  ): Output<string> | void;

  protected abstract buildPlan(
    outputPath: Output<string>,
    name: string,
    args: SsrSiteArgs,
    { bucket }: { bucket: Bucket },
  ): Output<Plan>;

  constructor(
    type: string,
    name: string,
    args: SsrSiteArgs = {},
    opts: ComponentResourceOptions = {},
  ) {
    super(type, name, args, opts);
    const self = this;

    validateDeprecatedProps();
    const regions = normalizeRegions();
    const route = normalizeRoute();
    const edge = normalizeEdge();
    const serverTimeout = normalizeServerTimeout();
    const buildCommand = this.normalizeBuildCommand(args);
    const sitePath = regions.apply(() => normalizeSitePath());
    const dev = normalizeDev();
    const purge = output(args.assets).apply((assets) => assets?.purge ?? false);

    if (dev.enabled) {
      const server = createDevServer();
      this.devUrl = dev.url;
      this.registerOutputs({
        _metadata: {
          mode: "placeholder",
          path: sitePath,
          server: server.arn,
        },
        _dev: {
          ...dev.outputs,
          aws: { role: server.nodes.role.arn },
        },
      });
      return;
    }

    const outputPath = buildApp(
      self,
      name,
      args,
      sitePath,
      buildCommand ?? undefined,
    );
    const bucket = createS3Bucket();
    const plan = validatePlan(
      this.buildPlan(outputPath, name, args, { bucket }),
    );
    const timeout = all([serverTimeout, plan.server]).apply(
      ([argsTimeout, plan]) => argsTimeout ?? plan?.timeout ?? "20 seconds",
    );
    const servers = createServers();
    const imageOptimizer = createImageOptimizer();
    const assetsUploaded = uploadAssets();
    const kvNamespace = buildKvNamespace();

    let distribution: Cdn | undefined;
    let distributionId: Output<string>;
    let kvStoreArn: Output<string>;
    let invalidationDependsOn: Resource[] = [];
    let prodUrl: Output<string | undefined>;
    if (route) {
      kvStoreArn = route.routerKvStoreArn;
      distributionId = route.routerDistributionId;
      invalidationDependsOn = [updateRouterKvRoutes()];
      prodUrl = route.routerUrl;
    } else {
      kvStoreArn = createRequestKvStore();
      distribution = createDistribution();
      distributionId = distribution.nodes.distribution.id;
      prodUrl = distribution.domainUrl.apply((domainUrl) =>
        output(domainUrl ?? distribution!.url),
      );
    }

    function createCachePolicy() {
      return new cloudfront.CachePolicy(
        `${name}ServerCachePolicy`,
        {
          comment: "SST server response cache policy",
          defaultTtl: 0,
          maxTtl: 31536000, // 1 year
          minTtl: 0,
          parametersInCacheKeyAndForwardedToOrigin: {
            cookiesConfig: {
              cookieBehavior: "none",
            },
            headersConfig: {
              headerBehavior: "whitelist",
              headers: {
                items: ["x-open-next-cache-key"],
              },
            },
            queryStringsConfig: {
              queryStringBehavior: "all",
            },
            enableAcceptEncodingBrotli: true,
            enableAcceptEncodingGzip: true,
          },
        },
        { parent: self },
      );
    }

    function createRequestKvStore() {
      return edge.apply((edge) => {
        const viewerRequest = edge?.viewerRequest;
        if (viewerRequest?.kvStore) return output(viewerRequest?.kvStore);

        return new cloudfront.KeyValueStore(
          `${name}KvStore`,
          {},
          { parent: self },
        ).arn;
      });
    }

    function createRequestFunction() {
      return edge.apply((edge) => {
        const userInjection = edge?.viewerRequest?.injection ?? "";
        const blockCloudfrontUrlInjection = args.domain
          ? CF_BLOCK_CLOUDFRONT_URL_INJECTION
          : "";
        return new cloudfront.Function(
          `${name}CloudfrontFunctionRequest`,
          {
            runtime: "cloudfront-js-2.0",
            keyValueStoreAssociations: kvStoreArn ? [kvStoreArn] : [],
            code: interpolate`
import cf from "cloudfront";
async function handler(event) {
  ${userInjection}
  ${blockCloudfrontUrlInjection}
  ${CF_ROUTER_INJECTION}

  const kvNamespace = "${kvNamespace}";

  // Load metadata
  let metadata;
  try {
    const v = await cf.kvs().get(kvNamespace + ":metadata");
    metadata = JSON.parse(v);
  } catch (e) {}

  await routeSite(kvNamespace, metadata);
  return event.request;
}`,
          },
          { parent: self },
        );
      });
    }

    function createResponseFunction() {
      return edge.apply((edge) => {
        const userConfig = edge?.viewerResponse;
        const userInjection = userConfig?.injection;
        const kvStoreArn = userConfig?.kvStore;

        if (!userInjection) return;

        return new cloudfront.Function(
          `${name}CloudfrontFunctionResponse`,
          {
            runtime: "cloudfront-js-2.0",
            keyValueStoreAssociations: kvStoreArn ? [kvStoreArn] : [],
            code: `
import cf from "cloudfront";
async function handler(event) {
  ${userInjection}
  return event.response;
}`,
          },
          { parent: self },
        );
      });
    }

    function createDistribution() {
      return new Cdn(
        ...transform(
          args.transform?.cdn,
          `${name}Cdn`,
          {
            comment: `${name} app`,
            domain: args.domain,
            origins: [
              {
                originId: "default",
                domainName: "placeholder.sst.dev",
                customOriginConfig: {
                  httpPort: 80,
                  httpsPort: 443,
                  originProtocolPolicy: "http-only",
                  originReadTimeout: 20,
                  originSslProtocols: ["TLSv1.2"],
                },
              },
            ],
            defaultCacheBehavior: {
              targetOriginId: "default",
              viewerProtocolPolicy: "redirect-to-https",
              allowedMethods: [
                "DELETE",
                "GET",
                "HEAD",
                "OPTIONS",
                "PATCH",
                "POST",
                "PUT",
              ],
              cachedMethods: ["GET", "HEAD"],
              compress: true,
              cachePolicyId: args.cachePolicy ?? createCachePolicy().id,
              // CloudFront's Managed-AllViewerExceptHostHeader policy
              originRequestPolicyId: "b689b0a8-53d0-40ab-baf2-68738e2966ac",
              functionAssociations: all([
                createRequestFunction(),
                createResponseFunction(),
              ]).apply(([reqFn, resFn]) => [
                { eventType: "viewer-request", functionArn: reqFn.arn },
                ...(resFn
                  ? [{ eventType: "viewer-response", functionArn: resFn.arn }]
                  : []),
              ]),
            },
          },
          { parent: self },
        ),
      );
    }

    const kvUpdated = createKvEntries();
    createInvalidation();

    const server = servers.apply((servers) => servers[0]?.server);
    this.bucket = bucket;
    this.cdn = distribution;
    this.server = server;
    this.prodUrl = prodUrl;

    this.registerOutputs({
      _hint: this.url,
      _metadata: {
        mode: "deployed",
        path: sitePath,
        url: this.url,
        edge: false,
        server: server.arn,
      },
      _dev: {
        ...dev.outputs,
        aws: { role: server.nodes.role.arn },
      },
    });

    function validateDeprecatedProps() {
      if (args.cdn !== undefined)
        throw new VisibleError(
          `"cdn" prop is deprecated. Use the "route.router" prop instead to use an existing "Router" component to serve your site.`,
        );
    }

    function normalizeDev() {
      const enabled = $dev && args.dev !== false;
      const devArgs = args.dev || {};

      return {
        enabled,
        url: output(devArgs.url ?? URL_UNAVAILABLE),
        outputs: {
          title: devArgs.title,
          command: output(devArgs.command ?? "npm run dev"),
          autostart: output(devArgs.autostart ?? true),
          directory: output(devArgs.directory ?? sitePath),
          environment: args.environment,
          links: output(args.link || [])
            .apply(Link.build)
            .apply((links) => links.map((link) => link.name)),
        },
      };
    }

    function normalizeSitePath() {
      return output(args.path).apply((sitePath) => {
        if (!sitePath) return ".";

        if (!fs.existsSync(sitePath)) {
          throw new VisibleError(
            `Site directory not found at "${path.resolve(
              sitePath,
            )}". Please check the path setting in your configuration.`,
          );
        }
        return sitePath;
      });
    }

    function normalizeRegions() {
      return output(
        args.regions ?? [getRegionOutput(undefined, { parent: self }).name],
      ).apply((regions) => {
        if (regions.length === 0)
          throw new VisibleError(
            "No deployment regions specified. Please specify at least one region in the 'regions' property.",
          );

        return regions.map((region) => {
          if (
            [
              "ap-south-2",
              "ap-southeast-4",
              "ap-southeast-5",
              "ca-west-1",
              "eu-south-2",
              "eu-central-2",
              "il-central-1",
              "me-central-1",
            ].includes(region)
          )
            throw new VisibleError(
              `Region ${region} is not supported by this component. Please select a different AWS region.`,
            );

          if (!Object.values(Region).includes(region as Region))
            throw new VisibleError(
              `Invalid AWS region: "${region}". Please specify a valid AWS region.`,
            );
          return region as Region;
        });
      });
    }

    function normalizeRoute() {
      const route = normalizeRouteArgs(args.router, args.route);

      if (route) {
        if (args.domain)
          throw new VisibleError(
            `Cannot provide both "domain" and "route". Use the "domain" prop on the "Router" component when serving your site through a Router.`,
          );

        if (args.edge)
          throw new VisibleError(
            `Cannot provide both "edge" and "route". Use the "edge" prop on the "Router" component when serving your site through a Router.`,
          );
      }

      return route;
    }

    function normalizeEdge() {
      return output([args.edge, args.server?.edge]).apply(
        ([edge, serverEdge]) => {
          if (serverEdge)
            throw new VisibleError(
              `The "server.edge" prop is deprecated. Use the "edge" prop on the top level instead.`,
            );

          if (!edge) return edge;
          return edge;
        },
      );
    }

    function normalizeServerTimeout() {
      return output(args.server?.timeout).apply((v) => {
        if (!v) return v;

        const seconds = toSeconds(v);
        if (seconds > 60) {
          getQuota("cloudfront-response-timeout").apply((quota) => {
            if (seconds > quota)
              throw new VisibleError(
                `Server timeout for "${name}" is longer than the allowed CloudFront response timeout of ${quota} seconds. You can contact AWS Support to increase the timeout - ${CONSOLE_URL}`,
              );
          });
        }
        return v;
      });
    }

    function createDevServer() {
      return new Function(
        ...transform(
          args.transform?.server,
          `${name}DevServer`,
          {
            description: `${name} dev server`,
            runtime: "nodejs20.x",
            timeout: "20 seconds",
            memory: "128 MB",
            bundle: path.join(
              $cli.paths.platform,
              "functions",
              "empty-function",
            ),
            handler: "index.handler",
            environment: args.environment,
            permissions: args.permissions,
            link: args.link,
            dev: false,
          },
          { parent: self },
        ),
      );
    }

    function validatePlan(plan: Output<Plan>) {
      return all([plan, route]).apply(([plan, route]) => {
        if (plan.base) {
          // starts with /
          plan.base = !plan.base.startsWith("/") ? `/${plan.base}` : plan.base;
          // does not end with /
          plan.base = plan.base.replace(/\/$/, "");
        }

        if (route?.pathPrefix && route.pathPrefix !== "/") {
          if (!plan.base)
            throw new VisibleError(
              `No base path found for site. You must configure the base path to match the route path prefix "${route.pathPrefix}".`,
            );

          if (!plan.base.startsWith(route.pathPrefix))
            throw new VisibleError(
              `The site base path "${plan.base}" must start with the route path prefix "${route.pathPrefix}".`,
            );
        }

        // if copy.to has a leading slash, files will be uploaded to `/` folder in bucket
        plan.assets.forEach((copy) => {
          copy.to = copy.to.replace(/^\/|\/$/g, "");
        });
        if (plan.isrCache) {
          plan.isrCache.to = plan.isrCache.to.replace(/^\/|\/$/g, "");
        }

        return plan;
      });
    }

    function createS3Bucket() {
      return new Bucket(
        ...transform(
          args.transform?.assets,
          `${name}Assets`,
          { access: "cloudfront" },
          { parent: self, retainOnDelete: false },
        ),
      );
    }

    function createServers() {
      return all([regions, plan.server]).apply(([regions, planServer]) => {
        if (!planServer) return [];

        return regions.map((region) => {
          const provider = useProvider(region);
          const server = new Function(
            ...transform(
              args.transform?.server,
              `${name}Server${logicalName(region)}`,
              {
                ...planServer,
                description: planServer.description ?? `${name} server`,
                runtime: output(args.server?.runtime).apply(
                  (v) => v ?? planServer.runtime ?? "nodejs20.x",
                ),
                timeout,
                memory: output(args.server?.memory).apply(
                  (v) => v ?? planServer.memory ?? "1024 MB",
                ),
                architecture: output(args.server?.architecture).apply(
                  (v) => v ?? planServer.architecture ?? "x86_64",
                ),
                vpc: args.vpc,
                nodejs: {
                  ...planServer.nodejs,
                  format: "esm" as const,
                  install: output(args.server?.install).apply((install) => [
                    ...(install ?? []),
                    ...(planServer.nodejs?.install ?? []),
                  ]),
                  loader: args.server?.loader ?? planServer.nodejs?.loader,
                },
                environment: output(args.environment).apply((environment) => ({
                  ...environment,
                  ...planServer.environment,
                })),
                permissions: output(args.permissions).apply((permissions) => [
                  {
                    actions: ["cloudfront:CreateInvalidation"],
                    resources: ["*"],
                  },
                  ...(permissions ?? []),
                  ...(planServer.permissions ?? []),
                ]),
                injections: [
                  ...(args.warm
                    ? [useServerWarmingInjection(planServer.streaming)]
                    : []),
                  ...(planServer.injections || []),
                ],
                link: output(args.link).apply((link) => [
                  ...(planServer.link ?? []),
                  ...(link ?? []),
                ]),
                layers: output(args.server?.layers).apply((layers) => [
                  ...(planServer.layers ?? []),
                  ...(layers ?? []),
                ]),
                url: true,
                dev: false,
                _skipHint: true,
              },
              { provider, parent: self },
            ),
          );

          if (args.warm) {
            // Create cron job
            const cron = new Cron(
              `${name}Warmer${logicalName(region)}`,
              {
                schedule: "rate(5 minutes)",
                job: {
                  description: `${name} warmer`,
                  bundle: path.join($cli.paths.platform, "dist", "ssr-warmer"),
                  runtime: "nodejs20.x",
                  handler: "index.handler",
                  timeout: "900 seconds",
                  memory: "128 MB",
                  dev: false,
                  environment: {
                    FUNCTION_NAME: server.nodes.function.name,
                    CONCURRENCY: output(args.warm).apply((warm) =>
                      warm.toString(),
                    ),
                  },
                  link: [server],
                  _skipMetadata: true,
                },
                transform: {
                  target: (args) => {
                    args.retryPolicy = {
                      maximumRetryAttempts: 0,
                      maximumEventAgeInSeconds: 60,
                    };
                  },
                },
              },
              { provider, parent: self },
            );

            // Prewarm on deploy
            new lambda.Invocation(
              `${name}Prewarm${logicalName(region)}`,
              {
                functionName: cron.nodes.job.name,
                triggers: {
                  version: Date.now().toString(),
                },
                input: JSON.stringify({}),
              },
              { provider, parent: self },
            );
          }

          return { region, server };
        });
      });
    }

    function createImageOptimizer() {
      return output(plan.imageOptimizer).apply((imageOptimizer) => {
        if (!imageOptimizer) return;
        return new Function(
          `${name}ImageOptimizer`,
          {
            timeout: "25 seconds",
            logging: {
              retention: "3 days",
            },
            permissions: [
              {
                actions: ["s3:GetObject"],
                resources: [interpolate`${bucket.arn}/*`],
              },
            ],
            ...imageOptimizer.function,
            url: true,
            dev: false,
            _skipMetadata: true,
            _skipHint: true,
          },
          { parent: self },
        );
      });
    }

    function useServerWarmingInjection(streaming?: boolean) {
      return [
        `if (event.type === "warmer") {`,
        `  const p = new Promise((resolve) => {`,
        `    setTimeout(() => {`,
        `      resolve({ serverId: "server-" + Math.random().toString(36).slice(2, 8) });`,
        `    }, event.delay);`,
        `  });`,
        ...(streaming
          ? [
              `  const response = await p;`,
              `  responseStream.write(JSON.stringify(response));`,
              `  responseStream.end();`,
              `  return;`,
            ]
          : [`  return p;`]),
        `}`,
      ].join("\n");
    }

    function uploadAssets() {
      return all([args.assets, route, plan, outputPath]).apply(
        async ([assets, route, plan, outputPath]) => {
          // Define content headers
          const versionedFilesTTL = 31536000; // 1 year
          const nonVersionedFilesTTL = 86400; // 1 day

          const bucketFiles: BucketFile[] = [];

          // Handle each copy source
          for (const copy of [
            ...plan.assets,
            ...(plan.isrCache
              ? [{ ...plan.isrCache, versionedSubDir: undefined }]
              : []),
          ]) {
            // Build fileOptions
            const fileOptions: BaseSiteFileOptions[] = [
              // unversioned files
              {
                files: "**",
                ignore: copy.versionedSubDir
                  ? toPosix(path.join(copy.versionedSubDir, "**"))
                  : undefined,
                cacheControl:
                  assets?.nonVersionedFilesCacheHeader ??
                  `public,max-age=0,s-maxage=${nonVersionedFilesTTL},stale-while-revalidate=${nonVersionedFilesTTL}`,
              },
              // versioned files
              ...(copy.versionedSubDir
                ? [
                    {
                      files: toPosix(path.join(copy.versionedSubDir, "**")),
                      cacheControl:
                        assets?.versionedFilesCacheHeader ??
                        `public,max-age=${versionedFilesTTL},immutable`,
                    },
                  ]
                : []),
              ...(assets?.fileOptions ?? []),
            ];

            // Upload files based on fileOptions
            const filesUploaded: string[] = [];
            for (const fileOption of fileOptions.reverse()) {
              const files = globSync(fileOption.files, {
                cwd: path.resolve(outputPath, copy.from),
                nodir: true,
                dot: true,
                ignore: fileOption.ignore,
              }).filter((file) => !filesUploaded.includes(file));

              bucketFiles.push(
                ...(await Promise.all(
                  files.map(async (file) => {
                    const source = path.resolve(outputPath, copy.from, file);
                    const content = await fs.promises.readFile(source, "utf-8");
                    const hash = crypto
                      .createHash("sha256")
                      .update(content)
                      .digest("hex");
                    return {
                      source,
                      key: toPosix(
                        path.join(
                          copy.to,
                          route?.pathPrefix?.replace(/^\//, "") ?? "",
                          file,
                        ),
                      ),
                      hash,
                      cacheControl: fileOption.cacheControl,
                      contentType:
                        fileOption.contentType ?? getContentType(file, "UTF-8"),
                    };
                  }),
                )),
              );
              filesUploaded.push(...files);
            }
          }

          return new BucketFiles(
            `${name}AssetFiles`,
            {
              bucketName: bucket.name,
              files: bucketFiles,
              purge,
              region: getRegionOutput(undefined, { parent: self }).name,
            },
            { parent: self },
          );
        },
      );
    }

    function buildKvNamespace() {
      // In the case multiple sites use the same kv store, we need to namespace the keys
      return crypto
        .createHash("md5")
        .update(`${$app.name}-${$app.stage}-${name}`)
        .digest("hex")
        .substring(0, 4);
    }

    function createKvEntries() {
      const entries = all([
        servers,
        imageOptimizer,
        outputPath,
        plan,
        bucket.nodes.bucket.bucketRegionalDomainName,
        timeout,
      ]).apply(
        ([servers, imageOptimizer, outputPath, plan, bucketDomain, timeout]) =>
          all([
            servers.map((s) => ({ region: s.region, url: s.server!.url })),
            imageOptimizer?.url,
          ]).apply(([servers, imageOptimizerUrl]) => {
            const kvEntries: Record<string, string> = {};
            const dirs: string[] = [];
            // Router append .html and index.html suffixes to requests to s3 routes:
            // - `.well-known` contain files without suffix, hence will be appended .html
            // - in the future, it might make sense for each dir to have props that controls
            //   the suffixes ie. "handleTrailingSlashse"
            const expandDirs = [".well-known"];

            plan.assets.forEach((copy) => {
              const processDir = (childPath = "", level = 0) => {
                const currentPath = path.join(outputPath, copy.from, childPath);
                fs.readdirSync(currentPath, { withFileTypes: true }).forEach(
                  (item) => {
                    // File: add to kvEntries
                    if (item.isFile()) {
                      kvEntries[toPosix(path.join("/", childPath, item.name))] =
                        "s3";
                      return;
                    }
                    // Directory + deep routes: recursively process it
                    //   In Next.js, asset requests are prefixed with is /_next/static,
                    //   and image optimization requests are prefixed with /_next/image.
                    //   We cannot route by 1 level of subdirs (ie. /_next/`), so we need
                    //   to route by 2 levels of subdirs.
                    // Directory + expand: recursively process it
                    if (
                      level === 0 &&
                      (expandDirs.includes(item.name) ||
                        item.name === copy.deepRoute)
                    ) {
                      processDir(path.join(childPath, item.name), level + 1);
                      return;
                    }
                    // Directory + NOT expand: add to route
                    dirs.push(toPosix(path.join("/", childPath, item.name)));
                  },
                );
              };
              processDir();
            });

            kvEntries["metadata"] = JSON.stringify({
              base: plan.base,
              custom404: plan.custom404,
              s3: {
                domain: bucketDomain,
                dir: plan.assets[0].to ? "/" + plan.assets[0].to : "",
                routes: dirs,
              },
              image: imageOptimizerUrl
                ? {
                    host: new URL(imageOptimizerUrl!).host,
                    route: plan.imageOptimizer!.prefix,
                  }
                : undefined,
              servers: servers.map((s) => [
                new URL(s.url).host,
                supportedRegions[s.region as keyof typeof supportedRegions].lat,
                supportedRegions[s.region as keyof typeof supportedRegions].lon,
              ]),
              origin: {
                timeouts: {
                  readTimeout: toSeconds(timeout),
                },
              },
            } satisfies KV_SITE_METADATA);
            return kvEntries;
          }),
      );

      return new KvKeys(
        `${name}KvKeys`,
        {
          store: kvStoreArn!,
          namespace: kvNamespace,
          entries,
          purge,
        },
        { parent: self },
      );
    }

    function updateRouterKvRoutes() {
      return new KvRoutesUpdate(
        `${name}RoutesUpdate`,
        {
          store: route!.routerKvStoreArn,
          namespace: route!.routerKvNamespace,
          key: "routes",
          entry: route!.apply((route) =>
            ["site", kvNamespace, route!.hostPattern, route!.pathPrefix].join(
              ",",
            ),
          ),
        },
        { parent: self },
      );
    }

    function createInvalidation() {
      all([args.invalidation, outputPath, plan]).apply(
        ([invalidationRaw, outputPath, plan]) => {
          // Normalize invalidation
          if (invalidationRaw === false) return;
          const invalidation = {
            wait: false,
            paths: "all",
            ...invalidationRaw,
          };

          // We will generate a hash based on the contents of the S3 files with cache enabled.
          // This will be used to determine if we need to invalidate our CloudFront cache.
          const s3Origin = plan.assets;
          const cachedS3Files = s3Origin.filter((file) => file.cached);
          if (cachedS3Files.length === 0) return;

          // Build invalidation paths
          const invalidationPaths: string[] = [];
          if (invalidation.paths === "all") {
            invalidationPaths.push("/*");
          } else if (invalidation.paths === "versioned") {
            cachedS3Files.forEach((item) => {
              if (!item.versionedSubDir) return;
              invalidationPaths.push(
                toPosix(path.join("/", item.to, item.versionedSubDir, "*")),
              );
            });
          } else {
            invalidationPaths.push(...(invalidation?.paths || []));
          }
          if (invalidationPaths.length === 0) return;

          // Build build ID
          let invalidationBuildId: string;
          if (plan.buildId) {
            invalidationBuildId = plan.buildId;
          } else {
            const hash = crypto.createHash("md5");

            cachedS3Files.forEach((item) => {
              // The below options are needed to support following symlinks when building zip files:
              // - nodir: This will prevent symlinks themselves from being copied into the zip.
              // - follow: This will follow symlinks and copy the files within.

              // For versioned files, use file path for digest since file version in name should change on content change
              if (item.versionedSubDir) {
                globSync("**", {
                  dot: true,
                  nodir: true,
                  follow: true,
                  cwd: path.resolve(
                    outputPath,
                    item.from,
                    item.versionedSubDir,
                  ),
                }).forEach((filePath) => hash.update(filePath));
              }

              // For non-versioned files, use file content for digest
              if (invalidation.paths !== "versioned") {
                globSync("**", {
                  ignore: item.versionedSubDir
                    ? [toPosix(path.join(item.versionedSubDir, "**"))]
                    : undefined,
                  dot: true,
                  nodir: true,
                  follow: true,
                  cwd: path.resolve(outputPath, item.from),
                }).forEach((filePath) =>
                  hash.update(
                    fs.readFileSync(
                      path.resolve(outputPath, item.from, filePath),
                      "utf-8",
                    ),
                  ),
                );
              }
            });
            invalidationBuildId = hash.digest("hex");
          }

          new DistributionInvalidation(
            `${name}Invalidation`,
            {
              distributionId,
              paths: invalidationPaths,
              version: invalidationBuildId,
              wait: invalidation.wait,
            },
            {
              parent: self,
              dependsOn: [assetsUploaded, kvUpdated, ...invalidationDependsOn],
            },
          );
        },
      );
    }
  }

  /**
   * The URL of the Astro site.
   *
   * If the `domain` is set, this is the URL with the custom domain.
   * Otherwise, it's the auto-generated CloudFront URL.
   */
  public get url() {
    return all([this.prodUrl, this.devUrl]).apply(
      ([prodUrl, devUrl]) => (prodUrl ?? devUrl)!,
    );
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The AWS Lambda server function that renders the site.
       */
      server: this.server,
      /**
       * The Amazon S3 Bucket that stores the assets.
       */
      assets: this.bucket,
      /**
       * The Amazon CloudFront CDN that serves the site.
       */
      cdn: this.cdn,
    };
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
