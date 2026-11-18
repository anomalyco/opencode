import {
  all,
  ComponentResourceOptions,
  interpolate,
  jsonStringify,
  Output,
  output,
} from "@pulumi/pulumi";
import { Component, Transform, transform } from "../component";
import { Link } from "../link";
import { Input } from "../input.js";
import { iam, rds, secretsmanager } from "@pulumi/aws";
import { RandomPassword } from "@pulumi/random";
import { Vpc } from "./vpc";
import { Vpc as VpcV1 } from "./vpc-v1";
import { VisibleError } from "../error";
import { Postgres as PostgresV1 } from "./postgres-v1";
import { SizeGbTb, toGBs } from "../size";
import { DevCommand } from "../experimental/dev-command.js";
import { RdsRoleLookup } from "./providers/rds-role-lookup";
export type { PostgresArgs as PostgresV1Args } from "./postgres-v1";

export interface PostgresArgs {
  /**
   * The Postgres engine version. Check out the [available versions in your region](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.DBVersions.html).
   * @default `"16.4"`
   * @example
   * ```js
   * {
   *   version: "17.2"
   * }
   * ```
   */
  version?: Input<string>;
  /**
   * The username of the master user.
   *
   * :::caution
   * Changing the username will cause the database to be destroyed and recreated.
   * :::
   *
   * @default `"postgres"`
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
   *   password: "Passw0rd!"
   * }
   * ```
   *
   * You can use a `Secret` to manage the password.
   *
   * ```js
   * {
   *   password: new sst.Secret("MyDBPassword").value
   * }
   * ```
   */
  password?: Input<string>;
  /**
   * Name of a database that is automatically created.
   *
   * The name must begin with a letter and contain only lowercase letters, numbers, or
   * underscores. By default, it takes the name of the app, and replaces the hyphens with
   * underscores.
   *
   * @default Based on the name of the current app
   * @example
   * ```js
   * {
   *   database: "acme"
   * }
   * ```
   */
  database?: Input<string>;
  /**
   * The type of instance to use for the database. Check out the [supported instance types](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.DBInstanceClass.Types.html).
   *
   * @default `"t4g.micro"`
   * @example
   * ```js
   * {
   *   instance: "m7g.xlarge"
   * }
   * ```
   *
   * By default, these changes are not applied immediately by RDS. Instead, they are
   * applied in the next maintenance window. Check out the [full list](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ModifyInstance.Settings.html)
   * of props that are not applied immediately.
   */
  instance?: Input<string>;
  /**
   * The maximum storage limit for the database.
   *
   * RDS will autoscale your storage to match your usage up to the given limit.
   * You are not billed for the maximum storage limit, You are only billed for the storage you use.
   *
   * :::note
   * You are only billed for the storage you use, not the maximum limit.
   * :::
   *
   * By default, [gp3 storage volumes](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Storage.html#Concepts.Storage.GeneralSSD)
   * are used without additional provisioned IOPS. This provides good baseline
   * performance for most use cases.
   *
   * The minimum storage size is 20 GB. And the maximum storage size is 64 TB.
   *
   * @default `"20 GB"`
   * @example
   * ```js
   * {
   *   storage: "100 GB"
   * }
   * ```
   */
  storage?: Input<SizeGbTb>;
  /**
   * Enable [RDS Proxy](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html) for the database.
   * @default `false`
   * @example
   * ```js
   * {
   *   proxy: true
   * }
   * ```
   */
  proxy?: Input<
    | boolean
    | {
      /**
       * Additional credentials the proxy can use to connect to the database. You don't
       * need to specify the master user credentials as they are always added by default.
       *
       * :::note
       * This component will not create the Postgres users listed here. You need to
       * create them manually in the database.
       * :::
       *
       * @example
       * ```js
       * {
       *   credentials: [
       *     {
       *       username: "metabase",
       *       password: "Passw0rd!"
       *     }
       *   ]
       * }
       * ```
       *
       * You can use a `Secret` to manage the password.
       *
       * ```js
       * {
       *   credentials: [
       *     {
       *       username: "metabase",
       *       password: new sst.Secret("MyDBPassword").value
       *     }
       *   ]
       * }
       * ```
       */
      credentials?: Input<
        Input<{
          /**
           * The username of the user.
           */
          username: Input<string>;
          /**
           * The password of the user.
           */
          password: Input<string>;
        }>[]
      >;
    }
  >;
  /**
   * Enable [Multi-AZ](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.html)
   * deployment for the database.
   *
   * This creates a standby replica for the database in another availability zone (AZ). The
   * standby database provides automatic failover in case the primary database fails. However,
   * when the primary database is healthy, the standby database is not used for serving read
   * traffic.
   *
   * :::caution
   * Using Multi-AZ will approximately double the cost of the database since it will be
   * deployed in two AZs.
   * :::
   *
   * @default `false`
   * @example
   * ```js
   * {
   *   multiAz: true
   * }
   * ```
   */
  multiAz?: Input<boolean>;
  /**
   * @internal
   */
  replicas?: Input<number>;
  /**
   * The VPC subnets to use for the database.
   *
   * @example
   * ```js
   * {
   *   vpc: {
   *     subnets: ["subnet-0db7376a7ad4db5fd ", "subnet-06fc7ee8319b2c0ce"]
   *   }
   * }
   * ```
   *
   * Or create a `Vpc` component.
   *
   * ```ts title="sst.config.ts"
   * const myVpc = new sst.aws.Vpc("MyVpc");
   * ```
   *
   * And pass it in. The database will be placed in the private subnets.
   *
   * ```js
   * {
   *   vpc: myVpc
   * }
   * ```
   */
  vpc:
  | Vpc
  | Input<{
    /**
     * A list of subnet IDs in the VPC.
     */
    subnets: Input<Input<string>[]>;
  }>;
  /**
   * Configure how this component works in `sst dev`.
   *
   * By default, your Postgres database is deployed in `sst dev`. But if you want to instead
   * connect to a locally running Postgres database, you can configure the `dev` prop.
   *
   * :::note
   * This will not create an RDS database in `sst dev`.
   * :::
   *
   * This will skip deploying an RDS database and link to the locally running Postgres database
   * instead.
   *
   * @example
   *
   * Setting the `dev` prop also means that any linked resources will connect to the right
   * database both in `sst dev` and `sst deploy`.
   *
   * ```ts
   * {
   *   dev: {
   *     username: "postgres",
   *     password: "password",
   *     database: "postgres",
   *     host: "localhost",
   *     port: 5432
   *   }
   * }
   * ```
   */
  dev?: {
    /**
     * The host of the local Postgres to connect to when running in dev.
     * @default `"localhost"`
     */
    host?: Input<string>;
    /**
     * The port of the local Postgres to connect to when running in dev.
     * @default `5432`
     */
    port?: Input<number>;
    /**
     * The database of the local Postgres to connect to when running in dev.
     * @default Inherit from the top-level [`database`](#database).
     */
    database?: Input<string>;
    /**
     * The username of the local Postgres to connect to when running in dev.
     * @default Inherit from the top-level [`username`](#username).
     */
    username?: Input<string>;
    /**
     * The password of the local Postgres to connect to when running in dev.
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
     * Transform the RDS subnet group.
     */
    subnetGroup?: Transform<rds.SubnetGroupArgs>;
    /**
     * Transform the RDS parameter group.
     */
    parameterGroup?: Transform<rds.ParameterGroupArgs>;
    /**
     * Transform the database instance in the RDS Cluster.
     */
    instance?: Transform<rds.InstanceArgs>;
    /**
     * Transform the RDS Proxy.
     */
    proxy?: Transform<rds.ProxyArgs>;
  };
}

