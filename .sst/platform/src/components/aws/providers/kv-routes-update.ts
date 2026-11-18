import { CustomResourceOptions, Input, dynamic } from "@pulumi/pulumi";
import { rpc } from "../../rpc/rpc.js";

export interface KvRoutesUpdateInputs {
  store: Input<string>;
  key: Input<string>;
  entry: Input<string>;
  namespace: Input<string>;
}

export class KvRoutesUpdate extends dynamic.Resource {
  constructor(
    name: string,
    args: KvRoutesUpdateInputs,
    opts?: CustomResourceOptions,
  ) {
    super(
      new rpc.Provider("Aws.KvRoutesUpdate"),
      `${name}.sst.aws.KvRoutesUpdate`,
      args,
      opts,
    );
  }
}
