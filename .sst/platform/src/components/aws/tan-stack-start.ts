import fs from "fs";
import path from "path";
import { ComponentResourceOptions, Output } from "@pulumi/pulumi";
import { VisibleError } from "../error.js";
import { Plan, SsrSite, SsrSiteArgs } from "./ssr-site.js";
import { RouterRouteArgs } from "./router.js";
import { Prettify } from "../component.js";

export interface TanStackStartArgs extends SsrSiteArgs {
  /**
   * Configure how this component works in `sst dev`.
   *
   * Instead of deploying your TanStack Start app, this starts it in dev mode. It's run
   * as a separate process in the `sst dev` multiplexer. Read more about
   * [`sst dev`](/docs/reference/cli/#dev).
   *
   * To disable dev mode, pass in `false`.
   */
  dev?: SsrSiteArgs["dev"];
  /**
   * Permissions and the resources that the [server function](#nodes-server) in your TanStack Start app needs to access. These permissions are used to create the function's IAM role.
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
   * Path to the directory where your TanStack Start app is located.  This path is relative to your `sst.config.ts`.
   *
   * By default it assumes your TanStack Start app is in the root of your SST app.
   * @default `"."`
   *
   * @example
   *
   * If your TanStack Start app is in a package in your monorepo.
   *
   * ```js
   * {
   *   path: "packages/web"
   * }
   * ```
   */
  path?: SsrSiteArgs["path"];
  /**
   * [Link resources](/docs/linking/) to your TanStack Start app. This will:
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
   * Configure how the CloudFront cache invalidations are handled. This is run after your TanStack Start app has been deployed.
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
   * Set in your TanStack Start app. These are made available:
   *
   * 1. In `vinxi build`, they are loaded into `process.env`.
   * 2. Locally while running `sst dev vinxi dev`.
   *
   * :::tip
   * You can also `link` resources to your TanStack Start app and access them in a type-safe way with the [SDK](/docs/reference/sdk/). We recommend linking since it's more secure.
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
   * Set a custom domain for your TanStack Start app.
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
   * Serve your TanStack Start app through a `Router` instead of a standalone CloudFront
   * distribution.
   *
   * By default, this component creates a new CloudFront distribution. But you might
   * want to serve it through the distribution of your `Router`.
   *
   * :::note
   * TanStack Start does not currently support base paths and can only be routed
   * from the root `/` path.
   * :::
   *
   * To serve your TanStack Start app **from a subdomain**, you'll need to
   * configure the domain in your `Router` component to match both the root and the
   * subdomain.
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
   */
  router?: Prettify<Omit<RouterRouteArgs, "path">>;
  /**
   * The command used internally to build your TanStack Start app.
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
   * Configure how the TanStack Start app assets are uploaded to S3.
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
   * Configure the TanStack Start app to use an existing CloudFront cache policy.
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
 * The `TanStackStart` component lets you deploy a [TanStack Start](https://tanstack.com/start/latest) app to AWS.
 *
 * :::note
 * You need to make sure the `server.preset` value in the `app.config.ts` is set to `aws-lambda`.
 * :::
 *
 * @example
 *
 * #### Minimal example
 *
 * Deploy a TanStack Start app that's in the project root.
 *
 * ```js title="sst.config.ts"
 * new sst.aws.TanStackStart("MyWeb");
 * ```
 *
 * #### Change the path
 *
 * Deploys the TanStack Start app in the `my-app/` directory.
 *
 * ```js {2} title="sst.config.ts"
 * new sst.aws.TanStackStart("MyWeb", {
 *   path: "my-app/"
 * });
 * ```
 *
 * #### Add a custom domain
 *
 * Set a custom domain for your TanStack Start app.
 *
 * ```js {2} title="sst.config.ts"
 * new sst.aws.TanStackStart("MyWeb", {
 *   domain: "my-app.com"
 * });
 * ```
 *
 * #### Redirect www to apex domain
 *
 * Redirect `www.my-app.com` to `my-app.com`.
 *
 * ```js {4} title="sst.config.ts"
 * new sst.aws.TanStackStart("MyWeb", {
 *   domain: {
 *     name: "my-app.com",
 *     redirects: ["www.my-app.com"]
 *   }
 * });
 * ```
 *
 * #### Link resources
 *
 * [Link resources](/docs/linking/) to your TanStack Start app. This will grant permissions
 * to the resources and allow you to access it in your app.
 *
 * ```ts {4} title="sst.config.ts"
 * const bucket = new sst.aws.Bucket("MyBucket");
 *
 * new sst.aws.TanStackStart("MyWeb", {
 *   link: [bucket]
 * });
 * ```
 *
 * You can use the [SDK](/docs/reference/sdk/) to access the linked resources
 * in your TanStack Start app.
 *
 * ```ts title="src/app.tsx"
 * import { Resource } from "sst";
 *
 * console.log(Resource.MyBucket.name);
 * ```
 */
export class TanStackStart extends SsrSite {
  constructor(
    name: string,
    args: TanStackStartArgs = {},
    opts: ComponentResourceOptions = {},
  ) {
    super(__pulumiType, name, args, opts);
  }

  protected normalizeBuildCommand() { }

  protected buildPlan(outputPath: Output<string>): Output<Plan> {
    return outputPath.apply((outputPath) => {
      const nitro = JSON.parse(
        fs.readFileSync(
          path.join(outputPath, ".output", "nitro.json"),
          "utf-8",
        ),
      );

      if (!["aws-lambda"].includes(nitro.preset)) {
        throw new VisibleError(
          `TanStackStart's app.config.ts must be configured to use the "aws-lambda" preset. It is currently set to "${nitro.preset}".`,
        );
      }

      const serverOutputPath = path.join(outputPath, ".output", "server");

      // If basepath is configured, nitro.mjs will have a line that looks like this:
      // return createRouter$2({ routeTree: Nr, defaultPreload: "intent", defaultErrorComponent: ce, defaultNotFoundComponent: () => jsx(de, {}), scrollRestoration: true, basepath: "/tan" });
      let basepath;
      // TanStack Start currently doesn't support basepaths.
      //try {
      //  const serverNitroChunk = fs.readFileSync(
      //    path.join(serverOutputPath, "chunks", "nitro", "nitro.mjs"),
      //    "utf-8",
      //  );
      //  basepath = serverNitroChunk.match(/basepath: "(.*)"/)?.[1];
      //} catch (e) {}

      // Remove the .output/public/_server directory from the assets
      // b/c all `_server` requests should go to the server function. If this folder is
      // not removed, it will create an s3 route that conflicts with the `_server` route.
      fs.rmSync(path.join(outputPath, ".output", "public", "_server"), {
        recursive: true,
        force: true,
      });
      fs.rmSync(path.join(outputPath, ".output", "public", "api"), {
        recursive: true,
        force: true,
      });

      return {
        base: basepath,
        server: {
          description: "Server handler for TanStack",
          handler: "index.handler",
          bundle: serverOutputPath,
          streaming: nitro?.config?.awsLambda?.streaming === true,
        },
        assets: [
          {
            from: path.join(".output", "public"),
            to: "",
            cached: true,
          },
        ],
      };
    });
  }

  /**
   * The URL of the TanStack Start app.
   *
   * If the `domain` is set, this is the URL with the custom domain.
   * Otherwise, it's the auto-generated CloudFront URL.
   */
  public get url() {
    return super.url;
  }
}

const __pulumiType = "sst:aws:TanstackStart";
// @ts-expect-error
TanStackStart.__pulumiType = __pulumiType;
