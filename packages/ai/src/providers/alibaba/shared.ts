import type { AnyApi } from "../../api.js"
import type { ProviderPackage } from "../../provider-package.js"
import { Provider } from "../../provider.js"
import type { AtLeastOne } from "../../route/auth-options.js"
import { ProviderConfigurationError, ProviderID } from "../../schema/index.js"

export type Region =
  | "ap-southeast-1"
  | "cn-beijing"
  | "cn-hongkong"
  | "us-east-1"
  | "eu-central-1"
  | "ap-northeast-1"
  | (string & {})

export type Location = AtLeastOne<{
  readonly region: Region
  /** Overrides the selected API's complete base URL, including its version prefix. */
  readonly baseURL: string
}> & { readonly workspaceID?: string }

export type Settings<Options> = Location &
  ProviderPackage.Settings &
  Options & {
    readonly apiKey?: string | false
  }

export const id = ProviderID.make("alibaba")

export const env = ["DASHSCOPE_API_KEY", "ALIBABA_API_KEY"]

export const auth = Provider.apiKey(env)

const hosts = new Map<string, string>([
  ["ap-southeast-1", "dashscope-intl.aliyuncs.com"],
  ["cn-beijing", "dashscope.aliyuncs.com"],
  ["cn-hongkong", "cn-hongkong.dashscope.aliyuncs.com"],
  ["us-east-1", "dashscope-us.aliyuncs.com"],
])

/** The base URL one API is served from: `path` on the region's host, unless `baseURL` replaces it. */
export const baseURL = (location: Partial<Location>, path: string) => {
  if (location.baseURL !== undefined) return location.baseURL
  if (location.region === undefined)
    throw new ProviderConfigurationError({ provider: id, message: "Alibaba requires region or baseURL" })
  const host =
    location.workspaceID === undefined
      ? hosts.get(location.region)
      : `${location.workspaceID}.${location.region}.maas.aliyuncs.com`
  if (host === undefined)
    throw new ProviderConfigurationError({
      provider: id,
      message: `Alibaba region ${location.region} requires workspaceID or baseURL`,
    })
  return `https://${host}${path}`
}

export const paths = {
  compatible: "/compatible-mode/v1",
  anthropic: "/apps/anthropic/v1",
  media: "/api/v1",
}

/** A provider serving one API, with `region` and `workspaceID` read from flat settings. */
export const provider = <A extends AnyApi>(api: A, path: string) =>
  Provider.make({
    id,
    auth,
    apis: [api],
    settings: {
      keys: ["region", "workspaceID", "baseURL", "provider"],
      patch: (values: Partial<Location> & { readonly provider?: string }) => ({
        id: values.provider,
        baseURL: baseURL(values, path),
      }),
    },
  })
