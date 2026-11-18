import fs from "fs";
import path from "path";
import { ComponentResourceOptions, interpolate, secret } from "@pulumi/pulumi";
import { all, output } from "@pulumi/pulumi";
import { Input } from "../input";
import { Efs } from "./efs";
import { FunctionArgs } from "./function";
import { RETENTION } from "./logging";
import { toGBs, toMBs } from "../size";
import { VisibleError } from "../error";
import { ServiceArgs } from "./service";
import { ImageArgs, Platform } from "@pulumi/docker-build";
import { Component, Transform, transform } from "../component";
import {
  cloudwatch,
  ecr,
  ecs,
  getCallerIdentityOutput,
  getPartitionOutput,
  getRegionOutput,
  iam,
} from "@pulumi/aws";
import { Link } from "../link";
import { Permission } from "./permission";
import { bootstrap } from "./helpers/bootstrap";
import { imageBuilder } from "./helpers/container-builder";
import { toNumber } from "../cpu";
import { toSeconds } from "../duration";
import { Cluster } from "./cluster";
import { physicalName } from "../naming";

export const supportedCpus = {
  "0.25 vCPU": 256,
  "0.5 vCPU": 512,
  "1 vCPU": 1024,
  "2 vCPU": 2048,
  "4 vCPU": 4096,
  "8 vCPU": 8192,
  "16 vCPU": 16384,
};

export const supportedMemories = {
  "0.25 vCPU": {
    "0.5 GB": 512,
    "1 GB": 1024,
    "2 GB": 2048,
  },
  "0.5 vCPU": {
    "1 GB": 1024,
    "2 GB": 2048,
    "3 GB": 3072,
    "4 GB": 4096,
  },
  "1 vCPU": {
    "2 GB": 2048,
    "3 GB": 3072,
    "4 GB": 4096,
    "5 GB": 5120,
    "6 GB": 6144,
    "7 GB": 7168,
    "8 GB": 8192,
  },
  "2 vCPU": {
    "4 GB": 4096,
    "5 GB": 5120,
    "6 GB": 6144,
    "7 GB": 7168,
    "8 GB": 8192,
    "9 GB": 9216,
    "10 GB": 10240,
    "11 GB": 11264,
    "12 GB": 12288,
    "13 GB": 13312,
    "14 GB": 14336,
    "15 GB": 15360,
    "16 GB": 16384,
  },
  "4 vCPU": {
    "8 GB": 8192,
    "9 GB": 9216,
    "10 GB": 10240,
    "11 GB": 11264,
    "12 GB": 12288,
    "13 GB": 13312,
    "14 GB": 14336,
    "15 GB": 15360,
    "16 GB": 16384,
    "17 GB": 17408,
    "18 GB": 18432,
    "19 GB": 19456,
    "20 GB": 20480,
    "21 GB": 21504,
    "22 GB": 22528,
    "23 GB": 23552,
    "24 GB": 24576,
    "25 GB": 25600,
    "26 GB": 26624,
    "27 GB": 27648,
    "28 GB": 28672,
    "29 GB": 29696,
    "30 GB": 30720,
  },
  "8 vCPU": {
    "16 GB": 16384,
    "20 GB": 20480,
    "24 GB": 24576,
    "28 GB": 28672,
    "32 GB": 32768,
    "36 GB": 36864,
    "40 GB": 40960,
    "44 GB": 45056,
    "48 GB": 49152,
    "52 GB": 53248,
    "56 GB": 57344,
    "60 GB": 61440,
  },
  "16 vCPU": {
    "32 GB": 32768,
    "40 GB": 40960,
    "48 GB": 49152,
    "56 GB": 57344,
    "64 GB": 65536,
    "72 GB": 73728,
    "80 GB": 81920,
    "88 GB": 90112,
    "96 GB": 98304,
    "104 GB": 106496,
    "112 GB": 114688,
    "120 GB": 122880,
  },
};

