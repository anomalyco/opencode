import fs from "fs";
import path from "path";
import { ComponentResourceOptions, Output, all } from "@pulumi/pulumi";
import {
  SsrSiteArgs,
  createKvStorage,
  createRouter,
  prepare,
  validatePlan,
} from "./ssr-site.js";
import { Component } from "../component.js";
import { Hint } from "../hint.js";
import { Link } from "../link.js";
import { Kv } from "./kv.js";
import { buildApp } from "../base/base-ssr-site.js";
import { Worker } from "./worker.js";
import { Plugin } from "esbuild";
import { pathToRegexp } from "../../util/path-to-regex.js";

export interface RemixArgs extends SsrSiteArgs {
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
   * The command used internally to build your Remix app.
   *
   * @default Dynamically determined based on the presence of package manager lock files. If "yarn.lock" is found, defaults to "yarn run build". If "pnpm-lock.yaml" is found, defaults to "pnpm run build". If "bun.lockb" is found, defaults to "bun run build". If "package-lock.json" is found, defaults to "npm run build".
   *
   * @example
   *
   * If you want to use a different build command.
   * ```js
   * {
   *   buildCommand: "npm run custom-build"
   * }
   * ```
   */
  buildCommand?: SsrSiteArgs["buildCommand"];
  /**
   * Set a custom domain for your Remix app. Supports domains hosted either on
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
  domain?: SsrSiteArgs["domain"];
  /**
   * Set [environment variables](https://remix.run/docs/en/main/guides/envvars) in your Remix app. These are made available:
   *
   * 1. In `remix build`, they are loaded into `process.env`.
   * 2. Locally while running `sst dev remix dev`.
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
 * ```js
 * new sst.aws.Remix("MyWeb");
 * ```
 *
 * #### Change the path
 *
 * Deploys the Remix app in the `my-remix-app/` directory.
 *
 * ```js {2}
 * new sst.aws.Remix("MyWeb", {
 *   path: "my-remix-app/"
 * });
 * ```
 *
 * #### Add a custom domain
 *
 * Set a custom domain for your Remix app.
 *
 * ```js {2}
 * new sst.aws.Remix("MyWeb", {
 *   domain: "my-app.com"
 * });
 * ```
 *
 * #### Redirect www to apex domain
 *
 * Redirect `www.my-app.com` to `my-app.com`.
 *
 * ```js {4}
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
 * ```ts {4}
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
export class Remix extends Component implements Link.Linkable {
  private assets: Kv;
  private router: Output<Worker>;
  private server: Output<Worker>;

  constructor(
    name: string,
    args: RemixArgs = {},
    opts: ComponentResourceOptions = {},
  ) {
    super(__pulumiType, name, args, opts);

    const parent = this;
    const { sitePath } = prepare(args);
    const isUsingVite = checkIsUsingVite();
    const storage = createKvStorage(parent, name, args);
    const outputPath = $dev ? sitePath : buildApp(parent, name, args, sitePath);
    const { buildMeta } = loadBuildOutput();
    const plan = buildPlan();
    const { router, server } = createRouter(
      parent,
      name,
      args,
      outputPath,
      storage,
      plan,
    );

    this.assets = storage;
    this.router = router;
    this.server = server;
    if (!$dev) {
      Hint.register(this.urn, this.url as Output<string>);
    }
    this.registerOutputs({
      _metadata: {
        mode: $dev ? "placeholder" : "deployed",
        path: sitePath,
        url: this.url,
      },
    });

    function checkIsUsingVite() {
      return sitePath.apply(
        (sitePath) =>
          fs.existsSync(path.join(sitePath, "vite.config.ts")) ||
          fs.existsSync(path.join(sitePath, "vite.config.js")),
      );
    }

    function loadBuildOutput() {
      return {
        buildMeta: $dev ? loadBuildMetadataPlaceholder() : loadBuildMetadata(),
      };
    }

    function loadBuildMetadata() {
      return all([outputPath, isUsingVite]).apply(
        ([outputPath, isUsingVite]) => {
          // The path for all files that need to be in the "/" directory (static assets)
          // is different when using Vite. These will be located in the "build/client"
          // path of the output. It will be the "public" folder when using remix config.
          const assetsPath = isUsingVite
            ? path.join("build", "client")
            : "public";
          const assetsVersionedSubDir = isUsingVite ? undefined : "build";

          return {
            assetsPath,
            assetsVersionedSubDir,
            // create 1 behaviour for each top level asset file/folder
            staticRoutes: fs
              .readdirSync(path.join(outputPath, assetsPath), {
                withFileTypes: true,
              })
              .map((item) =>
                item.isDirectory() ? `${item.name}/(.*)` : item.name,
              ),
          };
        },
      );
    }

    function loadBuildMetadataPlaceholder() {
      return {
        assetsPath: "placeholder",
        assetsVersionedSubDir: undefined,
        staticRoutes: [],
      };
    }

    function buildPlan() {
      return all([isUsingVite, outputPath, buildMeta]).apply(
        ([isUsingVite, outputPath, buildMeta]) => {
          return validatePlan({
            server: createServerLambdaBundle(isUsingVite, outputPath),
            assets: {
              copy: [
                {
                  from: buildMeta.assetsPath,
                  to: "",
                  cached: true,
                  versionedSubDir: buildMeta.assetsVersionedSubDir,
                },
              ],
            },
            routes: [
              {
                regex: pathToRegexp(buildMeta.staticRoutes).source,
                origin: "assets" as const,
              },
              {
                regex: pathToRegexp("(.*)").source,
                origin: "server" as const,
              },
            ],
          });
        },
      );
    }

    function createServerLambdaBundle(
      isUsingVite: boolean,
      outputPath: string,
    ) {
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
      const buildPath = path.join(outputPath, "build");
      fs.mkdirSync(buildPath, { recursive: true });

      // Copy the server lambda handler and pre-append the build injection based
      // on the config file used.
      const content = [
        // When using Vite config, the output build will be "server/index.js"
        // and when using Remix config it will be `server.js`.
        //isUsingVite
        //  ? `import * as remixServerBuild from "./server/index.js";`
        //  : `import * as remixServerBuild from "./index.js";`,
        //`import { createRequestHandler } from "@remix-run/cloudflare";`,
        //`import * as remixServerBuild from "./server";`,
        //`import { createRequestHandler } from "@remix-run/cloudflare";`,
        //`export default {`,
        //`  async fetch(request) {`,
        //`    const requestHandler = createRequestHandler(remixServerBuild);`,
        //`    return await requestHandler(request);`,
        //`  },`,
        //`};`,
        `import { createRequestHandler } from "@remix-run/cloudflare";`,
        `import * as build from "./server/index.js";`,
        `export default {`,
        `  async fetch(request) {`,
        `    console.log("fetch");`,
        `    console.log("build", build);`,
        `    console.log("build mode", build.mode);`,
        `    const handleRequest = createRequestHandler(build);`,
        `    console.log("handleRequest", handleRequest);`,
        `    return await handleRequest(request);`,
        `  },`,
        `};`,
      ].join("\n");
      fs.writeFileSync(path.join(buildPath, "server.ts"), content);

      const nodeBuiltInModulesPlugin: Plugin = {
        name: "node:built-in:modules",
        setup(build) {
          build.onResolve({ filter: /^(util|stream)$/ }, ({ kind, path }) => {
            // this plugin converts `require("node:*")` calls, those are the only ones that
            // need updating (esm imports to "node:*" are totally valid), so here we tag with the
            // node-buffer namespace only imports that are require calls
            return kind === "require-call"
              ? { path, namespace: "node-built-in-modules" }
              : undefined;
          });

          // we convert the imports we tagged with the node-built-in-modules namespace so that instead of `require("node:*")`
          // they import from `export * from "node:*";`
          build.onLoad(
            { filter: /.*/, namespace: "node-built-in-modules" },
            ({ path }) => {
              return {
                contents: `export * from 'node:${path}'`,
                loader: "js",
              };
            },
          );
        },
      };

      return {
        handler: path.join(buildPath, "server.ts"),
        build: {
          esbuild: {
            define: {
              process: JSON.stringify({
                env: {
                  //NODE_ENV: "production",
                  NODE_ENV: "development",
                },
              }),
            },
            plugins: [nodeBuiltInModulesPlugin],
          },
        },
      };
    }
  }

  /**
   * The URL of the Remix app.
   *
   * If the `domain` is set, this is the URL with the custom domain.
   * Otherwise, it's the auto-generated CloudFront URL.
   */
  public get url() {
    return this.router.url;
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
      assets: this.assets,
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
const __pulumiType = "sst:cloudflare:Remix";
// @ts-expect-error
Remix.__pulumiType = __pulumiType;
