import {
  ComponentResourceOptions,
  interpolate,
  jsonStringify,
  Output,
  output,
} from "@pulumi/pulumi";
import { $print, Component, Transform, transform } from "../component";
import { Link } from "../link";
import { Input } from "../input.js";
import { iam, opensearch, secretsmanager } from "@pulumi/aws";
import { RandomPassword } from "@pulumi/random";
import { VisibleError } from "../error";
import { SizeGbTb, toGBs } from "../size";
import { DevCommand } from "../experimental/dev-command.js";

export interface OpenSearchArgs {
  /**
   * The OpenSearch engine version. Check out the [available versions](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/what-is.html#choosing-version).
   * @default `"OpenSearch_2.17"`
   * @example
   * ```js
   * {
   *   version: "OpenSearch_2.5"
   * }
   * ```
   */
  version?: Input<string>;
  /**
   * The username of the master user.
   *
   * :::caution
   * Changing the username will cause the domain to be destroyed and recreated.
   * :::
   *
   * @default `"admin"`
   * @example
   * ```js
   * {
   *   username: "admin"
   * }
   * ```
   */
  username?: Input<string>;
  /**
   * The password of the master user.
   * @default A random password is generated.
   * @example
   * ```js
   * {
   *   password: "^Passw0rd^"
   * }
   * ```
   *
   * Use [Secrets](/docs/component/secret) to manage the password.
   * ```js
   * {
   *   password: new sst.Secret("MyDomainPassword").value
   * }
   * ```
   */
  password?: Input<string>;
  /**
   * The type of instance to use for the domain. Check out the [supported instance types](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/supported-instance-types.html).
   *
   * @default `"t3.small"`
   * @example
   * ```js
   * {
   *   instance: "m6g.large"
   * }
   * ```
   */
  instance?: Input<string>;
  /**
   * The storage limit for the domain.
   *
   * @default `"10 GB"`
   * @example
   * ```js
   * {
   *   storage: "100 GB"
   * }
   * ```
   */
  storage?: Input<SizeGbTb>;
  /**
   * Configure how this component works in `sst dev`.
   *
   * By default, your OpenSearch domain is deployed in `sst dev`. But if you want to
   * instead connect to a locally running OpenSearch, you can configure the `dev` prop.
   *
   * :::note
   * By default, this creates a new OpenSearch domain even in `sst dev`.
   * :::
   *
   * This will skip deploying an OpenSearch domain and link to the locally running
   * OpenSearch process instead.
   *
   * @example
   *
   * Setting the `dev` prop also means that any linked resources will connect to the right
   * instance both in `sst dev` and `sst deploy`.
   *
   * ```ts
   * {
   *   dev: {
   *     username: "admin",
   *     password: "Passw0rd!",
   *     url: "http://localhost:9200"
   *   }
   * }
   * ```
   */
  dev?: {
    /**
     * The URL of the local OpenSearch to connect to when running in dev.
     * @default `"http://localhost:9200"`
     */
    url?: Input<string>;
    /**
     * The username of the local OpenSearch to connect to when running in dev.
     * @default Inherit from the top-level [`username`](#username).
     */
    username?: Input<string>;
    /**
     * The password of the local OpenSearch to connect to when running in dev.
     * @default Inherit from the top-level [`password`](#password).
     */
    password?: Input<string>;
  };
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the OpenSearch domain.
     */
    domain?: Transform<opensearch.DomainArgs>;
    /**
     * Transform the OpenSearch domain policy.
     */
    policy?: Transform<iam.PolicyDocument>;
  };
}

interface OpenSearchRef {
  ref: boolean;
  id: Input<string>;
}