export interface FargateContainerArgs {
  /**
   * The name of the container.
   *
   * This is used as the `--name` option in the Docker run command.
   */
  name: Input<string>;
  /**
   * The amount of CPU allocated to the container.
   *
   * By default, a container can use up to all the CPU allocated to all the containers. If set,
   * this container is capped at this allocation even if more idle CPU is available.
   *
   * The sum of all the containers' CPU must be less than or equal to the total available CPU.
   *
   * @example
   * ```js
   * {
   *   cpu: "0.25 vCPU"
   * }
   * ```
   */
  cpu?: `${number} vCPU`;
  /**
   * The amount of memory allocated to the container.
   *
   * By default, a container can use up to all the memory allocated to all the containers. If
   * set, the container is capped at this allocation. If exceeded, the container will be killed
   * even if there is idle memory available.
   *
   * The sum of all the containers' memory must be less than or equal to the total available
   * memory.
   *
   * @example
   * ```js
   * {
   *   memory: "0.5 GB"
   * }
   * ```
   */
  memory?: `${number} GB`;
  /**
   * Configure the Docker image for the container. Same as the top-level [`image`](#image).
   */
  image?: Input<
    | string
    | {
        /**
         * The path to the Docker build context. Same as the top-level
         * [`image.context`](#image-context).
         */
        context?: Input<string>;
        /**
         * The path to the Dockerfile. Same as the top-level
         * [`image.dockerfile`](#image-dockerfile).
         */
        dockerfile?: Input<string>;
        /**
         * Key-value pairs of build args. Same as the top-level [`image.args`](#image-args).
         */
        args?: Input<Record<string, Input<string>>>;
        /**
         * The stage to build up to. Same as the top-level [`image.target`](#image-target).
         */
        target?: Input<string>;
      }
  >;
  /**
   * The command to override the default command in the container. Same as the top-level
   * [`command`](#command).
   */
  command?: Input<string[]>;
  /**
   * The entrypoint to override the default entrypoint in the container. Same as the top-level
   * [`entrypoint`](#entrypoint).
   */
  entrypoint?: Input<string[]>;
  /**
   * Key-value pairs of values that are set as container environment variables. Same as the
   * top-level [`environment`](#environment).
   */
  environment?: FunctionArgs["environment"];
  /**
   * A list of Amazon S3 file paths of environment files to load environment variables
   * from. Same as the top-level [`environmentFiles`](#environmentFiles).
   */
  environmentFiles?: Input<Input<string>[]>;
  /**
   * Configure the logs in CloudWatch. Same as the top-level [`logging`](#logging).
   */
  logging?: Input<{
    /**
     * The duration the logs are kept in CloudWatch. Same as the top-level [`logging.retention`](#logging-retention).
     */
    retention?: Input<keyof typeof RETENTION>;
    /**
     * The name of the CloudWatch log group. Same as the top-level [`logging.name`](#logging-name).
     */
    name?: Input<string>;
  }>;
  /**
   * Key-value pairs of AWS Systems Manager Parameter Store parameter ARNs or AWS Secrets
   * Manager secret ARNs. The values will be loaded into the container as environment
   * variables. Same as the top-level [`ssm`](#ssm).
   */
  ssm?: FargateBaseArgs["ssm"];
  /**
   * Mount Amazon EFS file systems into the container. Same as the top-level
   * [`efs`](#efs).
   */
  volumes?: FargateBaseArgs["volumes"];
}

