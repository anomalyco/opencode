import { CustomResourceOptions, Input, Output, dynamic } from "@pulumi/pulumi";
import { rpc } from "../../rpc/rpc.js";

export interface DistributionDeploymentWaiterInputs {
  distributionId: Input<string>;
  etag: Input<string>;
  wait: Input<boolean>;
}

export interface DistributionDeploymentWaiter {
  isDone: Output<boolean>;
}

export class DistributionDeploymentWaiter extends dynamic.Resource {
  constructor(
    name: string,
    args: DistributionDeploymentWaiterInputs,
    opts?: CustomResourceOptions,
  ) {
    super(
      new rpc.Provider("Aws.DistributionDeploymentWaiter"),
      `${name}.sst.aws.DistributionDeploymentWaiter`,
      args,
      opts,
    );
  }
}
