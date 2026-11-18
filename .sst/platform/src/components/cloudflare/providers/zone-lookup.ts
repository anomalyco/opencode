import { CustomResourceOptions, Input, Output, dynamic } from "@pulumi/pulumi";
import { cfFetch } from "../helpers/fetch.js";

interface Inputs {
  accountId: string;
  domain: string;
}

interface Outputs {
  zoneId: string;
  zoneName: string;
}

export interface ZoneLookupInputs {
  accountId: Input<Inputs["accountId"]>;
  domain: Input<Inputs["domain"]>;
}

export interface ZoneLookup {
  zoneId: Output<Outputs["zoneId"]>;
  zoneName: Output<Outputs["zoneName"]>;
}

class Provider implements dynamic.ResourceProvider {
  async create(inputs: Inputs): Promise<dynamic.CreateResult<Outputs>> {
    const { zoneId, zoneName } = await this.lookup(inputs);
    return { id: zoneId, outs: { zoneId, zoneName } };
  }

  async update(
    id: string,
    olds: Inputs,
    news: Inputs,
  ): Promise<dynamic.UpdateResult<Outputs>> {
    const { zoneId, zoneName } = await this.lookup(news);
    return { outs: { zoneId, zoneName } };
  }

  async lookup(
    inputs: Inputs,
    page = 1,
  ): Promise<{ zoneId: string; zoneName: string }> {
    try {
      const qs = new URLSearchParams({
        per_page: "50",
        "account.id": inputs.accountId,
      }).toString();
      const ret = await cfFetch<{ name: string; id: string }[]>(
        `/zones?${qs}`,
        { headers: { "Content-Type": "application/json" } },
      );
      const zone = ret.result.find(
        // ensure `example.com` does not match `myexample.com`
        (z) => inputs.domain === z.name || inputs.domain.endsWith(`.${z.name}`),
      );
      if (zone) return { zoneId: zone.id, zoneName: zone.name };

      if (ret.result.length < ret.result_info!.per_page)
        throw new Error(
          `Could not find hosted zone for domain ${inputs.domain}`,
        );

      return this.lookup(inputs, page + 1);
    } catch (error: any) {
      console.log(error);
      throw error;
    }
  }
}

export class ZoneLookup extends dynamic.Resource {
  constructor(
    name: string,
    args: ZoneLookupInputs,
    opts?: CustomResourceOptions,
  ) {
    super(
      new Provider(),
      `${name}.sst.cloudflare.ZoneLookup`,
      { ...args, zoneId: undefined, zoneName: undefined },
      opts,
    );
  }
}
