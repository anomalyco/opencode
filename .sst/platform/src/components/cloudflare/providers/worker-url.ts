import { CustomResourceOptions, Input, Output, dynamic } from "@pulumi/pulumi";
import { cfFetch } from "../helpers/fetch.js";

interface Inputs {
  accountId: string;
  scriptName: string;
  enabled: boolean;
}

interface Outputs {
  url: string | undefined;
}

export interface WorkerUrlInputs {
  accountId: Input<Inputs["accountId"]>;
  scriptName: Input<Inputs["scriptName"]>;
  enabled: Input<Inputs["enabled"]>;
}

export interface WorkerUrl {
  url: Output<Outputs["url"]>;
}

class Provider implements dynamic.ResourceProvider {
  async create(inputs: Inputs): Promise<dynamic.CreateResult> {
    const url = await this.process(inputs);
    return {
      id: inputs.scriptName,
      outs: url ? { url } : {},
    };
  }

  async update(
    id: string,
    olds: Inputs,
    news: Inputs,
  ): Promise<dynamic.UpdateResult> {
    const url = await this.process(news);
    return {
      outs: url ? { url } : {},
    };
  }

  async process(inputs: Inputs) {
    if (inputs.enabled === false) {
      await this.setEnabledFlag(inputs);
      return undefined;
    }

    const [userSubdomain] = await Promise.all([
      this.getWorkerDevSubdomain(inputs),
      this.setEnabledFlag(inputs),
    ]);
    return `${inputs.scriptName}.${userSubdomain}.workers.dev`;
  }

  async getWorkerDevSubdomain(inputs: Inputs) {
    try {
      const ret = await cfFetch<{ subdomain: string }>(
        `/accounts/${inputs.accountId}/workers/subdomain`,
        {
          headers: { "Content-Type": "application/json" },
        },
      );
      return ret.result.subdomain;
    } catch (error: any) {
      console.log(error);
      throw error;
    }
  }

  async setEnabledFlag(inputs: Inputs) {
    try {
      await cfFetch(
        `/accounts/${inputs.accountId}/workers/scripts/${inputs.scriptName}/subdomain`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: inputs.enabled }),
        },
      );
      // Add a delay when the subdomain is first created.
      // This is to prevent an issue where a negative cache-hit
      // causes the subdomain to be unavailable for 30 seconds.
      // This is a temporary measure until we fix this on the edge.
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } catch (error: any) {
      console.log(error);
      throw error;
    }
  }
}

export class WorkerUrl extends dynamic.Resource {
  constructor(
    name: string,
    args: WorkerUrlInputs,
    opts?: CustomResourceOptions,
  ) {
    super(
      new Provider(),
      `${name}.sst.cloudflare.WorkerUrl`,
      { ...args, url: undefined },
      opts,
    );
  }
}
