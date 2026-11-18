import {
  all,
  ComponentResourceOptions,
  interpolate,
  jsonStringify,
  Output,
  output,
} from "@pulumi/pulumi";
import { RandomPassword } from "@pulumi/random";
import { Component, Transform, transform } from "../component.js";
import { Link } from "../link.js";
import { Input } from "../input.js";
import { elasticache, secretsmanager } from "@pulumi/aws";
import { Vpc } from "./vpc.js";
import { VisibleError } from "../error.js";
import { DevCommand } from "../experimental/dev-command.js";
import { Redis as RedisV1 } from "./redis-v1";

export interface RedisArgs {
  /**
   * The Redis engine to use. The following engines are supported:
   *
   * - `"redis"`: The open-source version of Redis.
   * - `"valkey"`: [Valkey](https://valkey.io/) is a Redis-compatible in-memory key-value store.
   *
   * @default `"redis"`
   */
  engine?: Input<"redis" | "valkey">;
  /**
   * The version of Redis.
   *
   * The default is `"7.1"` for the `"redis"` engine and `"7.2"` for the `"valkey"` engine.
   *
   * Check out the [supported versions](https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/supported-engine-versions.html).
   *
   * @default `"7.1"` for Redis, `"7.2"` for Valkey
   * @example
   * ```js
   * {
   *   version: "6.2"
   * }
   * ```
   */
  version?: Input<string>;
  /**
   * The type of instance to use for the nodes of the Redis instance. Check out the [supported instance types](https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/CacheNodes.SupportedTypes.html).
   *
   * @default `"t4g.micro"`
   * @example
   * ```js
   * {
   *   instance: "m7g.xlarge"
   * }
   * ```
   */
  instance?: Input<string>;
  /**
   * @deprecated The `cluster.nodes` prop is now the recommended way to configure the
   * number of nodes in the cluster.
   */
  nodes?: Input<number>;
  /**
   * Configure cluster mode for Redis.
   *
   * @default `{ nodes: 1 }`
   * @example
   * Disable cluster mode.
   * ```js
   * {
   *   cluster: false
   * }
   * ```
   */
  cluster?: Input<
    | boolean
    | {
        /**
         * The number of nodes to use for the Redis cluster.
         *
         * @default `1`
         * @example
         * ```js
         * {
         *   nodes: 4
         * }
         * ```
         */
        nodes: Input<number>;
      }
  >;
  /**
   * Key-value pairs that define custom parameters for the Redis's parameter group.
   * These values override the defaults set by AWS.
   *
   * @example
   * ```js
   * {
   *   parameters: {
   *     "maxmemory-policy": "noeviction"
   *   }
   * }
   * ```
   */
  parameters?: Input<Record<string, Input<string>>>;
  /**
   * The VPC to use for the Redis instance.
   *
   * @example
   * Create a VPC component.
   *
   * ```js
   * const myVpc = new sst.aws.Vpc("MyVpc");
   * ```
   *
   * And pass it in.
   *
   * ```js
   * {
   *   vpc: myVpc
   * }
   * ```
   *
   * Or pass in a custom VPC configuration.
   *
   * ```js
   * {
   *   vpc: {
   *     subnets: ["subnet-0db7376a7ad4db5fd ", "subnet-06fc7ee8319b2c0ce"],
   *     securityGroups: ["sg-0399348378a4c256c"]
   *   }
   * }
   * ```
   */
  vpc:
    | Vpc
    | Input<{
        /**
         * A list of subnet IDs in the VPC to deploy the Redis instance in.
         */
        subnets: Input<Input<string>[]>;
        /**
         * A list of VPC security group IDs.
         */
        securityGroups: Input<Input<string>[]>;
      }>;
  /**
   * Configure how this component works in `sst dev`.
   *
   * By default, your Redis instance is deployed in `sst dev`. But if you want to instead
   * connect to a locally running Redis server, you can configure the `dev` prop.
   *
   * :::note
   * By default, this creates a new Redis ElastiCache instance even in `sst dev`.
   * :::
   *
   * This will skip deploying a Redis ElastiCache instance and link to the locally running
   * Redis server instead.
   *
   * @example
   *
   * Setting the `dev` prop also means that any linked resources will connect to the right
   * Redis instance both in `sst dev` and `sst deploy`.
   *
   * ```ts
   * {
   *   dev: {
   *     host: "localhost",
   *     port: 6379
   *   }
   * }
   * ```
   */
  dev?: {
    /**
     * The host of the local Redis server to connect to when running in dev.
     * @default `"localhost"`
     */
    host?: Input<string>;
    /**
     * The port of the local Redis server when running in dev.
     * @default `6379`
     */
    port?: Input<number>;
    /**
     * The username of the local Redis server to connect to when running in dev.
     * @default `"default"`
     */
    username?: Input<string>;
    /**
     * The password of the local Redis server to connect to when running in dev.
     * @default No password
     */
    password?: Input<string>;
  };
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the Redis subnet group.
     */
    subnetGroup?: Transform<elasticache.SubnetGroupArgs>;
    /**
     * Transform the Redis parameter group.
     */
    parameterGroup?: Transform<elasticache.ParameterGroupArgs>;
    /**
     * Transform the Redis cluster.
     */
    cluster?: Transform<elasticache.ReplicationGroupArgs>;
  };
}

