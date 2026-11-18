import fs from "fs";
import path from "path";
import {
  ComponentResourceOptions,
  Input,
  Output,
  all,
  interpolate,
  output,
  secret,
} from "@pulumi/pulumi";
import { Image, Platform } from "@pulumi/docker-build";
import { Component, transform } from "../component.js";
import { toGBs, toMBs } from "../size.js";
import { toNumber } from "../cpu.js";
import { dns as awsDns } from "./dns.js";
import { VisibleError } from "../error.js";
import { DnsValidatedCertificate } from "./dns-validated-certificate.js";
import { Link } from "../link.js";
import { bootstrap } from "./helpers/bootstrap.js";
import {
  ClusterArgs,
  ClusterServiceArgs,
  supportedCpus,
  supportedMemories,
} from "./cluster-v1.js";
import { RETENTION } from "./logging.js";
import { URL_UNAVAILABLE } from "./linkable.js";
import {
  appautoscaling,
  cloudwatch,
  ec2,
  ecr,
  ecs,
  getCallerIdentityOutput,
  getRegionOutput,
  iam,
  lb,
} from "@pulumi/aws";
import { Permission } from "./permission.js";
import { Vpc } from "./vpc.js";

export interface ServiceArgs extends ClusterServiceArgs {
  /**
   * The cluster to use for the service.
   */
  cluster: Input<{
    /**
     * The name of the cluster.
     */
    name: Input<string>;
    /**
     * The ARN of the cluster.
     */
    arn: Input<string>;
  }>;
  /**
   * The VPC to use for the cluster.
   */
  vpc: ClusterArgs["vpc"];
}

/**
 * The `Service` component is internally used by the `Cluster` component to deploy services to
 * [Amazon ECS](https://aws.amazon.com/ecs/). It uses [AWS Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html).
 *
 * :::note
 * This component is not meant to be created directly.
 * :::
 *
 * This component is returned by the `addService` method of the `Cluster` component.
 */
export class Service extends Component implements Link.Linkable {
  private readonly service?: ecs.Service;
  private readonly taskRole: iam.Role;
  private readonly taskDefinition?: ecs.TaskDefinition;
  private readonly loadBalancer?: lb.LoadBalancer;
  private readonly domain?: Output<string | undefined>;
  private readonly _url?: Output<string>;
  private readonly devUrl?: Output<string>;