export interface PostgresGetArgs {
  /**
   * The ID of the database.
   */
  id: Input<string>;
  /**
   * The ID of the proxy.
   */
  proxyId?: Input<string>;
}

interface PostgresRef {
  ref: boolean;
  id: Input<string>;
  proxyId?: Input<string>;
}

/**
 * The `Postgres` component lets you add a Postgres database to your app using
 * [Amazon RDS Postgres](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_PostgreSQL.html).
 *
 * @example
 *
 * #### Create the database
 *
 * ```js title="sst.config.ts"
 * const vpc = new sst.aws.Vpc("MyVpc");
 * const database = new sst.aws.Postgres("MyDatabase", { vpc });
 * ```
 *
 * #### Link to a resource
 *
 * You can link your database to other resources, like a function or your Next.js app.
 *
 * ```ts title="sst.config.ts"
 * new sst.aws.Nextjs("MyWeb", {
 *   link: [database],
 *   vpc
 * });
 * ```
 *
 * Once linked, you can connect to it from your function code.
 *
 * ```ts title="app/page.tsx" {1,5-9}
 * import { Resource } from "sst";
 * import { Pool } from "pg";
 *
 * const client = new Pool({
 *   user: Resource.MyDatabase.username,
 *   password: Resource.MyDatabase.password,
 *   database: Resource.MyDatabase.database,
 *   host: Resource.MyDatabase.host,
 *   port: Resource.MyDatabase.port,
 * });
 * await client.connect();
 * ```
 *
 * #### Running locally
 *
 * By default, your RDS Postgres database is deployed in `sst dev`. But let's say you are running
 * Postgres locally.
 *
 * ```bash
 * docker run \
 *   --rm \
 *   -p 5432:5432 \
 *   -v $(pwd)/.sst/storage/postgres:/var/lib/postgresql/data \
 *   -e POSTGRES_USER=postgres \
 *   -e POSTGRES_PASSWORD=password \
 *   -e POSTGRES_DB=local \
 *   postgres:16.4
 * ```
 *
 * You can connect to it in `sst dev` by configuring the `dev` prop.
 *
 * ```ts title="sst.config.ts" {3-8}
 * const postgres = new sst.aws.Postgres("MyPostgres", {
 *   vpc,
 *   dev: {
 *     username: "postgres",
 *     password: "password",
 *     database: "local",
 *     port: 5432
 *   }
 * });
 * ```
 *
 * This will skip deploying an RDS database and link to the locally running Postgres database
 * instead. [Check out the full example](/docs/examples/#aws-postgres-local).
 *
 * ---
 *
 * ### Cost
 *
 * By default this component uses a _Single-AZ Deployment_, _On-Demand DB Instances_ of a
 * `db.t4g.micro` at $0.016 per hour. And 20GB of _General Purpose gp3 Storage_
 * at $0.115 per GB per month.
 *
 * That works out to $0.016 x 24 x 30 + $0.115 x 20 or **$14 per month**. Adjust this for the
 * `instance` type and the `storage` you are using.
 *
 * The above are rough estimates for _us-east-1_, check out the
 * [RDS for PostgreSQL pricing](https://aws.amazon.com/rds/postgresql/pricing/#On-Demand_DB_Instances_costs) for more details.
 *
 * #### RDS Proxy
 *
 * If you enable the `proxy`, it uses _Provisioned instances_ with 2 vCPUs at $0.015 per hour.
 *
 * That works out to an **additional** $0.015 x 2 x 24 x 30 or **$22 per month**.
 *
 * This is a rough estimate for _us-east-1_, check out the
 * [RDS Proxy pricing](https://aws.amazon.com/rds/proxy/pricing/) for more details.
 */
