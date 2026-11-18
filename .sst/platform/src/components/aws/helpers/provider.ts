import { runtime } from "@pulumi/pulumi";
import { Provider, Region } from "@pulumi/aws";
import { lazy } from "../../../util/lazy";

const useProviderCache = lazy(() => new Map<string, Provider>());

export const useProvider = (region: Region) => {
  const cache = useProviderCache();
  const existing = cache.get(region);
  if (existing) return existing;
  const config = runtime.allConfig();
  for (const key in config) {
    const value = config[key];
    delete config[key];
    const [prefix, real] = key.split(":");
    if (prefix !== "aws") continue;

    // Array and Object values are JSON encoded, ie.
    // {
    //   allowedAccountIds: '["112245769880"]',
    //   defaultTags: '{"tags":{"sst:app":"playground","sst:stage":"frank"}}',
    //   region: 'us-east-1'
    // }
    try {
      config[real] = JSON.parse(value);
    } catch (e) {
      config[real] = value;
    }
  }
  const provider = new Provider(`AwsProvider.sst.${region}`, {
    ...config,
    region,
  });
  cache.set(region, provider);
  return provider;
};
