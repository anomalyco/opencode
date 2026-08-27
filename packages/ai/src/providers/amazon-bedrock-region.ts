import { AIError, InvalidRequestReason } from "../schema/errors.js"

export const resolve = (region?: string, credentialRegion?: string) =>
  (region ?? credentialRegion ?? process.env.AWS_REGION)?.trim()

export const require = (region: string | undefined, provider: string) => {
  if (region) return region
  throw new AIError({
    module: provider,
    method: "configure",
    reason: new InvalidRequestReason({
      parameter: "region",
      message: `${provider} requires an AWS region. Set region or AWS_REGION.`,
    }),
  })
}

export * as BedrockRegion from "./amazon-bedrock-region.js"
