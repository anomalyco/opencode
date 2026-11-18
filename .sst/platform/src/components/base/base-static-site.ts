import fs from "fs";
import path from "path";
import { all, output, Resource } from "@pulumi/pulumi";
import { VisibleError } from "../error.js";
import { Input } from "../input.js";
import { Prettify } from "../component.js";
import { BaseSiteFileOptions } from "./base-site.js";
import { siteBuilder } from "../aws/helpers/site-builder.js";

export type BaseStaticSiteAssets = {
  /**
   * Character encoding for text based assets uploaded, like HTML, CSS, JS. This is
   * used to set the `Content-Type` header when these files are served out.
   *
   * If set to `"none"`, then no charset will be returned in header.
   * @default `"utf-8"`
   * @example
   * ```js
   * {
   *   assets: {
   *     textEncoding: "iso-8859-1"
   *   }
   * }
   * ```
   */
  textEncoding?: Input<
    "utf-8" | "iso-8859-1" | "windows-1252" | "ascii" | "none"
  >;
  /**
   * Specify the `Content-Type` and `Cache-Control` headers for specific files. This allows
   * you to override the default behavior for specific files using glob patterns.
   *
   * By default, this is set to cache CSS/JS files for 1 year and not cache HTML files.
   *
   * ```js
   * {
   *   assets: {
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
   *
   * @default `Object[]`
   * @example
   * You can change the default options. For example, apply `Cache-Control` and `Content-Type` to all zip files.
   * ```js
   * {
   *   assets: {
   *     fileOptions: [
   *       {
   *         files: "**\/*.zip",
   *         contentType: "application/zip",
   *         cacheControl: "private,no-cache,no-store,must-revalidate"
   *       },
   *     ],
   *   }
   * }
   * ```
   * Apply `Cache-Control` to all CSS and JS files except for CSS files with `index-`
   * prefix in the `main/` directory.
   * ```js
   * {
   *   assets: {
   *     fileOptions: [
   *       {
   *         files: ["**\/*.css", "**\/*.js"],
   *         ignore: "main\/index-*.css",
   *         cacheControl: "private,no-cache,no-store,must-revalidate"
   *       },
   *     ],
   *   }
   * }
   * ```
   */
  fileOptions?: Input<Prettify<BaseSiteFileOptions>[]>;
};

export interface BaseStaticSiteArgs {
  path?: Input<string>;
  /**
   * The name of the index page of the site. This is a path relative to the root of your site, or the `path`.
   *
   * :::note
   * The index page only applies to the root of your site.
   * :::
   *
   * By default this is set to `index.html`. So if a visitor goes to your site, let's say `example.com`, `example.com/index.html` will be served.
   *
   * @default `"index.html"`
   * @example
   * ```js
   * {
   *   indexPage: "home.html"
   * }
   * ```
   */
  indexPage?: string;
  /**
   * The error page to display on a 403 or 404 error. This is a path relative to the root of your site, or the `path`.
   * @default The `indexPage` of your site.
   * @example
   * ```js
   * {
   *   errorPage: "404.html"
   * }
   * ```
   */
  errorPage?: Input<string>;
  /**
   * Set environment variables for your static site. These are made available:
   *
   * 1. Locally while running your site through `sst dev`.
   * 2. In the build process when running `build.command`.
   *
   * @example
   * ```js
   * environment: {
   *   API_URL: api.url
   *   STRIPE_PUBLISHABLE_KEY: "pk_test_123"
   * }
   * ```
   *
   * Some static site generators like Vite have their [concept of environment variables](https://vitejs.dev/guide/env-and-mode), and you can use this option to set them.
   *
   * :::note
   * The types for the Vite environment variables are generated automatically. You can change their location through `vite.types`.
   * :::
   *
   * These can be accessed as `import.meta.env` in your site. And only the ones prefixed with `VITE_` can be accessed in the browser.
   *
   * ```js
   * environment: {
   *   API_URL: api.url
   *   // Accessible in the browser
   *   VITE_STRIPE_PUBLISHABLE_KEY: "pk_test_123"
   * }
   * ```
   */
  environment?: Input<Record<string, Input<string>>>;
  build?: Input<{
    /**
     * The command that builds the static site. It's run before your site is deployed. This is run at the root of your site, `path`.
     * @example
     * ```js
     * {
     *   build: {
     *     command: "yarn build"
     *   }
     * }
     * ```
     */
    command: Input<string>;
    /**
     * The directory where the build output of your static site is generated. This will be uploaded.
     *
     * The path is relative to the root of your site, `path`.
     * @example
     * ```js
     * {
     *   build: {
     *     output: "build"
     *   }
     * }
     * ```
     */
    output: Input<string>;
  }>;
  /**
   * Configure [Vite](https://vitejs.dev) related options.
   *
   * :::tip
   * If a `vite.config.ts` or `vite.config.js` file is detected in the `path`, then these options will be used during the build and deploy process.
   * :::
   */
  vite?: Input<{
    /**
     * The path where the type definition for the `environment` variables are generated. This is relative to the `path`. [Read more](https://vitejs.dev/guide/env-and-mode#intellisense-for-typescript).
     *
     * @default `"src/sst-env.d.ts"`
     * @example
     * ```js
     * {
     *   vite: {
     *     types: "other/path/sst-env.d.ts"
     *   }
     * }
     * ```
     */
    types?: string;
  }>;
}

