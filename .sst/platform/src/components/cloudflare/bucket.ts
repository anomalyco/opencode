import { ComponentResourceOptions } from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import { Component, Transform, transform } from "../component";
import { Link } from "../link.js";
import { binding } from "./binding.js";
import { DEFAULT_ACCOUNT_ID } from "./account-id";

export interface BucketArgs {
  /**
   * [Transform](/docs/components/#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the R2 Bucket resource.
     */
    bucket?: Transform<cloudflare.R2BucketArgs>;
  };
}

/**
 * The `Bucket` component lets you add a [Cloudflare R2 Bucket](https://developers.cloudflare.com/r2/) to
 * your app.
 *
 * @example
 *
 * #### Minimal example
 *
 * ```ts title="sst.config.ts"
 * const bucket = new sst.cloudflare.Bucket("MyBucket");
 * ```
 *
 * #### Link to a worker
 *
 * You can link the bucket to a worker.
 *
 * ```ts {3} title="sst.config.ts"
 * new sst.cloudflare.Worker("MyWorker", {
 *   handler: "./index.ts",
 *   link: [bucket],
 *   url: true
 * });
 * ```
 *
 * Once linked, you can use the SDK to interact with the bucket.
 *
 * ```ts title="index.ts" {3}
 * import { Resource } from "sst";
 *
 * await Resource.MyBucket.list();
 * ```
 */
export class Bucket extends Component implements Link.Linkable {
  private bucket: cloudflare.R2Bucket;

  constructor(
    name: string,
    args?: BucketArgs,
    opts?: ComponentResourceOptions,
  ) {
    super(__pulumiType, name, args, opts);

    const parent = this;

    const bucket = createBucket();

    this.bucket = bucket;

    function createBucket() {
      return new cloudflare.R2Bucket(
        ...transform(
          args?.transform?.bucket,
          `${name}Bucket`,
          {
            name: "",
            accountId: DEFAULT_ACCOUNT_ID,
          },
          { parent },
        ),
      );
    }
  }

  /**
   * When you link a bucket to a worker, you can interact with it using these
   * [Bucket methods](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#bucket-method-definitions).
   *
   * @example
   * ```ts title="index.ts" {3}
   * import { Resource } from "sst";
   *
   * await Resource.MyBucket.list();
   * ```
   *
   * @internal
   */
  getSSTLink() {
    return {
      properties: {
        name: this.bucket.name,
      },
      include: [
        binding({
          type: "r2BucketBindings",
          properties: {
            bucketName: this.bucket.name,
          },
        }),
      ],
    };
  }

  /**
   * The generated name of the R2 Bucket.
   */
  public get name() {
    return this.bucket.name;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The Cloudflare R2 Bucket.
       */
      bucket: this.bucket,
    };
  }
}

const __pulumiType = "sst:cloudflare:Bucket";
// @ts-expect-error
Bucket.__pulumiType = __pulumiType;
