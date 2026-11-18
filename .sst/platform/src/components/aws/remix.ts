import fs from "fs";
import path from "path";
import { ComponentResourceOptions, Output, all } from "@pulumi/pulumi";
import type { Input } from "../input.js";
import { VisibleError } from "../error.js";
import { Plan, SsrSite, SsrSiteArgs } from "./ssr-site.js";

export interface RemixArgs extends SsrSiteArgs {
  /**
   * Configure how this component works in `sst dev`.
   *
   * :::note
   * In `sst dev` your Remix app is run in dev mode; it's not deployed.
   * :::
   *
   * Instead of deploying your Remix app, this starts it in dev mode. It's run
   * as a separate process in the `sst dev` multiplexer. Read more about
   * [`sst dev`](/docs/reference/cli/#dev).
   *
   * To disable dev mode, pass in `false`.
   */
  dev?: SsrSiteArgs["dev"];
  /**
   * Permissions and the resources that the [server function](#nodes-server) in your Remix app needs to access. These permissions are used to create the function's IAM role.
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
   * Path to the directory where your Remix app is located.  This path is relative to your `sst.config.ts`.
   *
   * By default it assumes your Remix app is in the root of your SST app.
   * @default `"."`
   *
   * @example
   *
   * If your Remix app is in a package in your monorepo.
   *
   * ```js
   * {
   *   path: "packages/web"
   * }
   * ```
   */
  path?: SsrSiteArgs["path"];
  /**
   * [Link resources](/docs/linking/) to your Remix app. This will:
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
   * Configure how the CloudFront cache invalidations are handled. This is run after your Remix app has been deployed.
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
   * Set [environment variables](https://remix.run/docs/en/main/guides/envvars) in your Remix app. These are made available:
   *
   * 1. In `remix build`, they are loaded into `process.env`.
   * 2. Locally while running through `sst dev`.
   *
   * :::tip
   * You can also `link` resources to your Remix app and access them in a type-safe way with the [SDK](/docs/reference/sdk/). We recommend linking since it's more secure.
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
   * Set a custom domain for your Remix app.
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
   * Serve your Remix app through a `Router` instead of a standalone CloudFront
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
   * To serve your Remix app **from a path**, you'll need to configure the root domain
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
   * You also need to set the `base` in your `vite.config.ts`.
   *
   * :::caution
   * If routing to a path, you need to set that as the base path in your Remix
   * app as well.
   * :::
   *
   * ```js title="vite.config.ts" {3}
   * export default defineConfig({
   *   plugins: [...],
   *   base: "/docs"
   * });
   * ```
   *
   * To serve your Remix app **from a subdomain**, you'll need to configure the
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
   * Finally, to serve your Remix app **from a combined pattern** like
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
   * Also, make sure to set this as the `base` in your `vite.config.ts`, like
   * above.
   */
  router?: SsrSiteArgs["router"];
  /**
   * The command used internally to build your Remix app.
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
   * The directory where the build output is located. This should match the value of
   * `buildDirectory` in the Remix plugin section of your Vite config.
   *
   * @default `"build"`
   */
  buildDirectory?: Input<string>;
  /**
   * Configure how the Remix app assets are uploaded to S3.
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
   * Configure the Remix app to use an existing CloudFront cache policy.
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
 * The `Remix` component lets you deploy a [Remix](https://remix.run) app to AWS.
 *
 * @example
 *
 * #### Minimal example
 *
 * Deploy a Remix app that's in the project root.
 *
 * ```js title="sst.config.ts"
 * new sst.aws.Remix("MyWeb");
 * ```
 *
 * #### Change the path
 *
 * Deploys the Remix app in the `my-remix-app/` directory.
 *
 * ```js {2} title="sst.config.ts"
 * new sst.aws.Remix("MyWeb", {
 *   path: "my-remix-app/"
 * });
 * ```
 *
 * #### Add a custom domain
 *
 * Set a custom domain for your Remix app.
 *
 * ```js {2} title="sst.config.ts"
 * new sst.aws.Remix("MyWeb", {
 *   domain: "my-app.com"
 * });
 * ```
 *
 * #### Redirect www to apex domain
 *
 * Redirect `www.my-app.com` to `my-app.com`.
 *
 * ```js {4} title="sst.config.ts"
 * new sst.aws.Remix("MyWeb", {
 *   domain: {
 *     name: "my-app.com",
 *     redirects: ["www.my-app.com"]
 *   }
 * });
 * ```
 *
 * #### Link resources
 *
 * [Link resources](/docs/linking/) to your Remix app. This will grant permissions
 * to the resources and allow you to access it in your app.
 *
 * ```ts {4} title="sst.config.ts"
 * const bucket = new sst.aws.Bucket("MyBucket");
 *
 * new sst.aws.Remix("MyWeb", {
 *   link: [bucket]
 * });
 * ```
 *
 * You can use the [SDK](/docs/reference/sdk/) to access the linked resources
 * in your Remix app.
 *
 * ```ts title="app/root.tsx"
 * import { Resource } from "sst";
 *
 * console.log(Resource.MyBucket.name);
 * ```
 */
export class Remix extends SsrSite {
  constructor(
    name: string,
    args: RemixArgs = {},
    opts: ComponentResourceOptions = {},
  ) {
    super(__pulumiType, name, args, opts);
  }

