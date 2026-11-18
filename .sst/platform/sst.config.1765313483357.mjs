
import { createRequire as topLevelCreateRequire } from 'module';
const require = topLevelCreateRequire(import.meta.url);
import { fileURLToPath as topLevelFileUrlToPath, URL as topLevelURL } from "url"
const __filename = topLevelFileUrlToPath(import.meta.url)
const __dirname = topLevelFileUrlToPath(new topLevelURL(".", import.meta.url))

var __defProp = Object.defineProperty;
var __export = (target, all11) => {
  for (var name in all11)
    __defProp(target, name, { get: all11[name], enumerable: true });
};

// <define:$app>
var define_app_default = { name: "shuvcode-desktop", stage: "production", removal: "retain", providers: { cloudflare: {} }, home: "cloudflare", version: "", protect: true, backend: "", removalPolicy: "" };

// <define:$cli>
var define_cli_default = { command: "deploy", dev: false, paths: { home: "/home/shuv/.config/sst", platform: "/home/shuv/repos/forks/shuvcode/.sst/platform", root: "/home/shuv/repos/forks/shuvcode", work: "/home/shuv/repos/forks/shuvcode/.sst" }, state: { version: {} } };

// .sst/platform/src/shim/run.js
import * as util from "@pulumi/pulumi";

// .sst/platform/src/components/link.ts
import {
  runtime as runtime2,
  output as output4,
  all as all3,
  ComponentResource as ComponentResource2
} from "@pulumi/pulumi";

// .sst/platform/src/components/error.ts
var VisibleError = class extends Error {
  constructor(...message) {
    super(message.join("\n"));
  }
};

// .sst/platform/src/components/linkable.ts
import { output as output3 } from "@pulumi/pulumi";

// .sst/platform/src/components/component.ts
import {
  ComponentResource,
  runtime,
  output as output2,
  asset as pulumiAsset,
  all as all2
} from "@pulumi/pulumi";

// .sst/platform/src/components/naming.ts
import crypto from "crypto";
function logicalName(name) {
  name = name.replace(/[^a-zA-Z0-9]/g, "");
  return name.charAt(0).toUpperCase() + name.slice(1);
}
function physicalName(max, name, suffix = "") {
  const main = prefixName(max - 9 - suffix.length, name);
  const random = hashStringToPrettyString(
    crypto.randomBytes(8).toString("hex"),
    8
  );
  return `${main}-${random}${suffix}`;
}
function prefixName(max, name) {
  name = name.replace(/[^a-zA-Z0-9]/g, "");
  const stageLen = define_app_default.stage.length;
  const nameLen = name.length;
  const strategy = nameLen + 1 >= max ? "name" : nameLen + stageLen + 2 >= max ? "stage+name" : "app+stage+name";
  if (strategy === "name") return `${name.substring(0, max)}`;
  if (strategy === "stage+name")
    return `${define_app_default.stage.substring(0, max - nameLen - 1)}-${name}`;
  return `${define_app_default.name.substring(0, max - stageLen - nameLen - 2)}-${define_app_default.stage}-${name}`;
}
function hashNumberToPrettyString(number, length) {
  const charLength = PRETTY_CHARS.length;
  let hash = "";
  while (number > 0) {
    hash = PRETTY_CHARS[number % charLength] + hash;
    number = Math.floor(number / charLength);
  }
  hash = hash.slice(0, length);
  while (hash.length < length) {
    hash = "s" + hash;
  }
  return hash;
}
function hashStringToPrettyString(str, length) {
  const hash = crypto.createHash("sha256");
  hash.update(str);
  const num = Number("0x" + hash.digest("hex").substring(0, 16));
  return hashNumberToPrettyString(num, length);
}
var PRETTY_CHARS = "abcdefhkmnorstuvwxz";

// .sst/platform/src/components/component.ts
function transform(transform2, name, args, opts) {
  if (typeof transform2 === "function") {
    transform2(args, opts, name);
    return [name, args, opts];
  }
  return [name, { ...args, ...transform2 }, opts];
}
var Component = class extends ComponentResource {
  componentType;
  componentName;
  constructor(type, name, args, opts) {
    const transforms = ComponentTransforms.get(type) ?? [];
    for (const transform2 of transforms) {
      transform2({ name, props: args, opts });
    }
    super(type, name, args, {
      transformations: [
        // Ensure logical and physical names are prefixed
        (args2) => {
          if (name.includes(" "))
            throw new Error(
              `Invalid component name "${name}" (${args2.type}). Component names cannot contain spaces.`
            );
          if (args2.type !== type && // @ts-expect-error
          !args2.name.startsWith(args2.opts.parent.__name)) {
            throw new Error(
              `In "${name}" component, the logical name of "${args2.name}" (${args2.type}) is not prefixed with parent's name ${// @ts-expect-error
              args2.opts.parent.__name}`
            );
          }
          if (args2.type.startsWith("sst:")) return;
          if ([
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
            "vercel:index/dnsRecord:DnsRecord"
          ].includes(args2.type))
            return;
          const namingRules = {
            "aws:apigateway/apiKey:ApiKey": ["name", 1024],
            "aws:apigateway/authorizer:Authorizer": ["name", 128],
            "aws:apigateway/restApi:RestApi": ["name", 128],
            "aws:apigateway/usagePlan:UsagePlan": ["name", 65536],
            // no length limit
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
              { lower: true }
            ],
            "aws:elasticache/replicationGroup:ReplicationGroup": [
              "replicationGroupId",
              40,
              { lower: true, replace: (name2) => name2.replaceAll(/-+/g, "-") }
            ],
            "aws:elasticache/subnetGroup:SubnetGroup": [
              "name",
              255,
              { lower: true }
            ],
            "aws:iam/role:Role": ["name", 64],
            "aws:iam/user:User": ["name", 64],
            "aws:iot/authorizer:Authorizer": ["name", 128],
            "aws:iot/topicRule:TopicRule": [
              "name",
              128,
              { replace: (name2) => name2.replaceAll("-", "_") }
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
              { lower: true }
            ],
            "aws:rds/clusterInstance:ClusterInstance": [
              "identifier",
              63,
              { lower: true }
            ],
            "aws:rds/instance:Instance": ["identifier", 63, { lower: true }],
            "aws:rds/proxy:Proxy": ["name", 60, { lower: true }],
            "aws:rds/clusterParameterGroup:ClusterParameterGroup": [
              "name",
              255,
              { lower: true }
            ],
            "aws:rds/parameterGroup:ParameterGroup": [
              "name",
              255,
              { lower: true }
            ],
            "aws:rds/subnetGroup:SubnetGroup": ["name", 255, { lower: true }],
            "aws:s3/bucketV2:BucketV2": ["bucket", 63, { lower: true }],
            "aws:secretsmanager/secret:Secret": ["name", 512],
            "aws:sesv2/configurationSet:ConfigurationSet": [
              "configurationSetName",
              64,
              { lower: true }
            ],
            "aws:sfn/stateMachine:StateMachine": ["name", 80],
            "aws:sns/topic:Topic": [
              "name",
              256,
              {
                suffix: () => output2(args2.props.fifoTopic).apply(
                  (fifo) => fifo ? ".fifo" : ""
                )
              }
            ],
            "aws:sqs/queue:Queue": [
              "name",
              80,
              {
                suffix: () => output2(args2.props.fifoQueue).apply(
                  (fifo) => fifo ? ".fifo" : ""
                )
              }
            ],
            "cloudflare:index/d1Database:D1Database": [
              "name",
              64,
              { lower: true }
            ],
            "cloudflare:index/r2Bucket:R2Bucket": ["name", 64, { lower: true }],
            "cloudflare:index/workersScript:WorkersScript": [
              "scriptName",
              64,
              { lower: true }
            ],
            "cloudflare:index/queue:Queue": ["queueName", 64, { lower: true }],
            "cloudflare:index/workersKvNamespace:WorkersKvNamespace": [
              "title",
              64,
              { lower: true }
            ]
          };
          const rule = namingRules[args2.type];
          if (!rule)
            throw new VisibleError(
              `In "${name}" component, the physical name of "${args2.name}" (${args2.type}) is not prefixed`
            );
          const nameField = rule[0];
          const length = rule[1];
          const options = rule[2];
          if (args2.props[nameField] && args2.props[nameField] !== "") return;
          if (nameField === "tags") {
            return {
              props: {
                ...args2.props,
                tags: {
                  // @ts-expect-error
                  ...args2.tags,
                  Name: prefixName(length, args2.name)
                }
              },
              opts: args2.opts
            };
          }
          const suffix = options?.suffix ? options.suffix() : output2("");
          return {
            props: {
              ...args2.props,
              [nameField]: suffix.apply((suffix2) => {
                let v = options?.lower ? physicalName(length, args2.name, suffix2).toLowerCase() : physicalName(length, args2.name, suffix2);
                if (options?.replace) v = options.replace(v);
                return v;
              })
            },
            opts: {
              ...args2.opts,
              ignoreChanges: [...args2.opts.ignoreChanges ?? [], nameField]
            }
          };
        },
        // Set child resources `retainOnDelete` if set on component
        (args2) => ({
          props: args2.props,
          opts: {
            ...args2.opts,
            retainOnDelete: args2.opts.retainOnDelete ?? opts?.retainOnDelete
          }
        }),
        ...opts?.transformations ?? []
      ],
      ...opts
    });
    this.componentType = type;
    this.componentName = name;
  }
  /** @internal */
  registerVersion(input) {
    const oldVersion = input.old;
    const newVersion = input.new ?? 1;
    if (oldVersion) {
      const className = this.componentType.replaceAll(":", ".");
      if (input.forceUpgrade && input.forceUpgrade !== `v${newVersion}`) {
        throw new VisibleError(
          [
            `The value of "forceUpgrade" does not match the version of "${className}" component.`,
            `Set "forceUpgrade" to "v${newVersion}" to upgrade to the new version.`
          ].join("\n")
        );
      }
      if (oldVersion < newVersion && !input.forceUpgrade) {
        throw new VisibleError(input.message ?? "");
      }
      if (oldVersion > newVersion) {
        throw new VisibleError(
          [
            `It seems you are trying to use an older version of "${className}".`,
            `You need to recreate this component to rollback - https://sst.dev/docs/components/#versioning`
          ].join("\n")
        );
      }
    }
    if (newVersion > 1) {
      new Version(this.componentName, newVersion, { parent: this });
    }
  }
};
var ComponentTransforms = /* @__PURE__ */ new Map();
var Version = class extends ComponentResource {
  constructor(target, version, opts) {
    super("sst:sst:Version", target + "Version", {}, opts);
    this.registerOutputs({ target, version });
  }
};

