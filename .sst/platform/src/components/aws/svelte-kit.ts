import fs from "fs";
import path from "path";
import { ComponentResourceOptions, Output } from "@pulumi/pulumi";
import { Plan, SsrSite, SsrSiteArgs } from "./ssr-site.js";

export interface SvelteKitArgs extends SsrSiteArgs {
  /**
   * Configure how this component works in `sst dev`.
   *
   * :::note
   * In `sst dev` your SvelteKit app is run in dev mode; it's not deployed.
   * :::
   *
   * Instead of deploying your SvelteKit app, this starts it in dev mode. It's run
   * as a separate process in the `sst dev` multiplexer. Read more about
   * [`sst dev`](/docs/reference/cli/#dev).
   *
   * To disable dev mode, pass in `false`.
   */
  dev?: SsrSiteArgs["dev"];
  /**
   * Permissions and the resources that the [server function](#nodes-server) in your SvelteKit app needs to access. These permissions are used to create the function's IAM role.
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
   * Path to the directory where your SvelteKit app is located.  This path is relative to your `sst.config.ts`.
   *
   * By default it assumes your SvelteKit app is in the root of your SST app.
   * @default `"."`
   *
   * @example
   *
   * If your SvelteKit app is in a package in your monorepo.
   *
   * ```js
   * {
   *   path: "packages/web"
   * }
   * ```
   */
  path?: SsrSiteArgs["path"];
  /**
   * [Link resources](/docs/linking/) to your SvelteKit app. This will:
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
   * Configure how the CloudFront cache invalidations are handled. This is run after your SvelteKit app has been deployed.
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
   * Set [environment variables](https://vitejs.dev/guide/env-and-mode.html#env-files) in your SvelteKit app. These are made available:
   *
   * 1. In `vite build`, they are loaded into `process.env`.
   * 2. Locally while running through `sst dev`.
   *
   * :::tip
   * You can also `link` resources to your SvelteKit app and access them in a type-safe way with the [SDK](/docs/reference/sdk/). We recommend linking since it's more secure.
   * :::
   *
   * @example
   * ```js
   * {
   *   environment: {
   *     API_URL: api.url,
   *     STRIPE_PUBLISHABLE_KEY: "pk_test_123"
   *   }
   * }
   * ```
   */
  environment?: SsrSiteArgs["environment"];
  /**
   * Set a custom domain for your SvelteKit app.
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
   * Serve your SvelteKit app through a `Router` instead of a standalone CloudFront
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
   * To serve your SvelteKit app **from a path**, you'll need to configure the root domain
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
   * You also need to set the [`base`](https://kit.svelte.dev/docs/configuration#paths)
   * to `/docs` in your `svelte.config.js` without a trailing slash.
   *
   * :::caution
   * If routing to a path, you need to set that as the base path in your
   * SvelteKit app as well.
   * :::
   *
   * ```js title="svelte.config.js" {4}
   * export default {
   *   kit: {
   *     paths: {
   *       base: "/docs"
   *     }
   *   }
   * };
   * ```
   *
   * To serve your SvelteKit app **from a subdomain**, you'll need to configure the
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
   * Finally, to serve your SvelteKit app **from a combined pattern** like
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
   * Also, make sure to set the base path in your `svelte.config.js`, like above.
   */
  router?: SsrSiteArgs["router"];
  /**
   * The command used internally to build your SvelteKit app.
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
   * Configure how the SvelteKit app assets are uploaded to S3.
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
   * Configure the SvelteKit app to use an existing CloudFront cache policy.
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
 * The `SvelteKit` component lets you deploy a [SvelteKit](https://kit.svelte.dev/) app to AWS.
 *
 * @example
 *
 * #### Minimal example
 *
 * Deploy a SvelteKit app that's in the project root.
 *
 * ```js title="sst.config.ts"
 * new sst.aws.SvelteKit("MyWeb");
 * ```
 *
 * #### Change the path
 *
 * Deploys the SvelteKit app in the `my-svelte-app/` directory.
 *
 * ```js {2} title="sst.config.ts"
 * new sst.aws.SvelteKit("MyWeb", {
 *   path: "my-svelte-app/"
 * });
 * ```
 *
 * #### Add a custom domain
 *
 * Set a custom domain for your SvelteKit app.
 *
 * ```js {2} title="sst.config.ts"
 * new sst.aws.SvelteKit("MyWeb", {
 *   domain: "my-app.com"
 * });
 * ```
 *
 * #### Redirect www to apex domain
 *
 * Redirect `www.my-app.com` to `my-app.com`.
 *
 * ```js {4} title="sst.config.ts"
 * new sst.aws.SvelteKit("MyWeb", {
 *   domain: {
 *     name: "my-app.com",
 *     redirects: ["www.my-app.com"]
 *   }
 * });
 * ```
 *
 * #### Link resources
 *
 * [Link resources](/docs/linking/) to your SvelteKit app. This will grant permissions
 * to the resources and allow you to access it in your app.
 *
 * ```ts {4} title="sst.config.ts"
 * const bucket = new sst.aws.Bucket("MyBucket");
 *
 * new sst.aws.SvelteKit("MyWeb", {
 *   link: [bucket]
 * });
 * ```
 *
 * You can use the [SDK](/docs/reference/sdk/) to access the linked resources
 * in your SvelteKit app.
 *
 * ```ts title="src/routes/+page.server.ts"
 * import { Resource } from "sst";
 *
 * console.log(Resource.MyBucket.name);
 * ```
 */
export class SvelteKit extends SsrSite {
  constructor(
    name: string,
    args: SvelteKitArgs = {},
    opts: ComponentResourceOptions = {},
  ) {
    super(__pulumiType, name, args, opts);
  }