export interface FargateBaseArgs {
  /**
   * The ECS Cluster to use. Create a new `Cluster` in your app, if you haven't already.
   *
   * ```js title="sst.config.ts"
   * const vpc = new sst.aws.Vpc("MyVpc");
   * const myCluster = new sst.aws.Cluster("MyCluster", { vpc });
   * ```
   *
   * And pass it in.
   *
   * ```js
   * {
   *   cluster: myCluster
   * }
   * ```
   */
  cluster: Cluster;
  /**
   * The CPU architecture of the container.
   * @default `"x86_64"`
   * @example
   * ```js
   * {
   *   architecture: "arm64"
   * }
   * ```
   */
  architecture?: Input<"x86_64" | "arm64">;
  /**
   * The amount of CPU allocated to the container. If there are multiple containers, this is
   * the total amount of CPU shared across all the containers.
   *
   * :::note
   * [View the valid combinations](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html#fargate-tasks-size) of CPU and memory.
   * :::
   *
   * @default `"0.25 vCPU"`
   * @example
   * ```js
   * {
   *   cpu: "1 vCPU"
   * }
   * ```
   */
  cpu?: keyof typeof supportedCpus;
  /**
   * The amount of memory allocated to the container. If there are multiple containers, this is
   * the total amount of memory shared across all the containers.
   *
   * :::note
   * [View the valid combinations](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html#fargate-tasks-size) of CPU and memory.
   * :::
   *
   * @default `"0.5 GB"`
   *
   * @example
   * ```js
   * {
   *   memory: "2 GB"
   * }
   * ```
   */
  memory?: `${number} GB`;
  /**
   * The amount of ephemeral storage (in GB) allocated to the container.
   *
   * @default `"20 GB"`
   *
   * @example
   * ```js
   * {
   *   storage: "100 GB"
   * }
   * ```
   */
  storage?: `${number} GB`;
  /**
   * [Link resources](/docs/linking/) to your containers. This will:
   *
   * 1. Grant the permissions needed to access the resources.
   * 2. Allow you to access it in your app using the [SDK](/docs/reference/sdk/).
   *
   * @example
   *
   * Takes a list of components to link to the containers.
   *
   * ```js
   * {
   *   link: [bucket, stripeKey]
   * }
   * ```
   */
  link?: FunctionArgs["link"];
  /**
   * Permissions and the resources that you need to access. These permissions are
   * used to create the [task role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html).
   *
   * :::tip
   * If you `link` the service to a resource, the permissions to access it are
   * automatically added.
   * :::
   *
   * @example
   * Allow the container to read and write to an S3 bucket called `my-bucket`.
   *
   * ```js
   * {
   *   permissions: [
   *     {
   *       actions: ["s3:GetObject", "s3:PutObject"],
   *       resources: ["arn:aws:s3:::my-bucket/*"]
   *     },
   *   ]
   * }
   * ```
   *
   * Allow the container to perform all actions on an S3 bucket called `my-bucket`.
   *
   * ```js
   * {
   *   permissions: [
   *     {
   *       actions: ["s3:*"],
   *       resources: ["arn:aws:s3:::my-bucket/*"]
   *     },
   *   ]
   * }
   * ```
   *
   * Granting the container permissions to access all resources.
   *
   * ```js
   * {
   *   permissions: [
   *     {
   *       actions: ["*"],
   *       resources: ["*"]
   *     },
   *   ]
   * }
   * ```
   */
  permissions?: FunctionArgs["permissions"];
  /**
   * Configure the Docker build command for building the image or specify a pre-built image.
   *
   * @default Build a Docker image from the Dockerfile in the root directory.
   * @example
   *
   * Building a Docker image.
   *
   * Prior to building the image, SST will automatically add the `.sst` directory
   * to the `.dockerignore` if not already present.
   *
   * ```js
   * {
   *   image: {
   *     context: "./app",
   *     dockerfile: "Dockerfile",
   *     args: {
   *       MY_VAR: "value"
   *     }
   *   }
   * }
   * ```
   *
   * Alternatively, you can pass in a pre-built image.
   *
   * ```js
   * {
   *   image: "nginxdemos/hello:plain-text"
   * }
   * ```
   */
  image?: Input<
    | string
    | {
        /**
         * The path to the [Docker build context](https://docs.docker.com/build/building/context/#local-context). The path is relative to your project's `sst.config.ts`.
         * @default `"."`
         * @example
         *
         * To change where the Docker build context is located.
         *
         * ```js
         * {
         *   context: "./app"
         * }
         * ```
         */
        context?: Input<string>;
        /**
         * The path to the [Dockerfile](https://docs.docker.com/reference/cli/docker/image/build/#file).
         * The path is relative to the build `context`.
         * @default `"Dockerfile"`
         * @example
         * To use a different Dockerfile.
         * ```js
         * {
         *   dockerfile: "Dockerfile.prod"
         * }
         * ```
         */
        dockerfile?: Input<string>;
        /**
         * Key-value pairs of [build args](https://docs.docker.com/build/guide/build-args/) to pass to the Docker build command.
         * @example
         * ```js
         * {
         *   args: {
         *     MY_VAR: "value"
         *   }
         * }
         * ```
         */
        args?: Input<Record<string, Input<string>>>;
        /**
         * Tags to apply to the Docker image.
         * @example
         * ```js
         * {
         *   tags: ["v1.0.0", "commit-613c1b2"]
         * }
         * ```
         */
        tags?: Input<Input<string>[]>;
        /**
         * The stage to build up to in a [multi-stage Dockerfile](https://docs.docker.com/build/building/multi-stage/#stop-at-a-specific-build-stage).
         * @example
         * ```js
         * {
         *   target: "stage1"
         * }
         * ```
         */
        target?: Input<string>;
      }
  >;
  /**
   * The command to override the default command in the container.
   * @example
   * ```js
   * {
   *   command: ["npm", "run", "start"]
   * }
   * ```
   */
  command?: Input<Input<string>[]>;
  /**
   * The entrypoint that overrides the default entrypoint in the container.
   * @example
   * ```js
   * {
   *   entrypoint: ["/usr/bin/my-entrypoint"]
   * }
   * ```
   */
  entrypoint?: Input<string[]>;
  /**
   * Key-value pairs of values that are set as [container environment variables](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/taskdef-envfiles.html).
   * The keys need to:
   *
   * 1. Start with a letter.
   * 2. Be at least 2 characters long.
   * 3. Contain only letters, numbers, or underscores.
   *
   * @example
   *
   * ```js
   * {
   *   environment: {
   *     DEBUG: "true"
   *   }
   * }
   * ```
   */
  environment?: FunctionArgs["environment"];
  /**
   * A list of Amazon S3 object ARNs pointing to [environment files](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/use-environment-file.html)
   * used to load environment variables into the container.
   *
   * Each file must be a plain text file in `.env` format.
   *
   * @example
   * Create an S3 bucket and upload an environment file.
   *
   * ```ts title="sst.config.ts"
   * const bucket = new sst.aws.Bucket("EnvBucket");
   * const file = new aws.s3.BucketObjectv2("EnvFile", {
   *   bucket: bucket.name,
   *   key: "test.env",
   *   content: ["FOO=hello", "BAR=world"].join("\n"),
   * });
   * ```
   *
   * And pass in the ARN of the environment file.
   *
   * ```js title="sst.config.ts"
   * {
   *   environmentFiles: [file.arn]
   * }
   * ```
   */
  environmentFiles?: Input<Input<string>[]>;
  /**
   * Key-value pairs of AWS Systems Manager Parameter Store parameter ARNs or AWS Secrets
   * Manager secret ARNs. The values will be loaded into the container as environment
   * variables.
   * @example
   * ```js
   * {
   *   ssm: {
   *     DATABASE_PASSWORD: "arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret-123abc"
   *   }
   * }
   * ```
   */
  ssm?: Input<Record<string, Input<string>>>;
  /**
   * Configure the logs in CloudWatch.
   * @default `{ retention: "1 month" }`
   * @example
   * ```js
   * {
   *   logging: {
   *     retention: "forever"
   *   }
   * }
   * ```
   */
  logging?: Input<{
    /**
     * The duration the logs are kept in CloudWatch.
     * @default `"1 month"`
     */
    retention?: Input<keyof typeof RETENTION>;
    /**
     * The name of the CloudWatch log group. If omitted, the log group name is generated
     * based on the cluster name, service name, and container name.
     * @default `"/sst/cluster/${CLUSTER_NAME}/${SERVICE_NAME}/${CONTAINER_NAME}"`
     */
    name?: Input<string>;
  }>;
  /**
   * Mount Amazon EFS file systems into the container.
   *
   * @example
   * Create an EFS file system.
   *
   * ```ts title="sst.config.ts"
   * const vpc = new sst.aws.Vpc("MyVpc");
   * const fileSystem = new sst.aws.Efs("MyFileSystem", { vpc });
   * ```
   *
   * And pass it in.
   *
   * ```js
   * {
   *   volumes: [
   *     {
   *       efs: fileSystem,
   *       path: "/mnt/efs"
   *     }
   *   ]
   * }
   * ```
   *
   * Or pass in a the EFS file system ID.
   *
   * ```js
   * {
   *   volumes: [
   *     {
   *       efs: {
   *         fileSystem: "fs-12345678",
   *         accessPoint: "fsap-12345678"
   *       },
   *       path: "/mnt/efs"
   *     }
   *   ]
   * }
   * ```
   */
  volumes?: Input<{
    /**
     * The Amazon EFS file system to mount.
     */
    efs: Input<
      | Efs
      | {
          /**
           * The ID of the EFS file system.
           */
          fileSystem: Input<string>;
          /**
           * The ID of the EFS access point.
           */
          accessPoint: Input<string>;
        }
    >;
    /**
     * The path to mount the volume.
     */
    path: Input<string>;
  }>[];
  /**
   * Assigns the given IAM role name to the containers. This allows you to pass in a previously
   * created role.
   *
   * :::caution
   * When you pass in a role, it will not update it if you add `permissions` or `link` resources.
   * :::
   *
   * By default, a new IAM role is created. It'll update this role if you add `permissions` or
   * `link` resources.
   *
   * However, if you pass in a role, you'll need to update it manually if you add `permissions`
   * or `link` resources.
   *
   * @default Creates a new role
   * @example
   * ```js
   * {
   *   taskRole: "my-task-role"
   * }
   * ```
   */
  taskRole?: Input<string>;
  /**
   * Assigns the given IAM role name to AWS ECS to launch and manage the containers. This
   * allows you to pass in a previously created role.
   *
   * By default, a new IAM role is created.
   *
   * @default Creates a new role
   * @example
   * ```js
   * {
   *   executionRole: "my-execution-role"
   * }
   * ```
   */
  executionRole?: Input<string>;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the Docker Image resource.
     */
    image?: Transform<ImageArgs>;
    /**
     * Transform the ECS Execution IAM Role resource.
     */
    executionRole?: Transform<iam.RoleArgs>;
    /**
     * Transform the ECS Task IAM Role resource.
     */
    taskRole?: Transform<iam.RoleArgs>;
    /**
     * Transform the ECS Task Definition resource.
     */
    taskDefinition?: Transform<ecs.TaskDefinitionArgs>;
    /**
     * Transform the CloudWatch log group resource.
     */
    logGroup?: Transform<cloudwatch.LogGroupArgs>;
  };
}

