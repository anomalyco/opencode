import {
  ComponentResource,
  ComponentResourceOptions,
  Inputs,
  runtime,
  output,
  asset as pulumiAsset,
  Input,
  all,
  Output,
} from "@pulumi/pulumi";
import { prefixName, physicalName } from "./naming.js";
import { VisibleError } from "./error.js";
import path from "path";
import { statSync } from "fs";

// Previously, `this.api.id` was used as the ID. `this.api.id` was of type Output<string>
// the value evaluates to the mistake id.
// In the future version, we will release a breaking change to fix this.
export const outputId =
  "Calling [toString] on an [Output<T>] is not supported.\n\nTo get the value of an Output<T> as an Output<string> consider either:\n1: o.apply(v => `prefix${v}suffix`)\n2: pulumi.interpolate `prefix${v}suffix`\n\nSee https://www.pulumi.com/docs/concepts/inputs-outputs for more details.\nThis function may throw in a future version of @pulumi/pulumi.";

/**
 * Helper type to inline nested types
 */
export type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

export type Transform<T> =
  | Partial<T>
  | ((args: T, opts: $util.CustomResourceOptions, name: string) => undefined);

export function transform<T extends object>(
  transform: Transform<T> | undefined,
  name: string,
  args: T,
  opts: $util.CustomResourceOptions,
) {
  // Case: transform is a function
  if (typeof transform === "function") {
    transform(args, opts, name);
    return [name, args, opts] as const;
  }

  // Case: no transform
  // Case: transform is an argument
  return [name, { ...args, ...transform }, opts] as const;
}

export class Component extends ComponentResource {
  private componentType: string;
  private componentName: string;

