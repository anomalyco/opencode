import fs from "fs";
import path from "path";
import { ComponentResourceOptions, Output, output } from "@pulumi/pulumi";
import { Plan, SsrSite, SsrSiteArgs } from "./ssr-site.js";

export interface ReactArgs extends SsrSiteArgs {
  /**
   * Configure how this component works in `sst dev`.
   *
   * :::note
   * In `sst dev` your React app is run in dev mode; it's not deployed.
   * :::
   *
   * Instead of deploying your React app, this starts it in dev mode. It's run
   * as a separate process in the `sst dev` multiplexer. Read more about
   * [`sst dev`](/docs/reference/cli/#dev).
   *
   * To disable dev mode, pass in `false`.
   */
  dev?: SsrSiteArgs["dev"];
  /**
   * Permissions and the resources that the [server function](#nodes-server) in your React app needs to access. These permissions are used to create the function's IAM role.
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
   * Path to the directory where your React app is located.  This path is relative to your `sst.config.ts`.
   *
   * By default it assumes your React app is in the root of your SST app.
   * @default `"."`
   *
   * @example
   *
   * If your React app is in a package in your monorepo.
   *
   * ```js
   * {
   *   path: "packages/web"
   * }
   * ```
   */
  path?: SsrSiteArgs["path"];
  /**
   * [Link resources](/docs/linking/) to your React app. This will:
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
   * Configure how the CloudFront cache invalidations are handled. This is run after your React app has been deployed.
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
   * Set [environment variables](https://vitejs.dev/guide/env-and-mode) in your React app. These are made available:
   *
   * 1. In `react-router build`, they are loaded into `process.env`.
   * 2. Locally while running `react-router dev` through `sst dev`.
   *
   * :::tip
   * You can also `link` resources to your React app and access them in a type-safe way with the [SDK](/docs/reference/sdk/). We recommend linking since it's more secure.
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
   * Set a custom domain for your React app.
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
   * Serve your React app through a `Router` instead of a standalone CloudFront
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
   * To serve your React app **from a path**, you'll need to configure the root domain
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
   * You also need to set the `base` property in your `vite.config.ts`.
   *
   * :::caution
   * If routing to a path, you need to set that as the base path in your
   * `vite.config.ts` and `reac-router.config.ts` as well.
   * :::
   *
   * ```js title="vite.config.ts" {3}
   * export default defineConfig({
   *   plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
   *   base: "/docs/"
   * });
   * ```
   *
   * And the `basename` in your React Router configuration.
   *
   * ```jsx title="react-router.config.ts" {2}
   * export const routerConfig = {
   *   basename: "/docs"
   * };
   * ```
   *
   * To serve your React app **from a subdomain**, you'll need to configure the
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
   * Finally, to serve your React app **from a combined pattern** like
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
   * Also, make sure to set the base path in your `vite.config.ts` and `basename`
   * in your `react-router.config.ts`, like above.
   */
  router?: SsrSiteArgs["router"];
  /**
   * The command used internally to build your React app.
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
   * Configure how the React app assets are uploaded to S3.
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
   * Configure the React app to use an existing CloudFront cache policy. By default,
   * a new cache policy is created. Note that CloudFront has a limit of 20 cache
   * policies per account. This allows you to reuse an existing policy instead of
   * creating a new one.
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
 * The `React` component lets you deploy a React app built with [React Router](https://reactrouter.com/) app to AWS.
 *
 * @example
 *
 * #### Minimal example
 *
 * Deploy a React app that's in the project root.
 *
 * ```js
 * new sst.aws.React("MyWeb");
 * ```
 *
 * #### Change the path
 *
 * Deploys the React app in the `my-react-app/` directory.
 *
 * ```js {2}
 * new sst.aws.React("MyWeb", {
 *   path: "my-react-app/"
 * });
 * ```
 *
 * #### Add a custom domain
 *
 * Set a custom domain for your React app.
 *
 * ```js {2}
 * new sst.aws.React("MyWeb", {
 *   domain: "my-app.com"
 * });
 * ```
 *
 * #### Redirect www to apex domain
 *
 * Redirect `www.my-app.com` to `my-app.com`.
 *
 * ```js {4}
 * new sst.aws.React("MyWeb", {
 *   domain: {
 *     name: "my-app.com",
 *     redirects: ["www.my-app.com"]
 *   }
 * });
 * ```
 *
 * #### Link resources
 *
 * [Link resources](/docs/linking/) to your React app. This will grant permissions
 * to the resources and allow you to access it in your app.
 *
 * ```ts {4}
 * const bucket = new sst.aws.Bucket("MyBucket");
 *
 * new sst.aws.React("MyWeb", {
 *   link: [bucket]
 * });
 * ```
 *
 * You can use the [SDK](/docs/reference/sdk/) to access the linked resources
 * in your React app.
 *
 * ```ts title="app/root.tsx"
 * import { Resource } from "sst";
 *
 * console.log(Resource.MyBucket.name);
 * ```
 */
export class React extends SsrSite {
  constructor(
    name: string,
    args: ReactArgs = {},
    opts: ComponentResourceOptions = {},
  ) {
    super(__pulumiType, name, args, opts);
  }