/**
 * The `OpenSearch` component lets you add a deployed instance of OpenSearch, or an
 * OpenSearch _domain_ to your app using [Amazon OpenSearch Service](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/what-is.html).
 *
 * @example
 *
 * #### Create the instance
 *
 * ```js title="sst.config.ts"
 * const search = new sst.aws.OpenSearch("MySearch");
 * ```
 *
 * #### Link to a resource
 *
 * You can link your instance to other resources, like a function or your Next.js app.
 *
 * ```ts title="sst.config.ts"
 * new sst.aws.Nextjs("MyWeb", {
 *   link: [search]
 * });
 * ```
 *
 * Once linked, you can connect to it from your function code.
 *
 * ```ts title="app/page.tsx" {1,5-9}
 * import { Resource } from "sst";
 * import { Client } from "@opensearch-project/opensearch";
 *
 * const client = new Client({
 *   node: Resource.MySearch.url,
 *   auth: {
 *     username: Resource.MySearch.username,
 *     password: Resource.MySearch.password
 *   }
 * });
 *
 * // Add a document
 * await client.index({
 *   index: "my-index",
 *   body: { message: "Hello world!" }
 * });
 *
 * // Search for documents
 * const result = await client.search({
 *   index: "my-index",
 *   body: { query: { match: { message: "world" } } }
 * });
 * ```
 *
 * #### Running locally
 *
 * By default, your OpenSearch domain is deployed in `sst dev`. But let's say you are
 * running OpenSearch locally.
 *
 * ```bash
 * docker run \
 *   --rm \
 *   -p 9200:9200 \
 *   -v $(pwd)/.sst/storage/opensearch:/usr/share/opensearch/data \
 *   -e discovery.type=single-node \
 *   -e plugins.security.disabled=true \
 *   -e OPENSEARCH_INITIAL_ADMIN_PASSWORD=^Passw0rd^ \
 *   opensearchproject/opensearch:2.17.0
 * ```
 *
 * You can connect to it in `sst dev` by configuring the `dev` prop.
 *
 * ```ts title="sst.config.ts" {3-5}
 * const opensearch = new sst.aws.OpenSearch("MyOpenSearch", {
 *   dev: {
 *     url: "http://localhost:9200",
 *     username: "admin",
 *     password: "^Passw0rd^"
 *   }
 * });
 * ```
 *
 * This will skip deploying an OpenSearch domain and link to the locally running
 * OpenSearch process instead.
 *
 * ---
 *
 * ### Cost
 *
 * By default this component uses a _Single-AZ Deployment_, _On-Demand Instances_ of a
 * `t3.small.search` at $0.036 per hour. And 10GB of _General Purpose gp3 Storage_
 * at $0.122 per GB per month.
 *
 * That works out to $0.036 x 24 x 30 + $0.122 x 10 or **$27 per month**. Adjust this for
 * the `instance` type and the `storage` you are using.
 *
 * The above are rough estimates for _us-east-1_, check out the [OpenSearch Service pricing](https://aws.amazon.com/opensearch-service/pricing/)
 * for more details.
 */
export class OpenSearch extends Component implements Link.Linkable {
  private domain?: opensearch.Domain;
  private _username?: Output<string>;
  private _password?: Output<string>;
  private dev?: {
    enabled: boolean;
    url: Output<string>;
    username: Output<string>;
    password: Output<string>;
  };

  constructor(
    name: string,
    args: OpenSearchArgs = {},
    opts: ComponentResourceOptions = {},
  ) {
    super(__pulumiType, name, args, opts);
    const self = this;

    if (args && "ref" in args) {
      const ref = reference();
      this.domain = ref.domain;
      this._username = ref.username;
      this._password = ref.password;
      return;
    }

    const engineVersion = output(args.version).apply(
      (v) => v ?? "OpenSearch_2.17",
    );
    const instanceType = output(args.instance).apply((v) => v ?? "t3.small");
    const username = output(args.username).apply((v) => v ?? "admin");
    const storage = normalizeStorage();

    const dev = registerDev();
    if (dev?.enabled) {
      this.dev = dev;
      return;
    }

    const password = createPassword();
    const secret = createSecret();
    const domain = createDomain();
    const policy = createPolicy();

    this.domain = domain;
    this._username = username;
    this._password = password;
    this.registerOutputs({
      _hint: this.url,
    });

    function reference() {
      const ref = args as unknown as OpenSearchRef;
      // Note: passing in `parent` causes Pulumi to lookup the current component's
      //       generated ID for the Domain. Not the one passed int. Need to look into
      //       this.
      //const domain = opensearch.Domain.get(`${name}Domain`, ref.id, undefined, {
      //  parent: self,
      //});
      const domain = opensearch.Domain.get(`${name}Domain`, ref.id);

      const input = domain.tags.apply((tags) => {
        if (!tags?.["sst:ref:username"])
          throw new VisibleError(
            `Failed to get username for OpenSearch ${name}.`,
          );
        if (!tags?.["sst:ref:password"])
          throw new VisibleError(
            `Failed to get password for OpenSearch ${name}.`,
          );

        return {
          username: tags["sst:ref:username"],
          password: tags["sst:ref:password"],
        };
      });

      const secret = secretsmanager.getSecretVersionOutput(
        { secretId: input.password },
        { parent: self },
      );
      const password = $jsonParse(secret.secretString).apply(
        (v) => v.password as string,
      );

      return { domain, username: input.username, password };
    }

    function normalizeStorage() {
      return output(args.storage ?? "10 GB").apply((v) => {
        const size = toGBs(v);
        if (size < 10) {
          throw new VisibleError(
            `Storage must be at least 10 GB for the ${name} OpenSearch domain.`,
          );
        }
        return size;
      });
    }

    function registerDev() {
      if (!args.dev) return undefined;

      if (
        $dev &&
        args.dev.password === undefined &&
        args.password === undefined
      ) {
        throw new VisibleError(
          `You must provide the password to connect to your locally running OpenSearch domain either by setting the "dev.password" or by setting the top-level "password" property.`,
        );
      }

      const dev = {
        enabled: $dev,
        url: output(args.dev.url ?? "http://localhost:9200"),
        username: args.dev.username ? output(args.dev.username) : username,
        password: output(args.dev.password ?? args.password ?? ""),
      };

      new DevCommand(`${name}Dev`, {
        dev: {
          title: name,
          autostart: true,
          command: `sst print-and-not-quit`,
        },
        environment: {
          SST_DEV_COMMAND_MESSAGE: interpolate`Make sure your local OpenSearch server is using:

  username: "${dev.username}"
  password: "${dev.password}"

Listening on "${dev.url}"...`,
        },
      });

      return dev;
    }

    function createPassword() {
      return args.password
        ? output(args.password)
        : new RandomPassword(
          `${name}Password`,
          {
            length: 32,
            minLower: 1,
            minUpper: 1,
            minNumeric: 1,
            minSpecial: 1,
          },
          { parent: self },
        ).result;
    }

    function createSecret() {
      const secret = new secretsmanager.Secret(
        `${name}Secret`,
        {
          recoveryWindowInDays: 0,
        },
        { parent: self },
      );

      new secretsmanager.SecretVersion(
        `${name}SecretVersion`,
        {
          secretId: secret.id,
          secretString: jsonStringify({
            username,
            password,
          }),
        },
        { parent: self },
      );

      return secret;
    }

    function createDomain() {
      return new opensearch.Domain(
        ...transform(
          args.transform?.domain,
          `${name}Domain`,
          {
            engineVersion,
            clusterConfig: {
              instanceType: interpolate`${instanceType}.search`,
              instanceCount: 1,
              dedicatedMasterEnabled: false,
              zoneAwarenessEnabled: false,
            },
            ebsOptions: {
              ebsEnabled: true,
              volumeSize: storage,
              volumeType: "gp3",
            },
            advancedSecurityOptions: {
              enabled: true,
              internalUserDatabaseEnabled: true,
              masterUserOptions: {
                masterUserName: username,
                masterUserPassword: password,
              },
            },
            nodeToNodeEncryption: {
              enabled: true,
            },
            encryptAtRest: {
              enabled: true,
            },
            domainEndpointOptions: {
              enforceHttps: true,
              tlsSecurityPolicy: "Policy-Min-TLS-1-2-2019-07",
            },
            tags: {
              "sst:ref:password": secret.id,
              "sst:ref:username": username,
            },
          },
          { parent: self },
        ),
      );
    }

    function createPolicy() {
      return new opensearch.DomainPolicy(
        `${name}DomainPolicy`,
        {
          domainName: domain.domainName,
          accessPolicies: iam.getPolicyDocumentOutput({
            statements: [
              {
                principals: [{ type: "*", identifiers: ["*"] }],
                actions: ["*"],
                resources: ["*"],
              },
            ],
          }).json,
        },
        { parent: self },
      );
    }
  }