// .sst/platform/src/components/linkable.ts
var Linkable = class extends Component {
  _name;
  _definition;
  static wrappedResources = /* @__PURE__ */ new Set();
  constructor(name, definition) {
    super("sst:sst:Linkable", name, definition, {});
    this._name = name;
    this._definition = definition;
  }
  get name() {
    return output3(this._name);
  }
  get properties() {
    return this._definition.properties;
  }
  /** @internal */
  getSSTLink() {
    return this._definition;
  }
  /**
   * Wrap any resource class to make it linkable. Behind the scenes this modifies the
   * prototype of the given class.
   *
   * :::tip
   * Use `Linkable.wrap` to make any resource linkable.
   * :::
   *
   * @param cls The resource class to wrap.
   * @param cb A callback that returns the definition for the linkable resource.
   *
   * @example
   *
   * Here we are wrapping the [`aws.dynamodb.Table`](https://www.pulumi.com/registry/packages/aws/api-docs/dynamodb/table/)
   * class to make it linkable.
   *
   * ```ts title="sst.config.ts"
   * Linkable.wrap(aws.dynamodb.Table, (table) => ({
   *   properties: { tableName: table.name },
   *   include: [
   *     sst.aws.permission({
   *       actions: ["dynamodb:*"],
   *       resources: [table.arn]
   *     })
   *   ]
   * }));
   * ```
   *
   * It's defining the properties that we want made accessible at runtime and the permissions
   * that the linked resource should have.
   *
   * Now you can link any `aws.dynamodb.Table` instances in your app just like any other SST
   * component.
   *
   * ```ts title="sst.config.ts" {7}
   * const table = new aws.dynamodb.Table("MyTable", {
   *   attributes: [{ name: "id", type: "S" }],
   *   hashKey: "id",
   * });
   *
   * new sst.aws.Nextjs("MyWeb", {
   *   link: [table]
   * });
   * ```
   *
   * Since this applies to any resource, you can also use it to wrap SST components and modify
   * how they are linked.
   *
   * ```ts title="sst.config.ts" "sst.aws.Bucket"
   * sst.Linkable.wrap(sst.aws.Bucket, (bucket) => ({
   *   properties: { name: bucket.name },
   *   include: [
   *     sst.aws.permission({
   *       actions: ["s3:GetObject"],
   *       resources: [bucket.arn]
   *     })
   *   ]
   * }));
   * ```
   *
   * This overrides the built-in link and lets you create your own.
   *
   * :::tip
   * You can modify the permissions granted by a linked resource.
   * :::
   *
   * In the above example, we're modifying the permissions to access a linked `sst.aws.Bucket`
   * in our app.
   */
  static wrap(cls, cb) {
    this.wrappedResources.add(cls.__pulumiType);
    cls.prototype.getSSTLink = function() {
      return cb(this);
    };
  }
};

// .sst/platform/src/components/link.ts
var Link;
((Link2) => {
  class Ref extends ComponentResource2 {
    constructor(target, type, properties, include) {
      super(
        "sst:sst:LinkRef",
        target + "LinkRef",
        {
          properties,
          include
        },
        {}
      );
      this.registerOutputs({
        target,
        include,
        properties: {
          type: type.replaceAll(":", "."),
          ...properties
        }
      });
    }
  }
  Link2.Ref = Ref;
  function reset() {
    const links = /* @__PURE__ */ new Set();
    runtime2.registerStackTransformation((args) => {
      const isLinkable2 = args.type.startsWith("sst:") || Linkable.wrappedResources.has(args.type);
      if (isLinkable2 && !args.opts.parent) {
        const lcname = args.name.toLowerCase();
        if (lcname === "app") {
          throw new VisibleError(
            `Component name "${args.name}" is reserved. Please choose a different name for your "${args.type}" component.`
          );
        }
        if (links.has(lcname)) {
          throw new VisibleError(`Component name ${args.name} is not unique.`);
        }
        links.add(lcname);
      }
      return {
        opts: args.opts,
        props: args.props
      };
    });
    runtime2.registerStackTransformation((args) => {
      const resource = args.resource;
      process.nextTick(() => {
        if (Link2.isLinkable(resource) && !args.opts.parent) {
          try {
            const link = resource.getSSTLink();
            new Ref(args.name, args.type, link.properties, link.include);
          } catch (e) {
          }
        }
      });
      return {
        opts: args.opts,
        props: args.props
      };
    });
  }
  Link2.reset = reset;
  function isLinkable(obj) {
    return "getSSTLink" in obj;
  }
  Link2.isLinkable = isLinkable;
  function build(links) {
    return links.map((link) => {
      if (!link)
        throw new VisibleError(
          "An undefined link was passed into a `link` array."
        );
      return link;
    }).filter((l) => isLinkable(l)).map((l) => {
      const link = l.getSSTLink();
      return all3([l.urn, link]).apply(([urn, link2]) => ({
        name: urn.split("::").at(-1),
        properties: {
          ...link2.properties,
          type: urn.split("::").at(-2)
        }
      }));
    });
  }
  Link2.build = build;
  function getProperties(links) {
    const linkProperties = output4(links ?? []).apply(
      (links2) => links2.map((link) => {
        if (!link)
          throw new VisibleError(
            "An undefined link was passed into a `link` array."
          );
        return link;
      }).filter((l) => isLinkable(l)).map((l) => ({
        urn: l.urn,
        properties: l.getSSTLink().properties
      }))
    );
    return output4(linkProperties).apply(
      (e) => Object.fromEntries(
        e.map(({ urn, properties }) => {
          const name = urn.split("::").at(-1);
          const data = {
            ...properties,
            type: urn.split("::").at(-2)
          };
          return [name, data];
        })
      )
    );
  }
  Link2.getProperties = getProperties;
  function propertiesToEnv(properties) {
    return output4(properties).apply((properties2) => {
      const env = Object.fromEntries(
        Object.entries(properties2).map(([key, value]) => {
          return [`SST_RESOURCE_${key}`, JSON.stringify(value)];
        })
      );
      env["SST_RESOURCE_App"] = JSON.stringify({
        name: define_app_default.name,
        stage: define_app_default.stage
      });
      return env;
    });
  }
  Link2.propertiesToEnv = propertiesToEnv;
  function getInclude(type, input) {
    if (!input) return output4([]);
    return output4(input).apply((links) => {
      return links.filter(isLinkable).flatMap((l) => {
        const link = l.getSSTLink();
        return (link.include || []).filter((i) => i.type === type);
      });
    });
  }
  Link2.getInclude = getInclude;
  function linkable3(obj, cb) {
    console.warn("sst.linkable is deprecated. Use sst.Linkable.wrap instead.");
    obj.prototype.getSSTLink = function() {
      return cb(this);
    };
  }
  Link2.linkable = linkable3;
})(Link || (Link = {}));

// .sst/platform/src/config.ts
function $config(input) {
  return input;
}

// .sst/platform/src/shim/run.js
var $secrets = JSON.parse(process.env.SST_SECRETS || "{}");
var { output, apply, all, interpolate, concat, jsonParse, jsonStringify } = util;
var linkable = Link.makeLinkable;

