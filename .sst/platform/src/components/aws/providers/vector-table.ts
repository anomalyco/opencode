import { CustomResourceOptions, Input, dynamic } from "@pulumi/pulumi";
import { rpc } from "../../rpc/rpc.js";

export interface PostgresTableInputs {
  clusterArn: Input<string>;
  secretArn: Input<string>;
  databaseName: Input<string>;
  tableName: Input<string>;
  dimension: Input<number>;
}

export class VectorTable extends dynamic.Resource {
  constructor(
    name: string,
    args: PostgresTableInputs,
    opts?: CustomResourceOptions,
  ) {
    super(
      new rpc.Provider("Aws.VectorTable"),
      `${name}.sst.aws.VectorTable`,
      args,
      opts,
    );
  }
}
