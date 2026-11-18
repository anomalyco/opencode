import fs from "fs";
import path from "path";
import { ComponentResourceOptions, Output } from "@pulumi/pulumi";
import { isALtB } from "../../util/compare-semver.js";
import { VisibleError } from "../error.js";
import { Plan, SsrSite, SsrSiteArgs } from "./ssr-site.js";

export interface AstroArgs extends SsrSiteArgs {
  /**
   * Configure how this component works in `sst dev`.
   *
   * :::note
   * In `sst dev` your Astro site is run in dev mode; it's not deployed.
   * :::
   *
   * Instead of deploying your Astro site, this starts it in dev mode. It's run
   * as a separate process in the `sst dev` multiplexer. Read more about
   * [`sst dev`](/docs/reference/cli/#dev).
   *
   * To disable dev mode, pass in `false`.
   */
  dev?: SsrSiteArgs["dev"];
  /**
   * Permissions and the resources that the [server function](#nodes-server) in your Astro site needs to access. These permissions are used to create the function's IAM role.
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
   *     }
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
   *     }
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
   *     }
   *   ]
   * }
   * ```
   */
  permissions?: SsrSiteArgs["permissions"];
  /**
   * Path to the directory where your Astro site is located.  This path is relative to your `sst.config.ts`.
   *
   * By default it assumes your Astro site is in the root of your SST app.
   * @default `"."`
   *
   * @example
   *
   * If your Astro site is in a package in your monorepo.
   *
   * ```js
   * {
   *   path: "packages/web"
   * }
   * ```
   */
  path?: SsrSiteArgs["path"];
  /**
   * [Link resources](/docs/linking/) to your Astro site. This will:
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
   * Configure how the CloudFront cache invalidations are handled. This is run after your Astro site has been deployed.
   * :::tip
   * You get 1000 free invalidations per month. After that you pay $0.005 per invalidation path. [Read more here](https://aws.amazon.com/cloudfront/pricing/).
   * :::
   * @default `{paths: "all", wait: false}`
   * @example
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
   * Set [environment variables](https://docs.astro.build/en/guides/environment-variables/) in your Astro site. These are made available:
   *
   * 1. In `astro build`, they are loaded into `import.meta.env`.
   * 2. Locally while running `astro dev` through `sst dev`.
   *
   * :::tip
   * You can also `link` resources to your Astro site and access them in a type-safe way with the [SDK](/docs/reference/sdk/). We recommend linking since it's more secure.
   * :::
   *
   * Recall that in Astro, you need to prefix your environment variables with `PUBLIC_` to access them on the client-side. [Read more here](https://docs.astro.build/en/guides/environment-variables/).
   *
   * @example
   * ```js
   * {
   *   environment: {
   *     API_URL: api.url,
   *     // Accessible on the client-side
   *     PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_123"
   *   }
   * }
   * ```
   */
  environment?: SsrSiteArgs["environment"];
  /**
   * Set a custom domain for your Astro site.
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
   * Serve your Astro site through a `Router` instead of a standalone CloudFront
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
   * To serve your Astro site **from a path**, you'll need to configure the root domain
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
   * You also need to set the
   * [`base`](https://docs.astro.build/en/reference/configuration-reference/#base)
   * in your `astro.config.mjs`.
   *
   * :::caution
   * If routing to a path, you need to set that as the base path in your Astro
   * site as well.
   * :::
   *
   * ```js title="astro.config.mjs" {3}
   * export default defineConfig({
   *   adapter: sst(),
   *   base: "/docs"
   * });
   * ```
   *
   * To serve your Astro site **from a subdomain**, you'll need to configure the
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
   * Finally, to serve your Astro site **from a combined pattern** like
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
   * Also, make sure to set this as the `base` in your `astro.config.mjs`, like
   * above.
   */
  router?: SsrSiteArgs["router"];
  /**
   * The command used internally to build your Astro site.
   *
   * @default `"npm run build"`
   *
   * @example
   *
   * If you want to use a different build command.
   * ```js
   * {
   *   buildCommand: "yarn build"
   * }
   * ```
   */
  buildCommand?: SsrSiteArgs["buildCommand"];
  /**
   * Configure how the Astro site assets are uploaded to S3.
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
   */
  assets?: SsrSiteArgs["assets"];
  /**
   * Configure the Astro site to use an existing CloudFront cache policy.
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
 * The `Astro` component lets you deploy an [Astro](https://astro.build) site to AWS.
 *
 * @example
 *
 * #### Minimal example
 *
 * Deploy the Astro site that's in the project root.
 *
 * ```js title="sst.config.ts"
 * new sst.aws.Astro("MyWeb");
 * ```
 *
 * #### Change the path
 *
 * Deploys the Astro site in the `my-astro-app/` directory.
 *
 * ```js {2} title="sst.config.ts"
 * new sst.aws.Astro("MyWeb", {
 *   path: "my-astro-app/"
 * });
 * ```
 *
 * #### Add a custom domain
 *
 * Set a custom domain for your Astro site.
 *
 * ```js {2} title="sst.config.ts"
 * new sst.aws.Astro("MyWeb", {
 *   domain: "my-app.com"
 * });
 * ```
 *
 * #### Redirect www to apex domain
 *
 * Redirect `www.my-app.com` to `my-app.com`.
 *
 * ```js {4} title="sst.config.ts"
 * new sst.aws.Astro("MyWeb", {
 *   domain: {
 *     name: "my-app.com",
 *     redirects: ["www.my-app.com"]
 *   }
 * });
 * ```
 *
 * #### Link resources
 *
 * [Link resources](/docs/linking/) to your Astro site. This will grant permissions
 * to the resources and allow you to access it in your site.
 *
 * ```ts {4} title="sst.config.ts"
 * const bucket = new sst.aws.Bucket("MyBucket");
 *
 * new sst.aws.Astro("MyWeb", {
 *   link: [bucket]
 * });
 * ```
 *
 * You can use the [SDK](/docs/reference/sdk/) to access the linked resources
 * in your Astro site.
 *
 * ```astro title="src/pages/index.astro"
 * ---
 * import { Resource } from "sst";
 *
 * console.log(Resource.MyBucket.name);
 * ---
 * ```
 */
export class Astro extends SsrSite {
  constructor(
    name: string,
    args: AstroArgs = {},
    opts: ComponentResourceOptions = {},
  ) {
    super(__pulumiType, name, args, opts);
  }

