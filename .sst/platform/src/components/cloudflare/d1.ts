import { ComponentResourceOptions } from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import { Component, Transform, transform } from "../component";
import { Link } from "../link";
import { binding } from "./binding";
import { DEFAULT_ACCOUNT_ID } from ".";

export interface D1Args {
  /**
   * [Transform](/docs/components/#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the D1 resource.
     */
    database?: Transform<cloudflare.D1DatabaseArgs>;
  };
}

/**
 * The `D1` component lets you add a [Cloudflare D1 database](https://developers.cloudflare.com/d1/) to
 * your app.
 *
 * @example
 *
 * #### Minimal example
 *
 * ```ts title="sst.config.ts"
 * const db = new sst.cloudflare.D1("MyDatabase");
 * ```
 *
 * #### Link to a worker
 *
 * You can link the db to a worker.
 *
 * ```ts {3} title="sst.config.ts"
 * new sst.cloudflare.Worker("MyWorker", {
 *   handler: "./index.ts",
 *   link: [db],
 *   url: true
 * });
 * ```
 *
 * Once linked, you can use the SDK to interact with the db.
 *
 * ```ts title="index.ts" {1} "Resource.MyDatabase.prepare"
 * import { Resource } from "sst";
 *
 * await Resource.MyDatabase.prepare(
 *   "SELECT id FROM todo ORDER BY id DESC LIMIT 1",
 * ).first();
 * ```
 */
export class D1 extends Component implements Link.Linkable {
  private database: cloudflare.D1Database;

  constructor(name: string, args?: D1Args, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);

    const parent = this;

    const db = createDB();

    this.database = db;

    function createDB() {
      return new cloudflare.D1Database(
        ...transform(
          args?.transform?.database,
          `${name}Database`,
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
   * When you link a D1 database, the database will be available to the worker and you can
   * query it using its [API methods](https://developers.cloudflare.com/d1/build-with-d1/d1-client-api/).
   *
   * @example
   * ```ts title="index.ts" {1} "Resource.MyDatabase.prepare"
   * import { Resource } from "sst";
   *
   * await Resource.MyDatabase.prepare(
   *   "SELECT id FROM todo ORDER BY id DESC LIMIT 1",
   * ).first();
   * ```
   *
   * @internal
   */
  getSSTLink() {
    return {
      properties: {
        databaseId: this.database.id,
      },
      include: [
        binding({
          type: "d1DatabaseBindings",
          properties: {
            id: this.database.id,
          },
        }),
      ],
    };
  }

  /**
   * The generated ID of the D1 database.
   */
  public get databaseId() {
    return this.database.id;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The Cloudflare D1 database.
       */
      database: this.database,
    };
  }
}

const __pulumiType = "sst:cloudflare:D1";
// @ts-expect-error
D1.__pulumiType = __pulumiType;
