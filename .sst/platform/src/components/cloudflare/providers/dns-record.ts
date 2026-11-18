import { CustomResourceOptions, Input, Output, dynamic } from "@pulumi/pulumi";
import { rpc } from "../../rpc/rpc.js";
import { DEFAULT_ACCOUNT_ID } from "../account-id";

export interface DnsRecordInputs {
  zoneId: Input<string>;
  type: Input<string>;
  name: Input<string>;
  value?: Input<string>;
  data?: Input<{
    flags: Input<string>;
    tag: Input<string>;
    value: Input<string>;
  }>;
  proxied?: Input<boolean>;
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
      new rpc.Provider("Cloudflare.DnsRecord"),
      `${name}.sst.cloudflare.DnsRecord`,
      {
        ...args,
        recordId: undefined,
        accountId: DEFAULT_ACCOUNT_ID,
        apiToken:
          $app.providers?.cloudflare?.apiToken ||
          process.env.CLOUDFLARE_API_TOKEN!,
      },
      opts,
    );
  }
}
