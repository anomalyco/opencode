/**
 * The Global library is a collection of `$` functions and variables that are available in the `run` function, of your [`sst.config.ts`](/docs/reference/config/).
 *
 * You don't need to import the Global library. It's available in the `run` function of your `sst.config.ts`.
 *
 * :::note
 * The Global library is only available in the `run` function of your `sst.config.ts`.
 * :::
 *
 * For example, you can get the name of your app in your app config using `$app.name`.
 *
 * ```ts title="sst.config.ts" {4}
 * export default $config({
 *   // ...
 *   async run() {
 *     console.log($app.name);
 *   }
 * });
 * ```
 *
 * The **variables** contain the context of the app that's being run. While the **functions** help you work with the [Outputs of components](/docs/components##inputs--outputs).
 *
 * @packageDocumentation
 */

import "@types/node";
import * as util from "@pulumi/pulumi";
import * as _sst from "./components/index";
import { $config as config, App } from "./config";

type Simplify<T> = {
  [K in keyof T]: T[K];
} & {};

/** @internal */
interface $APP
  extends Readonly<{
    /**
     * The name of the current app.
     */
    name: string;
    /**
     * The stage currently being run. You can use this to conditionally deploy resources based
     * on the stage.
     *
     * For example, to deploy a bucket only in the `dev` stage:
     *
     * ```ts title="sst.config.ts"
     * if ($app.stage === "dev") {
     *   new sst.aws.Bucket("MyBucket");
     * }
     * ```
     */
    stage: string;
    /**
     * The removal policy for the current stage. If `removal` was not set in the `sst.config.ts`, this will be return its default value, `retain`.
     */
    removal: "remove" | "retain" | "retain-all";
    /**
     * The providers currently being used in the app.
     */
    providers: App["providers"];

    /**
     * If true, prevents `sst remove` from being executed on this stage
     */
    protect: boolean;
  }> {}

