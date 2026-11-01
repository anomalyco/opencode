import { Struct } from "effect"
import type { Config, Settings } from "./alibaba.js"

export function config(input: Settings<Config["providerOptions"]>) {
  const { body, ...rest } = input
  return {
    ...rest,
    http: body === undefined ? undefined : { body },
    providerOptions: Struct.omit(rest, ["apiKey", "baseURL", "headers", "region", "workspaceID"]),
  }
}
