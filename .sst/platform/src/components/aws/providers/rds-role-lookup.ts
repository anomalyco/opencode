import { CustomResourceOptions, Input, Output, dynamic } from "@pulumi/pulumi";
import { rpc } from "../../rpc/rpc.js";

export interface RdsRoleLookupInputs {
  name: Input<string>;
}

export class RdsRoleLookup extends dynamic.Resource {
  constructor(
    name: string,
    args: RdsRoleLookupInputs,
    opts?: CustomResourceOptions,
  ) {
    super(
      new rpc.Provider("Aws.RdsRoleLookup"),
      `${name}.sst.aws.RdsRoleLookup`,
      args,
      opts,
    );
  }
}