export function normalizeArchitecture(args: FargateBaseArgs) {
  return output(args.architecture ?? "x86_64").apply((v) => v);
}

export function normalizeCpu(args: FargateBaseArgs) {
  return output(args.cpu ?? "0.25 vCPU").apply((v) => {
    if (!supportedCpus[v]) {
      throw new Error(
        `Unsupported CPU: ${v}. The supported values for CPU are ${Object.keys(
          supportedCpus,
        ).join(", ")}`,
      );
    }
    return v;
  });
}

export function normalizeMemory(
  cpu: ReturnType<typeof normalizeCpu>,
  args: FargateBaseArgs,
) {
  return all([cpu, args.memory ?? "0.5 GB"]).apply(([cpu, v]) => {
    if (!(v in supportedMemories[cpu])) {
      throw new Error(
        `Unsupported memory: ${v}. The supported values for memory for a ${cpu} CPU are ${Object.keys(
          supportedMemories[cpu],
        ).join(", ")}`,
      );
    }
    return v;
  });
}

export function normalizeStorage(args: FargateBaseArgs) {
  return output(args.storage ?? "20 GB").apply((v) => {
    const storage = toGBs(v);
    if (storage < 20 || storage > 200)
      throw new Error(
        `Unsupported storage: ${v}. The supported value for storage is between "20 GB" and "200 GB"`,
      );
    return v;
  });
}

