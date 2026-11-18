import fs from "fs";
import path from "path";
import crypto from "crypto";
import { ComponentResourceOptions, all, output } from "@pulumi/pulumi";
import { Kv, KvArgs } from "./kv.js";
import { Component, Transform, transform } from "../component.js";
import { Link } from "../link.js";
import { Input } from "../input.js";
import { globSync } from "glob";
import { KvData } from "./providers/kv-data.js";
import { Worker } from "./worker.js";
import { getContentType } from "../base/base-site.js";
import {
  BaseStaticSiteArgs,
  BaseStaticSiteAssets,
  buildApp,
  prepare,
} from "../base/base-static-site.js";
import { DEFAULT_ACCOUNT_ID } from "./account-id.js";

export interface StaticSiteArgs extends BaseStaticSiteArgs {
  /**
   * Path to the directory where your static site is located. By default this assumes your static site is in the root of your SST app.
   *
   * This directory will be uploaded to KV. The path is relative to your `sst.config.ts`.
   *
   * :::note
   * If the `build` options are specified, `build.output` will be uploaded to KV instead.
   * :::
   *
   * If you are using a static site generator, like Vite, you'll need to configure the `build` options. When these are set, the `build.output` directory will be uploaded to KV instead.
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
   * Configure if your static site needs to be built. This is useful if you are using a static site generator.
   *
   * The `build.output` directory will be uploaded to KV instead.
   *
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
   * Configure how the static site's assets are uploaded to KV.
   *
   * By default, this is set to the following. Read more about these options below.
   * ```js
   * {
   *   assets: {
   *     textEncoding: "utf-8",
   *     fileOptions: [
   *       {
   *         files: ["**\/*.css", "**\/*.js"],
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
  assets?: Input<BaseStaticSiteAssets & {}>;
  /**
   * Set a custom domain for your static site. Supports domains hosted on Cloudflare.
   *
   * :::tip
   * You can migrate an externally hosted domain to Cloudflare by
   * [following this guide](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/).
   * :::
   *
   * @example
   *
   * ```js
   * {
   *   domain: "domain.com"
   * }
   * ```
   */
  domain?: Input<string>;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the Kv resource used for uploading the assets.
     */
    assets?: Transform<KvArgs>;
  };
}

