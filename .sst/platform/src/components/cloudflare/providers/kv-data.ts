import fs from "fs";
import { CustomResourceOptions, Input, dynamic } from "@pulumi/pulumi";
import { cfFetch } from "../helpers/fetch.js";

interface KvDataEntry {
  source: string;
  key: string;
  hash: string;
  contentType: string;
  cacheControl?: string;
}

export interface KvDataInputs {
  accountId: Input<Inputs["accountId"]>;
  namespaceId: Input<Inputs["namespaceId"]>;
  entries: Input<Inputs["entries"]>;
}

interface Inputs {
  accountId: string;
  namespaceId: string;
  entries: KvDataEntry[];
}

class Provider implements dynamic.ResourceProvider {
  async create(inputs: Inputs): Promise<dynamic.CreateResult> {
    await this.upload(inputs.accountId, inputs.namespaceId, inputs.entries, []);
    return { id: "data" };
  }

  async update(
    id: string,
    olds: Inputs,
    news: Inputs,
  ): Promise<dynamic.UpdateResult> {
    await this.upload(
      news.accountId,
      news.namespaceId,
      news.entries,
      news.namespaceId === olds.namespaceId ? olds.entries : [],
    );
    return {};
  }

  async upload(
    accountId: string,
    namespaceId: string,
    entries: KvDataEntry[],
    oldEntries: KvDataEntry[],
  ) {
    const oldFilesMap = new Map(oldEntries.map((f) => [f.key, f]));

    await Promise.all(
      entries
        .filter((entry) => {
          const old = oldFilesMap.get(entry.key);
          return (
            old?.hash !== entry.hash ||
            old?.contentType !== entry.contentType ||
            old?.cacheControl !== entry.cacheControl
          );
        })
        .map(async (entry) => {
          const formData = new FormData();
          formData.append(
            "metadata",
            JSON.stringify({
              contentType: entry.contentType,
              cacheControl: entry.cacheControl,
            }),
          );
          //formData.append("value", fs.createReadStream(entry.source));
          formData.append(
            "value",
            await fs.promises.readFile(entry.source, "base64"),
          );
          try {
            await cfFetch(
              `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${entry.key}`,
              {
                method: "PUT",
                body: formData,
              },
            );
          } catch (error: any) {
            console.log(error);
            throw error;
          }
        }),
    );
  }
}

export class KvData extends dynamic.Resource {
  constructor(name: string, args: KvDataInputs, opts?: CustomResourceOptions) {
    super(new Provider(), `${name}.sst.cloudflare.KvPairs`, args, opts);
  }
}