// .sst/platform/src/auto/run.ts
import {
  runtime as runtime3,
  output as output5
} from "@pulumi/pulumi";
async function run(program) {
  process.chdir(define_cli_default.paths.root);
  addTransformationToRetainResourcesOnDelete();
  addTransformationToAddTags();
  addTransformationToCheckBucketsHaveMultiplePolicies();
  Link.reset();
  const outputs = await program() || {};
  outputs._protect = define_app_default.protect;
  return outputs;
}
function addTransformationToRetainResourcesOnDelete() {
  runtime3.registerStackTransformation((args) => {
    if (define_app_default.removal === "retain-all" || define_app_default.removal === "retain" && [
      "aws:dynamodb/table:Table",
      "aws:rds/instance:Instance",
      "aws:s3/bucket:Bucket",
      "aws:s3/bucketV2:BucketV2",
      "planetscale:index/database:Database",
      "planetscale:index/branch:Branch"
    ].includes(args.type)) {
      args.opts.retainOnDelete = args.opts.retainOnDelete ?? true;
      return args;
    }
    return void 0;
  });
}
function addTransformationToAddTags() {
  runtime3.registerStackTransformation((args) => {
    if ("import" in args.opts && args.opts.import) {
      if (!args.opts.ignoreChanges) args.opts.ignoreChanges = [];
      args.opts.ignoreChanges.push("tags");
      args.opts.ignoreChanges.push("tagsAll");
    }
    return args;
  });
}
function addTransformationToCheckBucketsHaveMultiplePolicies() {
  const bucketsWithPolicy = {};
  runtime3.registerStackTransformation((args) => {
    if (args.type !== "aws:s3/bucketPolicy:BucketPolicy") return;
    output5(args.props.bucket).apply((bucket) => {
      if (bucketsWithPolicy[bucket])
        throw new VisibleError(
          `Cannot add bucket policy "${args.name}" to the AWS S3 Bucket "${bucket}". The bucket already has a policy attached "${bucketsWithPolicy[bucket]}".`
        );
      bucketsWithPolicy[bucket] = args.name;
    });
    return void 0;
  });
}

// sst.desktop.config.ts
import * as cloudflare7 from "@pulumi/cloudflare";

// .sst/platform/src/components/rpc/rpc.ts
import http from "http";
var rpc;
((rpc2) => {
  class MethodNotFoundError extends Error {
    constructor(method) {
      super(`Method "${method}" not found`);
      this.method = method;
    }
  }
  rpc2.MethodNotFoundError = MethodNotFoundError;
  async function call(method, args) {
    return new Promise((resolve, reject) => {
      const url = new URL(process.env.SST_SERVER + "/rpc");
      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        }
      };
      const req = http.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`Failed to call RPC: ${data}`));
            return;
          }
          try {
            const json = JSON.parse(data);
            if (json.error) {
              if (json.error.startsWith("rpc: can't find")) {
                reject(new MethodNotFoundError(method));
                return;
              }
              reject(new Error(json.error));
              return;
            }
            resolve(json.result);
          } catch (error) {
            reject(new Error(`Failed to parse JSON: ${error.message}`));
          }
        });
      });
      req.on("error", (error) => {
        reject(error);
      });
      req.setTimeout(0);
      const body = JSON.stringify({
        jsonrpc: "1.0",
        method,
        params: [args]
      });
      req.write(body);
      req.end();
    });
  }
  rpc2.call = call;
  class Provider4 {
    constructor(type) {
      this.type = type;
    }
    name(action) {
      return "Resource." + this.type + "." + action;
    }
    async create(inputs) {
      return call(this.name("Create"), inputs);
    }
    async delete(id, outs) {
      return call(this.name("Delete"), { id, outs }).catch((ex) => {
        if (ex instanceof MethodNotFoundError) return;
        throw ex;
      });
    }
    async update(id, olds, news) {
      return call(this.name("Update"), { id, olds, news }).catch((ex) => {
        if (ex instanceof MethodNotFoundError)
          return {
            id
          };
        throw ex;
      });
    }
    async read(id, props) {
      return call(this.name("Read"), { id, props }).catch((ex) => {
        if (ex instanceof MethodNotFoundError) return { id, props };
        throw ex;
      });
    }
    async diff(id, olds, news) {
      return call(this.name("Diff"), { id, olds, news }).catch((ex) => {
        if (ex instanceof MethodNotFoundError) return { id, olds, news };
        throw ex;
      });
    }
  }
  rpc2.Provider = Provider4;
})(rpc || (rpc = {}));

// .sst/platform/src/components/base/base-site.ts
import path from "path";
function getContentType(filename, textEncoding) {
  const ext = filename.endsWith(".well-known/site-association-json") || filename.endsWith(".well-known/apple-app-site-association") ? ".json" : path.extname(filename);
  const extensions = {
    [".txt"]: { mime: "text/plain", isText: true },
    [".htm"]: { mime: "text/html", isText: true },
    [".html"]: { mime: "text/html", isText: true },
    [".xhtml"]: { mime: "application/xhtml+xml", isText: true },
    [".css"]: { mime: "text/css", isText: true },
    [".js"]: { mime: "text/javascript", isText: true },
    [".mjs"]: { mime: "text/javascript", isText: true },
    [".apng"]: { mime: "image/apng", isText: false },
    [".avif"]: { mime: "image/avif", isText: false },
    [".gif"]: { mime: "image/gif", isText: false },
    [".jpeg"]: { mime: "image/jpeg", isText: false },
    [".jpg"]: { mime: "image/jpeg", isText: false },
    [".png"]: { mime: "image/png", isText: false },
    [".svg"]: { mime: "image/svg+xml", isText: true },
    [".bmp"]: { mime: "image/bmp", isText: false },
    [".tiff"]: { mime: "image/tiff", isText: false },
    [".webp"]: { mime: "image/webp", isText: false },
    [".ico"]: { mime: "image/vnd.microsoft.icon", isText: false },
    [".eot"]: { mime: "application/vnd.ms-fontobject", isText: false },
    [".ttf"]: { mime: "font/ttf", isText: false },
    [".otf"]: { mime: "font/otf", isText: false },
    [".woff"]: { mime: "font/woff", isText: false },
    [".woff2"]: { mime: "font/woff2", isText: false },
    [".json"]: { mime: "application/json", isText: true },
    [".jsonld"]: { mime: "application/ld+json", isText: true },
    [".xml"]: { mime: "application/xml", isText: true },
    [".pdf"]: { mime: "application/pdf", isText: false },
    [".zip"]: { mime: "application/zip", isText: false },
    [".wasm"]: { mime: "application/wasm", isText: false },
    [".webmanifest"]: { mime: "application/manifest+json", isText: true }
  };
  const extensionData = extensions[ext];
  const mime = extensionData?.mime ?? "application/octet-stream";
  const charset = extensionData?.isText && textEncoding !== "none" ? `;charset=${textEncoding}` : "";
  return `${mime}${charset}`;
}

// .sst/platform/src/components/base/base-ssr-site.ts
import path2 from "path";
import fs from "fs";
import { all as all5, output as output6 } from "@pulumi/pulumi";

// .sst/platform/src/components/aws/helpers/site-builder.ts
import { all as all4 } from "@pulumi/pulumi";

// .sst/platform/src/util/semaphore.ts
var Semaphore = class {
  constructor(max) {
    this.max = max;
    this.current = 0;
    this.queue = [];
  }
  current;
  queue;
  async acquire(name) {
    if (this.current < this.max) {
      this.current++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }
  release() {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next?.();
      return;
    }
    this.current--;
  }
};

// .sst/platform/src/components/aws/helpers/site-builder.ts
import { local } from "@pulumi/command";
var limiter = new Semaphore(
  parseInt(process.env.SST_BUILD_CONCURRENCY_SITE || "1")
);
function siteBuilder(name, args, opts) {
  return all4([args]).apply(async ([args2]) => {
    await limiter.acquire(name);
    let waitOn;
    const command = new local.Command(name, args2, opts);
    waitOn = command.urn;
    if (define_cli_default.command === "diff") {
      waitOn = local.runOutput(
        {
          command: args2.create,
          dir: args2.dir,
          environment: args2.environment
        },
        opts
      ).stdout;
    }
    return waitOn.apply(() => {
      limiter.release();
      return command;
    });
  });
}

// .sst/platform/src/components/base/base-ssr-site.ts
function buildApp(parent, name, args, sitePath, buildCommand) {
  return all5([
    sitePath,
    buildCommand ?? args.buildCommand,
    args.link,
    args.environment
  ]).apply(([sitePath2, userCommand, links, environment]) => {
    const cmd = resolveBuildCommand();
    const result2 = runBuild();
    return result2.id.apply(() => sitePath2);
    function resolveBuildCommand() {
      if (userCommand) return userCommand;
      if (!userCommand) {
        if (!fs.existsSync(path2.join(sitePath2, "package.json"))) {
          throw new VisibleError(`No package.json found at "${sitePath2}".`);
        }
        const packageJson = JSON.parse(
          fs.readFileSync(path2.join(sitePath2, "package.json")).toString()
        );
        if (!packageJson.scripts || !packageJson.scripts.build) {
          throw new VisibleError(
            `No "build" script found within package.json in "${sitePath2}".`
          );
        }
      }
      if (fs.existsSync(path2.join(sitePath2, "yarn.lock")) || fs.existsSync(path2.join(define_cli_default.paths.root, "yarn.lock")))
        return "yarn run build";
      if (fs.existsSync(path2.join(sitePath2, "pnpm-lock.yaml")) || fs.existsSync(path2.join(define_cli_default.paths.root, "pnpm-lock.yaml")))
        return "pnpm run build";
      if (fs.existsSync(path2.join(sitePath2, "bun.lockb")) || fs.existsSync(path2.join(define_cli_default.paths.root, "bun.lockb")) || fs.existsSync(path2.join(sitePath2, "bun.lock")) || fs.existsSync(path2.join(define_cli_default.paths.root, "bun.lock")))
        return "bun run build";
      return "npm run build";
    }
    function runBuild() {
      const linkData = Link.build(links || []);
      const linkEnvs = output6(linkData).apply((linkData2) => {
        const envs = {
          SST_RESOURCE_App: JSON.stringify({
            name: define_app_default.name,
            stage: define_app_default.stage
          })
        };
        for (const datum of linkData2) {
          envs[`SST_RESOURCE_${datum.name}`] = JSON.stringify(datum.properties);
        }
        return envs;
      });
      return siteBuilder(
        `${name}Builder`,
        {
          create: cmd,
          update: cmd,
          dir: path2.join(define_cli_default.paths.root, sitePath2),
          environment: linkEnvs.apply((linkEnvs2) => ({
            SST: "1",
            ...process.env,
            ...environment,
            ...linkEnvs2
          })),
          triggers: [Date.now().toString()]
        },
        {
          parent,
          ignoreChanges: process.env.SKIP ? ["*"] : void 0
        }
      );
    }
  });
}

