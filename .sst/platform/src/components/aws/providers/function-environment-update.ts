import { CustomResourceOptions, Input, dynamic } from "@pulumi/pulumi";
import { rpc } from "../../rpc/rpc.js";

export interface FunctionEnvironmentUpdateInputs {
  /**
   * The name of the function to update.
   */
  functionName: Input<string>;
  /**
   * The environment variables to update.
   */
  environment: Input<Record<string, Input<string>>>;
  /**
   * The region of the function to update.
   */
  region: Input<string>;
}

/**
 * The `FunctionEnvironmentUpdate` component is internally used by the `Function` component
 * to update the environment variables of a function.
 *
 * :::note
 * This component is not intended to be created directly.
 * :::
 *
 * You'll find this component returned by the `addEnvironment` method of the `Function` component.
 */
export class FunctionEnvironmentUpdate extends dynamic.Resource {
  constructor(
    name: string,
    args: FunctionEnvironmentUpdateInputs,
    opts?: CustomResourceOptions,
  ) {
    super(
      new rpc.Provider("Aws.FunctionEnvironmentUpdate"),
      `${name}.sst.aws.FunctionEnvironmentUpdate`,
      args,
      opts,
    );
  }
}