export function normalizeContainers(
  type: "service" | "task",
  args: ServiceArgs,
  name: string,
  architecture: ReturnType<typeof normalizeArchitecture>,
) {
  if (
    args.containers &&
    (args.image ||
      args.logging ||
      args.environment ||
      args.environmentFiles ||
      args.volumes ||
      args.health ||
      args.ssm)
  ) {
    throw new VisibleError(
      type === "service"
        ? `You cannot provide both "containers" and "image", "logging", "environment", "environmentFiles", "volumes", "health" or "ssm".`
        : `You cannot provide both "containers" and "image", "logging", "environment", "environmentFiles", "volumes" or "ssm".`,
    );
  }

  // Standardize containers
  const containers = args.containers ?? [
    {
      name: name,
      cpu: undefined,
      memory: undefined,
      image: args.image,
      logging: args.logging,
      environment: args.environment,
      environmentFiles: args.environmentFiles,
      ssm: args.ssm,
      volumes: args.volumes,
      command: args.command,
      entrypoint: args.entrypoint,
      health: type === "service" ? args.health : undefined,
      dev: type === "service" ? args.dev : undefined,
    },
  ];

  // Normalize container props
  return output(containers).apply((containers) =>
    containers.map((v) => {
      return {
        ...v,
        volumes: normalizeVolumes(),
        image: normalizeImage(),
        logging: normalizeLogging(),
      };

      function normalizeVolumes() {
        return output(v.volumes).apply(
          (volumes) =>
            volumes?.map((volume) => ({
              path: volume.path,
              efs:
                volume.efs instanceof Efs
                  ? {
                      fileSystem: volume.efs.id,
                      accessPoint: volume.efs.accessPoint,
                    }
                  : volume.efs,
            })),
        );
      }

      function normalizeImage() {
        return all([v.image, architecture]).apply(([image, architecture]) => {
          if (typeof image === "string") return image;

          return {
            ...image,
            context: image?.context ?? ".",
            platform:
              architecture === "arm64"
                ? Platform.Linux_arm64
                : Platform.Linux_amd64,
          };
        });
      }

      function normalizeLogging() {
        return all([v.logging, args.cluster.nodes.cluster.name]).apply(
          ([logging, clusterName]) => ({
            ...logging,
            retention: logging?.retention ?? "1 month",
            name:
              logging?.name ??
              // In the case of shared Cluster across stage, log group name can thrash
              // if Task name is the same. Need to suffix the task name with random hash.
              `/sst/cluster/${clusterName}/${physicalName(64, name)}/${v.name}`,
          }),
        );
      }
    }),
  );
}