// .sst/platform/src/components/base/base-static-site.ts
import fs2 from "fs";
import path3 from "path";
import { all as all6, output as output7 } from "@pulumi/pulumi";
function prepare(args) {
  const sitePath = normalizeSitePath();
  const environment = normalizeEnvironment();
  const indexPage = normalizeIndexPage();
  generateViteTypes();
  return {
    sitePath,
    environment,
    indexPage
  };
  function normalizeSitePath() {
    return output7(args.path).apply((sitePath2) => {
      if (!sitePath2) return ".";
      if (!fs2.existsSync(sitePath2)) {
        throw new VisibleError(`No site found at "${path3.resolve(sitePath2)}".`);
      }
      return sitePath2;
    });
  }
  function normalizeEnvironment() {
    return output7(args.environment).apply((environment2) => environment2 ?? {});
  }
  function normalizeIndexPage() {
    return output7(args.indexPage).apply(
      (indexPage2) => indexPage2 ?? "index.html"
    );
  }
  function generateViteTypes() {
    return all6([sitePath, args.vite, environment]).apply(
      ([sitePath2, vite, environment2]) => {
        let typesPath = vite?.types;
        if (!typesPath) {
          if (fs2.existsSync(path3.join(sitePath2, "vite.config.js")) || fs2.existsSync(path3.join(sitePath2, "vite.config.ts"))) {
            typesPath = "src/sst-env.d.ts";
          }
        }
        if (!typesPath) {
          return;
        }
        const filePath = path3.resolve(path3.join(sitePath2, typesPath));
        const content = `/* This file is auto-generated by SST. Do not edit. */
/* tslint:disable */
/* eslint-disable */
/// <reference types="vite/client" />
interface ImportMetaEnv {
${Object.keys(environment2).map((key) => `  readonly ${key}: string`).join("\n")}
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}`;
        const fileDir = path3.dirname(filePath);
        fs2.mkdirSync(fileDir, { recursive: true });
        fs2.writeFileSync(filePath, content);
      }
    );
  }
}
function buildApp2(parent, name, build, sitePath, environment) {
  if (!build) return sitePath;
  const result2 = siteBuilder(
    `${name}Builder`,
    {
      create: output7(build).command,
      update: output7(build).command,
      dir: output7(sitePath).apply(
        (sitePath2) => path3.join(define_cli_default.paths.root, sitePath2)
      ),
      environment,
      triggers: [Date.now().toString()]
    },
    {
      parent,
      ignoreChanges: process.env.SKIP ? ["*"] : void 0
    }
  );
  return all6([sitePath, build, result2.id]).apply(([sitePath2, build2, _]) => {
    const outputPath = path3.join(sitePath2, build2.output);
    if (!fs2.existsSync(outputPath)) {
      throw new VisibleError(
        `No build output found at "${path3.resolve(outputPath)}".`
      );
    }
    return outputPath;
  });
}

// .sst/platform/src/components/cloudflare/index.ts
var cloudflare_exports = {};
__export(cloudflare_exports, {
  Auth: () => Auth,
  Bucket: () => Bucket,
  Cron: () => Cron,
  D1: () => D1,
  DEFAULT_ACCOUNT_ID: () => DEFAULT_ACCOUNT_ID,
  Kv: () => Kv,
  Queue: () => Queue2,
  StaticSite: () => StaticSite,
  Worker: () => Worker,
  binding: () => binding,
  dns: () => dns,
  x: () => experimental_exports
});

// .sst/platform/src/components/cloudflare/bucket.ts
import * as cloudflare from "@pulumi/cloudflare";

// .sst/platform/src/components/cloudflare/binding.ts
function binding(input) {
  return {
    type: "cloudflare.binding",
    binding: input.type,
    properties: input.properties
  };
}

// .sst/platform/src/components/cloudflare/account-id.ts
var DEFAULT_ACCOUNT_ID = process.env.CLOUDFLARE_DEFAULT_ACCOUNT_ID;

// .sst/platform/src/components/cloudflare/bucket.ts
var Bucket = class extends Component {
  bucket;
  constructor(name, args, opts) {
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
            accountId: DEFAULT_ACCOUNT_ID
          },
          { parent }
        )
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
        name: this.bucket.name
      },
      include: [
        binding({
          type: "r2BucketBindings",
          properties: {
            bucketName: this.bucket.name
          }
        })
      ]
    };
  }
  /**
   * The generated name of the R2 Bucket.
   */
  get name() {
    return this.bucket.name;
  }
  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  get nodes() {
    return {
      /**
       * The Cloudflare R2 Bucket.
       */
      bucket: this.bucket
    };
  }
};
var __pulumiType = "sst:cloudflare:Bucket";
Bucket.__pulumiType = __pulumiType;

// .sst/platform/src/components/cloudflare/kv.ts
import * as cloudflare2 from "@pulumi/cloudflare";
var Kv = class extends Component {
  namespace;
  constructor(name, args, opts) {
    super(__pulumiType2, name, args, opts);
    const parent = this;
    const namespace = createNamespace();
    this.namespace = namespace;
    function createNamespace() {
      return new cloudflare2.WorkersKvNamespace(
        ...transform(
          args?.transform?.namespace,
          `${name}Namespace`,
          {
            title: "",
            accountId: DEFAULT_ACCOUNT_ID
          },
          { parent }
        )
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
        namespaceId: this.namespace.id
      },
      include: [
        binding({
          type: "kvNamespaceBindings",
          properties: {
            namespaceId: this.namespace.id
          }
        })
      ]
    };
  }
  /**
   * The generated ID of the KV namespace.
   */
  get id() {
    return this.namespace.id;
  }
  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  get nodes() {
    return {
      /**
       * The Cloudflare KV namespace.
       */
      namespace: this.namespace
    };
  }
};
var __pulumiType2 = "sst:cloudflare:Kv";
Kv.__pulumiType = __pulumiType2;

// .sst/platform/src/components/cloudflare/d1.ts
import * as cloudflare3 from "@pulumi/cloudflare";
var D1 = class extends Component {
  database;
  constructor(name, args, opts) {
    super(__pulumiType3, name, args, opts);
    const parent = this;
    const db = createDB();
    this.database = db;
    function createDB() {
      return new cloudflare3.D1Database(
        ...transform(
          args?.transform?.database,
          `${name}Database`,
          {
            name: "",
            accountId: DEFAULT_ACCOUNT_ID
          },
          { parent }
        )
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
        databaseId: this.database.id
      },
      include: [
        binding({
          type: "d1DatabaseBindings",
          properties: {
            id: this.database.id
          }
        })
      ]
    };
  }
  /**
   * The generated ID of the D1 database.
   */
  get databaseId() {
    return this.database.id;
  }
  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  get nodes() {
    return {
      /**
       * The Cloudflare D1 database.
       */
      database: this.database
    };
  }
};
var __pulumiType3 = "sst:cloudflare:D1";
D1.__pulumiType = __pulumiType3;

// .sst/platform/src/components/cloudflare/dns.ts
import * as cloudflare4 from "@pulumi/cloudflare";

// .sst/platform/src/components/cloudflare/providers/zone-lookup.ts
import { dynamic } from "@pulumi/pulumi";