export function prepare(args: BaseStaticSiteArgs) {
  const sitePath = normalizeSitePath();
  const environment = normalizeEnvironment();
  const indexPage = normalizeIndexPage();
  generateViteTypes();

  return {
    sitePath,
    environment,
    indexPage,
  };

  function normalizeSitePath() {
    return output(args.path).apply((sitePath) => {
      if (!sitePath) return ".";

      if (!fs.existsSync(sitePath)) {
        throw new VisibleError(`No site found at "${path.resolve(sitePath)}".`);
      }
      return sitePath;
    });
  }

  function normalizeEnvironment() {
    return output(args.environment).apply((environment) => environment ?? {});
  }

  function normalizeIndexPage() {
    return output(args.indexPage).apply(
      (indexPage) => indexPage ?? "index.html",
    );
  }

  function generateViteTypes() {
    return all([sitePath, args.vite, environment]).apply(
      ([sitePath, vite, environment]) => {
        // Build the path
        let typesPath = vite?.types;
        if (!typesPath) {
          if (
            fs.existsSync(path.join(sitePath, "vite.config.js")) ||
            fs.existsSync(path.join(sitePath, "vite.config.ts"))
          ) {
            typesPath = "src/sst-env.d.ts";
          }
        }
        if (!typesPath) {
          return;
        }

        // Create type file
        const filePath = path.resolve(path.join(sitePath, typesPath));
        const content = `/* This file is auto-generated by SST. Do not edit. */
/* tslint:disable */
/* eslint-disable */
/// <reference types="vite/client" />
interface ImportMetaEnv {
${Object.keys(environment)
  .map((key) => `  readonly ${key}: string`)
  .join("\n")}
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}`;

        const fileDir = path.dirname(filePath);
        fs.mkdirSync(fileDir, { recursive: true });
        fs.writeFileSync(filePath, content);
      },
    );
  }
}

export function buildApp(
  parent: Resource,
  name: string,
  build: BaseStaticSiteArgs["build"],
  sitePath: ReturnType<typeof prepare>["sitePath"],
  environment: ReturnType<typeof prepare>["environment"],
) {
  if (!build) return sitePath;

  const result = siteBuilder(
    `${name}Builder`,
    {
      create: output(build).command,
      update: output(build).command,
      dir: output(sitePath).apply((sitePath) =>
        path.join($cli.paths.root, sitePath),
      ),
      environment,
      triggers: [Date.now().toString()],
    },
    {
      parent,
      ignoreChanges: process.env.SKIP ? ["*"] : undefined,
    },
  );

  // Validate build output
  return all([sitePath, build, result.id]).apply(([sitePath, build, _]) => {
    const outputPath = path.join(sitePath, build.output);
    if (!fs.existsSync(outputPath)) {
      throw new VisibleError(
        `No build output found at "${path.resolve(outputPath)}".`,
      );
    }

    return outputPath;
  });
}