  constructor(
    type: string,
    name: string,
    args?: Inputs,
    opts?: ComponentResourceOptions,
  ) {
    const transforms = ComponentTransforms.get(type) ?? [];
    for (const transform of transforms) {
      transform({ name, props: args, opts });
    }
    super(type, name, args, {
      transformations: [
        // Ensure logical and physical names are prefixed
        (args) => {
          // Ensure component names do not contain spaces
          if (name.includes(" "))
            throw new Error(
              `Invalid component name "${name}" (${args.type}). Component names cannot contain spaces.`,
            );

          // Ensure names are prefixed with parent's name
          if (
            args.type !== type &&
            // @ts-expect-error
            !args.name.startsWith(args.opts.parent!.__name)
          ) {
            throw new Error(
              `In "${name}" component, the logical name of "${args.name}" (${
                args.type
              }) is not prefixed with parent's name ${
                // @ts-expect-error
                args.opts.parent!.__name
              }`,
            );
          }

          // Ensure physical names are prefixed with app/stage
          // note: We are setting the default names here instead of inline when creating
          //       the resource is b/c the physical name is inferred from the logical name.
          //       And it's convenient to access the logical name here.
          if (args.type.startsWith("sst:")) return;
          if (
            [
              // resources manually named
              "aws:cloudwatch/logGroup:LogGroup",
              "aws:ecs/service:Service",
              "aws:ecs/taskDefinition:TaskDefinition",
              "aws:lb/targetGroup:TargetGroup",
              "aws:servicediscovery/privateDnsNamespace:PrivateDnsNamespace",
              "aws:servicediscovery/service:Service",
              // resources not prefixed
              "pulumi-nodejs:dynamic:Resource",
              "random:index/randomId:RandomId",
              "random:index/randomPassword:RandomPassword",
              "command:local:Command",
              "tls:index/privateKey:PrivateKey",
              "aws:acm/certificate:Certificate",
              "aws:acm/certificateValidation:CertificateValidation",
              "aws:apigateway/basePathMapping:BasePathMapping",
              "aws:apigateway/deployment:Deployment",
              "aws:apigateway/domainName:DomainName",
              "aws:apigateway/integration:Integration",
              "aws:apigateway/integrationResponse:IntegrationResponse",
              "aws:apigateway/method:Method",
              "aws:apigateway/methodResponse:MethodResponse",
              "aws:apigateway/resource:Resource",
              "aws:apigateway/response:Response",
              "aws:apigateway/stage:Stage",
              "aws:apigateway/usagePlanKey:UsagePlanKey",
              "aws:apigatewayv2/apiMapping:ApiMapping",
              "aws:apigatewayv2/domainName:DomainName",
              "aws:apigatewayv2/integration:Integration",
              "aws:apigatewayv2/route:Route",
              "aws:apigatewayv2/stage:Stage",
              "aws:appautoscaling/target:Target",
              "aws:appsync/dataSource:DataSource",
              "aws:appsync/domainName:DomainName",
              "aws:appsync/domainNameApiAssociation:DomainNameApiAssociation",
              "aws:appsync/function:Function",
              "aws:appsync/resolver:Resolver",
              "aws:ec2/routeTableAssociation:RouteTableAssociation",
              "aws:ecs/clusterCapacityProviders:ClusterCapacityProviders",
              "aws:efs/fileSystem:FileSystem",
              "aws:efs/mountTarget:MountTarget",
              "aws:efs/accessPoint:AccessPoint",
              "aws:iam/accessKey:AccessKey",
              "aws:iam/instanceProfile:InstanceProfile",
              "aws:iam/policy:Policy",
              "aws:iam/userPolicy:UserPolicy",
              "aws:cloudfront/cachePolicy:CachePolicy",
              "aws:cloudfront/distribution:Distribution",
              "aws:cognito/identityPoolRoleAttachment:IdentityPoolRoleAttachment",
              "aws:cognito/identityProvider:IdentityProvider",
              "aws:cognito/userPoolClient:UserPoolClient",
              "aws:lambda/eventSourceMapping:EventSourceMapping",
              "aws:lambda/functionEventInvokeConfig:FunctionEventInvokeConfig",
              "aws:lambda/functionUrl:FunctionUrl",
              "aws:lambda/invocation:Invocation",
              "aws:lambda/permission:Permission",
              "aws:lambda/provisionedConcurrencyConfig:ProvisionedConcurrencyConfig",
              "aws:lb/listener:Listener",
              "aws:lb/listenerRule:ListenerRule",
              "aws:opensearch/domainPolicy:DomainPolicy",
              "aws:rds/proxyDefaultTargetGroup:ProxyDefaultTargetGroup",
              "aws:rds/proxyTarget:ProxyTarget",
              "aws:route53/record:Record",
              "aws:s3/bucketCorsConfigurationV2:BucketCorsConfigurationV2",
              "aws:s3/bucketNotification:BucketNotification",
              "aws:s3/bucketObject:BucketObject",
              "aws:s3/bucketObjectv2:BucketObjectv2",
              "aws:s3/bucketPolicy:BucketPolicy",
              "aws:s3/bucketPublicAccessBlock:BucketPublicAccessBlock",
              "aws:s3/bucketVersioningV2:BucketVersioningV2",
              "aws:s3/bucketWebsiteConfigurationV2:BucketWebsiteConfigurationV2",
              "aws:secretsmanager/secretVersion:SecretVersion",
              "aws:ses/domainIdentityVerification:DomainIdentityVerification",
              "aws:sesv2/configurationSetEventDestination:ConfigurationSetEventDestination",
              "aws:sesv2/emailIdentity:EmailIdentity",
              "aws:sns/topicPolicy:TopicPolicy",
              "aws:sns/topicSubscription:TopicSubscription",
              "aws:sqs/queuePolicy:QueuePolicy",
              "aws:ssm/parameter:Parameter",
              "cloudflare:index/dnsRecord:DnsRecord",
              "cloudflare:index/workersCronTrigger:WorkersCronTrigger",
              "cloudflare:index/workersCustomDomain:WorkersCustomDomain",
              "docker-build:index:Image",
              "vercel:index/dnsRecord:DnsRecord",
            ].includes(args.type)
          )
            return;

          const namingRules: Record<
            string,
            [
              string,
              number,
              {
                lower?: boolean;
                replace?: (name: string) => string;
                suffix?: () => Output<string>;
              }?,
            ]
          > = {
            "aws:apigateway/apiKey:ApiKey": ["name", 1024],
            "aws:apigateway/authorizer:Authorizer": ["name", 128],
            "aws:apigateway/restApi:RestApi": ["name", 128],
            "aws:apigateway/usagePlan:UsagePlan": ["name", 65536], // no length limit
            "aws:apigatewayv2/api:Api": ["name", 128],
            "aws:apigatewayv2/authorizer:Authorizer": ["name", 128],
            "aws:apigatewayv2/vpcLink:VpcLink": ["name", 128],
            "aws:appautoscaling/policy:Policy": ["name", 255],
            "aws:appsync/graphQLApi:GraphQLApi": ["name", 65536],
            "aws:cloudwatch/eventBus:EventBus": ["name", 256],
            "aws:cloudwatch/eventTarget:EventTarget": ["targetId", 64],
            "aws:cloudwatch/eventRule:EventRule": ["name", 64],
            "aws:cloudfront/function:Function": ["name", 64],
            "aws:cloudfront/keyValueStore:KeyValueStore": ["name", 64],
            "aws:cognito/identityPool:IdentityPool": ["identityPoolName", 128],
            "aws:cognito/userPool:UserPool": ["name", 128],
            "aws:dynamodb/table:Table": ["name", 255],
            "aws:ec2/keyPair:KeyPair": ["keyName", 255],
            "aws:ec2/eip:Eip": ["tags", 255],
            "aws:ec2/instance:Instance": ["tags", 255],
            "aws:ec2/internetGateway:InternetGateway": ["tags", 255],
            "aws:ec2/natGateway:NatGateway": ["tags", 255],
            "aws:ec2/routeTable:RouteTable": ["tags", 255],
            "aws:ec2/securityGroup:SecurityGroup": ["tags", 255],
            "aws:ec2/defaultSecurityGroup:DefaultSecurityGroup": ["tags", 255],
            "aws:ec2/subnet:Subnet": ["tags", 255],
            "aws:ec2/vpc:Vpc": ["tags", 255],
            "aws:ecs/cluster:Cluster": ["name", 255],
            "aws:elasticache/parameterGroup:ParameterGroup": [
              "name",
              255,
              { lower: true },
            ],
            "aws:elasticache/replicationGroup:ReplicationGroup": [
              "replicationGroupId",
              40,
              { lower: true, replace: (name) => name.replaceAll(/-+/g, "-") },
            ],
            "aws:elasticache/subnetGroup:SubnetGroup": [
              "name",
              255,
              { lower: true },
            ],
            "aws:iam/role:Role": ["name", 64],
            "aws:iam/user:User": ["name", 64],
            "aws:iot/authorizer:Authorizer": ["name", 128],
            "aws:iot/topicRule:TopicRule": [
              "name",
              128,
              { replace: (name) => name.replaceAll("-", "_") },
            ],
            "aws:kinesis/stream:Stream": ["name", 255],
            // AWS Load Balancer name allows 32 chars, but an 8 char suffix
            // ie. "-1234567" is automatically added
            "aws:lb/loadBalancer:LoadBalancer": ["name", 24],
            "aws:lambda/function:Function": ["name", 64],
            "aws:opensearch/domain:Domain": ["domainName", 28, { lower: true }],
            "aws:rds/cluster:Cluster": [
              "clusterIdentifier",
              63,
              { lower: true },
            ],
            "aws:rds/clusterInstance:ClusterInstance": [
              "identifier",
              63,
              { lower: true },
            ],
            "aws:rds/instance:Instance": ["identifier", 63, { lower: true }],
            "aws:rds/proxy:Proxy": ["name", 60, { lower: true }],
            "aws:rds/clusterParameterGroup:ClusterParameterGroup": [
              "name",
              255,
              { lower: true },
            ],
            "aws:rds/parameterGroup:ParameterGroup": [
              "name",
              255,
              { lower: true },
            ],
            "aws:rds/subnetGroup:SubnetGroup": ["name", 255, { lower: true }],
            "aws:s3/bucketV2:BucketV2": ["bucket", 63, { lower: true }],
            "aws:secretsmanager/secret:Secret": ["name", 512],
            "aws:sesv2/configurationSet:ConfigurationSet": [
              "configurationSetName",
              64,
              { lower: true },
            ],
            "aws:sfn/stateMachine:StateMachine": ["name", 80],
            "aws:sns/topic:Topic": [
              "name",
              256,
              {
                suffix: () =>
                  output(args.props.fifoTopic).apply((fifo) =>
                    fifo ? ".fifo" : "",
                  ),
              },
            ],
            "aws:sqs/queue:Queue": [
              "name",
              80,
              {
                suffix: () =>
                  output(args.props.fifoQueue).apply((fifo) =>
                    fifo ? ".fifo" : "",
                  ),
              },
            ],
            "cloudflare:index/d1Database:D1Database": [
              "name",
              64,
              { lower: true },
            ],
            "cloudflare:index/r2Bucket:R2Bucket": ["name", 64, { lower: true }],
            "cloudflare:index/workersScript:WorkersScript": [
              "scriptName",
              64,
              { lower: true },
            ],
            "cloudflare:index/queue:Queue": ["queueName", 64, { lower: true }],
            "cloudflare:index/workersKvNamespace:WorkersKvNamespace": [
              "title",
              64,
              { lower: true },
            ],
          };

          const rule = namingRules[args.type];
          if (!rule)
            throw new VisibleError(
              `In "${name}" component, the physical name of "${args.name}" (${args.type}) is not prefixed`,
            );

          // name is already set
          const nameField = rule[0];
          const length = rule[1];
          const options = rule[2];
          if (args.props[nameField] && args.props[nameField] !== "") return;

          // Handle prefix field is tags
          if (nameField === "tags") {
            return {
              props: {
                ...args.props,
                tags: {
                  // @ts-expect-error
                  ...args.tags,
                  Name: prefixName(length, args.name),
                },
              },
              opts: args.opts,
            };
          }

          // Handle prefix field is name
          const suffix = options?.suffix ? options.suffix() : output("");
          return {
            props: {
              ...args.props,
              [nameField]: suffix.apply((suffix) => {
                let v = options?.lower
                  ? physicalName(length, args.name, suffix).toLowerCase()
                  : physicalName(length, args.name, suffix);
                if (options?.replace) v = options.replace(v);
                return v;
              }),
            },
            opts: {
              ...args.opts,
              ignoreChanges: [...(args.opts.ignoreChanges ?? []), nameField],
            },
          };
        },
        // Set child resources `retainOnDelete` if set on component
        (args) => ({
          props: args.props,
          opts: {
            ...args.opts,
            retainOnDelete: args.opts.retainOnDelete ?? opts?.retainOnDelete,
          },
        }),
        ...(opts?.transformations ?? []),
      ],
      ...opts,
    });

    this.componentType = type;
    this.componentName = name;
  }