// .sst/platform/src/components/cloudflare/helpers/fetch.ts
var CLOUDFLARE_API_BASE_URL = process.env.CLOUDFLARE_API_BASE_URL ?? "https://api.cloudflare.com/client/v4";
var CLOUDFLARE_API_TOKEN = define_app_default.providers?.cloudflare?.apiToken || process.env.CLOUDFLARE_API_TOKEN;
async function cfFetch(resource, init = {}) {
  const maxRetries = 3;
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const ret = await fetch(`${CLOUDFLARE_API_BASE_URL}${resource}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
          ...init.headers
        }
      });
      const json = await ret.json();
      if (json.success) {
        return json;
      }
      lastError = new Error(
        `A request to the Cloudflare API (${resource}) failed.`
      );
      lastError.errors = json.errors;
      lastError.messages = json.messages;
    } catch (error) {
      lastError = error;
    }
    if (attempt < maxRetries) {
      await new Promise(
        (resolve) => setTimeout(resolve, Math.pow(2, attempt) * 200)
      );
    }
  }
  throw lastError;
}

// .sst/platform/src/components/cloudflare/providers/zone-lookup.ts
var Provider = class {
  async create(inputs) {
    const { zoneId, zoneName } = await this.lookup(inputs);
    return { id: zoneId, outs: { zoneId, zoneName } };
  }
  async update(id, olds, news) {
    const { zoneId, zoneName } = await this.lookup(news);
    return { outs: { zoneId, zoneName } };
  }
  async lookup(inputs, page = 1) {
    try {
      const qs = new URLSearchParams({
        per_page: "50",
        "account.id": inputs.accountId
      }).toString();
      const ret = await cfFetch(
        `/zones?${qs}`,
        { headers: { "Content-Type": "application/json" } }
      );
      const zone = ret.result.find(
        // ensure `example.com` does not match `myexample.com`
        (z) => inputs.domain === z.name || inputs.domain.endsWith(`.${z.name}`)
      );
      if (zone) return { zoneId: zone.id, zoneName: zone.name };
      if (ret.result.length < ret.result_info.per_page)
        throw new Error(
          `Could not find hosted zone for domain ${inputs.domain}`
        );
      return this.lookup(inputs, page + 1);
    } catch (error) {
      console.log(error);
      throw error;
    }
  }
};
var ZoneLookup = class extends dynamic.Resource {
  constructor(name, args, opts) {
    super(
      new Provider(),
      `${name}.sst.cloudflare.ZoneLookup`,
      { ...args, zoneId: void 0, zoneName: void 0 },
      opts
    );
  }
};

// .sst/platform/src/components/cloudflare/dns.ts
import { output as output8 } from "@pulumi/pulumi";

// .sst/platform/src/components/cloudflare/providers/dns-record.ts
import { dynamic as dynamic2 } from "@pulumi/pulumi";
var DnsRecord = class extends dynamic2.Resource {
  constructor(name, args, opts) {
    super(
      new rpc.Provider("Cloudflare.DnsRecord"),
      `${name}.sst.cloudflare.DnsRecord`,
      {
        ...args,
        recordId: void 0,
        accountId: DEFAULT_ACCOUNT_ID,
        apiToken: define_app_default.providers?.cloudflare?.apiToken || process.env.CLOUDFLARE_API_TOKEN
      },
      opts
    );
  }
};

// .sst/platform/src/components/cloudflare/dns.ts
function dns(args = {}) {
  return {
    provider: "cloudflare",
    createAlias,
    createCaa,
    createRecord
  };
  function lookupZone(namePrefix, recordType, recordName, opts) {
    if (args.zone) {
      const zone2 = cloudflare4.getZoneOutput({
        zoneId: args.zone
      });
      return {
        id: output8(args.zone),
        name: zone2.name
      };
    }
    const zone = new ZoneLookup(
      `${namePrefix}${recordType}${recordName}ZoneLookup`,
      {
        accountId: DEFAULT_ACCOUNT_ID,
        domain: recordName.replace(/\.$/, "")
      },
      opts
    );
    return {
      id: zone.zoneId,
      name: zone.zoneName
    };
  }
  function createAlias(namePrefix, record, opts) {
    return handleCreate(
      namePrefix,
      {
        name: record.name,
        type: "CNAME",
        value: record.aliasName,
        isAlias: true
      },
      opts
    );
  }
  function createCaa(namePrefix, recordName, opts) {
    const zone = lookupZone(namePrefix, "CAA", recordName, opts);
    return [
      new DnsRecord(
        `${namePrefix}CAA${recordName}Record`,
        {
          zoneId: zone.id,
          type: "CAA",
          name: zone.name,
          data: {
            flags: "0",
            tag: "issue",
            value: "amazonaws.com"
          }
        },
        opts
      ),
      new DnsRecord(
        `${namePrefix}CAAWildcard${recordName}Record`,
        {
          zoneId: zone.id,
          type: "CAA",
          name: zone.name,
          data: {
            flags: "0",
            tag: "issuewild",
            value: "amazonaws.com"
          }
        },
        opts
      )
    ];
  }
  function createRecord(namePrefix, record, opts) {
    return handleCreate(namePrefix, record, opts);
  }
  function handleCreate(namePrefix, record, opts) {
    return output8(record).apply((record2) => {
      const zone = lookupZone(namePrefix, record2.type, record2.name, opts);
      const proxy = output8(args.proxy).apply(
        (proxy2) => (proxy2 && record2.isAlias) ?? false
      );
      const nameSuffix = logicalName(record2.name);
      const type = record2.type.toUpperCase();
      return new cloudflare4.DnsRecord(
        ...transform(
          args.transform?.record,
          `${namePrefix}${record2.type}Record${nameSuffix}`,
          {
            zoneId: zone.id,
            proxied: output8(proxy),
            type,
            name: record2.name,
            ...type === "TXT" ? {
              content: record2.value.startsWith(`"`) ? record2.value : `"${record2.value}"`
            } : {
              content: record2.value
            },
            ttl: output8(proxy).apply((proxy2) => proxy2 ? 1 : 60)
          },
          opts
        )
      );
    });
  }
}

// .sst/platform/src/components/cloudflare/static-site.ts
import fs5 from "fs";
import path5 from "path";
import crypto3 from "crypto";
import { all as all8, output as output10 } from "@pulumi/pulumi";
import { globSync } from "glob";

// .sst/platform/src/components/cloudflare/providers/kv-data.ts
import fs3 from "fs";
import { dynamic as dynamic3 } from "@pulumi/pulumi";
var Provider2 = class {
  async create(inputs) {
    await this.upload(inputs.accountId, inputs.namespaceId, inputs.entries, []);
    return { id: "data" };
  }
  async update(id, olds, news) {
    await this.upload(
      news.accountId,
      news.namespaceId,
      news.entries,
      news.namespaceId === olds.namespaceId ? olds.entries : []
    );
    return {};
  }
  async upload(accountId, namespaceId, entries, oldEntries) {
    const oldFilesMap = new Map(oldEntries.map((f) => [f.key, f]));
    await Promise.all(
      entries.filter((entry) => {
        const old = oldFilesMap.get(entry.key);
        return old?.hash !== entry.hash || old?.contentType !== entry.contentType || old?.cacheControl !== entry.cacheControl;
      }).map(async (entry) => {
        const formData = new FormData();
        formData.append(
          "metadata",
          JSON.stringify({
            contentType: entry.contentType,
            cacheControl: entry.cacheControl
          })
        );
        formData.append(
          "value",
          await fs3.promises.readFile(entry.source, "base64")
        );
        try {
          await cfFetch(
            `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${entry.key}`,
            {
              method: "PUT",
              body: formData
            }
          );
        } catch (error) {
          console.log(error);
          throw error;
        }
      })
    );
  }
};
var KvData = class extends dynamic3.Resource {
  constructor(name, args, opts) {
    super(new Provider2(), `${name}.sst.cloudflare.KvPairs`, args, opts);
  }
};

// .sst/platform/src/components/cloudflare/worker.ts
import fs4 from "fs/promises";
import path4 from "path";
import crypto2 from "crypto";
import {
  output as output9,
  all as all7,
  jsonStringify as jsonStringify2,
  interpolate as interpolate2
} from "@pulumi/pulumi";
import * as cf from "@pulumi/cloudflare";

// .sst/platform/src/components/cloudflare/providers/worker-url.ts
import { dynamic as dynamic4 } from "@pulumi/pulumi";
var Provider3 = class {
  async create(inputs) {
    const url = await this.process(inputs);
    return {
      id: inputs.scriptName,
      outs: url ? { url } : {}
    };
  }
  async update(id, olds, news) {
    const url = await this.process(news);
    return {
      outs: url ? { url } : {}
    };
  }
  async process(inputs) {
    if (inputs.enabled === false) {
      await this.setEnabledFlag(inputs);
      return void 0;
    }
    const [userSubdomain] = await Promise.all([
      this.getWorkerDevSubdomain(inputs),
      this.setEnabledFlag(inputs)
    ]);
    return `${inputs.scriptName}.${userSubdomain}.workers.dev`;
  }
  async getWorkerDevSubdomain(inputs) {
    try {
      const ret = await cfFetch(
        `/accounts/${inputs.accountId}/workers/subdomain`,
        {
          headers: { "Content-Type": "application/json" }
        }
      );
      return ret.result.subdomain;
    } catch (error) {
      console.log(error);
      throw error;
    }
  }
  async setEnabledFlag(inputs) {
    try {
      await cfFetch(
        `/accounts/${inputs.accountId}/workers/scripts/${inputs.scriptName}/subdomain`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: inputs.enabled })
        }
      );
      await new Promise((resolve) => setTimeout(resolve, 3e3));
    } catch (error) {
      console.log(error);
      throw error;
    }
  }
};
var WorkerUrl = class extends dynamic4.Resource {
  constructor(name, args, opts) {
    super(
      new Provider3(),
      `${name}.sst.cloudflare.WorkerUrl`,
      { ...args, url: void 0 },
      opts
    );
  }
};

