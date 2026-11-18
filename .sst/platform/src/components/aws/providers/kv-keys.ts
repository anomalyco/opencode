import { CustomResourceOptions, Input, dynamic } from "@pulumi/pulumi";
import { rpc } from "../../rpc/rpc.js";

export interface KvKeysInputs {
  store: Input<string>;
  namespace: Input<string>;
  entries: Input<Record<string, Input<string>>>;
  purge: Input<boolean>;
}

export class KvKeys extends dynamic.Resource {
  constructor(name: string, args: KvKeysInputs, opts?: CustomResourceOptions) {
    super(new rpc.Provider("Aws.KvKeys"), `${name}.sst.aws.KvKeys`, args, opts);
  }
}
