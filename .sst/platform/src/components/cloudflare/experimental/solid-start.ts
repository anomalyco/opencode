import fs from "fs/promises";
import path from "path";
import { ComponentResourceOptions, Output } from "@pulumi/pulumi";
import { VisibleError } from "../../error.js";
import { Plan, SsrSite, SsrSiteArgs } from "../ssr-site.js";
import { existsAsync } from "../../../util/fs.js";

export interface SolidStartArgs extends SsrSiteArgs {
  /**
   * Configure how this component works in `sst dev`.
   *
   * :::note
   * In `sst dev` your SolidStart app is run in dev mode; it's not deployed.
   * :::
   *
   * Instead of deploying your SolidStart app, this starts it in dev mode. It's run
   * as a separate process in the `sst dev` multiplexer. Read more about
   * [`sst dev`](/docs/reference/cli/#dev).
   *
   * To disable dev mode, pass in `false`.
   */
  dev?: SsrSiteArgs["dev"];
  /**
   * Path to the directory where your SolidStart app is located.  This path is relative to your `sst.config.ts`.
   *
   * By default it assumes your SolidStart app is in the root of your SST app.
   * @default `"."`
   *
   * @example
   *
   * If your SolidStart app is in a package in your monorepo.
   *
   * ```js
   * {
   *   path: "packages/web"
   * }
   * ```
   */
  path?: SsrSiteArgs["path"];
  /**
   * [Link resources](/docs/linking/) to your SolidStart app. This will:
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
   *
   * You can access the linked resources as bindings in your SolidStart app.
   */
  link?: SsrSiteArgs["link"];
  /**
   * Set environment variables in your SolidStart app. These are made available:
   *
   * 1. In `vinxi build`, they are loaded into `process.env`.
   * 2. Locally while running `vinxi dev` through `sst dev`.
   *
   * :::tip
   * You can also `link` resources to your SolidStart app and access them in a type-safe way with the [SDK](/docs/reference/sdk/). We recommend linking since it's more secure.
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
   *
   * You can access the environment variables in your SolidStart app as follows:
   */
  environment?: SsrSiteArgs["environment"];
  /**
   * Set a custom domain for your SolidStart app.
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
   * The command used internally to build your SolidStart app.
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
 * The `SolidStart` component lets you deploy a [SolidStart](https://start.solidjs.com) app to Cloudflare.
 *
 * @example
 *
 * #### Minimal example
 *
 * Deploy the SolidStart app that's in the project root.
 *
 * ```js title="sst.config.ts"
 * new sst.cloudflare.SolidStart("MyWeb");
 * ```
 *
 * #### Change the path
 *
 * Deploys the SolidStart app in the `my-solid-start-app/` directory.
 *
 * ```js {2} title="sst.config.ts"
 * new sst.cloudflare.SolidStart("MyWeb", {
 *   path: "my-solid-start-app/"
 * });
 * ```
 *
 * #### Add a custom domain
 *
 * Set a custom domain for your SolidStart app.
 *
 * ```js {2} title="sst.config.ts"
 * new sst.cloudflare.SolidStart("MyWeb", {
 *   domain: "my-app.com"
 * });
 * ```
 *
 * #### Link resources
 *
 * [Link resources](/docs/linking/) to your SolidStart app. This will grant permissions
 * to the resources and allow you to access it in your site.
 *
 * ```ts {4} title="sst.config.ts"
 * const bucket = new sst.cloudflare.Bucket("MyBucket");
 *
 * new sst.cloudflare.SolidStart("MyWeb", {
 *   link: [bucket]
 * });
 * ```
 *
 * You can use the [SDK](/docs/reference/sdk/) to access the linked resources
 * in your SolidStart app.
 *
 * ```ts title="src/app.tsx"
 * import { Resource } from "sst";
 *
 * console.log(Resource.MyBucket.name);
 * ```
 */
export class SolidStart extends SsrSite {
  constructor(
    name: string,
    args: SolidStartArgs = {},
    opts: ComponentResourceOptions = {},
  ) {
    super(__pulumiType, name, args, opts);
  }

  protected buildPlan(outputPath: Output<string>): Output<Plan> {
    return outputPath.apply(async (outputPath) => {
      // Make sure aws-lambda preset is used in nitro.json
      const nitro = JSON.parse(
        await fs.readFile(
          path.join(outputPath, ".output", "nitro.json"),
          "utf-8",
        ),
      );

      if (!["cloudflare-module"].includes(nitro.preset)) {
        throw new VisibleError(
          `SolidStart's nitro.config.ts must be configured to use the "cloudflare-module" preset. It is currently set to "${nitro.preset}".`,
        );
      }

      // Make sure the server bundle is in the dist directory
      if (
        !(await existsAsync(
          path.join(outputPath, ".output", "server", "index.mjs"),
        ))
      ) {
        throw new VisibleError(
          `SSR server bundle "index.mjs" not found in the build output at:\n` +
            `  "${path.resolve(outputPath, ".output", "server")}".\n\n` +
            `If your SolidStart project is entirely pre-rendered, use the \`sst.cloudflare.StaticSite\` component instead of \`sst.cloudflare.SolidStart\`.`,
        );
      }

      // Ensure `.assetsignore` file exists and contains `server`
      const ignorePath = path.join(outputPath, ".output", ".assetsignore");
      const ignorePatterns = (await existsAsync(ignorePath))
        ? (await fs.readFile(ignorePath, "utf-8")).split("\n")
        : [];
      let dirty = false;
      ["server"].forEach((pattern) => {
        if (ignorePatterns.includes(pattern)) return;
        ignorePatterns.push(pattern);
        dirty = true;
      });

      if (dirty) {
        await fs.appendFile(ignorePath, "\nserver");
      }

      return {
        server: "./.output/server/index.mjs",
        assets: "./.output/public",
      };
    });
  }

  /**
   * The URL of the SolidStart app.
   *
   * If the `domain` is set, this is the URL with the custom domain.
   * Otherwise, it's the auto-generated Worker URL.
   */
  public get url() {
    return super.url;
  }
}

const __pulumiType = "sst:cloudflare:SolidStart";
// @ts-expect-error
SolidStart.__pulumiType = __pulumiType;
