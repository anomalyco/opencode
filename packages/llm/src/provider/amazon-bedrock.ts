import { ProviderRoute } from "../provider-route"

export const provider = ProviderRoute.fixed("amazon-bedrock", "bedrock-converse")

export * as AmazonBedrock from "./amazon-bedrock"
