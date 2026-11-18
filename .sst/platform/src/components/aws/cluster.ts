import { ComponentResourceOptions, Output, output } from "@pulumi/pulumi";
import {
  Component,
  ComponentVersion,
  parseComponentVersion,
  Prettify,
  Transform,
  transform,
} from "../component";
import { Input } from "../input";
import { Service, ServiceArgs } from "./service";
import { ecs } from "@pulumi/aws";
import { Cluster as ClusterV1 } from "./cluster-v1";
import { Vpc } from "./vpc";
import { Vpc as VpcV1 } from "./vpc-v1.js";
import { Task, TaskArgs } from "./task";
import { VisibleError } from "../error";
export type { ClusterArgs as ClusterV1Args } from "./cluster-v1";

type ClusterVpcArgs = {
  /**
   * The ID of the VPC.
   */
  id: Input<string>;
  /**
   * A list of VPC security group IDs for the service.
   */
  securityGroups: Input<Input<string>[]>;
  /**
   * A list of subnet IDs in the VPC to place the services in.
   * @deprecated Use `containerSubnets` instead.
   */
  serviceSubnets?: Input<Input<string>[]>;
  /**
   * A list of subnet IDs in the VPC to place the containers in.
   */
  containerSubnets?: Input<Input<string>[]>;
  /**
   * A list of subnet IDs in the VPC to place the load balancer in.
   */
  loadBalancerSubnets: Input<Input<string>[]>;
  /**
   * The ID of the Cloud Map namespace to use for the service.
   */
  cloudmapNamespaceId?: Input<string>;
  /**
   * The name of the Cloud Map namespace to use for the service.
   */
  cloudmapNamespaceName?: Input<string>;
};

export interface ClusterArgs {
  /**
   * The VPC to use for the cluster.
   *
   * @example
   * Create a `Vpc` component.
   *
   * ```js title="sst.config.ts"
   * const myVpc = new sst.aws.Vpc("MyVpc");
   * ```
   *
   * Or reference an existing VPC.
   *
   * ```js title="sst.config.ts"
   * const myVpc = sst.aws.Vpc.get("MyVpc", {
   *   id: "vpc-12345678901234567"
   * });
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
   * By default, both the load balancer and the services are deployed in public subnets.
   * The above is equivalent to:
   *
   * ```js
   * {
   *   vpc: {
   *     id: myVpc.id,
   *     securityGroups: myVpc.securityGroups,
   *     containerSubnets: myVpc.publicSubnets,
   *     loadBalancerSubnets: myVpc.publicSubnets,
   *     cloudmapNamespaceId: myVpc.nodes.cloudmapNamespace.id,
   *     cloudmapNamespaceName: myVpc.nodes.cloudmapNamespace.name
   *   }
   * }
   * ```
   */
  vpc: Vpc | Input<Prettify<ClusterVpcArgs>>;
  /** @internal */
  forceUpgrade?: "v2";
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the ECS Cluster resource.
     */
    cluster?: Transform<ecs.ClusterArgs>;
  };
}

export interface ClusterGetArgs {
  /**
   * The ID of the cluster.
   */
  id: Input<string>;
  /**
   * The VPC used for the cluster.
   */
  vpc: ClusterArgs["vpc"];
}

interface ClusterRef {
  ref: true;
  id: Input<string>;
  vpc: ClusterArgs["vpc"];
}

/**
 * The `Cluster` component lets you create an [ECS cluster](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/clusters.html) for your app.
 * add `Service` and `Task` components to it.
 *
 * @example
 *
 * ```ts title="sst.config.ts"
 * const vpc = new sst.aws.Vpc("MyVpc");
 * const cluster = new sst.aws.Cluster("MyCluster", { vpc });
 * ```
 *
 * Once created, you can add the following to it:
 *
 * 1. `Service`: These are containers that are always running, like web or
 *   application servers. They automatically restart if they fail.
 * 2. `Task`: These are containers that are used for long running asynchronous work,
 *   like data processing.
 */
export class Cluster extends Component {
  private constructorOpts: ComponentResourceOptions;
  private cluster: Output<ecs.Cluster>;
  private _vpc:
    | Vpc
    | Output<
        Required<Pick<ClusterVpcArgs, "containerSubnets">> &
          Omit<ClusterVpcArgs, "containerSubnets" | "serviceSubnets">
      >;
  public static v1 = ClusterV1;

