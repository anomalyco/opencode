import { ProviderResolver } from "../provider-resolver"

export const resolver = ProviderResolver.fixed("amazon-bedrock", "bedrock-converse")

export * as AmazonBedrock from "./amazon-bedrock"