interface RedisRef {
  ref: boolean;
  clusterId: Input<string>;
}

/**
 * The `Redis` component lets you add a Redis cluster to your app using
 * [Amazon ElastiCache](https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/WhatIs.html).
 *
 * @example
 *
 * #### Create the cluster
 *
 * ```js title="sst.config.ts"
 * const vpc = new sst.aws.Vpc("MyVpc");
 * const redis = new sst.aws.Redis("MyRedis", { vpc });
 * ```
 *
 * #### Link to a resource
 *
 * You can link your cluster to other resources, like a function or your Next.js app.
 *
 * ```ts title="sst.config.ts"
 * new sst.aws.Nextjs("MyWeb", {
 *   link: [redis],
 *   vpc
 * });
 * ```
 *
 * Once linked, you can connect to it from your function code.
 *
 * ```ts title="app/page.tsx" {1,6,7,12,13}
 * import { Resource } from "sst";
 * import { Cluster } from "ioredis";
 *
 * const client = new Cluster(
 *   [{
 *     host: Resource.MyRedis.host,
 *     port: Resource.MyRedis.port
 *   }],
 *   {
 *     redisOptions: {
 *       tls: { checkServerIdentity: () => undefined },
 *       username: Resource.MyRedis.username,
 *       password: Resource.MyRedis.password
 *     }
 *   }
 * );
 * ```
 *
 * #### Running locally
 *
 * By default, your Redis cluster is deployed in `sst dev`. But let's say you are running Redis
 * locally.
 *
 * ```bash
 * docker run \
 *   --rm \
 *   -p 6379:6379 \
 *   -v $(pwd)/.sst/storage/redis:/data \
 *   redis:latest
 * ```
 *
 * You can connect to it in `sst dev` by configuring the `dev` prop.
 *
 * ```ts title="sst.config.ts" {3-6}
 * const redis = new sst.aws.Redis("MyRedis", {
 *   vpc,
 *   dev: {
 *     host: "localhost",
 *     port: 6379
 *   }
 * });
 * ```
 *
 * This will skip deploying a Redis ElastiCache cluster and link to the locally running Redis
 * server instead. [Check out the full example](/docs/examples/#aws-redis-local).
 *
 * ---
 *
 * ### Cost
 *
 * By default this component uses _On-demand nodes_ with a single `cache.t4g.micro` instance.
 *
 * The default `redis` engine costs $0.016 per hour. That works out to $0.016 x 24 x 30 or **$12 per month**.
 *
 * If the `valkey` engine is used, the cost is $0.0128 per hour. That works out to $0.0128 x 24 x 30 or **$9 per month**.
 *
 * Adjust this for the `instance` type and number of `nodes` you are using.
 *
 * The above are rough estimates for _us-east-1_, check out the
 * [ElastiCache pricing](https://aws.amazon.com/elasticache/pricing/) for more details.
 */
export class Redis extends Component implements Link.Linkable {
  private cluster?: Output<elasticache.ReplicationGroup>;
  private _authToken?: Output<string>;
  private dev?: {
    enabled: boolean;
    host: Output<string>;
    port: Output<number>;
    username: Output<string>;
    password?: Output<string>;
  };
  public static v1 = RedisV1;

  constructor(name: string, args: RedisArgs, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);
    const _version = 2;
    const self = this;

    if (args && "ref" in args) {
      const ref = reference();
      this.cluster = output(ref.cluster);
      this._authToken = ref.authToken;
      return;
    }

    registerVersion();
    const engine = output(args.engine).apply((v) => v ?? "redis");
    const version = all([engine, args.version]).apply(
      ([engine, v]) => v ?? (engine === "redis" ? "7.1" : "7.2"),
    );
    const instance = output(args.instance).apply((v) => v ?? "t4g.micro");
    const argsCluster = normalizeCluster();
    const vpc = normalizeVpc();