  constructor(
    name: string,
    args: ClusterArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super(__pulumiType, name, args, opts);
    const _version = { major: 2, minor: 0 };
    const self = this;
    this.constructorOpts = opts;

    if (args && "ref" in args) {
      const ref = reference();
      const vpc = normalizeVpc();
      this.cluster = ref.cluster;
      this._vpc = vpc;
      return;
    }

    registerVersion();
    const vpc = normalizeVpc();
    const cluster = createCluster();
    createCapacityProviders();

    this.cluster = output(cluster);
    this._vpc = vpc;

    function reference() {
      const ref = args as ClusterRef;
      const cluster = ecs.Cluster.get(`${name}Cluster`, ref.id, undefined, {
        parent: self,
      });
      const clusterValidated = cluster.tags.apply((tags) => {
        const refVersion = tags?.["sst:ref:version"]
          ? parseComponentVersion(tags["sst:ref:version"])
          : undefined;

        if (refVersion?.minor !== _version.minor) {
          throw new VisibleError(
            [
              `There have been some minor changes to the "Cluster" component that's being referenced by "${name}".\n`,
              `To update, you'll need to redeploy the stage where the cluster was created. And then redeploy this stage.`,
            ].join("\n"),
          );
        }

        registerVersion(refVersion);

        return cluster;
      });

      return { cluster: clusterValidated };
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
        return args.vpc;
      }

      // "vpc" is object
      return output(args.vpc).apply((vpc) => {
        if (vpc.containerSubnets && vpc.serviceSubnets)
          throw new VisibleError(
            `You cannot provide both "vpc.containerSubnets" and "vpc.serviceSubnets" in the "${name}" Cluster component. The "serviceSubnets" property has been deprecated. Use "containerSubnets" instead.`,
          );
        if (!vpc.containerSubnets && !vpc.serviceSubnets)
          throw new VisibleError(
            `Missing "vpc.containerSubnets" for the "${name}" Cluster component.`,
          );

        if (
          (vpc.cloudmapNamespaceId && !vpc.cloudmapNamespaceName) ||
          (!vpc.cloudmapNamespaceId && vpc.cloudmapNamespaceName)
        )
          throw new VisibleError(
            `You must provide both "vpc.cloudmapNamespaceId" and "vpc.cloudmapNamespaceName" for the "${name}" Cluster component.`,
          );

        return {
          ...vpc,
          containerSubnets: (vpc.containerSubnets ?? vpc.serviceSubnets)!,
          serviceSubnets: undefined,
        };
      });
    }

    function createCluster() {
      return new ecs.Cluster(
        ...transform(
          args.transform?.cluster,
          `${name}Cluster`,
          {
            tags: {
              "sst:ref:version": `${_version.major}.${_version.minor}`,
            },
          },
          { parent: self },
        ),
      );
    }

    function registerVersion(overrideVersion?: ComponentVersion) {
      const newMajorVersion = _version.major;
      const oldMajorVersion =
        overrideVersion?.major ?? $cli.state.version[name];
      self.registerVersion({
        new: newMajorVersion,
        old: oldMajorVersion,
        message: [
          `There is a new version of "Cluster" that has breaking changes.`,
          ``,
          `What changed:`,
          `  - In the old version, load balancers were deployed in public subnets, and services were deployed in private subnets. The VPC was required to have NAT gateways.`,
          `  - In the latest version, both the load balancer and the services are deployed in public subnets. The VPC is not required to have NAT gateways. So the new default makes this cheaper to run.`,
          ``,
          `To upgrade:`,
          `  - Set \`forceUpgrade: "v${newMajorVersion}"\` on the "Cluster" component. Learn more https://sst.dev/docs/component/aws/cluster#forceupgrade`,
          ``,
          `To continue using v${$cli.state.version[name]}:`,
          `  - Rename "Cluster" to "Cluster.v${$cli.state.version[name]}". Learn more about versioning - https://sst.dev/docs/components/#versioning`,
        ].join("\n"),
        forceUpgrade: args.forceUpgrade,
      });
    }