  protected normalizeBuildCommand() { }

  protected buildPlan(outputPath: Output<string>): Output<Plan> {
    return outputPath.apply((outputPath) => {
      const serverOutputPath = path.join(
        outputPath,
        ".svelte-kit",
        "svelte-kit-sst",
        "server",
      );
      let basepath: string | undefined;
      try {
        const manifest = fs
          .readFileSync(path.join(serverOutputPath, "manifest.js"))
          .toString();
        const appDir = manifest.match(/appDir: "(.+?)"/)?.[1];
        const appPath = manifest.match(/appPath: "(.+?)"/)?.[1];
        if (appDir && appPath && appPath.endsWith(appDir)) {
          basepath = appPath.substring(0, appPath.length - appDir.length);
        }
      } catch (e) { }

      return {
        base: basepath,
        server: {
          handler: path.join(
            serverOutputPath,
            "lambda-handler",
            "index.handler",
          ),
          nodejs: {
            esbuild: {
              minify: process.env.SST_DEBUG ? false : true,
              sourcemap: process.env.SST_DEBUG ? ("inline" as const) : false,
              define: {
                "process.env.SST_DEBUG": process.env.SST_DEBUG
                  ? "true"
                  : "false",
              },
            },
          },
          copyFiles: [
            {
              from: path.join(
                outputPath,
                ".svelte-kit",
                "svelte-kit-sst",
                "prerendered",
              ),
              to: "prerendered",
            },
          ],
        },
        assets: [
          {
            from: path.join(".svelte-kit", "svelte-kit-sst", "client"),
            to: "",
            cached: true,
            versionedSubDir: "_app",
          },
          {
            from: path.join(".svelte-kit", "svelte-kit-sst", "prerendered"),
            to: "",
            cached: false,
          },
        ],
      };
    });
  }

  /**
   * The URL of the SvelteKit app.
   *
   * If the `domain` is set, this is the URL with the custom domain.
   * Otherwise, it's the auto-generated CloudFront URL.
   */
  public get url() {
    return super.url;
  }
}

const __pulumiType = "sst:aws:SvelteKit";
// @ts-expect-error
SvelteKit.__pulumiType = __pulumiType;