    const dev = registerDev();
    if (dev?.enabled) {
      this.dev = dev;
      return;
    }

    const { authToken, secret } = createAuthToken();
    const subnetGroup = createSubnetGroup();
    const parameterGroup = createParameterGroup();
    const cluster = createCluster();

    this.cluster = cluster;
    this._authToken = authToken;

    function reference() {
      const ref = args as unknown as RedisRef;
      const cluster = elasticache.ReplicationGroup.get(
        `${name}Cluster`,
        ref.clusterId,
        undefined,
        { parent: self },
      );

      const input = cluster.tags.apply((tags) => {
        registerVersion(
          tags?.["sst:component-version"]
            ? parseInt(tags["sst:component-version"])
            : undefined,
        );

        if (!tags?.["sst:ref:secret"])
          throw new VisibleError(
            `Failed to lookup secret for Redis cluster "${name}".`,
          );

        return {
          secretRef: tags?.["sst:ref:secret"],
        };
      });

      const secret = secretsmanager.getSecretVersionOutput(
        { secretId: input.secretRef },
        { parent: self },
      );
      const authToken = secret.secretString.apply((v) => {
        return JSON.parse(v).authToken as string;
      });

      return { cluster, authToken };
    }

    function registerVersion(overrideVersion?: number) {
      const oldVersion = overrideVersion ?? $cli.state.version[name];
      self.registerVersion({
        new: _version,
        old: oldVersion,
        message: [
          `There is a new version of "Redis" that has breaking changes.`,
          ``,
          `To continue using the previous version, rename "Redis" to "Redis.v${oldVersion}".`,
          `Or recreate this component to update - https://sst.dev/docs/components/#versioning`,
        ].join("\n"),
      });
    }

    function registerDev() {
      if (!args.dev) return undefined;

      const dev = {
        enabled: $dev,
        host: output(args.dev.host ?? "localhost"),
        port: output(args.dev.port ?? 6379),
        username: output(args.dev.username ?? "default"),
        password: args.dev.password ? output(args.dev.password) : undefined,
      };

      new DevCommand(`${name}Dev`, {
        dev: {
          title: name,
          autostart: true,
          command: `sst print-and-not-quit`,
        },
        environment: {
          SST_DEV_COMMAND_MESSAGE: interpolate`Make sure your local Redis server is using:

  username: "${dev.username}"
  password: ${
    dev.password ? `"${dev.password}"` : "\x1b[38;5;8m[no password]\x1b[0m"
  }

Listening on "${dev.host}:${dev.port}"...`,
        },
      });

      return dev;
    }

    function normalizeVpc() {
      // "vpc" is a Vpc component
      if (args.vpc instanceof Vpc) {
        return output({
          subnets: args.vpc.privateSubnets,
          securityGroups: args.vpc.securityGroups,
        });
      }

      // "vpc" is object
      return output(args.vpc);
    }

    function normalizeCluster() {
      return all([args.cluster, args.nodes]).apply(([v, nodes]) => {
        if (v === false) return undefined;
        if (v === true) return { nodes: 1 };
        if (v === undefined) {
          if (nodes) return { nodes };
          return { nodes: 1 };
        }
        return v;
      });
    }

    function createAuthToken() {
      const authToken = new RandomPassword(
        `${name}AuthToken`,
        {
          length: 32,
          special: true,
          overrideSpecial: "!&#$^<>-",
        },
        { parent: self },
      ).result;

      const secret = new secretsmanager.Secret(
        `${name}ProxySecret`,
        {
          recoveryWindowInDays: 0,
        },
        { parent: self },
      );

      new secretsmanager.SecretVersion(
        `${name}ProxySecretVersion`,
        {
          secretId: secret.id,
          secretString: jsonStringify({ authToken }),
        },
        { parent: self },
      );

      return { secret, authToken };
    }

    function createSubnetGroup() {
      return new elasticache.SubnetGroup(
        ...transform(
          args.transform?.subnetGroup,
          `${name}SubnetGroup`,
          {
            description: "Managed by SST",
            subnetIds: vpc.subnets,
          },
          { parent: self },
        ),
      );
    }