  protected normalizeBuildCommand() { }

  protected buildPlan(outputPath: Output<string>): Output<Plan> {
    return output(outputPath).apply((outputPath) => {
      const assetsPath = path.join("build", "client");
      const serverPath = (() => {
        const p = path.join("build", "server");
        return fs.existsSync(path.join(outputPath, p)) ? p : undefined;
      })();
      const indexPage = "index.html";

      // Get base configured in vite config ie. "/docs/"
      const viteBase = (() => {
        try {
          const viteConfig = path.join(outputPath, "vite.config.ts");
          const content = fs.readFileSync(viteConfig, "utf-8");
          const match = content.match(/["']?base["']?:\s*["']([^"]+)["']/);
          return match ? match[1] : undefined;
        } catch (e) { }
      })();

      // Get base configured in react-router config ie. "/docs/"
      const reactRouterBase = (() => {
        try {
          const rrConfig = path.join(outputPath, "react-router.config.ts");
          const content = fs.readFileSync(rrConfig, "utf-8");
          const match = content.match(/["']?basename["']?:\s*["']([^"]+)["']/);
          return match ? match[1] : undefined;
        } catch (e) { }
      })();

      if (viteBase) {
        if (!viteBase.endsWith("/"))
          throw new Error(
            `The "base" value in vite.config.ts must end with a trailing slash ("/"). This is required for correct asset path construction.`,
          );
        if (!reactRouterBase)
          throw new Error(
            `Found "base" configured in vite.config.ts but missing "basename" in react-router.config.ts. Both configurations are required.`,
          );
      }
      if (reactRouterBase) {
        if (reactRouterBase.endsWith("/"))
          throw new Error(
            `The "basename" value in react-router.config.ts must not end with a trailing slash ("/"). This ensures the root URL is accessible without a trailing slash.`,
          );
        if (!viteBase)
          throw new Error(
            `Found "basename" configured in react-router.config.ts but missing "base" in vite.config.ts. Both configurations are required.`,
          );
      }

      return {
        base: reactRouterBase,
        server: serverPath
          ? (() => {
            // React does perform their own internal ESBuild process, but it doesn't bundle
            // 3rd party dependencies by default. In the interest of keeping deployments
            // seamless for users we will create a server bundle with all dependencies included.

            fs.copyFileSync(
              path.join(
                $cli.paths.platform,
                "functions",
                "react-server",
                "server.mjs",
              ),
              path.join(outputPath, "build", "server.mjs"),
            );

            return {
              handler: path.join(outputPath, "build", "server.handler"),
              streaming: true,
            };
          })()
          : undefined,
        assets: [
          {
            from: assetsPath,
            to: "",
            cached: true,
            versionedSubDir: "assets",
          },
        ],
        custom404: serverPath ? undefined : `/${indexPage}`,
      };
    });
  }

  /**
   * The URL of the React app.
   *
   * If the `domain` is set, this is the URL with the custom domain.
   * Otherwise, it's the auto-generated CloudFront URL.
   */
  public get url() {
    return super.url;
  }
}

const __pulumiType = "sst:aws:React";
// @ts-expect-error
React.__pulumiType = __pulumiType;
