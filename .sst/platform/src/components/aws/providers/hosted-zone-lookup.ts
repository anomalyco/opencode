import { CustomResourceOptions, Input, Output, dynamic } from "@pulumi/pulumi";
import { rpc } from "../../rpc/rpc.js";

export interface HostedZoneLookupInputs {
  domain: Input<string>;
}

export interface HostedZoneLookup {
  zoneId: Output<string>;
}

export class HostedZoneLookup extends dynamic.Resource {
  constructor(
    name: string,
    args: HostedZoneLookupInputs,
    opts?: CustomResourceOptions,
  ) {
    super(
      new rpc.Provider("Aws.HostedZoneLookup"),
      `${name}.sst.aws.HostedZoneLookup`,
      { ...args, zoneId: undefined },
      opts,
    );
  }
}
