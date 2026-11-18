import { CustomResourceOptions, Input, Output, dynamic } from "@pulumi/pulumi";
import { rpc } from "../../rpc/rpc.js";

export interface DnsRecordInputs {
  domain: Input<string>;
  type: Input<string>;
  name: Input<string>;
  value: Input<string>;
}

export interface DnsRecord {
  recordId: Output<string>;
}

export class DnsRecord extends dynamic.Resource {
  constructor(
    name: string,
    args: DnsRecordInputs,
    opts?: CustomResourceOptions,
  ) {
    super(
      new rpc.Provider("Vercel.DnsRecord"),
      `${name}.sst.vercel.DnsRecord`,
      {
        ...args,
        recordId: undefined,
        teamId: process.env.VERCEL_TEAM_ID,
        apiToken: process.env.VERCEL_API_TOKEN!,
      },
      opts,
    );
  }
}
