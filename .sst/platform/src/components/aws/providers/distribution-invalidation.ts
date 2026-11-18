import { CustomResourceOptions, Input, dynamic } from "@pulumi/pulumi";
import { rpc } from "../../rpc/rpc.js";

export interface DistributionInvalidationInputs {
  distributionId: Input<string>;
  paths: Input<string[]>;
  wait: Input<boolean>;
  version: Input<string>;
}

export class DistributionInvalidation extends dynamic.Resource {
  constructor(
    name: string,
    args: DistributionInvalidationInputs,
    opts?: CustomResourceOptions,
  ) {
    super(
      new rpc.Provider("Aws.DistributionInvalidation"),
      `${name}.sst.aws.DistributionInvalidation`,
      args,
      opts,
    );
  }
}