export function createTaskRole(
  name: string,
  args: FargateBaseArgs,
  opts: ComponentResourceOptions,
  parent: Component,
  dev: boolean,
  additionalPermissions?: FunctionArgs["permissions"],
) {
  if (args.taskRole)
    return iam.Role.get(`${name}TaskRole`, args.taskRole, {}, { parent });

  const policy = all([
    args.permissions ?? [],
    Link.getInclude<Permission>("aws.permission", args.link),
    additionalPermissions ?? [],
  ]).apply(([argsPermissions, linkPermissions, additionalPermissions]) =>
    iam.getPolicyDocumentOutput({
      statements: [
        ...argsPermissions,
        ...linkPermissions,
        ...additionalPermissions,
        {
          actions: [
            "ssmmessages:CreateControlChannel",
            "ssmmessages:CreateDataChannel",
            "ssmmessages:OpenControlChannel",
            "ssmmessages:OpenDataChannel",
          ],
          resources: ["*"],
        },
      ].map((item) => ({
        effect: (() => {
          const effect = item.effect ?? "allow";
          return effect.charAt(0).toUpperCase() + effect.slice(1);
        })(),
        actions: item.actions,
        resources: item.resources,
      })),
    }),
  );

  return new iam.Role(
    ...transform(
      args.transform?.taskRole,
      `${name}TaskRole`,
      {
        assumeRolePolicy: iam.assumeRolePolicyForPrincipal({
          Service: "ecs-tasks.amazonaws.com",
          ...(dev ? { AWS: getCallerIdentityOutput({}, opts).accountId } : {}),
        }),
        inlinePolicies: policy.apply(({ statements }) =>
          statements ? [{ name: "inline", policy: policy.json }] : [],
        ),
      },
      { parent },
    ),
  );
}