// .sst/platform/src/components/cloudflare/worker.ts
import { iam } from "@pulumi/aws";
var Worker = class extends Component {
  script;
  workerUrl;
  workerDomain;
  constructor(name, args, opts) {
    super(__pulumiType4, name, args, opts);
    const parent = this;
    const dev = normalizeDev();
    const urlEnabled = normalizeUrl();
    const bindings = buildBindings();
    const iamCredentials = createAwsCredentials();
    const buildInput = all7([name, args.handler, args.build, dev]).apply(
      async ([name2, handler, build2]) => {
        return {
          functionID: name2,
          links: {},
          handler,
          runtime: "worker",
          properties: {
            accountID: DEFAULT_ACCOUNT_ID,
            build: build2
          }
        };
      }
    );
    const build = buildHandler();
    const script = createScript();
    const workerUrl = createWorkersUrl();
    const workerDomain = createWorkersDomain();
    this.script = script;
    this.workerUrl = workerUrl;
    this.workerDomain = workerDomain;
    all7([dev, buildInput, script.scriptName]).apply(
      async ([dev2, buildInput2, scriptName]) => {
        if (!dev2) return void 0;
        await rpc.call("Runtime.AddTarget", {
          ...buildInput2,
          properties: {
            ...buildInput2.properties,
            scriptName
          }
        });
      }
    );
    this.registerOutputs({
      _live: all7([name, args.handler, args.build, dev]).apply(
        ([name2, handler, build2, dev2]) => {
          if (!dev2) return void 0;
          return {
            functionID: name2,
            links: [],
            handler,
            runtime: "worker",
            properties: {
              accountID: DEFAULT_ACCOUNT_ID,
              scriptName: script.scriptName,
              build: build2
            }
          };
        }
      ),
      _metadata: {
        handler: args.handler
      }
    });
    function normalizeDev() {
      return output9(args.dev).apply((v) => false);
    }
    function normalizeUrl() {
      return output9(args.url).apply((v) => v ?? false);
    }
    function buildBindings() {
      const result2 = [
        {
          type: "plain_text",
          name: "SST_RESOURCE_App",
          text: jsonStringify2({
            name: define_app_default.name,
            stage: define_app_default.stage
          })
        }
      ];
      if (!args.link) return result2;
      return output9(args.link).apply((links) => {
        for (let link of links) {
          if (!Link.isLinkable(link)) continue;
          const name2 = output9(link.urn).apply((uri) => uri.split("::").at(-1));
          const item = link.getSSTLink();
          const b = item.include?.find(
            (i) => i.type === "cloudflare.binding"
          );
          result2.push(
            b ? {
              type: {
                plainTextBindings: "plain_text",
                secretTextBindings: "secret_text",
                queueBindings: "queue",
                serviceBindings: "service",
                kvNamespaceBindings: "kv_namespace",
                d1DatabaseBindings: "d1",
                r2BucketBindings: "r2_bucket"
              }[b.binding],
              name: name2,
              ...b.properties
            } : {
              type: "secret_text",
              name: name2,
              text: jsonStringify2(item.properties)
            }
          );
        }
        return result2;
      });
    }
    function createAwsCredentials() {
      return output9(
        Link.getInclude("aws.permission", args.link)
      ).apply((permissions) => {
        if (permissions.length === 0) return;
        const user = new iam.User(
          `${name}AwsUser`,
          { forceDestroy: true },
          { parent }
        );
        new iam.UserPolicy(
          `${name}AwsPolicy`,
          {
            user: user.name,
            policy: jsonStringify2({
              Statement: permissions.map((p) => ({
                Effect: (() => {
                  const effect = p.effect ?? "allow";
                  return effect.charAt(0).toUpperCase() + effect.slice(1);
                })(),
                Action: p.actions,
                Resource: p.resources
              }))
            })
          },
          { parent }
        );
        const keys = new iam.AccessKey(
          `${name}AwsCredentials`,
          { user: user.name },
          { parent }
        );
        return keys;
      });
    }
    function buildHandler() {
      const buildResult = buildInput.apply(async (input) => {
        const result2 = await rpc.call("Runtime.Build", input);
        if (result2.errors.length > 0) {
          throw new Error(result2.errors.join("\n"));
        }
        return result2;
      });
      return buildResult;
    }
    function createScript() {
      const contentFilePath = build.apply(
        (build2) => path4.join(build2.out, build2.handler)
      );
      return new cf.WorkersScript(
        ...transform(
          args.transform?.worker,
          `${name}Script`,
          {
            scriptName: physicalName(64, `${name}Script`).toLowerCase(),
            mainModule: "placeholder",
            accountId: DEFAULT_ACCOUNT_ID,
            contentFile: contentFilePath,
            contentSha256: contentFilePath.apply(
              async (p) => crypto2.createHash("sha256").update(await fs4.readFile(p, "utf-8")).digest("hex")
            ),
            compatibilityDate: "2025-05-05",
            compatibilityFlags: ["nodejs_compat"],
            assets: args.assets ? output9(args.assets).apply(async (assets) => {
              const directory = path4.join(
                define_cli_default.paths.root,
                assets.directory
              );
              let headers;
              try {
                headers = await fs4.readFile(
                  path4.join(directory, "_headers"),
                  "utf-8"
                );
              } catch (e) {
              }
              return {
                directory,
                config: { headers }
              };
            }) : void 0,
            bindings: all7([args.environment, iamCredentials, bindings]).apply(
              ([environment, iamCredentials2, bindings2]) => [
                ...bindings2,
                ...iamCredentials2 ? [
                  {
                    type: "plain_text",
                    name: "AWS_ACCESS_KEY_ID",
                    text: iamCredentials2.id
                  },
                  {
                    type: "secret_text",
                    name: "AWS_SECRET_ACCESS_KEY",
                    text: iamCredentials2.secret
                  }
                ] : [],
                ...args.assets ? [
                  {
                    type: "assets",
                    name: "ASSETS"
                  }
                ] : [],
                ...Object.entries(environment ?? {}).map(([key, value]) => ({
                  type: "plain_text",
                  name: key,
                  text: value
                }))
              ]
            )
          },
          { parent, ignoreChanges: ["scriptName"] }
        )
      );
    }
    function createWorkersUrl() {
      return new WorkerUrl(
        `${name}Url`,
        {
          accountId: DEFAULT_ACCOUNT_ID,
          scriptName: script.scriptName,
          enabled: urlEnabled
        },
        { parent }
      );
    }
    function createWorkersDomain() {
      if (!args.domain) return;
      const zone = new ZoneLookup(
        `${name}ZoneLookup`,
        {
          accountId: DEFAULT_ACCOUNT_ID,
          domain: args.domain
        },
        { parent }
      );
      return new cf.WorkersCustomDomain(
        `${name}Domain`,
        {
          accountId: DEFAULT_ACCOUNT_ID,
          service: script.scriptName,
          hostname: args.domain,
          zoneId: zone.id,
          environment: "production"
        },
        { parent }
      );
    }
  }
  /**
   * The Worker URL if `url` is enabled.
   */
  get url() {
    return this.workerDomain ? interpolate2`https://${this.workerDomain.hostname}` : this.workerUrl.url.apply((url) => url ? `https://${url}` : url);
  }
  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  get nodes() {
    return {
      /**
       * The Cloudflare Worker script.
       */
      worker: this.script
    };
  }
  /**
   * When you link a worker, say WorkerA, to another worker, WorkerB; it automatically creates
   * a service binding between the workers. It allows WorkerA to call WorkerB without going
   * through a publicly-accessible URL.
   *
   * @example
   * ```ts title="index.ts" {3}
   * import { Resource } from "sst";
   *
   * await Resource.WorkerB.fetch(request);
   * ```
   *
   * Read more about [binding Workers](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/).
   *
   * @internal
   */
  getSSTLink() {
    return {
      properties: {
        url: this.url
      },
      include: [
        binding({
          type: "serviceBindings",
          properties: {
            service: this.script.id
          }
        })
      ]
    };
  }
};
var __pulumiType4 = "sst:cloudflare:Worker";
Worker.__pulumiType = __pulumiType4;

