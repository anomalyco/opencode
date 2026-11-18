import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  ComponentResourceOptions,
  Output,
  Resource,
  all,
  interpolate,
  output,
} from "@pulumi/pulumi";
import { Cdn, CdnArgs } from "./cdn.js";
import { Bucket, BucketArgs } from "./bucket.js";
import { Component, Prettify, Transform, transform } from "../component.js";
import { Link } from "../link.js";
import { Input } from "../input.js";
import { globSync } from "glob";
import { BucketFile, BucketFiles } from "./providers/bucket-files.js";
import { getContentType, BaseSiteDev } from "../base/base-site.js";
import {
  BaseStaticSiteArgs,
  BaseStaticSiteAssets,
  buildApp,
  prepare,
} from "../base/base-static-site.js";
import { cloudfront, getRegionOutput, s3 } from "@pulumi/aws";
import { URL_UNAVAILABLE } from "./linkable.js";
import { KvKeys } from "./providers/kv-keys.js";
import {
  CF_BLOCK_CLOUDFRONT_URL_INJECTION,
  CF_ROUTER_INJECTION,
  KV_SITE_METADATA,
  normalizeRouteArgs,
  RouterRouteArgs,
  RouterRouteArgsDeprecated,
} from "./router.js";
import { DistributionInvalidation } from "./providers/distribution-invalidation.js";
import { VisibleError } from "../error.js";
import { KvRoutesUpdate } from "./providers/kv-routes-update.js";
import { toPosix } from "../path.js";