export function createExecutionRole(
  name: string,
  args: FargateBaseArgs,
  opts: ComponentResourceOptions,
  parent: Component,
) {
  if (args.executionRole)
    return iam.Role.get(
      `${name}ExecutionRole`,
      args.executionRole,
      {},
      { parent },
    );

  return new iam.Role(
    ...transform(
      args.transform?.executionRole,
      `${name}ExecutionRole`,
      {
        assumeRolePolicy: iam.assumeRolePolicyForPrincipal({
          Service: "ecs-tasks.amazonaws.com",
        }),
        managedPolicyArns: [
          interpolate`arn:${
            getPartitionOutput({}, opts).partition
          }:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy`,
        ],
        inlinePolicies: [
          {
            name: "inline",
            policy: iam.getPolicyDocumentOutput({
              statements: [
                {
                  sid: "ReadSsmAndSecrets",
                  actions: [
                    "ssm:GetParameters",
                    "ssm:GetParameter",
                    "ssm:GetParameterHistory",
                    "secretsmanager:GetSecretValue",
                  ],
                  resources: ["*"],
                },
                ...(args.environmentFiles
                  ? [
                      {
                        sid: "ReadEnvironmentFiles",
                        actions: ["s3:GetObject"],
                        resources: args.environmentFiles,
                      },
                    ]
                  : []),
              ],
            }).json,
          },
        ],
      },
      { parent },
    ),
  );
}

