import {
  ComponentResourceOptions,
  Input,
  Output,
  output,
} from "@pulumi/pulumi";
import { Component, transform } from "../component";
import { Function } from "./function";
import { VisibleError } from "../error";
import { AppSyncDataSourceArgs } from "./app-sync";
import { parseDynamoArn } from "./helpers/arn";
import { appsync, iam } from "@pulumi/aws";
import { FunctionBuilder, functionBuilder } from "./helpers/function-builder";

export interface DataSourceArgs extends AppSyncDataSourceArgs {
  /**
   * The AppSync GraphQL API ID.
   */
  apiId: Input<string>;
  /**
   * The AppSync component name.
   */
  apiComponentName: string;
}

/**
 * The `AppSyncDataSource` component is internally used by the `AppSync` component to add
 * data sources to [AWS AppSync](https://docs.aws.amazon.com/appsync/latest/devguide/what-is-appsync.html).
 *
 * :::note
 * This component is not intended to be created directly.
 * :::
 *
 * You'll find this component returned by the `addDataSource` method of the `AppSync` component.
 */
export class AppSyncDataSource extends Component {
  private readonly dataSource: appsync.DataSource;
  private readonly lambda?: FunctionBuilder;
  private readonly serviceRole?: iam.Role;

  constructor(
    name: string,
    args: DataSourceArgs,
    opts?: ComponentResourceOptions,
  ) {
    super(__pulumiType, name, args, opts);

    const self = this;

    const apiId = output(args.apiId);

    validateSingleDataSource();
    const type = getType();

    const lambda = createFunction();
    const serviceRole = createServiceRole();
    const dataSource = createDataSource();

    this.dataSource = dataSource;
    this.lambda = lambda;
    this.serviceRole = serviceRole;

    function validateSingleDataSource() {
      const sources = [
        args.lambda,
        args.dynamodb,
        args.elasticSearch,
        args.eventBridge,
        args.http,
        args.openSearch,
        args.rds,
      ].filter((source) => source);

      if (sources.length > 1) {
        throw new Error(
          `Expected only one data source, but found ${sources.length}.`,
        );
      }
    }

    function getType() {
      if (args.lambda) return "AWS_LAMBDA";
      if (args.dynamodb) return "AMAZON_DYNAMODB";
      if (args.elasticSearch) return "AMAZON_ELASTICSEARCH";
      if (args.eventBridge) return "AMAZON_EVENTBRIDGE";
      if (args.http) return "HTTP";
      if (args.openSearch) return "AMAZON_OPENSEARCH_SERVICE";
      if (args.rds) return "RELATIONAL_DATABASE";
      return "NONE";
    }

    function createFunction() {
      if (!args.lambda) return;

      return functionBuilder(`${name}Function`, args.lambda, {
        description: `${args.apiComponentName} data source`,
      });
    }

    function createServiceRole() {
      if (
        !lambda &&
        !args.dynamodb &&
        !args.elasticSearch &&
        !args.eventBridge &&
        !args.openSearch
      )
        return;

      return new iam.Role(
        ...transform(
          args.transform?.serviceRole,
          `${name}ServiceRole`,
          {
            assumeRolePolicy: iam.getPolicyDocumentOutput({
              statements: [
                {
                  actions: ["sts:AssumeRole"],
                  principals: [
                    {
                      type: "Service",
                      identifiers: ["appsync.amazonaws.com"],
                    },
                  ],
                },
              ],
            }).json,
            inlinePolicies: [
              {
                name: "inline",
                policy: iam.getPolicyDocumentOutput({
                  statements: [
                    ...(lambda
                      ? [{ actions: ["lambda:*"], resources: [lambda.arn] }]
                      : []),
                    ...(args.dynamodb
                      ? [
                          {
                            actions: ["dynamodb:*"],
                            resources: [args.dynamodb],
                          },
                        ]
                      : []),
                    ...(args.elasticSearch
                      ? [
                          {
                            actions: ["es:*"],
                            resources: [args.elasticSearch],
                          },
                        ]
                      : []),
                    ...(args.eventBridge
                      ? [
                          {
                            actions: ["events:*"],
                            resources: [args.eventBridge],
                          },
                        ]
                      : []),
                    ...(args.openSearch
                      ? [
                          {
                            actions: ["opensearch:*"],
                            resources: [args.openSearch],
                          },
                        ]
                      : []),
                  ],
                }).json,
              },
            ],
          },
          { parent: self },
        ),
      );
    }

    function createDataSource() {
      return new appsync.DataSource(
        ...transform(
          args.transform?.dataSource,
          `${name}DataSource`,
          {
            apiId,
            type,
            name: args.name,
            serviceRoleArn: serviceRole?.arn,
            lambdaConfig: lambda ? { functionArn: lambda.arn } : undefined,
            dynamodbConfig: args.dynamodb
              ? {
                  tableName: output(args.dynamodb).apply(
                    (arn) => parseDynamoArn(arn).tableName,
                  ),
                }
              : undefined,
            elasticsearchConfig: args.elasticSearch
              ? { endpoint: args.elasticSearch }
              : undefined,
            eventBridgeConfig: args.eventBridge
              ? { eventBusArn: args.eventBridge }
              : undefined,
            httpConfig: args.http ? { endpoint: args.http } : undefined,
            opensearchserviceConfig: args.openSearch
              ? { endpoint: args.openSearch }
              : undefined,
            relationalDatabaseConfig: args.rds
              ? {
                  httpEndpointConfig: {
                    dbClusterIdentifier: output(args.rds).cluster,
                    awsSecretStoreArn: output(args.rds).credentials,
                  },
                }
              : undefined,
          },
          { parent: self },
        ),
      );
    }
  }

  /**
   * The name of the data source.
   */
  public get name() {
    return this.dataSource.name;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    const self = this;
    return {
      /**
       * The Amazon AppSync DataSource.
       */
      dataSource: this.dataSource,
      /**
       * The Lambda function used by the data source.
       */
      get function() {
        if (!self.lambda)
          throw new VisibleError(
            "Cannot access `nodes.function` because the data source does not use a Lambda function.",
          );
        return self.lambda.apply((fn) => fn.getFunction());
      },
      /**
       * The DataSource service's IAM role.
       */
      get serviceRole() {
        if (!self.serviceRole)
          throw new VisibleError(
            "Cannot access `nodes.serviceRole` because the data source does not have a service role.",
          );
        return self.serviceRole;
      },
    };
  }
}

const __pulumiType = "sst:aws:AppSyncDataSource";
// @ts-expect-error
AppSyncDataSource.__pulumiType = __pulumiType;