export interface StaticSiteArgs extends BaseStaticSiteArgs {
  /**
   * Configure how this component works in `sst dev`.
   *
   * :::note
   * In `sst dev` your static site is run in dev mode; it's not deployed.
   * :::
   *
   * Instead of deploying your static site, this starts it in dev mode. It's run
   * as a separate process in the `sst dev` multiplexer. Read more about
   * [`sst dev`](/docs/reference/cli/#dev).
   *
   * To disable dev mode, pass in `false`.
   */
  dev?: false | Prettify<BaseSiteDev>;
  /**
   * Path to the directory where your static site is located. By default this assumes your static site is in the root of your SST app.
   *
   * This directory will be uploaded to S3. The path is relative to your `sst.config.ts`.
   *
   * :::note
   * If the `build` options are specified, `build.output` will be uploaded to S3 instead.
   * :::
   *
   * If you are using a static site generator, like Vite, you'll need to configure the `build` options. When these are set, the `build.output` directory will be uploaded to S3 instead.
   *
   * @default `"."`
   *
   * @example
   *
   * Change where your static site is located.
   *
   * ```js
   * {
   *   path: "packages/web"
   * }
   * ```
   */
  path?: BaseStaticSiteArgs["path"];
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
     *
     * By default, a viewer request function is created to:
     * - Disable CloudFront default URL if custom domain is set.
     * - Rewrite URLs to append `index.html` to the URL if the URL ends with a `/`.
     * - Rewrite URLs to append `.html` to the URL if the URL does not contain a file extension.
     *
     * @example
     *
     * You can pass in the code to inject into the function. The provided code will
     * be injected at the start of the function.
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
     * You can use this add basic auth, [check out an example](/docs/examples/#aws-static-site-basic-auth).
     */
    viewerRequest?: Input<{
      /**
       * The code to inject into the viewer request function.
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
      /**
       * @deprecated Use `kvStore` instead because CloudFront Functions only support one KV store.
       */
      kvStores?: Input<Input<string>[]>;
    }>;
    /**
     * Configure the viewer response function.
     *
     * The viewer response function can be used to modify outgoing responses before they
     * are sent to the client. For example, you can add security headers or change the response
     * status code.
     *
     * By default, no viewer response function is set. A new function will be created with
     * the provided code.
     *
     * @example
     *
     * You can pass in the code to inject into the function. And a CloudFront function will
     * be created with the provided code injected into it.
     *
     * ```js
     * async function handler(event) {
     *   // User injected code
     *
     *   return event.response;
     * }
     * ```
     *
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
    viewerResponse?: Input<{
      /**
       * The code to inject into the viewer response function.
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
       *   server: {
       *     edge: {
       *       viewerResponse: {
       *         kvStore: "arn:aws:cloudfront::123456789012:key-value-store/my-store"
       *       }
       *     }
       *   }
       * }
       * ```
       */
      kvStore?: Input<string>;
      /**
       * @deprecated Use `kvStore` instead because CloudFront Functions only support one KV store.
       */
      kvStores?: Input<Input<string>[]>;
    }>;
  }>;
  /**
   * Configure if your static site needs to be built. This is useful if you are using a static site generator.
   *
   * The `build.output` directory will be uploaded to S3 instead.
   * @example
   * For a Vite project using npm this might look like this.
   *
   * ```js
   * {
   *   build: {
   *     command: "npm run build",
   *     output: "dist"
   *   }
   * }
   * ```
   */
  build?: BaseStaticSiteArgs["build"];
  /**
   * Configure how the static site's assets are uploaded to S3.
   *
   * By default, this is set to the following. Read more about these options below.
   * ```js
   * {
   *   assets: {
   *     textEncoding: "utf-8",
   *     fileOptions: [
   *       {
   *         files: "**",
   *         cacheControl: "max-age=31536000,public,immutable"
   *       },
   *       {
   *         files: "**\/*.html",
   *         cacheControl: "max-age=0,no-cache,no-store,must-revalidate"
   *       }
   *     ]
   *   }
   * }
   * ```
   * @default `Object`
   */
  assets?: Prettify<
    BaseStaticSiteAssets & {
      /**
       * The name of the S3 bucket to upload the assets to.
       * @default Creates a new bucket
       * @example
       * ```js
       * {
       *   assets: {
       *     bucket: "my-existing-bucket"
       *   }
       * }
       * ```
       *
       * :::note
       * The bucket must allow CloudFront to access the bucket.
       * :::
       *
       * When using an existing bucket, ensure that the bucket has a policy that allows CloudFront to access the bucket.
       * For example, the bucket policy might look like this:
       * ```json
       * {
       *   "Version": "2012-10-17",
       *   "Statement": [
       *     {
       *       "Effect": "Allow",
       *       "Principal": {
       *         "Service": "cloudfront.amazonaws.com"
       *       },
       *       "Action": "s3:GetObject",
       *       "Resource": "arn:aws:s3:::my-existing-bucket/*"
       *     }
       *   ]
       * }
       * ```
       */
      bucket?: Input<string>;
      /**
       * The path into the S3 bucket where the assets should be uploaded.
       * @default Root of the bucket
       * @example
       * ```js
       * {
       *   assets: {
       *     path: "websites/my-website"
       *   }
       * }
       * ```
       */
      path?: Input<string>;
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
      /**
       * Configure additional asset routes for serving files directly from the S3 bucket.
       *
       * These routes allow files stored in specific S3 bucket paths to be served under the
       * same domain as your site. This is particularly useful for handling user-uploaded
       * content.
       *
       * @example
       * If user-uploaded files are stored in the `uploads` directory, and no `routes` are
       * configured, these files will return 404 errors or display the `errorPage` if set.
       * By including `uploads` in `routes`, all files in that folder will be served
       * directly from the S3 bucket.
       *
       * ```js
       * {
       *   assets: {
       *     routes: ["uploads"]
       *   }
       * }
       * ```
       */
      routes?: Input<Input<string>[]>;
    }
  >;
  /**
   * Set a custom domain for your static site. Supports domains hosted either on
   * [Route 53](https://aws.amazon.com/route53/) or outside AWS.
   *
   * :::tip
   * You can also migrate an externally hosted domain to Amazon Route 53 by
   * [following this guide](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/MigratingDNS.html).
   * :::
   *
   * @example
   *
   * ```js
   * {
   *   domain: "domain.com"
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
  domain?: CdnArgs["domain"];
  /**
   * @deprecated The `router` prop is now the recommended way to serve your site
   * through a `Router` component.
   */
  route?: Prettify<RouterRouteArgsDeprecated>;
  /**
   * Serve your static site through a `Router` instead of a standalone CloudFront
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
   * To serve your static site **from a path**, you'll need to configure the root domain
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
   * If you are using a static site generator make sure the base path is set in your
   * config.
   *
   * :::caution
   * If routing to a path, you need to configure that as the base path in your
   * static site generator as well.
   * :::
   *
   * For Vite, set the `base` option in your `vite.config.ts`. It should end with
   * a `/` to ensure asset paths like CSS and JS, are constructed correctly.
   *
   * ```js title="vite.config.ts" {2}
   * export default defineConfig({
   *   base: "/docs/"
   * });
   * ```
   *
   * To serve your static site **from a subdomain**, you'll need to configure the
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
   * Finally, to serve your static site **from a combined pattern** like
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
   * Also, make sure to set the base path in your static site generator
   * configuration, like above.
   */
  router?: Prettify<RouterRouteArgs>;
  /**
   * Configure how the CloudFront cache invalidations are handled. This is run after your static site has been deployed.
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
       * Waiting for the CloudFront cache invalidation process to finish ensures that the new content will be served once the deploy finishes. However, this process can sometimes take more than 5 mins.
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
       * You can either pass in an array of glob patterns to invalidate specific files. Or you can use the built-in option `all` to invalidation all files when any file changes.
       *
       * :::note
       * Invalidating `all` counts as one invalidation, while each glob pattern counts as a single invalidation path.
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
       */
      paths?: Input<"all" | string[]>;
    }
  >;
  /**
   * @deprecated The `route.path` prop is now the recommended way to configure the base
   * path for the site.
   */
  base?: Input<string>;
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
     * Transform the CloudFront CDN resource.
     */
    cdn?: Transform<CdnArgs>;
  };
}