export function createTaskDefinition(
  name: string,
  args: ServiceArgs,
  opts: ComponentResourceOptions,
  parent: Component,
  containers: ReturnType<typeof normalizeContainers>,
  architecture: ReturnType<typeof normalizeArchitecture>,
  cpu: ReturnType<typeof normalizeCpu>,
  memory: ReturnType<typeof normalizeMemory>,
  storage: ReturnType<typeof normalizeStorage>,
  taskRole: ReturnType<typeof createTaskRole>,
  executionRole: ReturnType<typeof createExecutionRole>,
) {
  const clusterName = args.cluster.nodes.cluster.name;
  const region = getRegionOutput({}, opts).name;
  const bootstrapData = region.apply((region) => bootstrap.forRegion(region));
  const linkEnvs = Link.propertiesToEnv(Link.getProperties(args.link));
  const containerDefinitions = output(containers).apply((containers) =>
    containers.map((container) => ({
      name: container.name,
      image: (() => {
        if (typeof container.image === "string") return output(container.image);

        const containerImage = container.image;
        const contextPath = path.join($cli.paths.root, container.image.context);
        const dockerfile = container.image.dockerfile ?? "Dockerfile";
        const dockerfilePath = path.join(contextPath, dockerfile);
        const dockerIgnorePath = fs.existsSync(
          path.join(contextPath, `${dockerfile}.dockerignore`),
        )
          ? path.join(contextPath, `${dockerfile}.dockerignore`)
          : path.join(contextPath, ".dockerignore");

        // add .sst to .dockerignore if not exist
        const lines = fs.existsSync(dockerIgnorePath)
          ? fs.readFileSync(dockerIgnorePath).toString().split("\n")
          : [];
        if (!lines.find((line) => line === ".sst")) {
          fs.writeFileSync(
            dockerIgnorePath,
            [...lines, "", "# sst", ".sst"].join("\n"),
          );
        }

        // Build image
        const image = imageBuilder(
          ...transform(
            args.transform?.image,
            `${name}Image${container.name}`,
            {
              context: { location: contextPath },
              dockerfile: { location: dockerfilePath },
              buildArgs: containerImage.args,
              secrets: linkEnvs,
              target: container.image.target,
              platforms: [container.image.platform],
              tags: [container.name, ...(container.image.tags ?? [])].map(
                (tag) => interpolate`${bootstrapData.assetEcrUrl}:${tag}`,
              ),
              registries: [
                ecr
                  .getAuthorizationTokenOutput(
                    {
                      registryId: bootstrapData.assetEcrRegistryId,
                    },
                    { parent },
                  )
                  .apply((authToken) => ({
                    address: authToken.proxyEndpoint,
                    password: secret(authToken.password),
                    username: authToken.userName,
                  })),
              ],
              cacheFrom: [
                {
                  registry: {
                    ref: interpolate`${bootstrapData.assetEcrUrl}:${container.name}-cache`,
                  },
                },
              ],
              cacheTo: [
                {
                  registry: {
                    ref: interpolate`${bootstrapData.assetEcrUrl}:${container.name}-cache`,
                    imageManifest: true,
                    ociMediaTypes: true,
                    mode: "max",
                  },
                },
              ],
              push: true,
            },
            { parent },
          ),
        );

        return interpolate`${bootstrapData.assetEcrUrl}@${image.digest}`;
      })(),
      cpu: container.cpu ? toNumber(container.cpu) : undefined,
      memory: container.memory ? toMBs(container.memory) : undefined,
      command: container.command,
      entrypoint: container.entrypoint,
      healthCheck: container.health && {
        command: container.health.command,
        startPeriod: toSeconds(container.health.startPeriod ?? "0 seconds"),
        timeout: toSeconds(container.health.timeout ?? "5 seconds"),
        interval: toSeconds(container.health.interval ?? "30 seconds"),
        retries: container.health.retries ?? 3,
      },
      pseudoTerminal: true,
      portMappings: [{ containerPortRange: "1-65535" }],
      logConfiguration: {
        logDriver: "awslogs",
        options: {
          "awslogs-group": (() => {
            return new cloudwatch.LogGroup(
              ...transform(
                args.transform?.logGroup,
                `${name}LogGroup${container.name}`,
                {
                  name: container.logging.name,
                  retentionInDays: RETENTION[container.logging.retention],
                },
                { parent, ignoreChanges: ["name"] },
              ),
            );
          })().name,
          "awslogs-region": region,
          "awslogs-stream-prefix": "/service",
        },
      },
      environment: linkEnvs.apply((linkEnvs) =>
        Object.entries({
          ...container.environment,
          ...linkEnvs,
        }).map(([name, value]) => ({ name, value })),
      ),
      environmentFiles: container.environmentFiles?.map((file) => ({
        type: "s3",
        value: file,
      })),
      linuxParameters: {
        initProcessEnabled: true,
      },
      mountPoints: container.volumes?.map((volume) => ({
        sourceVolume: volume.efs.accessPoint,
        containerPath: volume.path,
      })),
      secrets: Object.entries(container.ssm ?? {}).map(([name, valueFrom]) => ({
        name,
        valueFrom,
      })),
    })),
  );

  return storage.apply(
    (storage) =>
      new ecs.TaskDefinition(
        ...transform(
          args.transform?.taskDefinition,
          `${name}Task`,
          {
            family: interpolate`${clusterName}-${name}`,
            trackLatest: true,
            cpu: cpu.apply((v) => toNumber(v).toString()),
            memory: memory.apply((v) => toMBs(v).toString()),
            networkMode: "awsvpc",
            ephemeralStorage: (() => {
              const sizeInGib = toGBs(storage);
              return sizeInGib === 20 ? undefined : { sizeInGib };
            })(),
            requiresCompatibilities: ["FARGATE"],
            runtimePlatform: {
              cpuArchitecture: architecture.apply((v) => v.toUpperCase()),
              operatingSystemFamily: "LINUX",
            },
            executionRoleArn: executionRole.arn,
            taskRoleArn: taskRole.arn,
            volumes: output(containers).apply((containers) => {
              const uniqueAccessPoints: Set<string> = new Set();
              return containers.flatMap((container) =>
                (container.volumes ?? []).flatMap((volume) => {
                  if (uniqueAccessPoints.has(volume.efs.accessPoint)) return [];
                  uniqueAccessPoints.add(volume.efs.accessPoint);
                  return {
                    name: volume.efs.accessPoint,
                    efsVolumeConfiguration: {
                      fileSystemId: volume.efs.fileSystem,
                      transitEncryption: "ENABLED",
                      authorizationConfig: {
                        accessPointId: volume.efs.accessPoint,
                      },
                    },
                  };
                }),
              );
            }),
            containerDefinitions: $jsonStringify(containerDefinitions),
          },
          { parent },
        ),
      ),
  );
}