  /**
   * The ID of the OpenSearch component.
   */
  public get id() {
    if (this.dev?.enabled) return output("placeholder");
    return this.domain!.id;
  }

  /** The username of the master user. */
  public get username() {
    if (this.dev?.enabled) return this.dev.username;
    return this._username!;
  }

  /** The password of the master user. */
  public get password() {
    if (this.dev?.enabled) return this.dev.password;
    return this._password!;
  }

  /**
   * The endpoint of the domain.
   */
  public get url() {
    if (this.dev?.enabled) return this.dev.url;
    return interpolate`https://${this.domain!.endpoint}`;
  }

  public get nodes() {
    return {
      domain: this.domain,
    };
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        username: this.username,
        password: this.password,
        url: this.url,
      },
    };
  }

  /**
   * Reference an existing OpenSearch domain with the given name. This is useful when you
   * create a domain in one stage and want to share it in another. It avoids
   * having to create a new domain in the other stage.
   *
   * :::tip
   * You can use the `static get` method to share OpenSearch domains across stages.
   * :::
   *
   * @param name The name of the component.
   * @param id The ID of the existing OpenSearch component.
   * @param opts? Resource options.
   *
   * @example
   * Imagine you create a domain in the `dev` stage. And in your personal stage `frank`,
   * instead of creating a new domain, you want to share the same domain from `dev`.
   *
   * ```ts title="sst.config.ts"
   * const search = $app.stage === "frank"
   *   ? sst.aws.OpenSearch.get("MyOpenSearch", "app-dev-myopensearch-efsmkrbt")
   *   : new sst.aws.OpenSearch("MyOpenSearch");
   * ```
   *
   * Here `app-dev-myopensearch-efsmkrbt` is the
   * ID of the OpenSearch component created in the `dev` stage.
   * You can find this by outputting the ID in the `dev` stage.
   *
   * ```ts title="sst.config.ts"
   * return {
   *   id: search.id
   * };
   * ```
   */
  public static get(
    name: string,
    id: Input<string>,
    opts?: ComponentResourceOptions,
  ) {
    return new OpenSearch(
      name,
      {
        ref: true,
        id,
      } as unknown as OpenSearchArgs,
      opts,
    );
  }
}

const __pulumiType = "sst:aws:OpenSearch";
// @ts-expect-error
OpenSearch.__pulumiType = __pulumiType;
