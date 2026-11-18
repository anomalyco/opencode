import { ComponentResourceOptions } from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import { Component, Transform, transform } from "../component";
import { Link } from "../link";
import { binding } from "./binding";
import { DEFAULT_ACCOUNT_ID } from "./account-id";

export interface KvArgs {
  /**
   * [Transform](/docs/components/#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the R2 KV namespace resource.
     */
    namespace?: Transform<cloudflare.WorkersKvNamespaceArgs>;
  };
}

/**
 * The `Kv` component lets you add a [Cloudflare KV storage namespace](https://developers.cloudflare.com/kv/) to
 * your app.
 *
 * @example
 *
 * #### Minimal example
 *
 * ```ts title="sst.config.ts"
 * const storage = new sst.cloudflare.Kv("MyStorage");
 * ```
 *
 * #### Link to a worker
 *
 * You can link KV to a worker.
 *
 * ```ts {3} title="sst.config.ts"
 * new sst.cloudflare.Worker("MyWorker", {
 *   handler: "./index.ts",
 *   link: [storage],
 *   url: true
 * });
 * ```
 *
 * Once linked, you can use the SDK to interact with the bucket.
 *
 * ```ts title="index.ts" {3}
 * import { Resource } from "sst";
 *
 * await Resource.MyStorage.get("someKey");
 * ```
 */
export class Kv extends Component implements Link.Linkable {
  private namespace: cloudflare.WorkersKvNamespace;

  constructor(name: string, args?: KvArgs, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);

    const parent = this;

    const namespace = createNamespace();

    this.namespace = namespace;

    function createNamespace() {
      return new cloudflare.WorkersKvNamespace(
        ...transform(
          args?.transform?.namespace,
          `${name}Namespace`,
          {
            title: "",
            accountId: DEFAULT_ACCOUNT_ID,
          },
          { parent },
        ),
      );
    }
  }

  /**
   * When you link a KV storage, the storage will be available to the worker and you can
   * interact with it using its [API methods](https://developers.cloudflare.com/kv/api/).
   *
   * @example
   * ```ts title="index.ts" {3}
   * import { Resource } from "sst";
   *
   * await Resource.MyStorage.get("someKey");
   * ```
   *
   * @internal
   */
  getSSTLink() {
    return {
      properties: {
        namespaceId: this.namespace.id,
      },
      include: [
        binding({
          type: "kvNamespaceBindings",
          properties: {
            namespaceId: this.namespace.id,
          },
        }),
      ],
    };
  }

  /**
   * The generated ID of the KV namespace.
   */
  public get id() {
    return this.namespace.id;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The Cloudflare KV namespace.
       */
      namespace: this.namespace,
    };
  }
}

const __pulumiType = "sst:cloudflare:Kv";
// @ts-expect-error
Kv.__pulumiType = __pulumiType;
