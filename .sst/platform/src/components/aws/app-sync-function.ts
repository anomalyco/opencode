import { ComponentResourceOptions, Input } from "@pulumi/pulumi";
import { Component, transform } from "../component";
import { AppSyncFunctionArgs } from "./app-sync";
import { appsync } from "@pulumi/aws";

export interface FunctionArgs extends AppSyncFunctionArgs {
  /**
   * The AppSync GraphQL API ID.
   */
  apiId: Input<string>;
}

/**
 * The `AppSyncFunction` component is internally used by the `AppSync` component to add
 * functions to [AWS AppSync](https://docs.aws.amazon.com/appsync/latest/devguide/what-is-appsync.html).
 *
 * :::note
 * This component is not intended to be created directly.
 * :::
 *
 * You'll find this component returned by the `addFunction` method of the `AppSync` component.
 */
export class AppSyncFunction extends Component {
  private readonly fn: appsync.Function;

  constructor(
    name: string,
    args: FunctionArgs,
    opts?: ComponentResourceOptions,
  ) {
    super(__pulumiType, name, args, opts);

    const self = this;

    const fn = createFunction();

    this.fn = fn;

    function createFunction() {
      return new appsync.Function(
        ...transform(
          args.transform?.function,
          `${name}Function`,
          {
            apiId: args.apiId,
            name: args.name,
            dataSource: args.dataSource,
            requestMappingTemplate: args.requestMappingTemplate,
            responseMappingTemplate: args.responseMappingTemplate,
            code: args.code,
            runtime: args.code
              ? {
                  name: "APPSYNC_JS",
                  runtimeVersion: "1.0.0",
                }
              : undefined,
          },
          { parent: self },
        ),
      );
    }
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The Amazon AppSync Function.
       */
      function: this.fn,
    };
  }
}

const __pulumiType = "sst:aws:AppSyncFunction";
// @ts-expect-error
AppSyncFunction.__pulumiType = __pulumiType;