    function createParameterGroup() {
      return new elasticache.ParameterGroup(
        ...transform(
          args.transform?.parameterGroup,
          `${name}ParameterGroup`,
          {
            description: "Managed by SST",
            family: all([engine, version]).apply(([engine, version]) => {
              const majorVersion = version.split(".")[0];
              const defaultFamily = `${engine}${majorVersion}`;
              return (
                {
                  redis4: "redis4.0",
                  redis5: "redis5.0",
                  redis6: "redis6.x",
                }[defaultFamily] ?? defaultFamily
              );
            }),
            parameters: all([args.parameters ?? {}, argsCluster]).apply(
              ([parameters, argsCluster]) => [
                {
                  name: "cluster-enabled",
                  value: argsCluster ? "yes" : "no",
                },
                ...Object.entries(parameters).map(([name, value]) => ({
                  name,
                  value,
                })),
              ],
            ),
          },
          { parent: self },
        ),
      );
    }

    function createCluster() {
      return argsCluster.apply(
        (argsCluster) =>
          new elasticache.ReplicationGroup(
            ...transform(
              args.transform?.cluster,
              `${name}Cluster`,
              {
                description: "Managed by SST",
                engine,
                engineVersion: version,
                nodeType: interpolate`cache.${instance}`,
                dataTieringEnabled: instance.apply((v) =>
                  v.startsWith("r6gd."),
                ),
                port: 6379,
                ...(argsCluster
                  ? {
                      clusterMode: "enabled",
                      numNodeGroups: argsCluster.nodes,
                      replicasPerNodeGroup: 0,
                      automaticFailoverEnabled: true,
                    }
                  : {
                      clusterMode: "disabled",
                    }),
                multiAzEnabled: false,
                atRestEncryptionEnabled: true,
                transitEncryptionEnabled: true,
                transitEncryptionMode: "required",
                authToken,
                subnetGroupName: subnetGroup.name,
                parameterGroupName: parameterGroup.name,
                securityGroupIds: vpc.securityGroups,
                tags: {
                  "sst:component-version": _version.toString(),
                  "sst:ref:secret": secret.id,
                },
              },
              { parent: self },
            ),
          ),
      );
    }
  }

  /**
   * The ID of the Redis cluster.
   */
  public get clusterId() {
    return this.dev ? output("placeholder") : this.cluster!.id;
  }

  /**
   * The username to connect to the Redis cluster.
   */
  public get username() {
    return this.dev ? this.dev.username : output("default");
  }

  /**
   * The password to connect to the Redis cluster.
   */
  public get password() {
    return this.dev ? this.dev.password ?? output("") : this._authToken;
  }

  /**
   * The host to connect to the Redis cluster.
   */
  public get host() {
    return this.dev
      ? this.dev.host
      : this.cluster!.clusterEnabled.apply((enabled) =>
          enabled
            ? this.cluster!.configurationEndpointAddress
            : this.cluster!.primaryEndpointAddress,
        );
  }

  /**
   * The port to connect to the Redis cluster.
   */
  public get port() {
    return this.dev ? this.dev.port : this.cluster!.port.apply((v) => v!);
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    const _this = this;
    return {
      /**
       * The ElastiCache Redis cluster.
       */
      get cluster() {
        if (_this.dev)
          throw new VisibleError("Cannot access `nodes.cluster` in dev mode.");
        return _this.cluster!;
      },
    };
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        host: this.host,
        port: this.port,
        username: this.username,
        password: this.password,
      },
    };
  }

  /**
   * Reference an existing Redis cluster with the given cluster name. This is useful when you
   * create a Redis cluster in one stage and want to share it in another. It avoids having to
   * create a new Redis cluster in the other stage.
   *
   * :::tip
   * You can use the `static get` method to share Redis clusters across stages.
   * :::
   *
   * @param name The name of the component.
   * @param clusterId The id of the existing Redis cluster.
   * @param opts? Resource options.
   *
   * @example
   * Imagine you create a cluster in the `dev` stage. And in your personal stage `frank`,
   * instead of creating a new cluster, you want to share the same cluster from `dev`.
   *
   * ```ts title="sst.config.ts"
   * const redis = $app.stage === "frank"
   *   ? sst.aws.Redis.get("MyRedis", "app-dev-myredis")
   *   : new sst.aws.Redis("MyRedis");
   * ```
   *
   * Here `app-dev-myredis` is the ID of the cluster created in the `dev` stage.
   * You can find this by outputting the cluster ID in the `dev` stage.
   *
   * ```ts title="sst.config.ts"
   * return {
   *   cluster: redis.clusterId
   * };
   * ```
   */
  public static get(
    name: string,
    clusterId: Input<string>,
    opts?: ComponentResourceOptions,
  ) {
    return new Redis(
      name,
      {
        ref: true,
        clusterId,
      } as unknown as RedisArgs,
      opts,
    );
  }
}

const __pulumiType = "sst:aws:Redis";
// @ts-expect-error
Redis.__pulumiType = __pulumiType;