declare global {
  // @ts-expect-error
  export import sst = _sst;

  /** @internal */
  export const $linkable: typeof import("./components/link").Link.linkable;

  /**
   * A convenience reference to the the [`util`](https://www.pulumi.com/docs/reference/pkg/nodejs/pulumi/pulumi/) module from Pulumi.
   *
   * This is useful for working with components. You can use these without importing or installing the Pulumi SDK.
   *
   * @example
   *
   * For example, to create a new asset, you can:
   *
   * ```ts title="sst.config.ts"
   * const myFiles = new $util.asset.FileArchive("./path/to/files");
   * ```
   *
   * This is equivalent to doing:
   *
   * ```ts title="sst.config.ts"
   * import * as pulumi from "@pulumi/pulumi";
   *
   * const myFiles = new pulumi.asset.FileArchive("./path/to/files");
   * ```
   */
  // @ts-expect-error
  export import $util = util;

  /** @internal */
  export const $output: typeof util.output;
  /**
   * Wait for a list of Output values to be resolved, and then apply a function to their resolved values.
   *
   * @example
   * Say you had a couple of S3 Buckets:
   * ```ts title="sst.config.ts"
   * const bucket1 = new sst.aws.Bucket("MyBucket1");
   * const bucket2 = new sst.aws.Bucket("MyBucket2");
   * ```
   *
   * You can run a function after both of them are resolved:
   *
   * ```ts title="sst.config.ts"
   * $resolve([bucket1.name, bucket2.name]).apply(([value1, value2]) =>
   *   console.log({ value1, value2 })
   * );
   * ```
   */
  export function $resolve<T extends Record<string, any>>(
    val: T,
  ): util.Output<util.Unwrap<T>>;
  export function $resolve<T1, T2, T3, T4, T5, T6, T7, T8>(
    values: [
      util.Input<T1>,
      util.Input<T2>,
      util.Input<T3>,
      util.Input<T4>,
      util.Input<T5>,
      util.Input<T6>,
      util.Input<T7>,
      util.Input<T8>,
    ],
  ): util.Output<
    [
      util.Unwrap<T1>,
      util.Unwrap<T2>,
      util.Unwrap<T3>,
      util.Unwrap<T4>,
      util.Unwrap<T5>,
      util.Unwrap<T6>,
      util.Unwrap<T7>,
      util.Unwrap<T8>,
    ]
  >;
  export function $resolve<T1, T2, T3, T4, T5, T6, T7>(
    values: [
      util.Input<T1>,
      util.Input<T2>,
      util.Input<T3>,
      util.Input<T4>,
      util.Input<T5>,
      util.Input<T6>,
      util.Input<T7>,
    ],
  ): util.Output<
    [
      util.Unwrap<T1>,
      util.Unwrap<T2>,
      util.Unwrap<T3>,
      util.Unwrap<T4>,
      util.Unwrap<T5>,
      util.Unwrap<T6>,
      util.Unwrap<T7>,
    ]
  >;
  export function $resolve<T1, T2, T3, T4, T5, T6>(
    values: [
      util.Input<T1>,
      util.Input<T2>,
      util.Input<T3>,
      util.Input<T4>,
      util.Input<T5>,
      util.Input<T6>,
    ],
  ): util.Output<
    [
      util.Unwrap<T1>,
      util.Unwrap<T2>,
      util.Unwrap<T3>,
      util.Unwrap<T4>,
      util.Unwrap<T5>,
      util.Unwrap<T6>,
    ]
  >;
  export function $resolve<T1, T2, T3, T4, T5>(
    values: [
      util.Input<T1>,
      util.Input<T2>,
      util.Input<T3>,
      util.Input<T4>,
      util.Input<T5>,
    ],
  ): util.Output<
    [
      util.Unwrap<T1>,
      util.Unwrap<T2>,
      util.Unwrap<T3>,
      util.Unwrap<T4>,
      util.Unwrap<T5>,
    ]
  >;
  export function $resolve<T1, T2, T3, T4>(
    values: [util.Input<T1>, util.Input<T2>, util.Input<T3>, util.Input<T4>],
  ): util.Output<[Unwrap<T1>, util.Unwrap<T2>, Unwrap<T3>, Unwrap<T4>]>;
  export function $resolve<T1, T2, T3>(
    values: [util.Input<T1>, util.Input<T2>, util.Input<T3>],
  ): util.Output<[util.Unwrap<T1>, util.Unwrap<T2>, util.Unwrap<T3>]>;
  export function $resolve<T1, T2>(
    values: [util.Input<T1>, util.Input<T2>],
  ): util.Output<[Unwrap<T1>, util.Unwrap<T2>]>;
  /**
   * Use string interpolation on Output values.
   *
   * @example
   * This is takes care of resolving the Output values for you. Say you had a bucket:
   *
   * ```ts title="sst.config.ts"
   * const bucket = new sst.aws.Bucket("MyBucket");
   * ```
   *
   * Instead of resolving the bucket name first:
   *
   * ```ts title="sst.config.ts"
   * const description = bucket.name.apply(name => `This is a bucket named ${name}`);
   * ```
   *
   * You can directly do this:
   * ```ts title="sst.config.ts"
   * const description = $interpolate`This is a bucket named ${bucket.name}`;
   * ```
   */
  export const $interpolate: typeof util.interpolate;
  /**
   * Takes a sequence of Output values or plain JavaScript values, stringifies each,
   * and concatenates them into one final string.
   *
   * @example
   * This is takes care of resolving the Output values for you. Say you had a bucket:
   *
   * ```ts title="sst.config.ts"
   * const bucket = new sst.aws.Bucket("MyBucket");
   * ```
   *
   * Instead of having to resolve the bucket name first::
   *
   * ```ts title="sst.config.ts"
   * const description = bucket.name.apply(name =>
   *   "This is a bucket named ".concat(name)
   * );
   * ```
   *
   * You can directly do this:
   *
   * ```ts title="sst.config.ts"
   * const description = $concat("This is a bucket named ", bucket.name);
   * ```
   */
  export const $concat: typeof util.concat;
  /**
   * Takes an Output value or plain JavaScript value, uses `JSON.parse`
   * on the resolved JSON string to turn it into a JSON object.
   *
   * @example
   * So for example, instead of doing of resolving the value first:
   *
   * ```ts title="sst.config.ts"
   * const policy = policyStr.apply((policy) =>
   *   JSON.parse(policy)
   * );
   * ```
   *
   * You can directly do this:
   *
   * ```ts title="sst.config.ts"
   * const policy = $jsonParse(policyStr);
   * ```
   */
  export const $jsonParse: typeof util.jsonParse;
  /**
   * Takes an Output value or plain JSON object, uses `JSON.stringify`
   * on the resolved JSON object to turn it into a JSON string.
   *
   * @example
   * So for example, instead of doing of resolving the value first:
   *
   * ```ts title="sst.config.ts"
   * const policy = policyObj.apply((policy) =>
   *   JSON.stringify(policy)
   * );
   * ```
   *
   * You can directly do this:
   *
   * ```ts title="sst.config.ts"
   * const policy = $jsonStringify(policyObj);
   * ```
   */
  export const $jsonStringify: typeof util.jsonStringify;

  /**
   * Context about the app being run.
   */
  export const $app: Simplify<$APP>;

  /**
   * Register a function that'll be called when a component of the given type is about
   * to be created. This is useful for setting global defaults for your components.
   *
   * :::note
   * This function is only called for components that are created **after** the function is registered.
   * :::
   *
   * The function takes the arguments and options that are being passed to the component,
   * and can modify them.
   *
   * @example
   *
   * For example, to set a default runtime for all function components.
   *
   * ```ts title="sst.config.ts"
   * $transform(sst.aws.Function, (args, opts, name) => {
   *   // Set the default if it's not set by the component
   *   args.runtime ??= "nodejs20.x";
   * });
   * ```
   *
   * Here, `args`, `opts` and `name` are what you'd pass to the `Function` component. Recall
   * the signature of the `Function` component:
   *
   * ```ts title="sst.config.ts"
   * new sst.aws.Function(name: string, args: FunctionArgs, opts?: pulumi.ComponentResourceOptions)
   * ```
   */
  export const $transform: typeof import("./components/component").$transform;

  /**
   * Packages a file or directory into a Pulumi asset. This can be used for Pulumi resources that
   * take an asset as input.
   *
   * When the given path is a file, it returns a
   * [`FileAsset`](https://www.pulumi.com/docs/iac/concepts/assets-archives/#assets). If the
   * path is a directory, it returns a
   * [`FileArchive`](https://www.pulumi.com/docs/iac/concepts/assets-archives/#assets) with the
   * zipped contents of the directory.
   *
   * :::tip
   * This automatically resolves paths relative to the root of the app.
   * :::
   *
   * Relative paths are resolved relative to the root of the app. While, absolute paths are used as is.
   *
   * @example
   *
   * If you have a file inside the `images` directory at the root of your app, you can upload it
   * to S3 on deploy.
   *
   * ```ts title="sst.config.ts" {7}
   * const bucket = new aws.s3.Bucket("MyBucket");
   *
   * new aws.s3.BucketObjectv2("MyImage", {
   *   bucket: bucket.name,
   *   key: "public/spongebob.svg",
   *   contentType: "image/svg+xml",
   *   source: $asset("images/spongebob.svg"),
   * });
   * ```
   *
   * You can also use this to zip up the files in the `files/` directory and upload it to S3.
   *
   * ```ts title="sst.config.ts" {5}
   * new aws.s3.BucketObjectv2("MyZip", {
   *   bucket: bucket.name,
   *   key: "public/spongebob.zip",
   *   contentType: "application/zip",
   *   source: $asset("files"),
   * });
   * ```
   */
  export const $asset: typeof import("./components/component").$asset;

  /**
   * Returns `true` if the app is running in `sst dev`.
   */
  export const $dev: boolean;

  /** @internal */
  export const $cli: {
    command: string;
    rpc: string;
    paths: {
      home: string;
      root: string;
      work: string;
      platform: string;
    };
    state: {
      version: Record<string, number>;
    };
  };
}