  protected normalizeBuildCommand() { }

  protected buildPlan(outputPath: Output<string>): Output<Plan> {
    return outputPath.apply((outputPath) => {
      const BUILD_META_FILE_NAME = "sst.buildMeta.json";
      const filePath = path.join(outputPath, "dist", BUILD_META_FILE_NAME);
      if (!fs.existsSync(filePath)) {
        throw new VisibleError(
          `Build metadata file not found at "${filePath}". Update your "astro-sst" adapter and rebuild your Astro site.`,
        );
      }
      const buildMeta = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
        base: string;
        pluginVersion: string;
        outputMode: "server" | "static";
        responseMode: "stream" | "buffer";
        clientBuildOutputDir: string;
        clientBuildVersionedSubDir: string;
      };
      const serverOutputPath = path.join(outputPath, "dist", "server");

      if (
        buildMeta.pluginVersion === undefined ||
        isALtB(buildMeta.pluginVersion, "3.1.2")
      ) {
        throw new VisibleError(
          `Incompatible "astro-sst" adapter version detected. The Astro component requires "astro-sst" adapter version 3.1.2 or later.`,
        );
      }

      // Note about handling 404 pages. Here is Astro's behavior:
      // - when static/prerendered, Astro builds a /404.html file in the client build output dir
      // - when SSR, Astro server handles /404 route
      //
      // We could handle the /404.html with CloudFront's custom error response feature, but that will not work when routing the Astro through the `Router` component. It does not make sense for `Router` to have a custom error response shared across all routes (ie. API). Each route's 404 behavior are different.
      //
      // So here is what we do when a request comes in for ie. /garbage:
      //
      // - Case 1: static (no server) => In CF function S3 look up will fail, and uri will rewrite to /404.html
      //   x that's why we set `plan.custom404` to `/404.html`
      //
      // - Case 2: prerendered (has server) => In CF function S3 look up will fail, and request will be sent to the server function. Server fails to serve /garbage, and cannot find the route. Server tries to serve /404, and cannot find the route. Server finally serves the 404.html file manually bundled into it.
      //   x that's why we configure `plan.server.copyFiles` include /404.html
      //
      // - Case 3: SSR (has server) => In CF function S3 look up will fail, and request is sent to the server function. Server fails to serve /garbage, and cannot find the route. Server tries to serve /404.
      const isStatic = buildMeta.outputMode === "static";
      const base = buildMeta.base === "/" ? undefined : buildMeta.base;
      return {
        base,
        server: isStatic
          ? undefined
          : {
            handler: path.join(serverOutputPath, "entry.handler"),
            nodejs: { install: ["sharp"] },
            streaming: buildMeta.responseMode === "stream",
            copyFiles: fs.existsSync(path.join(serverOutputPath, "404.html"))
              ? [
                {
                  from: path.join(serverOutputPath, "404.html"),
                  to: "404.html",
                },
              ]
              : [],
          },
        assets: [
          {
            from: buildMeta.clientBuildOutputDir,
            to: "",
            cached: true,
            versionedSubDir: buildMeta.clientBuildVersionedSubDir,
          },
        ],
        custom404:
          isStatic &&
            fs.existsSync(
              path.join(outputPath, buildMeta.clientBuildOutputDir, "404.html"),
            )
            ? "/404.html"
            : undefined,
      };
    });
  }

  /**
   * The URL of the Astro site.
   *
   * If the `domain` is set, this is the URL with the custom domain.
   * Otherwise, it's the auto-generated CloudFront URL.
   */
  public get url() {
    return super.url;
  }
}
const __pulumiType = "sst:aws:Astro";
// @ts-expect-error
Astro.__pulumiType = __pulumiType;