    function createCapacityProviders() {
      return new ecs.ClusterCapacityProviders(
        `${name}CapacityProviders`,
        {
          clusterName: cluster.name,
          capacityProviders: ["FARGATE", "FARGATE_SPOT"],
        },
        { parent: self },
      );
    }
  }

  /**
   * The cluster ID.
   */
  public get id() {
    return this.cluster.id;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The Amazon ECS Cluster.
       */
      cluster: this.cluster,
    };
  }

  /**
   * The VPC configuration for the cluster.
   * @internal
   */
  public get vpc() {
    return this._vpc;
  }

  /**
   * Add a service to the cluster.
   *
   * @deprecated Use the `Service` component directly to create services. To migrate, change
   *
   * ```ts
   * cluster.addService("MyService", { ...args });
   * ```
   *
   * to
   *
   * ```ts
   * new sst.aws.Service("MyService", { cluster, ...args });
   * ```
   *
   * @param name Name of the service.
   * @param args? Configure the service.
   * @param opts? Resource options.
   *
   * @example
   *
   * ```ts title="sst.config.ts"
   * cluster.addService("MyService");
   * ```
   *
   * You can also configure the service. For example, set a custom domain.
   *
   * ```js {2} title="sst.config.ts"
   * cluster.addService("MyService", {
   *   domain: "example.com"
   * });
   * ```
   *
   * Enable auto-scaling.
   *
   * ```ts title="sst.config.ts"
   * cluster.addService("MyService", {
   *   scaling: {
   *     min: 4,
   *     max: 16,
   *     cpuUtilization: 50,
   *     memoryUtilization: 50,
   *   }
   * });
   * ```
   *
   * By default this starts a single container. To add multiple containers in the service, pass in an array of containers args.
   *
   * ```ts title="sst.config.ts"
   * cluster.addService("MyService", {
   *   architecture: "arm64",
   *   containers: [
   *     {
   *       name: "app",
   *       image: "nginxdemos/hello:plain-text"
   *     },
   *     {
   *       name: "admin",
   *       image: {
   *         context: "./admin",
   *         dockerfile: "Dockerfile"
   *       }
   *     }
   *   ]
   * });
   * ```
   *
   * This is useful for running sidecar containers.
   */
  public addService(
    name: string,
    args?: Omit<ServiceArgs, "cluster">,
    opts?: ComponentResourceOptions,
  ) {
    // Do not prefix the service to allow `Resource.MyService` to work.
    return new Service(
      name,
      {
        cluster: this,
        ...args,
      },
      { provider: this.constructorOpts.provider, ...opts },
    );
  }

  /**
   * Add a task to the cluster.
   *
   * @deprecated Use the `Task` component directly to create tasks. To migrate, change
   *
   * ```ts
   * cluster.addTask("MyTask", { ...args });
   * ```
   *
   * to
   *
   * ```ts
   * new sst.aws.Task("MyTask", { cluster, ...args });
   * ```
   *
   * @param name Name of the task.
   * @param args? Configure the task.
   * @param opts? Resource options.
   *
   * @example
   *
   * ```ts title="sst.config.ts"
   * cluster.addTask("MyTask");
   * ```
   *
   * You can also configure the task. By default this starts a single container.
   * To add multiple containers in the task, pass in an array of containers args.
   *
   * ```ts title="sst.config.ts"
   * cluster.addTask("MyTask", {
   *   architecture: "arm64",
   *   containers: [
   *     {
   *       name: "app",
   *       image: "nginxdemos/hello:plain-text"
   *     },
   *     {
   *       name: "admin",
   *       image: {
   *         context: "./admin",
   *         dockerfile: "Dockerfile"
   *       }
   *     }
   *   ]
   * });
   * ```
   *
   * This is useful for running sidecar containers.
   */
  public addTask(
    name: string,
    args?: Omit<TaskArgs, "cluster">,
    opts?: ComponentResourceOptions,
  ) {
    // Do not prefix the task to allow `Resource.MyTask` to work.
    return new Task(
      name,
      {
        cluster: this,
        ...args,
      },
      { provider: this.constructorOpts.provider, ...opts },
    );
  }

  /**
   * Reference an existing ECS Cluster with the given ID. This is useful when you
   * create a cluster in one stage and want to share it in another. It avoids
   * having to create a new cluster in the other stage.
   *
   * :::tip
   * You can use the `static get` method to share cluster across stages.
   * :::
   *
   * @param name The name of the component.
   * @param args The arguments to get the cluster.
   * @param opts? Resource options.
   *
   * @example
   * Imagine you create a cluster in the `dev` stage. And in your personal stage `frank`,
   * instead of creating a new cluster, you want to share the same cluster from `dev`.
   *
   * ```ts title="sst.config.ts"
   * const cluster = $app.stage === "frank"
   *   ? sst.aws.Cluster.get("MyCluster", {
   *       id: "arn:aws:ecs:us-east-1:123456789012:cluster/app-dev-MyCluster",
   *       vpc,
   *     })
   *   : new sst.aws.Cluster("MyCluster", { vpc });
   * ```
   *
   * Here `arn:aws:ecs:us-east-1:123456789012:cluster/app-dev-MyCluster` is the ID of the
   * cluster created in the `dev` stage. You can find these by outputting the cluster ID
   * in the `dev` stage.
   *
   * ```ts title="sst.config.ts"
   * return {
   *   id: cluster.id,
   * };
   * ```
   */
  public static get(
    name: string,
    args: ClusterGetArgs,
    opts?: ComponentResourceOptions,
  ) {
    return new Cluster(
      name,
      { ref: true, id: args.id, vpc: args.vpc } as ClusterArgs,
      opts,
    );
  }
}

const __pulumiType = "sst:aws:Cluster";
// @ts-expect-error
Cluster.__pulumiType = __pulumiType;