/**
 * The `StaticSite` component lets you deploy a static website to AWS. It uses [Amazon S3](https://aws.amazon.com/s3/) to store your files and [Amazon CloudFront](https://aws.amazon.com/cloudfront/) to serve them.
 *
 * It can also `build` your site by running your static site generator, like [Vite](https://vitejs.dev) and uploading the build output to S3.
 *
 * @example
 *
 * #### Minimal example
 *
 * Simply uploads the current directory as a static site.
 *
 * ```js title="sst.config.ts"
 * new sst.aws.StaticSite("MyWeb");
 * ```
 *
 * #### Change the path
 *
 * Change the `path` that should be uploaded.
 *
 * ```js title="sst.config.ts"
 * new sst.aws.StaticSite("MyWeb", {
 *   path: "path/to/site"
 * });
 * ```
 *
 * #### Running locally
 *
 * In `sst dev`, we don't deploy your site to AWS because we assume you are running it locally.
 *
 * :::note
 * Your static site will not be deployed when run locally with `sst dev`.
 * :::
 *
 * For example, for a Vite site, you can run it locally with.
 *
 * ```bash
 * sst dev vite dev
 * ```
 *
 * This will start the Vite dev server and pass in any environment variables that you've set in your config. But it will not deploy your site to AWS.
 *
 * #### Deploy a Vite SPA
 *
 * Use [Vite](https://vitejs.dev) to deploy a React/Vue/Svelte/etc. SPA by specifying the `build` config.
 *
 * ```js title="sst.config.ts"
 * new sst.aws.StaticSite("MyWeb", {
 *   build: {
 *     command: "npm run build",
 *     output: "dist"
 *   }
 * });
 * ```
 *
 * #### Deploy a Jekyll site
 *
 * Use [Jekyll](https://jekyllrb.com) to deploy a static site.
 *
 * ```js title="sst.config.ts"
 * new sst.aws.StaticSite("MyWeb", {
 *   errorPage: "/404.html",
 *   build: {
 *     command: "bundle exec jekyll build",
 *     output: "_site"
 *   }
 * });
 * ```
 *
 * #### Deploy a Gatsby site
 *
 * Use [Gatsby](https://www.gatsbyjs.com) to deploy a static site.
 *
 * ```js title="sst.config.ts"
 * new sst.aws.StaticSite("MyWeb", {
 *   errorPage: "/404.html",
 *   build: {
 *     command: "npm run build",
 *     output: "public"
 *   }
 * });
 * ```
 *
 * #### Deploy an Angular SPA
 *
 * Use [Angular](https://angular.dev) to deploy a SPA.
 *
 * ```js title="sst.config.ts"
 * new sst.aws.StaticSite("MyWeb", {
 *   build: {
 *     command: "ng build --output-path dist",
 *     output: "dist"
 *   }
 * });
 * ```
 *
 * #### Add a custom domain
 *
 * Set a custom domain for your site.
 *
 * ```js {2} title="sst.config.ts"
 * new sst.aws.StaticSite("MyWeb", {
 *   domain: "my-app.com"
 * });
 * ```
 *
 * #### Redirect www to apex domain
 *
 * Redirect `www.my-app.com` to `my-app.com`.
 *
 * ```js {4} title="sst.config.ts"
 * new sst.aws.StaticSite("MyWeb", {
 *   domain: {
 *     name: "my-app.com",
 *     redirects: ["www.my-app.com"]
 *   }
 * });
 * ```
 *
 * #### Set environment variables
 *
 * Set `environment` variables for the build process of your static site. These will be used locally and on deploy.
 *
 * :::tip
 * For Vite, the types for the environment variables are also generated. This can be configured through the `vite` prop.
 * :::
 *
 * For some static site generators like Vite, [environment variables](https://vitejs.dev/guide/env-and-mode) prefixed with `VITE_` can be accessed in the browser.
 *
 * ```ts {5-7} title="sst.config.ts"
 * const bucket = new sst.aws.Bucket("MyBucket");
 *
 * new sst.aws.StaticSite("MyWeb", {
 *   environment: {
 *     BUCKET_NAME: bucket.name,
 *     // Accessible in the browser
 *     VITE_STRIPE_PUBLISHABLE_KEY: "pk_test_123"
 *   },
 *   build: {
 *     command: "npm run build",
 *     output: "dist"
 *   }
 * });
 * ```
 */
