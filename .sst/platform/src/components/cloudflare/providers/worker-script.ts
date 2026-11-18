/**
 * @deprecated This component was meant to be used instead of WorkersScript to handle
 * large file content. This was because WorkersScript used to serialize the content
 * into the state, causing the state to grow very large. Cloudflare provider has
 * since been updated to use the new `contentFile` and `contentSha256` properties
 * to handle large file content.
 */
import { CustomResourceOptions, Output, dynamic } from "@pulumi/pulumi";
import { rpc } from "../../rpc/rpc.js";
import { DEFAULT_ACCOUNT_ID } from "../account-id.js";
import { WorkersScriptArgs } from "@pulumi/cloudflare";
import { Input } from "../../input.js";

export interface WorkerScriptInputs extends Omit<WorkersScriptArgs, "content"> {
  content: Input<{
    filename: Input<string>;
    hash: Input<string>;
  }>;
}

export interface WorkerScript {
  scriptName: Output<string>;
}

export class WorkerScript extends dynamic.Resource {
  constructor(
    name: string,
    args: WorkerScriptInputs,
    opts?: CustomResourceOptions,
  ) {
    super(
      new rpc.Provider("Cloudflare.WorkerScript"),
      `${name}.sst.cloudflare.WorkerScript`,
      {
        ...args,
        accountId: DEFAULT_ACCOUNT_ID,
        apiToken:
          $app.providers?.cloudflare?.apiToken ||
          process.env.CLOUDFLARE_API_TOKEN!,
      },
      {
        ...opts,
        replaceOnChanges: ["scriptName"],
      },
    );
  }
}