export class Postgres extends Component implements Link.Linkable {
  private instance?: rds.Instance;
  private _password?: Output<string>;
  private proxy?: Output<rds.Proxy | undefined>;
  private dev?: {
    enabled: boolean;
    host: Output<string>;
    port: Output<number>;
    username: Output<string>;
    password: Output<string>;
    database: Output<string>;
  };
  public static v1 = PostgresV1;

  constructor(
    name: string,
    args: PostgresArgs,
    opts?: ComponentResourceOptions,
  ) {
    super(__pulumiType, name, args, opts);
    const _version = 2;
    const self = this;

    if (args && "ref" in args) {
      const ref = reference();
      this.instance = ref.instance;
      this._password = ref.password;
      this.proxy = output(ref.proxy);
      return;
    }

    registerVersion();
    const multiAz = output(args.multiAz).apply((v) => v ?? false);
    const engineVersion = output(args.version).apply((v) => v ?? "16.4");
    const instanceType = output(args.instance).apply((v) => v ?? "t4g.micro");
    const username = output(args.username).apply((v) => v ?? "postgres");
    const storage = normalizeStorage();
    const dbName = output(args.database).apply(
      (v) => v ?? $app.name.replaceAll("-", "_"),
    );
    const vpc = normalizeVpc();

    const dev = registerDev();
    if (dev?.enabled) {
      this.dev = dev;
      return;
    }

    const password = createPassword();
    const secret = createSecret();
    const subnetGroup = createSubnetGroup();
    const parameterGroup = createParameterGroup();
    const instance = createInstance();
    createReplicas();
    const proxy = createProxy();

    this.instance = instance;
    this._password = password;
    this.proxy = proxy;

    function reference() {
      const ref = args as unknown as PostgresRef;
      const instance = rds.Instance.get(`${name}Instance`, ref.id, undefined, {
        parent: self,
      });

      const input = instance.tags.apply((tags) => {
        registerVersion(
          tags?.["sst:component-version"]
            ? parseInt(tags["sst:component-version"])
            : undefined,
        );

        return {
          proxyId: output(ref.proxyId),
          passwordTag: tags?.["sst:lookup:password"],
        };
      });

      const proxy = input.proxyId.apply((proxyId) =>
        proxyId
          ? rds.Proxy.get(`${name}Proxy`, proxyId, undefined, {
            parent: self,
          })
          : undefined,
      );

      const password = input.passwordTag.apply((passwordTag) => {
        if (!passwordTag)
          throw new VisibleError(
            `Failed to get password for Postgres ${name}.`,
          );

        const secret = secretsmanager.getSecretVersionOutput(
          { secretId: passwordTag },
          { parent: self },
        );
        return $jsonParse(secret.secretString).apply(
          (v) => v.password as string,
        );
      });

      return { instance, proxy, password };
    }

    function registerVersion(overrideVersion?: number) {
      self.registerVersion({
        new: _version,
        old: overrideVersion ?? $cli.state.version[name],
        message: [
          `This component has been renamed. Please change:\n`,
          `"sst.aws.Postgres" to "sst.aws.Postgres.v${$cli.state.version[name]}"\n`,
          `Learn more https://sst.dev/docs/components/#versioning`,
        ].join("\n"),
      });
    }

    function normalizeStorage() {
      return output(args.storage ?? "20 GB").apply((v) => {
        const size = toGBs(v);
        if (size < 20) {
          throw new VisibleError(
            `Storage must be at least 20 GB for the ${name} Postgres database.`,
          );
        }
        if (size > 65536) {
          throw new VisibleError(
            `Storage cannot be greater than 65536 GB (64 TB) for the ${name} Postgres database.`,
          );
        }
        return size;
      });
    }

    function normalizeVpc() {
      // "vpc" is a Vpc.v1 component
      if (args.vpc instanceof VpcV1) {
        throw new VisibleError(
          `You are using the "Vpc.v1" component. Please migrate to the latest "Vpc" component.`,
        );
      }

      // "vpc" is a Vpc component
      if (args.vpc instanceof Vpc) {
        return {
          subnets: args.vpc.privateSubnets,
        };
      }

      // "vpc" is object
      return output(args.vpc);
    }

    function registerDev() {
      if (!args.dev) return undefined;

      if (
        $dev &&
        args.dev.password === undefined &&
        args.password === undefined
      ) {
        throw new VisibleError(
          `You must provide the password to connect to your locally running Postgres database either by setting the "dev.password" or by setting the top-level "password" property.`,
        );
      }

      const dev = {
        enabled: $dev,
        host: output(args.dev.host ?? "localhost"),
        port: output(args.dev.port ?? 5432),
        username: args.dev.username ? output(args.dev.username) : username,
        password: output(args.dev.password ?? args.password ?? ""),
        database: args.dev.database ? output(args.dev.database) : dbName,
      };

      new DevCommand(`${name}Dev`, {
        dev: {
          title: name,
          autostart: true,
          command: `sst print-and-not-quit`,
        },
        environment: {
          SST_DEV_COMMAND_MESSAGE: interpolate`Make sure your local PostgreSQL server is using:

  username: "${dev.username}"
  password: "${dev.password}"
  database: "${dev.database}"

Listening on "${dev.host}:${dev.port}"...`,
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
            special: false,
          },
          { parent: self },
        ).result;
    }

    function createSubnetGroup() {
      return new rds.SubnetGroup(
        ...transform(
          args.transform?.subnetGroup,
          `${name}SubnetGroup`,
          {
            subnetIds: vpc.subnets,
          },
          { parent: self },
        ),
      );
    }

    function createParameterGroup() {
      return new rds.ParameterGroup(
        ...transform(
          args.transform?.parameterGroup,
          `${name}ParameterGroup`,
          {
            family: engineVersion.apply((v) => `postgres${v.split(".")[0]}`),
            parameters: [
              {
                name: "rds.force_ssl",
                value: "0",
              },
              {
                name: "rds.logical_replication",
                value: "1",
                applyMethod: "pending-reboot",
              },
            ],
          },
          { parent: self },
        ),
      );
    }

    function createSecret() {
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
          secretString: jsonStringify({
            username,
            password,
          }),
        },
        { parent: self },
      );

      return secret;
    }