  protected normalizeBuildCommand() {}

  protected buildPlan(
    outputPath: Output<string>,
    _name: string,
    args: RemixArgs,
  ): Output<Plan> {
    return all([outputPath, args.buildDirectory]).apply(
      async ([outputPath, buildDirectory]) => {
        // The path for all files that need to be in the "/" directory (static assets)
        // is different when using Vite. These will be located in the "build/client"
        // path of the output by default. It will be the "public" folder when using remix config.
        let assetsPath = "public";
        let assetsVersionedSubDir = "build";
        let buildPath = path.join(outputPath, "build");

        const viteConfig = await loadViteConfig();
        if (viteConfig) {
          assetsPath = path.join(
            viteConfig.__remixPluginContext.remixConfig.buildDirectory,
            "client",
          );
          assetsVersionedSubDir = "assets";
          buildPath = path.join(
            outputPath,
            viteConfig.__remixPluginContext.remixConfig.buildDirectory,
          );
        }

        const basepath = fs
          .readFileSync(path.join(outputPath, "vite.config.ts"), "utf-8")
          .match(/base: ['"](.*)['"]/)?.[1];

        return {
          base: basepath,
          server: createServerLambdaBundle(),
          assets: [
            {
              from: assetsPath,
              to: "",
              cached: true,
              versionedSubDir: assetsVersionedSubDir,
            },
          ],
        };

        async function loadViteConfig() {
          const file = [
            "vite.config.ts",
            "vite.config.js",
            "vite.config.mts",
            "vite.config.mjs",
          ].find((filename) => fs.existsSync(path.join(outputPath, filename)));
          if (!file) return;

          try {
            // @ts-expect-error
            const vite = await import("vite");
            const config = await vite.loadConfigFromFile(
              { command: "build", mode: "production" },
              path.join(outputPath, file),
            );
            if (!config) throw new Error();

            return {
              __remixPluginContext: {
                remixConfig: {
                  buildDirectory: buildDirectory ?? "build",
                },
              },
            };
          } catch (e) {
            throw new VisibleError(
              `Could not load Vite configuration from "${file}". Check that your Remix project uses Vite and the file exists.`,
            );
          }
        }

        function createServerLambdaBundle() {
          // Create a Lambda@Edge handler for the Remix server bundle.
          //
          // Note: Remix does perform their own internal ESBuild process, but it
          // doesn't bundle 3rd party dependencies by default. In the interest of
          // keeping deployments seamless for users we will create a server bundle
          // with all dependencies included. We will still need to consider how to
          // address any need for external dependencies, although I think we should
          // possibly consider this at a later date.

          // In this path we are assuming that the Remix build only outputs the
          // "core server build". We can safely assume this as we have guarded the
          // remix.config.js to ensure it matches our expectations for the build
          // configuration.
          // We need to ensure that the "core server build" is wrapped with an
          // appropriate Lambda@Edge handler. We will utilise an internal asset
          // template to create this wrapper within the "core server build" output
          // directory.

          // Ensure build directory exists
          fs.mkdirSync(buildPath, { recursive: true });

          // Copy the server lambda handler and pre-append the build injection based
          // on the config file used.
          const content = [
            // When using Vite config, the output build will be "server/index.js"
            // and when using Remix config it will be `server.js`.
            `// Import the server build that was produced by 'remix build'`,
            viteConfig
              ? `import * as remixServerBuild from "./server/index.js";`
              : `import * as remixServerBuild from "./index.js";`,
            ``,
            fs.readFileSync(
              path.join(
                $cli.paths.platform,
                "functions",
                "remix-server",
                "regional-server.mjs",
              ),
            ),
          ].join("\n");
          fs.writeFileSync(path.join(buildPath, "server.mjs"), content);

          // Copy the Remix polyfil to the server build directory
          //
          // Note: We need to ensure that the polyfills are injected above other code that
          // will depend on them when not using Vite. Importing them within the top of the
          // lambda code doesn't appear to guarantee this, we therefore leverage ESBUild's
          // `inject` option to ensure that the polyfills are injected at the top of
          // the bundle.
          const polyfillDest = path.join(buildPath, "polyfill.mjs");
          fs.copyFileSync(
            path.join(
              $cli.paths.platform,
              "functions",
              "remix-server",
              "polyfill.mjs",
            ),
            polyfillDest,
          );

          return {
            handler: path.join(buildPath, "server.handler"),
            nodejs: {
              esbuild: {
                inject: [path.resolve(polyfillDest)],
              },
            },
            streaming: true,
          };
        }
      },
    );
  }

  /**
   * The URL of the Remix app.
   *
   * If the `domain` is set, this is the URL with the custom domain.
   * Otherwise, it's the auto-generated CloudFront URL.
   */
  public get url() {
    return super.url;
  }
}

const __pulumiType = "sst:aws:Remix";
// @ts-expect-error
Remix.__pulumiType = __pulumiType;