// .sst/platform/src/components/cloudflare/static-site.ts
var StaticSite = class extends Component {
  assets;
  router;
  constructor(name, args = {}, opts = {}) {
    super(__pulumiType5, name, args, opts);
    const parent = this;
    const { sitePath, environment, indexPage } = prepare(args);
    const outputPath = false ? path5.join(define_cli_default.paths.platform, "functions", "empty-site") : buildApp2(parent, name, args.build, sitePath, environment);
    const storage = createKvStorage();
    const assetManifest = generateAssetManifest();
    const kvData = uploadAssets();
    const worker = createRouter();
    this.assets = storage;
    this.router = worker;
    this.registerOutputs({
      _hint: this.url,
      _dev: {
        environment,
        command: "npm run dev",
        directory: sitePath,
        autostart: true
      },
      _metadata: {
        path: sitePath,
        environment,
        url: this.url
      }
    });
    function createKvStorage() {
      return new Kv(
        ...transform(
          args.transform?.assets,
          `${name}Assets`,
          {},
          {
            parent,
            retainOnDelete: false
          }
        )
      );
    }
    function generateAssetManifest() {
      return all8([outputPath, args.assets]).apply(
        async ([outputPath2, assets]) => {
          const fileOptions = assets?.fileOptions ?? [
            {
              files: "**",
              cacheControl: "max-age=0,no-cache,no-store,must-revalidate"
            },
            {
              files: ["**/*.js", "**/*.css"],
              cacheControl: "max-age=31536000,public,immutable"
            }
          ];
          const manifest = [];
          const filesProcessed = [];
          for (const fileOption of fileOptions.reverse()) {
            const files = globSync(fileOption.files, {
              cwd: path5.resolve(outputPath2),
              nodir: true,
              dot: true,
              ignore: [
                ".sst/**",
                ...typeof fileOption.ignore === "string" ? [fileOption.ignore] : fileOption.ignore ?? []
              ]
            }).filter((file) => !filesProcessed.includes(file));
            filesProcessed.push(...files);
            manifest.push(
              ...await Promise.all(
                files.map(async (file) => {
                  const source = path5.resolve(outputPath2, file);
                  const content = await fs5.promises.readFile(source, "utf-8");
                  const hash = crypto3.createHash("sha256").update(content).digest("hex");
                  return {
                    source,
                    key: file,
                    hash,
                    cacheControl: fileOption.cacheControl,
                    contentType: fileOption.contentType ?? getContentType(file, "UTF-8")
                  };
                })
              )
            );
          }
          return manifest;
        }
      );
    }
    function uploadAssets() {
      return new KvData(
        `${name}AssetFiles`,
        {
          accountId: DEFAULT_ACCOUNT_ID,
          namespaceId: storage.id,
          entries: assetManifest.apply(
            (manifest) => manifest.map((m) => ({
              source: m.source,
              key: m.key,
              hash: m.hash,
              cacheControl: m.cacheControl,
              contentType: m.contentType
            }))
          )
        },
        { parent, ignoreChanges: false ? ["*"] : void 0 }
      );
    }
    function createRouter() {
      return new Worker(
        `${name}Router`,
        {
          handler: path5.join(
            define_cli_default.paths.platform,
            "functions",
            "cf-static-site-router-worker"
          ),
          url: true,
          domain: args.domain,
          environment: {
            INDEX_PAGE: indexPage,
            ...args.errorPage ? { ERROR_PAGE: args.errorPage } : {}
          },
          build: {
            esbuild: assetManifest.apply((assetManifest2) => ({
              define: {
                SST_ASSET_MANIFEST: JSON.stringify(
                  Object.fromEntries(assetManifest2.map((e) => [e.key, e.hash]))
                )
              }
            }))
          },
          transform: {
            worker: (workerArgs) => {
              workerArgs.bindings = output10(workerArgs.bindings ?? []).apply(
                (bindings) => [
                  ...bindings,
                  {
                    type: "kv_namespace",
                    name: "ASSETS",
                    namespaceId: storage.id
                  }
                ]
              );
            }
          }
        },
        // create worker after KV upload finishes
        { dependsOn: kvData, parent }
      );
    }
  }
  /**
   * The URL of the website.
   *
   * If the `domain` is set, this is the URL with the custom domain.
   * Otherwise, it's the auto-generated worker URL.
   */
  get url() {
    return this.router.url;
  }
  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  get nodes() {
    return {
      /**
       * The KV namespace that stores the assets.
       */
      assets: this.assets,
      /**
       * The worker that serves the requests.
       */
      router: this.router
    };
  }
  /** @internal */
  getSSTLink() {
    return {
      properties: {
        url: this.url
      }
    };
  }
};
var __pulumiType5 = "sst:cloudflare:StaticSite";
StaticSite.__pulumiType = __pulumiType5;

// .sst/platform/src/components/cloudflare/auth.ts
import {
  output as output11,
  secret
} from "@pulumi/pulumi";
import { PrivateKey } from "@pulumi/tls";
var Auth = class extends Component {
  _key;
  _authenticator;
  constructor(name, args, opts) {
    super(__pulumiType6, name, args, opts);
    this._key = new PrivateKey(`${name}Keypair`, {
      algorithm: "RSA"
    });
    this._authenticator = output11(args.authenticator).apply((args2) => {
      return new Worker(`${name}Authenticator`, {
        ...args2,
        url: true,
        environment: {
          ...args2.environment,
          AUTH_PRIVATE_KEY: secret(this.key.privateKeyPemPkcs8),
          AUTH_PUBLIC_KEY: secret(this.key.publicKeyPem)
        }
      });
    });
  }
  get key() {
    return this._key;
  }
  get authenticator() {
    return this._authenticator;
  }
  get url() {
    return this._authenticator.url;
  }
  /** @internal */
  getSSTLink() {
    return {
      properties: {
        url: this._authenticator.url,
        publicKey: secret(this.key.publicKeyPem)
      }
    };
  }
};
var __pulumiType6 = "sst:cloudflare:Auth";
Auth.__pulumiType = __pulumiType6;

// .sst/platform/src/components/cloudflare/queue.ts
import * as cloudflare5 from "@pulumi/cloudflare";
var Queue2 = class extends Component {
  queue;
  constructor(name, args, opts) {
    super(__pulumiType7, name, args, opts);
    const parent = this;
    const queue = create();
    this.queue = queue;
    function create() {
      return new cloudflare5.Queue(
        ...transform(
          args?.transform?.queue,
          `${name}Queue`,
          {
            queueName: "",
            accountId: DEFAULT_ACCOUNT_ID
          },
          { parent }
        )
      );
    }
  }
  getSSTLink() {
    return {
      properties: {},
      include: [
        binding({
          type: "queueBindings",
          properties: {
            queue: this.queue.queueName
          }
        })
      ]
    };
  }
  /**
   * The generated id of the queue
   */
  get id() {
    return this.queue.id;
  }
  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  get nodes() {
    return {
      /**
       * The Cloudflare queue.
       */
      queue: this.queue
    };
  }
};
var __pulumiType7 = "sst:cloudflare:Queue";
Queue2.__pulumiType = __pulumiType7;

// .sst/platform/src/components/cloudflare/cron.ts
import { all as all9 } from "@pulumi/pulumi";
import * as cloudflare6 from "@pulumi/cloudflare";

// .sst/platform/src/components/cloudflare/helpers/worker-builder.ts
import {
  output as output12
} from "@pulumi/pulumi";
function workerBuilder(name, definition, argsTransform, opts) {
  return output12(definition).apply((definition2) => {
    if (typeof definition2 === "string") {
      const worker = new Worker(
        ...transform(argsTransform, name, { handler: definition2 }, opts || {})
      );
      return {
        getWorker: () => worker,
        script: worker.nodes.worker
      };
    } else if (definition2.handler) {
      const worker = new Worker(
        ...transform(
          argsTransform,
          name,
          {
            ...definition2
          },
          opts || {}
        )
      );
      return {
        getWorker: () => worker,
        script: worker.nodes.worker
      };
    }
    throw new Error(`Invalid worker definition for the "${name}" Worker`);
  });
}

// .sst/platform/src/components/cloudflare/cron.ts
var Cron = class extends Component {
  worker;
  trigger;
  constructor(name, args, opts) {
    super(__pulumiType8, name, args, opts);
    const parent = this;
    const worker = createWorker();
    const trigger = createTrigger();
    this.worker = worker;
    this.trigger = trigger;
    function createWorker() {
      return workerBuilder(`${name}Handler`, args.job);
    }
    function createTrigger() {
      return all9([args.schedules]).apply(([schedules]) => {
        return new cloudflare6.WorkersCronTrigger(
          ...transform(
            args.transform?.trigger,
            `${name}Trigger`,
            {
              accountId: DEFAULT_ACCOUNT_ID,
              scriptName: worker.script.scriptName,
              schedules: schedules.map((s) => ({ cron: s }))
            },
            { parent }
          )
        );
      });
    }
  }
  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  get nodes() {
    return {
      /**
       * The Cloudflare Worker.
       */
      worker: this.worker.script,
      /**
       * The Cloudflare Worker Cron Trigger.
       */
      trigger: this.trigger
    };
  }
};
var __pulumiType8 = "sst:cloudflare:Cron";
Cron.__pulumiType = __pulumiType8;

// .sst/platform/src/components/cloudflare/experimental/index.ts
var experimental_exports = {};
__export(experimental_exports, {
  Astro: () => Astro,
  SolidStart: () => SolidStart,
  StaticSite: () => StaticSite2
});

// .sst/platform/src/components/cloudflare/experimental/astro.ts
import fs8 from "fs/promises";
import path7 from "path";