  /** @internal */
  protected registerVersion(input: {
    new: number;
    old?: number;
    message?: string;
    forceUpgrade?: `v${number}`;
  }) {
    // Check component version
    const oldVersion = input.old;
    const newVersion = input.new ?? 1;
    if (oldVersion) {
      const className = this.componentType.replaceAll(":", ".");
      // Invalid forceUpgrade value
      if (input.forceUpgrade && input.forceUpgrade !== `v${newVersion}`) {
        throw new VisibleError(
          [
            `The value of "forceUpgrade" does not match the version of "${className}" component.`,
            `Set "forceUpgrade" to "v${newVersion}" to upgrade to the new version.`,
          ].join("\n"),
        );
      }
      // Version upgraded without forceUpgrade
      if (oldVersion < newVersion && !input.forceUpgrade) {
        throw new VisibleError(input.message ?? "");
      }
      // Version downgraded
      if (oldVersion > newVersion) {
        throw new VisibleError(
          [
            `It seems you are trying to use an older version of "${className}".`,
            `You need to recreate this component to rollback - https://sst.dev/docs/components/#versioning`,
          ].join("\n"),
        );
      }
    }

    // Set version
    if (newVersion > 1) {
      new Version(this.componentName, newVersion, { parent: this });
    }
  }
}