export class StaticSite extends Component implements Link.Linkable {
  private cdn?: Cdn;
  private bucket?: Bucket;
  private devUrl?: Output<string>;
  private prodUrl?: Output<string | undefined>;

  constructor(
    name: string,
    args: StaticSiteArgs = {},
    opts: ComponentResourceOptions = {},
  ) {
    super(__pulumiType, name, args, opts);
    const self = this;

    validateDeprecatedProps();
    const { sitePath, environment, indexPage } = prepare(args);
    const dev = normalizeDev();

    if (dev.enabled) {
      this.devUrl = dev.url;
      this.registerOutputs({
        _metadata: {
          mode: "placeholder",
          path: sitePath,
          environment,
          url: this.url,
        },
        _dev: dev.outputs,
      });
      return;
    }

    const route = normalizeRoute();
    const errorPage = normalizeErrorPage();
    const assets = normalizeAsssets();
    const outputPath = buildApp(self, name, args.build, sitePath, environment);
    const bucket = createBucket();
    const { bucketName, bucketDomain } = getBucketDetails();
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

    const kvUpdated = createKvEntries();
    createInvalidation();

    this.bucket = bucket;
    this.cdn = distribution;
    this.prodUrl = prodUrl;

    this.registerOutputs({
      _hint: this.url,
      _metadata: {
        mode: "deployed",
        path: sitePath,
        environment,
        url: this.url,
      },
      _dev: dev.outputs,
    });

    function validateDeprecatedProps() {
      if (args.base !== undefined)
        throw new VisibleError(
          `"base" prop is deprecated. Use the "route.path" prop instead to set the base path of the site.`,
        );

      if (args.cdn !== undefined)
        throw new VisibleError(
          `"cdn" prop is deprecated. Use the "route.router" prop instead to use an existing "Router" component to serve your site.`,
        );
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

    function normalizeDev() {
      const enabled = $dev && args.dev !== false;
      const devArgs = args.dev || {};

      return {
        enabled,
        url: output(devArgs.url ?? URL_UNAVAILABLE),
        outputs: {
          title: devArgs.title,
          environment,
          command: output(devArgs.command ?? "npm run dev"),
          autostart: output(devArgs.autostart ?? true),
          directory: output(devArgs.directory ?? sitePath),
        },
      };
    }

    function normalizeErrorPage() {
      return all([indexPage, args.errorPage]).apply(
        ([indexPage, errorPage]) => {
          return "/" + (errorPage ?? indexPage).replace(/^\//, "");
        },
      );
    }

    function normalizeAsssets() {
      return {
        ...args.assets,
        // remove leading and trailing slashes from the path
        path: args.assets?.path
          ? output(args.assets?.path).apply((v) =>
            v.replace(/^\//, "").replace(/\/$/, ""),
          )
          : undefined,
        purge: output(args.assets?.purge ?? true),
        // normalize to /path format
        routes: args.assets?.routes
          ? output(args.assets?.routes).apply((v) =>
            v.map(
              (route) => "/" + route.replace(/^\//, "").replace(/\/$/, ""),
            ),
          )
          : [],
      };
    }

    function createBucket() {
      if (assets.bucket) return;

      return new Bucket(
        ...transform(
          args.transform?.assets,
          `${name}Assets`,
          { access: "cloudfront" },
          { parent: self, retainOnDelete: false },
        ),
      );
    }

    function getBucketDetails() {
      const s3Bucket = bucket
        ? bucket.nodes.bucket
        : s3.BucketV2.get(`${name}Assets`, assets.bucket!, undefined, {
          parent: self,
        });

      return {
        bucketName: s3Bucket.bucket,
        bucketDomain: s3Bucket.bucketRegionalDomainName,
      };
    }

    function uploadAssets() {
      return all([outputPath, assets, route]).apply(
        async ([outputPath, assets, route]) => {
          const bucketFiles: BucketFile[] = [];

          // Build fileOptions
          const fileOptions = assets?.fileOptions ?? [
            {
              files: "**",
              cacheControl: "max-age=31536000,public,immutable",
            },
            {
              files: "**/*.html",
              cacheControl: "max-age=0,no-cache,no-store,must-revalidate",
            },
          ];

          // Upload files based on fileOptions
          const filesProcessed: string[] = [];
          for (const fileOption of fileOptions.reverse()) {
            const files = globSync(fileOption.files, {
              cwd: path.resolve(outputPath),
              nodir: true,
              dot: true,
              ignore: [
                ".sst/**",
                ...(typeof fileOption.ignore === "string"
                  ? [fileOption.ignore]
                  : fileOption.ignore ?? []),
              ],
            }).filter((file) => !filesProcessed.includes(file));

            bucketFiles.push(
              ...(await Promise.all(
                files.map(async (file) => {
                  const source = path.resolve(outputPath, file);
                  const content = await fs.promises.readFile(source, "utf-8");
                  const hash = crypto
                    .createHash("sha256")
                    .update(content)
                    .digest("hex");
                  return {
                    source,
                    key: toPosix(
                      path.join(
                        assets.path ?? "",
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
            filesProcessed.push(...files);
          }

          return new BucketFiles(
            `${name}AssetFiles`,
            {
              bucketName,
              files: bucketFiles,
              purge: assets.purge,
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
        outputPath,
        assets,
        bucketDomain,
        errorPage,
        route,
      ]).apply(async ([outputPath, assets, bucketDomain, errorPage, route]) => {
        const kvEntries: Record<string, string> = {};
        const dirs: string[] = [];
        // Router append .html and index.html suffixes to requests to s3 routes:
        // - `.well-known` contain files without suffix, hence will be appended .html
        // - in the future, it might make sense for each dir to have props that controls
        //   the suffixes ie. "handleTrailingSlashse"
        const expandDirs = [".well-known"];

        const processDir = (childPath = "", level = 0) => {
          const currentPath = path.join(outputPath, childPath);
          fs.readdirSync(currentPath, { withFileTypes: true }).forEach(
            (item) => {
              // File: add to kvEntries
              if (item.isFile()) {
                kvEntries[toPosix(path.join("/", childPath, item.name))] = "s3";
                return;
              }
              // Directory + expand: recursively process it
              if (level === 0 && expandDirs.includes(item.name)) {
                processDir(path.join(childPath, item.name), level + 1);
                return;
              }
              // Directory + NOT expand: add to route
              dirs.push(toPosix(path.join("/", childPath, item.name)));
            },
          );
        };
        processDir();

        kvEntries["metadata"] = JSON.stringify({
          base: route?.pathPrefix === "/" ? undefined : route?.pathPrefix,
          custom404: errorPage,
          s3: {
            domain: bucketDomain,
            dir: assets.path ? "/" + assets.path : "",
            routes: [...assets.routes, ...dirs],
          },
        } satisfies KV_SITE_METADATA);

        return kvEntries;
      });

      return new KvKeys(
        `${name}KvKeys`,
        {
          store: kvStoreArn!,
          namespace: kvNamespace,
          entries,
          purge: assets.purge,
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

    function createRequestKvStore() {
      return output(args.edge).apply((edge) => {
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
      return output(args.edge).apply((edge) => {
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
      return output(args.edge).apply((edge) => {
        const userConfig = edge?.viewerResponse;
        const userInjection = userConfig?.injection;
        const kvStoreArn = userConfig?.kvStore ?? userConfig?.kvStores?.[0];

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
            comment: `${name} site`,
            domain: args.domain,
            origins: [
              {
                originId: "default",
                domainName: "placeholder.sst.dev",
                customOriginConfig: {
                  httpPort: 80,
                  httpsPort: 443,
                  originProtocolPolicy: "https-only",
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
              // CloudFront's managed CachingOptimized policy
              cachePolicyId: "658327ea-f89d-4fab-a63d-7e88639e58f6",
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

    function createInvalidation() {
      all([outputPath, args.assets, args.invalidation]).apply(
        ([outputPath, assets, invalidationRaw]) => {
          // Normalize invalidation
          if (invalidationRaw === false) return;
          const invalidation = {
            wait: false,
            paths: "all" as const,
            ...invalidationRaw,
          };

          // Build invalidation paths
          const invalidationPaths =
            invalidation.paths === "all" ? ["/*"] : invalidation.paths;
          if (invalidationPaths.length === 0) return;

          // Calculate a hash based on the contents of the S3 files. This will be
          // used to determine if we need to invalidate our CloudFront cache.
          //
          // The below options are needed to support following symlinks when building zip files:
          // - nodir: This will prevent symlinks themselves from being copied into the zip.
          // - follow: This will follow symlinks and copy the files within.
          const hash = crypto.createHash("md5");
          hash.update(JSON.stringify(assets ?? {}));
          globSync("**", {
            dot: true,
            nodir: true,
            follow: true,
            cwd: path.resolve(outputPath),
          }).forEach((filePath) =>
            hash.update(
              fs.readFileSync(path.resolve(outputPath, filePath), "utf-8"),
            ),
          );

          new DistributionInvalidation(
            `${name}Invalidation`,
            {
              distributionId,
              paths: invalidationPaths,
              version: hash.digest("hex"),
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
   * The URL of the website.
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

const __pulumiType = "sst:aws:StaticSite";
// @ts-expect-error
StaticSite.__pulumiType = __pulumiType;