// .sst/platform/src/components/cloudflare/ssr-site.ts
import path6 from "path";
import fs6 from "fs";
import { output as output13, all as all10 } from "@pulumi/pulumi";
var SsrSite = class extends Component {
  server;
  constructor(type, name, args = {}, opts = {}) {
    super(type, name, args, opts);
    const self = this;
    const sitePath = normalizeSitePath();
    const outputPath = false ? sitePath : buildApp(self, name, args, sitePath);
    const plan = validatePlan(this.buildPlan(outputPath, name, args));
    const worker = createWorker();
    this.server = worker;
    this.registerOutputs({
      _hint: false ? void 0 : this.url,
      _dev: {
        environment: args.environment,
        command: "npm run dev",
        directory: sitePath,
        autostart: true,
        links: output13(args.link || []).apply(Link.build).apply((links) => links.map((link) => link.name))
      },
      _metadata: {
        mode: false ? "placeholder" : "deployed",
        path: sitePath
      }
    });
    function normalizeSitePath() {
      return output13(args.path).apply((sitePath2) => {
        if (!sitePath2) return ".";
        if (!fs6.existsSync(sitePath2)) {
          throw new VisibleError(
            `Site directory not found at "${path6.resolve(
              sitePath2
            )}". Please check the path setting in your configuration.`
          );
        }
        return sitePath2;
      });
    }
    function validatePlan(plan2) {
      return plan2;
    }
    function createWorker() {
      return new Worker(
        ...transform(
          args.transform?.server,
          `${name}Worker`,
          {
            handler: all10([outputPath, plan.server]).apply(
              ([outputPath2, server]) => path6.join(outputPath2, server)
            ),
            environment: args.environment,
            link: args.link,
            url: true,
            dev: false,
            domain: args.domain,
            assets: {
              directory: all10([outputPath, plan.assets]).apply(
                ([outputPath2, assets]) => path6.join(outputPath2, assets)
              )
            }
          },
          { parent: self }
        )
      );
    }
  }
  /**
   * The URL of the Remix app.
   *
   * If the `domain` is set, this is the URL with the custom domain.
   * Otherwise, it's the auto-generated CloudFront URL.
   */
  get url() {
    return this.server.url;
  }
  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  get nodes() {
    return {
      /**
       * The Cloudflare Worker that renders the site.
       */
      server: this.server
    };
  }
  /** @internal */
  getSSTLink() {
    return {
      properties: {
        url: this.url
      }
    };
  }
};

// .sst/platform/src/util/fs.ts
import fs7 from "fs/promises";
async function existsAsync(input) {
  return fs7.access(input).then(() => true).catch(() => false);
}

// .sst/platform/src/components/cloudflare/experimental/astro.ts
var Astro = class extends SsrSite {
  constructor(name, args = {}, opts = {}) {
    super(__pulumiType9, name, args, opts);
  }
  buildPlan(outputPath) {
    return outputPath.apply(async (outputPath2) => {
      const distPath = path7.join(outputPath2, "dist");
      if (!await existsAsync(path7.join(distPath, "_worker.js", "index.js"))) {
        throw new VisibleError(
          `SSR server bundle "_worker.js" not found in the build output at:
  "${path7.resolve(distPath)}".

If your Astro project is entirely pre-rendered, use the \`sst.cloudflare.StaticSite\` component instead of \`sst.cloudflare.Astro\`.`
        );
      }
      const ignorePath = path7.join(outputPath2, "dist", ".assetsignore");
      const ignorePatterns = await existsAsync(ignorePath) ? (await fs8.readFile(ignorePath, "utf-8")).split("\n") : [];
      let dirty = false;
      ["_worker.js", "_routes.json"].forEach((pattern) => {
        if (ignorePatterns.includes(pattern)) return;
        ignorePatterns.push(pattern);
        dirty = true;
      });
      if (dirty) {
        await fs8.appendFile(ignorePath, "\n_worker.js\n_routes.json");
      }
      return {
        server: "./dist/_worker.js/index.js",
        assets: "./dist"
      };
    });
  }
  /**
   * The URL of the Astro site.
   *
   * If the `domain` is set, this is the URL with the custom domain.
   * Otherwise, it's the auto-generated Worker URL.
   */
  get url() {
    return super.url;
  }
};
var __pulumiType9 = "sst:cloudflare:Astro";
Astro.__pulumiType = __pulumiType9;

// .sst/platform/src/components/cloudflare/experimental/solid-start.ts
import fs9 from "fs/promises";
import path8 from "path";
var SolidStart = class extends SsrSite {
  constructor(name, args = {}, opts = {}) {
    super(__pulumiType10, name, args, opts);
  }
  buildPlan(outputPath) {
    return outputPath.apply(async (outputPath2) => {
      const nitro = JSON.parse(
        await fs9.readFile(
          path8.join(outputPath2, ".output", "nitro.json"),
          "utf-8"
        )
      );
      if (!["cloudflare-module"].includes(nitro.preset)) {
        throw new VisibleError(
          `SolidStart's nitro.config.ts must be configured to use the "cloudflare-module" preset. It is currently set to "${nitro.preset}".`
        );
      }
      if (!await existsAsync(
        path8.join(outputPath2, ".output", "server", "index.mjs")
      )) {
        throw new VisibleError(
          `SSR server bundle "index.mjs" not found in the build output at:
  "${path8.resolve(outputPath2, ".output", "server")}".

If your SolidStart project is entirely pre-rendered, use the \`sst.cloudflare.StaticSite\` component instead of \`sst.cloudflare.SolidStart\`.`
        );
      }
      const ignorePath = path8.join(outputPath2, ".output", ".assetsignore");
      const ignorePatterns = await existsAsync(ignorePath) ? (await fs9.readFile(ignorePath, "utf-8")).split("\n") : [];
      let dirty = false;
      ["server"].forEach((pattern) => {
        if (ignorePatterns.includes(pattern)) return;
        ignorePatterns.push(pattern);
        dirty = true;
      });
      if (dirty) {
        await fs9.appendFile(ignorePath, "\nserver");
      }
      return {
        server: "./.output/server/index.mjs",
        assets: "./.output/public"
      };
    });
  }
  /**
   * The URL of the SolidStart app.
   *
   * If the `domain` is set, this is the URL with the custom domain.
   * Otherwise, it's the auto-generated Worker URL.
   */
  get url() {
    return super.url;
  }
};
var __pulumiType10 = "sst:cloudflare:SolidStart";
SolidStart.__pulumiType = __pulumiType10;

// .sst/platform/src/components/cloudflare/experimental/static-site.ts
import path9 from "path";
var StaticSite2 = class extends Component {
  server;
  constructor(name, args = {}, opts = {}) {
    super(__pulumiType11, name, args, opts);
    const self = this;
    const { sitePath, environment, indexPage } = prepare(args);
    const outputPath = false ? path9.join(define_cli_default.paths.platform, "functions", "empty-site") : buildApp2(self, name, args.build, sitePath, environment);
    const worker = createRouter();
    this.server = worker;
    this.registerOutputs({
      _hint: false ? void 0 : this.url,
      _dev: {
        environment,
        command: "npm run dev",
        directory: sitePath,
        autostart: true
      },
      _metadata: {
        mode: false ? "placeholder" : "deployed",
        path: sitePath,
        environment,
        url: this.url
      }
    });
    function createRouter() {
      return new Worker(
        `${name}Router`,
        {
          handler: path9.join(
            define_cli_default.paths.platform,
            "functions",
            "cf-static-site-router-worker-experimental"
          ),
          environment: environment.apply((e) => ({
            ...e,
            INDEX_PAGE: indexPage,
            ...args.errorPage ? { ERROR_PAGE: args.errorPage } : {}
          })),
          url: true,
          dev: false,
          domain: args.domain,
          assets: {
            directory: outputPath
          }
        },
        { parent: self }
      );
    }
  }
  /**
   * The URL of the website.
   *
   * If the `domain` is set, this is the URL with the custom domain.
   * Otherwise, it's the auto-generated worker URL.
   */
  get url() {
    return this.server.url;
  }
  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  get nodes() {
    return {
      /**
       * The worker that serves the requests.
       */
      server: this.server
    };
  }
  /** @internal */
  getSSTLink() {
    return {
      properties: {
        url: this.url
      }
    };
  }
};
var __pulumiType11 = "sst:cloudflare:StaticSite";
StaticSite2.__pulumiType = __pulumiType11;

// .sst/platform/src/components/index.ts
var linkable2 = Link.linkable;

// sst.desktop.config.ts
var sst_desktop_config_default = $config({
  app(input) {
    return {
      name: "shuvcode-desktop",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "cloudflare"
    };
  },
  async run() {
    const domain = (() => {
      if (define_app_default.stage === "production") return "shuv.ai";
      if (define_app_default.stage === "dev") return "dev.shuv.ai";
      return `${define_app_default.stage}.dev.shuv.ai`;
    })();
    const zoneID = "89b56654a1e7378f9d90921aac8d8e91";
    new cloudflare7.RegionalHostname("RegionalHostname", {
      hostname: "desktop." + domain,
      regionKey: "us",
      zoneId: zoneID
    });
    new cloudflare_exports.StaticSite("Desktop", {
      domain: "desktop." + domain,
      path: "packages/desktop",
      build: {
        command: "bun turbo build",
        output: "./dist"
      }
    });
  }
});

// eval.ts
var result = await run(sst_desktop_config_default.run);
var eval_default = result;
export {
  eval_default as default
};
//# sourceMappingURL=sst.config.1765313483357.mjs.map
