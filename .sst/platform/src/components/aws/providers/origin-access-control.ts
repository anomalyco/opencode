import { CustomResourceOptions, dynamic, Input } from "@pulumi/pulumi";
import { rpc } from "../../rpc/rpc.js";

export interface OriginAccessControlInputs {
  name: Input<string>;
}

export class OriginAccessControl extends dynamic.Resource {
  constructor(
    name: string,
    args: OriginAccessControlInputs,
    opts?: CustomResourceOptions,
  ) {
    super(
      new rpc.Provider("Aws.OriginAccessControl"),
      `${name}.sst.aws.OriginAccessControl`,
      args,
      opts,
    );
  }
}
