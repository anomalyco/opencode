import fs from "fs/promises";
import path from "path";
import { ComponentResourceOptions, Output } from "@pulumi/pulumi";
import { VisibleError } from "../../error.js";
import { Plan, SsrSite, SsrSiteArgs } from "../ssr-site.js";
import { existsAsync } from "../../../util/fs.js";

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
   * 2. Allow you to access it in your site using [`Astro.locals.runtime`](https://docs.astro.build/en/guides/integrations-guide/cloudflare/#environment-variables-and-secrets).
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
   *
   * You can access the linked resources as bindings in your Astro site.
   *
   * ```js
   * const { env } = Astro.locals.runtime;
   * const files = await env.MyBucket.list();
   * ```
   */
  link?: SsrSiteArgs["link"];
  /**
   * Set [environment variables](https://docs.astro.build/en/guides/environment-variables/) in your Astro site. These are made available:
   *
   * 1. In `astro build`, they are loaded into [`Astro.locals.runtime`](https://docs.astro.build/en/guides/integrations-guide/cloudflare/#environment-variables-and-secrets).
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
   *
   * You can access the environment variables in your Astro site as follows:
   *
   * ```js
   * const { env } = Astro.locals.runtime;
   * const apiUrl = env.API_URL;
   * const stripeKey = env.PUBLIC_STRIPE_PUBLISHABLE_KEY;
   * ```
   */
  environment?: SsrSiteArgs["environment"];
  /**
   * Set a custom domain for your Astro site.
   *
   * @example
   *
   * ```js
   * {
   *   domain: "my-app.com"
   * }
   * ```
   */
  domain?: SsrSiteArgs["domain"];
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
}

/**
 * The `Astro` component lets you deploy an [Astro](https://astro.build) site to Cloudflare.
 *
 * @example
 *
 * #### Minimal example
 *
 * Deploy the Astro site that's in the project root.
 *
 * ```js title="sst.config.ts"
 * new sst.cloudflare.Astro("MyWeb");
 * ```
 *
 * #### Change the path
 *
 * Deploys the Astro site in the `my-astro-app/` directory.
 *
 * ```js {2} title="sst.config.ts"
 * new sst.cloudflare.Astro("MyWeb", {
 *   path: "my-astro-app/"
 * });
 * ```
 *
 * #### Add a custom domain
 *
 * Set a custom domain for your Astro site.
 *
 * ```js {2} title="sst.config.ts"
 * new sst.cloudflare.Astro("MyWeb", {
 *   domain: "my-app.com"
 * });
 * ```
 *
 * #### Link resources
 *
 * [Link resources](/docs/linking/) to your Astro site. This will grant permissions
 * to the resources and allow you to access it in your site.
 *
 * ```ts {4} title="sst.config.ts"
 * const bucket = new sst.cloudflare.Bucket("MyBucket");
 *
 * new sst.cloudflare.Astro("MyWeb", {
 *   link: [bucket]
 * });
 * ```
 *
 * You can access the linked resources as bindings in your Astro site.
 *
 * ```astro title="src/pages/index.astro"
 * ---
 * const { env } = Astro.locals.runtime;
 *
 * const files = await env.MyBucket.list();
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

  protected buildPlan(outputPath: Output<string>): Output<Plan> {
    return outputPath.apply(async (outputPath) => {
      const distPath = path.join(outputPath, "dist");
      if (!(await existsAsync(path.join(distPath, "_worker.js", "index.js")))) {
        throw new VisibleError(
          `SSR server bundle "_worker.js" not found in the build output at:\n` +
            `  "${path.resolve(distPath)}".\n\n` +
            `If your Astro project is entirely pre-rendered, use the \`sst.cloudflare.StaticSite\` component instead of \`sst.cloudflare.Astro\`.`,
        );
      }

      // Ensure `.assetsignore` file exists and contains `_worker.js` and `_routes.json`
      const ignorePath = path.join(outputPath, "dist", ".assetsignore");
      const ignorePatterns = (await existsAsync(ignorePath))
        ? (await fs.readFile(ignorePath, "utf-8")).split("\n")
        : [];
      let dirty = false;
      ["_worker.js", "_routes.json"].forEach((pattern) => {
        if (ignorePatterns.includes(pattern)) return;
        ignorePatterns.push(pattern);
        dirty = true;
      });

      if (dirty) {
        await fs.appendFile(ignorePath, "\n_worker.js\n_routes.json");
      }

      return {
        server: "./dist/_worker.js/index.js",
        assets: "./dist",
      };
    });
  }

  /**
   * The URL of the Astro site.
   *
   * If the `domain` is set, this is the URL with the custom domain.
   * Otherwise, it's the auto-generated Worker URL.
   */
  public get url() {
    return super.url;
  }
}
const __pulumiType = "sst:cloudflare:Astro";
// @ts-expect-error
Astro.__pulumiType = __pulumiType;