    function createInstance() {
      return new rds.Instance(
        ...transform(
          args.transform?.instance,
          `${name}Instance`,
          {
            dbName,
            dbSubnetGroupName: subnetGroup.name,
            engine: "postgres",
            engineVersion,
            instanceClass: interpolate`db.${instanceType}`,
            username,
            password,
            parameterGroupName: parameterGroup.name,
            skipFinalSnapshot: true,
            storageEncrypted: true,
            storageType: "gp3",
            allocatedStorage: 20,
            maxAllocatedStorage: storage,
            multiAz,
            backupRetentionPeriod: 7,
            performanceInsightsEnabled: true,
            tags: {
              "sst:component-version": _version.toString(),
              "sst:lookup:password": secret.id,
            },
          },
          { parent: self, deleteBeforeReplace: true },
        ),
      );
    }

    function createReplicas() {
      return output(args.replicas ?? 0).apply((replicas) =>
        Array.from({ length: replicas }).map(
          (_, i) =>
            new rds.Instance(
              `${name}Replica${i}`,
              {
                replicateSourceDb: instance.identifier,
                dbName: interpolate`${instance.dbName}_replica${i}`,
                dbSubnetGroupName: instance.dbSubnetGroupName,
                availabilityZone: instance.availabilityZone,
                engine: instance.engine,
                engineVersion: instance.engineVersion,
                instanceClass: instance.instanceClass,
                username: instance.username,
                password: instance.password.apply((v) => v!),
                parameterGroupName: instance.parameterGroupName,
                skipFinalSnapshot: true,
                storageEncrypted: instance.storageEncrypted.apply((v) => v!),
                storageType: instance.storageType,
                allocatedStorage: instance.allocatedStorage,
                maxAllocatedStorage: instance.maxAllocatedStorage.apply(
                  (v) => v!,
                ),
              },
              { parent: self },
            ),
        ),
      );
    }