const ComponentTransforms = new Map<string, any[]>();
export function $transform<T, Args, Options>(
  resource: { new (name: string, args: Args, opts?: Options): T },
  cb: (args: Args, opts: Options, name: string) => void,
) {
  // @ts-expect-error
  const type = resource.__pulumiType;
  if (type.startsWith("sst:")) {
    let transforms = ComponentTransforms.get(type);
    if (!transforms) {
      transforms = [];
      ComponentTransforms.set(type, transforms);
    }
    transforms.push((input: any) => {
      cb(input.props, input.opts, input.name);
      return input;
    });
    return;
  }
  runtime.registerStackTransformation((input) => {
    if (input.type !== type) return;
    cb(input.props as any, input.opts as any, input.name);
    return input;
  });
}

export function $asset(assetPath: string) {
  const fullPath = path.isAbsolute(assetPath)
    ? assetPath
    : path.join($cli.paths.root, assetPath);

  try {
    return statSync(fullPath).isDirectory()
      ? new pulumiAsset.FileArchive(fullPath)
      : new pulumiAsset.FileAsset(fullPath);
  } catch (e) {
    throw new VisibleError(`Asset not found: ${fullPath}`);
  }
}

export function $lazy<T>(fn: () => T) {
  return output(undefined)
    .apply(async () => output(fn()))
    .apply((x) => x);
}

export function $print(...msg: Input<any>[]) {
  return all(msg).apply((msg) => console.log(...msg));
}

export class Version extends ComponentResource {
  constructor(target: string, version: number, opts: ComponentResourceOptions) {
    super("sst:sst:Version", target + "Version", {}, opts);
    this.registerOutputs({ target, version });
  }
}

export type ComponentVersion = { major: number; minor: number };
export function parseComponentVersion(version: string): ComponentVersion {
  const [major, minor] = version.split(".");
  return { major: parseInt(major), minor: parseInt(minor) };
}