  constructor(
    name: string,
    args: ServiceArgs,
    opts?: ComponentResourceOptions,
  ) {
    super(__pulumiType, name, args, opts);

    const self = this;

    const cluster = output(args.cluster);
    const vpc = normalizeVpc();
    const region = normalizeRegion();
    const architecture = normalizeArchitecture();
    const imageArgs = normalizeImage();
    const cpu = normalizeCpu();
    const memory = normalizeMemory();
    const storage = normalizeStorage();
    const scaling = normalizeScaling();
    const logging = normalizeLogging();
    const pub = normalizePublic();

    const linkData = buildLinkData();
    const linkPermissions = buildLinkPermissions();

    const taskRole = createTaskRole();
    this.taskRole = taskRole;

    if ($dev) {
      this.devUrl = !pub ? undefined : output(args.dev?.url ?? URL_UNAVAILABLE);
      registerReceiver();
      return;
    }

    const bootstrapData = region.apply((region) => bootstrap.forRegion(region));
    const executionRole = createExecutionRole();
    const image = createImage();
    const logGroup = createLogGroup();
    const taskDefinition = createTaskDefinition();
    const certificateArn = createSsl();
    const { loadBalancer, targets } = createLoadBalancer();
    const service = createService();
    createAutoScaling();
    createDnsRecords();

    this.service = service;
    this.taskDefinition = taskDefinition;
    this.loadBalancer = loadBalancer;
    this.domain = pub?.domain
      ? pub.domain.apply((domain) => domain?.name)
      : output(undefined);
    this._url = !self.loadBalancer
      ? undefined
      : all([self.domain, self.loadBalancer?.dnsName]).apply(
        ([domain, loadBalancer]) =>
          domain ? `https://${domain}/` : `http://${loadBalancer}`,
      );

    registerHint();
    registerReceiver();

    function normalizeVpc() {
      // "vpc" is a Vpc component
      if (args.vpc instanceof Vpc) {
        const result = {
          id: args.vpc.id,
          publicSubnets: args.vpc.publicSubnets,
          privateSubnets: args.vpc.privateSubnets,
          securityGroups: args.vpc.securityGroups,
        };
        return args.vpc.nodes.natGateways.apply((natGateways) => {
          if (natGateways.length === 0)
            throw new VisibleError(
              `The VPC configured for the service does not have NAT enabled. Enable NAT by configuring "nat" on the "sst.aws.Vpc" component.`,
            );
          return result;
        });
      }

      // "vpc" is object
      return output(args.vpc);
    }

    function normalizeRegion() {
      return getRegionOutput(undefined, { parent: self }).name;
    }

    function normalizeArchitecture() {
      return output(args.architecture ?? "x86_64").apply((v) => v);
    }

    function normalizeImage() {
      return all([args.image ?? {}, architecture]).apply(
        ([image, architecture]) => ({
          ...image,
          context: image.context ?? ".",
          platform:
            architecture === "arm64"
              ? Platform.Linux_arm64
              : Platform.Linux_amd64,
        }),
      );
    }

    function normalizeCpu() {
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

    function normalizeMemory() {
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

    function normalizeStorage() {
      return output(args.storage ?? "21 GB").apply((v) => {
        const storage = toGBs(v);
        if (storage < 21 || storage > 200)
          throw new Error(
            `Unsupported storage: ${v}. The supported value for storage is between "21 GB" and "200 GB"`,
          );
        return v;
      });
    }

    function normalizeScaling() {
      return output(args.scaling).apply((v) => ({
        min: v?.min ?? 1,
        max: v?.max ?? 1,
        cpuUtilization: v?.cpuUtilization ?? 70,
        memoryUtilization: v?.memoryUtilization ?? 70,
      }));
    }

    function normalizeLogging() {
      return output(args.logging).apply((logging) => ({
        ...logging,
        retention: logging?.retention ?? "1 month",
      }));
    }

    function normalizePublic() {
      if (!args.public) return;

      const ports = output(args.public).apply((pub) => {
        // validate ports
        if (!pub.ports || pub.ports.length === 0)
          throw new VisibleError(
            `You must provide the ports to expose via "public.ports".`,
          );

        // parse protocols and ports
        const ports = pub.ports.map((v) => {
          const listenParts = v.listen.split("/");
          const forwardParts = v.forward ? v.forward.split("/") : listenParts;
          return {
            listenPort: parseInt(listenParts[0]),
            listenProtocol: listenParts[1],
            forwardPort: parseInt(forwardParts[0]),
            forwardProtocol: forwardParts[1],
          };
        });

        // validate protocols are consistent
        const appProtocols = ports.filter(
          (port) =>
            ["http", "https"].includes(port.listenProtocol) &&
            ["http", "https"].includes(port.forwardProtocol),
        );
        if (appProtocols.length > 0 && appProtocols.length < ports.length)
          throw new VisibleError(
            `Protocols must be either all http/https, or all tcp/udp/tcp_udp/tls.`,
          );

        // validate certificate exists for https/tls protocol
        ports.forEach((port) => {
          if (["https", "tls"].includes(port.listenProtocol) && !pub.domain) {
            throw new VisibleError(
              `You must provide a custom domain for ${port.listenProtocol.toUpperCase()} protocol.`,
            );
          }
        });

        return ports;
      });

      const domain = output(args.public).apply((pub) => {
        if (!pub.domain) return undefined;

        // normalize domain
        const domain =
          typeof pub.domain === "string" ? { name: pub.domain } : pub.domain;
        return {
          name: domain.name,
          dns: domain.dns === false ? undefined : domain.dns ?? awsDns(),
          cert: domain.cert,
        };
      });

      return { ports, domain };
    }

    function buildLinkData() {
      return output(args.link || []).apply((links) => Link.build(links));
    }

    function buildLinkPermissions() {
      return Link.getInclude<Permission>("aws.permission", args.link);
    }

    function createImage() {
      // Edit .dockerignore file
      const imageArgsNew = imageArgs.apply((imageArgs) => {
        const context = path.join($cli.paths.root, imageArgs.context);
        const dockerfile = imageArgs.dockerfile ?? "Dockerfile";

        // get .dockerignore file
        const file = (() => {
          let filePath = path.join(context, `${dockerfile}.dockerignore`);
          if (fs.existsSync(filePath)) return filePath;
          filePath = path.join(context, ".dockerignore");
          if (fs.existsSync(filePath)) return filePath;
        })();

        // add .sst to .dockerignore if not exist
        const content = file ? fs.readFileSync(file).toString() : "";
        const lines = content.split("\n");
        if (!lines.find((line) => line === ".sst")) {
          fs.writeFileSync(
            file ?? path.join(context, ".dockerignore"),
            [...lines, "", "# sst", ".sst"].join("\n"),
          );
        }
        return imageArgs;
      });

      // Build image
      return new Image(
        ...transform(
          args.transform?.image,
          `${name}Image`,
          {
            context: {
              location: imageArgsNew.apply((v) =>
                path.join($cli.paths.root, v.context),
              ),
            },
            dockerfile: {
              location: imageArgsNew.apply((v) =>
                v.dockerfile
                  ? path.join($cli.paths.root, v.dockerfile)
                  : path.join($cli.paths.root, v.context, "Dockerfile"),
              ),
            },
            buildArgs: imageArgsNew.apply((v) => v.args ?? {}),
            platforms: [imageArgs.platform],
            tags: [interpolate`${bootstrapData.assetEcrUrl}:${name}`],
            registries: [
              ecr
                .getAuthorizationTokenOutput({
                  registryId: bootstrapData.assetEcrRegistryId,
                })
                .apply((authToken) => ({
                  address: authToken.proxyEndpoint,
                  password: secret(authToken.password),
                  username: authToken.userName,
                })),
            ],
            push: true,
          },
          { parent: self },
        ),
      );
    }

    function createLoadBalancer() {
      if (!pub) return {};

      const securityGroup = new ec2.SecurityGroup(
        ...transform(
          args?.transform?.loadBalancerSecurityGroup,
          `${name}LoadBalancerSecurityGroup`,
          {
            vpcId: vpc.id,
            egress: [
              {
                fromPort: 0,
                toPort: 0,
                protocol: "-1",
                cidrBlocks: ["0.0.0.0/0"],
              },
            ],
            ingress: [
              {
                fromPort: 0,
                toPort: 0,
                protocol: "-1",
                cidrBlocks: ["0.0.0.0/0"],
              },
            ],
          },
          { parent: self },
        ),
      );

      const loadBalancer = new lb.LoadBalancer(
        ...transform(
          args.transform?.loadBalancer,
          `${name}LoadBalancer`,
          {
            internal: false,
            loadBalancerType: pub.ports.apply((ports) =>
              ports[0].listenProtocol.startsWith("http")
                ? "application"
                : "network",
            ),
            subnets: vpc.publicSubnets,
            securityGroups: [securityGroup.id],
            enableCrossZoneLoadBalancing: true,
          },
          { parent: self },
        ),
      );

      const ret = all([pub.ports, certificateArn]).apply(([ports, cert]) => {
        const listeners: Record<string, lb.Listener> = {};
        const targets: Record<string, lb.TargetGroup> = {};

        ports.forEach((port) => {
          const forwardProtocol = port.forwardProtocol.toUpperCase();
          const forwardPort = port.forwardPort;
          const targetId = `${forwardProtocol}${forwardPort}`;
          const target =
            targets[targetId] ??
            new lb.TargetGroup(
              ...transform(
                args.transform?.target,
                `${name}Target${targetId}`,
                {
                  // TargetGroup names allow for 32 chars, but an 8 letter suffix
                  // ie. "-1234567" is automatically added.
                  // - If we don't specify "name" or "namePrefix", we need to ensure
                  //   the component name is less than 24 chars. Hard to guarantee.
                  // - If we specify "name", we need to ensure the $app-$stage-$name
                  //   if less than 32 chars. Hard to guarantee.
                  // - Hence we will use "namePrefix".
                  namePrefix: forwardProtocol,
                  port: forwardPort,
                  protocol: forwardProtocol,
                  targetType: "ip",
                  vpcId: vpc.id,
                },
                { parent: self },
              ),
            );
          targets[targetId] = target;

          const listenProtocol = port.listenProtocol.toUpperCase();
          const listenPort = port.listenPort;
          const listenerId = `${listenProtocol}${listenPort}`;
          const listener =
            listeners[listenerId] ??
            new lb.Listener(
              ...transform(
                args.transform?.listener,
                `${name}Listener${listenerId}`,
                {
                  loadBalancerArn: loadBalancer.arn,
                  port: listenPort,
                  protocol: listenProtocol,
                  certificateArn: ["HTTPS", "TLS"].includes(listenProtocol)
                    ? cert
                    : undefined,
                  defaultActions: [
                    {
                      type: "forward",
                      targetGroupArn: target.arn,
                    },
                  ],
                },
                { parent: self },
              ),
            );
          listeners[listenerId] = listener;
        });

        return { listeners, targets };
      });

      return { loadBalancer, targets: ret.targets };
    }

    function createSsl() {
      if (!pub) return output(undefined);

      return pub.domain.apply((domain) => {
        if (!domain) return output(undefined);
        if (domain.cert) return output(domain.cert);

        return new DnsValidatedCertificate(
          `${name}Ssl`,
          {
            domainName: domain.name,
            dns: domain.dns!,
          },
          { parent: self },
        ).arn;
      });
    }

    function createLogGroup() {
      return new cloudwatch.LogGroup(
        ...transform(
          args.transform?.logGroup,
          `${name}LogGroup`,
          {
            name: interpolate`/sst/cluster/${cluster.name}/${name}`,
            retentionInDays: logging.apply(
              (logging) => RETENTION[logging.retention],
            ),
          },
          { parent: self },
        ),
      );
    }

    function createTaskRole() {
      const policy = all([args.permissions || [], linkPermissions]).apply(
        ([argsPermissions, linkPermissions]) =>
          iam.getPolicyDocumentOutput({
            statements: [...argsPermissions, ...linkPermissions].map(
              (item) => ({
                effect: (() => {
                  const effect = item.effect ?? "allow";
                  return effect.charAt(0).toUpperCase() + effect.slice(1);
                })(),
                actions: item.actions,
                resources: item.resources,
              }),
            ),
          }),
      );

      return new iam.Role(
        ...transform(
          args.transform?.taskRole,
          `${name}TaskRole`,
          {
            assumeRolePolicy: !$dev
              ? iam.assumeRolePolicyForPrincipal({
                Service: "ecs-tasks.amazonaws.com",
              })
              : iam.assumeRolePolicyForPrincipal({
                AWS: interpolate`arn:aws:iam::${getCallerIdentityOutput().accountId
                  }:root`,
              }),
            inlinePolicies: policy.apply(({ statements }) =>
              statements ? [{ name: "inline", policy: policy.json }] : [],
            ),
          },
          { parent: self },
        ),
      );
    }

    function createExecutionRole() {
      return new iam.Role(
        `${name}ExecutionRole`,
        {
          assumeRolePolicy: iam.assumeRolePolicyForPrincipal({
            Service: "ecs-tasks.amazonaws.com",
          }),
          managedPolicyArns: [
            "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
          ],
        },
        { parent: self },
      );
    }

    function createTaskDefinition() {
      return new ecs.TaskDefinition(
        ...transform(
          args.transform?.taskDefinition,
          `${name}Task`,
          {
            family: interpolate`${cluster.name}-${name}`,
            trackLatest: true,
            cpu: cpu.apply((v) => toNumber(v).toString()),
            memory: memory.apply((v) => toMBs(v).toString()),
            networkMode: "awsvpc",
            ephemeralStorage: {
              sizeInGib: storage.apply((v) => toGBs(v)),
            },
            requiresCompatibilities: ["FARGATE"],
            runtimePlatform: {
              cpuArchitecture: architecture.apply((v) => v.toUpperCase()),
              operatingSystemFamily: "LINUX",
            },
            executionRoleArn: executionRole.arn,
            taskRoleArn: taskRole.arn,
            containerDefinitions: $jsonStringify([
              {
                name,
                image: interpolate`${bootstrapData.assetEcrUrl}@${image.digest}`,
                pseudoTerminal: true,
                portMappings: pub?.ports.apply((ports) =>
                  ports
                    .map((port) => port.forwardPort)
                    // ensure unique ports
                    .filter(
                      (value, index, self) => self.indexOf(value) === index,
                    )
                    .map((value) => ({ containerPort: value })),
                ),
                logConfiguration: {
                  logDriver: "awslogs",
                  options: {
                    "awslogs-group": logGroup.name,
                    "awslogs-region": region,
                    "awslogs-stream-prefix": "/service",
                  },
                },
                environment: all([args.environment ?? [], linkData]).apply(
                  ([env, linkData]) => [
                    ...Object.entries(env).map(([name, value]) => ({
                      name,
                      value,
                    })),
                    ...linkData.map((d) => ({
                      name: `SST_RESOURCE_${d.name}`,
                      value: JSON.stringify(d.properties),
                    })),
                    {
                      name: "SST_RESOURCE_App",
                      value: JSON.stringify({
                        name: $app.name,
                        stage: $app.stage,
                      }),
                    },
                  ],
                ),
              },
            ]),
          },
          { parent: self },
        ),
      );
    }

    function createService() {
      return new ecs.Service(
        ...transform(
          args.transform?.service,
          `${name}Service`,
          {
            name,
            cluster: cluster.arn,
            taskDefinition: taskDefinition.arn,
            desiredCount: scaling.min,
            launchType: "FARGATE",
            networkConfiguration: {
              assignPublicIp: false,
              subnets: vpc.privateSubnets,
              securityGroups: vpc.securityGroups,
            },
            deploymentCircuitBreaker: {
              enable: true,
              rollback: true,
            },
            loadBalancers:
              targets &&
              targets.apply((targets) =>
                Object.values(targets).map((target) => ({
                  targetGroupArn: target.arn,
                  containerName: name,
                  containerPort: target.port.apply((port) => port!),
                })),
              ),
          },
          { parent: self },
        ),
      );
    }

    function createAutoScaling() {
      const target = new appautoscaling.Target(
        `${name}AutoScalingTarget`,
        {
          serviceNamespace: "ecs",
          scalableDimension: "ecs:service:DesiredCount",
          resourceId: interpolate`service/${cluster.name}/${service.name}`,
          maxCapacity: scaling.max,
          minCapacity: scaling.min,
        },
        { parent: self },
      );

      new appautoscaling.Policy(
        `${name}AutoScalingCpuPolicy`,
        {
          serviceNamespace: target.serviceNamespace,
          scalableDimension: target.scalableDimension,
          resourceId: target.resourceId,
          policyType: "TargetTrackingScaling",
          targetTrackingScalingPolicyConfiguration: {
            predefinedMetricSpecification: {
              predefinedMetricType: "ECSServiceAverageCPUUtilization",
            },
            targetValue: scaling.cpuUtilization,
          },
        },
        { parent: self },
      );

      new appautoscaling.Policy(
        `${name}AutoScalingMemoryPolicy`,
        {
          serviceNamespace: target.serviceNamespace,
          scalableDimension: target.scalableDimension,
          resourceId: target.resourceId,
          policyType: "TargetTrackingScaling",
          targetTrackingScalingPolicyConfiguration: {
            predefinedMetricSpecification: {
              predefinedMetricType: "ECSServiceAverageMemoryUtilization",
            },
            targetValue: scaling.memoryUtilization,
          },
        },
        { parent: self },
      );
    }

    function createDnsRecords() {
      if (!pub) return;

      pub.domain.apply((domain) => {
        if (!domain?.dns) return;

        domain.dns.createAlias(
          name,
          {
            name: domain.name,
            aliasName: loadBalancer!.dnsName,
            aliasZone: loadBalancer!.zoneId,
          },
          { parent: self },
        );
      });
    }

    function registerHint() {
      self.registerOutputs({ _hint: self._url });
    }

    function registerReceiver() {
      self.registerOutputs({
        _dev: imageArgs.apply((imageArgs) => ({
          links: linkData.apply((input) => input.map((item) => item.name)),
          environment: {
            ...args.environment,
            AWS_REGION: region,
          },
          aws: {
            role: taskRole.arn,
          },
          autostart: output(args.dev?.autostart).apply((val) => val ?? true),
          directory: output(args.dev?.directory).apply(
            (dir) =>
              dir ||
              path.join(
                imageArgs.dockerfile
                  ? path.dirname(imageArgs.dockerfile)
                  : imageArgs.context,
              ),
          ),
          command: args.dev?.command,
        })),
      });
    }
  }

  /**
   * The URL of the service.
   *
   * If `public.domain` is set, this is the URL with the custom domain.
   * Otherwise, it's the auto-generated load balancer URL.
   */
  public get url() {
    const errorMessage =
      "Cannot access the URL because no public ports are exposed.";
    if ($dev) {
      if (!this.devUrl) throw new VisibleError(errorMessage);
      return this.devUrl;
    }

    if (!this._url) throw new VisibleError(errorMessage);
    return this._url;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    const self = this;
    return {
      /**
       * The Amazon ECS Service.
       */
      get service() {
        if ($dev)
          throw new VisibleError("Cannot access `nodes.service` in dev mode.");
        return self.service!;
      },
      /**
       * The Amazon ECS Task Role.
       */
      get taskRole() {
        return self.taskRole;
      },
      /**
       * The Amazon ECS Task Definition.
       */
      get taskDefinition() {
        if ($dev)
          throw new VisibleError(
            "Cannot access `nodes.taskDefinition` in dev mode.",
          );
        return self.taskDefinition!;
      },
      /**
       * The Amazon Elastic Load Balancer.
       */
      get loadBalancer() {
        if ($dev)
          throw new VisibleError(
            "Cannot access `nodes.loadBalancer` in dev mode.",
          );
        if (!self.loadBalancer)
          throw new VisibleError(
            "Cannot access `nodes.loadBalancer` when no public ports are exposed.",
          );
        return self.loadBalancer;
      },
    };
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: { url: $dev ? this.devUrl : this._url },
    };
  }
}

const __pulumiType = "sst:aws:Service";
// @ts-expect-error
Service.__pulumiType = __pulumiType;