/**
 * The `StaticSite` component lets you deploy a static website to Cloudflare. It uses [Cloudflare KV storage](https://developers.cloudflare.com/kv/) to store your files and [Cloudflare Workers](https://developers.cloudflare.com/workers/) to serve them.
 *
 * It can also `build` your site by running your static site generator, like [Vite](https://vitejs.dev) and uploading the build output to Cloudflare KV.
 *
 * @example
 *
 * #### Minimal example
 *
 * Simply uploads the current directory as a static site.
 *
 * ```js
 * new sst.aws.StaticSite("MyWeb");
 * ```
 *
 * #### Change the path
 *
 * Change the `path` that should be uploaded.
 *
 * ```js
 * new sst.aws.StaticSite("MyWeb", {
 *   path: "path/to/site"
 * });
 * ```
 *
 * #### Deploy a Vite SPA
 *
 * Use [Vite](https://vitejs.dev) to deploy a React/Vue/Svelte/etc. SPA by specifying the `build` config.
 *
 * ```js
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
 * ```js
 * new sst.aws.StaticSite("MyWeb", {
 *   errorPage: "404.html",
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
 * ```js
 * new sst.aws.StaticSite("MyWeb", {
 *   errorPage: "404.html",
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
 * ```js
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
 * ```js {2}
 * new sst.aws.StaticSite("MyWeb", {
 *   domain: "my-app.com"
 * });
 * ```
 *
 * #### Redirect www to apex domain
 *
 * Redirect `www.my-app.com` to `my-app.com`.
 *
 * ```js {4}
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
 * ```ts {5-7}
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
  private assets: Kv;
  private router: Worker;

  constructor(
    name: string,
    args: StaticSiteArgs = {},
    opts: ComponentResourceOptions = {},
  ) {
    super(__pulumiType, name, args, opts);

    const parent = this;
    const { sitePath, environment, indexPage } = prepare(args);
    const outputPath = $dev
      ? path.join($cli.paths.platform, "functions", "empty-site")
      : buildApp(parent, name, args.build, sitePath, environment);
    const storage = createKvStorage();
    const assetManifest = generateAssetManifest();
    const kvData = uploadAssets();
    const worker = createRouter();
    this.assets = storage;
    this.router = worker;

    this.registerOutputs({
      _hint: this.url,
      _dev: {
        environment,
        command: "npm run dev",
        directory: sitePath,
        autostart: true,
      },
      _metadata: {
        path: sitePath,
        environment,
        url: this.url,
      },
    });

    function createKvStorage() {
      return new Kv(
        ...transform(
          args.transform?.assets,
          `${name}Assets`,
          {},
          {
            parent,
            retainOnDelete: false,
          },
        ),
      );
    }

    function generateAssetManifest() {
      return all([outputPath, args.assets]).apply(
        async ([outputPath, assets]) => {
          // Build fileOptions
          const fileOptions = assets?.fileOptions ?? [
            {
              files: "**",
              cacheControl: "max-age=0,no-cache,no-store,must-revalidate",
            },
            {
              files: ["**/*.js", "**/*.css"],
              cacheControl: "max-age=31536000,public,immutable",
            },
          ];

          // Upload files based on fileOptions
          const manifest = [];
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
            filesProcessed.push(...files);

            manifest.push(
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
                    key: file,
                    hash,
                    cacheControl: fileOption.cacheControl,
                    contentType:
                      fileOption.contentType ?? getContentType(file, "UTF-8"),
                  };
                }),
              )),
            );
          }

          return manifest;
        },
      );
    }

    function uploadAssets() {
      return new KvData(
        `${name}AssetFiles`,
        {
          accountId: DEFAULT_ACCOUNT_ID,
          namespaceId: storage.id,
          entries: assetManifest.apply((manifest) =>
            manifest.map((m) => ({
              source: m.source,
              key: m.key,
              hash: m.hash,
              cacheControl: m.cacheControl,
              contentType: m.contentType,
            })),
          ),
        },
        { parent, ignoreChanges: $dev ? ["*"] : undefined },
      );
    }

    function createRouter() {
      return new Worker(
        `${name}Router`,
        {
          handler: path.join(
            $cli.paths.platform,
            "functions",
            "cf-static-site-router-worker",
          ),
          url: true,
          domain: args.domain,
          environment: {
            INDEX_PAGE: indexPage,
            ...(args.errorPage ? { ERROR_PAGE: args.errorPage } : {}),
          },
          build: {
            esbuild: assetManifest.apply((assetManifest) => ({
              define: {
                SST_ASSET_MANIFEST: JSON.stringify(
                  Object.fromEntries(assetManifest.map((e) => [e.key, e.hash])),
                ),
              },
            })),
          },
          transform: {
            worker: (workerArgs) => {
              workerArgs.bindings = output(workerArgs.bindings ?? []).apply(
                (bindings) => [
                  ...bindings,
                  {
                    type: "kv_namespace",
                    name: "ASSETS",
                    namespaceId: storage.id,
                  },
                ],
              );
            },
          },
        },
        // create worker after KV upload finishes
        { dependsOn: kvData, parent },
      );
    }
  }

  /**
   * The URL of the website.
   *
   * If the `domain` is set, this is the URL with the custom domain.
   * Otherwise, it's the auto-generated worker URL.
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
       * The KV namespace that stores the assets.
       */
      assets: this.assets,
      /**
       * The worker that serves the requests.
       */
      router: this.router,
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

const __pulumiType = "sst:cloudflare:StaticSite";
// @ts-expect-error
StaticSite.__pulumiType = __pulumiType;