    function createProxy() {
      return output(args.proxy).apply((proxy) => {
        if (!proxy) return;

        const credentials = proxy === true ? [] : proxy.credentials ?? [];

        // Create secrets
        const secrets = credentials.map((credential) => {
          const secret = new secretsmanager.Secret(
            `${name}ProxySecret${credential.username}`,
            {
              recoveryWindowInDays: 0,
            },
            { parent: self },
          );

          new secretsmanager.SecretVersion(
            `${name}ProxySecretVersion${credential.username}`,
            {
              secretId: secret.id,
              secretString: jsonStringify({
                username: credential.username,
                password: credential.password,
              }),
            },
            { parent: self },
          );
          return secret;
        });

        const role = new iam.Role(
          `${name}ProxyRole`,
          {
            assumeRolePolicy: iam.assumeRolePolicyForPrincipal({
              Service: "rds.amazonaws.com",
            }),
            inlinePolicies: [
              {
                name: "inline",
                policy: iam.getPolicyDocumentOutput({
                  statements: [
                    {
                      actions: ["secretsmanager:GetSecretValue"],
                      resources: [secret.arn, ...secrets.map((s) => s.arn)],
                    },
                  ],
                }).json,
              },
            ],
          },
          { parent: self },
        );

        const lookup = new RdsRoleLookup(
          `${name}ProxyRoleLookup`,
          { name: "AWSServiceRoleForRDS" },
          { parent: self },
        );

        const rdsProxy = new rds.Proxy(
          ...transform(
            args.transform?.proxy,
            `${name}Proxy`,
            {
              engineFamily: "POSTGRESQL",
              auths: [
                {
                  authScheme: "SECRETS",
                  iamAuth: "DISABLED",
                  secretArn: secret.arn,
                },
                ...secrets.map((s) => ({
                  authScheme: "SECRETS",
                  iamAuth: "DISABLED",
                  secretArn: s.arn,
                })),
              ],
              roleArn: role.arn,
              vpcSubnetIds: vpc.subnets,
            },
            { parent: self, dependsOn: [lookup] },
          ),
        );

        const targetGroup = new rds.ProxyDefaultTargetGroup(
          `${name}ProxyTargetGroup`,
          {
            dbProxyName: rdsProxy.name,
          },
          { parent: self },
        );

        new rds.ProxyTarget(
          `${name}ProxyTarget`,
          {
            dbProxyName: rdsProxy.name,
            targetGroupName: targetGroup.name,
            dbInstanceIdentifier: instance.identifier,
          },
          { parent: self },
        );

        return rdsProxy;
      });
    }
  }

  /**
   * The identifier of the Postgres instance.
   */
  public get id() {
    if (this.dev?.enabled) return output("placeholder");
    return this.instance!.identifier;
  }

  /**
   * The name of the Postgres proxy.
   */
  public get proxyId() {
    if (this.dev?.enabled) return output("placeholder");

    return this.proxy!.apply((v) => {
      if (!v) {
        throw new VisibleError(
          `Proxy is not enabled. Enable it with "proxy: true".`,
        );
      }
      return v.id;
    });
  }

  /** The username of the master user. */
  public get username() {
    if (this.dev?.enabled) return this.dev.username;
    return this.instance!.username;
  }

  /** The password of the master user. */
  public get password() {
    if (this.dev?.enabled) return this.dev.password;
    return this._password!;
  }

  /**
   * The name of the database.
   */
  public get database() {
    if (this.dev?.enabled) return this.dev.database;
    return this.instance!.dbName;
  }

  /**
   * The port of the database.
   */
  public get port() {
    if (this.dev?.enabled) return this.dev.port;
    return this.instance!.port;
  }

  /**
   * The host of the database.
   */
  public get host() {
    if (this.dev?.enabled) return this.dev.host;

    return all([this.instance!.endpoint, this.proxy!]).apply(
      ([endpoint, proxy]) => proxy?.endpoint ?? output(endpoint.split(":")[0]),
    );
  }

  public get nodes() {
    return {
      instance: this.instance,
    };
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        database: this.database,
        username: this.username,
        password: this.password,
        port: this.port,
        host: this.host,
      },
    };
  }

  /**
   * Reference an existing Postgres database with the given name. This is useful when you
   * create a Postgres database in one stage and want to share it in another. It avoids
   * having to create a new Postgres database in the other stage.
   *
   * :::tip
   * You can use the `static get` method to share Postgres databases across stages.
   * :::
   *
   * @param name The name of the component.
   * @param args The arguments to get the Postgres database.
   * @param opts? Resource options.
   *
   * @example
   * Imagine you create a database in the `dev` stage. And in your personal stage `frank`,
   * instead of creating a new database, you want to share the same database from `dev`.
   *
   * ```ts title="sst.config.ts"
   * const database = $app.stage === "frank"
   *   ? sst.aws.Postgres.get("MyDatabase", {
   *       id: "app-dev-mydatabase",
   *       proxyId: "app-dev-mydatabase-proxy"
   *     })
   *   : new sst.aws.Postgres("MyDatabase", {
   *       proxy: true
   *     });
   * ```
   *
   * Here `app-dev-mydatabase` is the ID of the database, and `app-dev-mydatabase-proxy`
   * is the ID of the proxy created in the `dev` stage. You can find these by outputting
   * the database ID and proxy ID in the `dev` stage.
   *
   * ```ts title="sst.config.ts"
   * return {
   *   id: database.id,
   *   proxyId: database.proxyId
   * };
   * ```
   */
  public static get(
    name: string,
    args: PostgresGetArgs,
    opts?: ComponentResourceOptions,
  ) {
    return new Postgres(
      name,
      {
        ref: true,
        id: args.id,
        proxyId: args.proxyId,
      } as unknown as PostgresArgs,
      opts,
    );
  }
}

const __pulumiType = "sst:aws:Postgres";
// @ts-expect-error
Postgres.__pulumiType = __pulumiType;
