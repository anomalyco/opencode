import { rpc } from "../../rpc/rpc";

interface BootstrapData {
  asset: string;
  assetEcrRegistryId: string;
  assetEcrUrl: string;
  state: string;
  appsyncHttp: string;
  appsyncRealtime: string;
}

export const bootstrap = {
  forRegion(region: string): Promise<BootstrapData> {
    return rpc.call("Provider.Aws.Bootstrap", { region });
  },
};
