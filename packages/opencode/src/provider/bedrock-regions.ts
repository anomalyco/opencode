/**
 * AWS Bedrock region configuration.
 * Maps model patterns to their available regions.
 */

export namespace BedrockRegions {
  /** Default region for Bedrock */
  export const DEFAULT_REGION = "us-east-1"

  /** Model-to-region mapping table */
  export const MODEL_REGIONS: Record<string, string[]> = {
    "anthropic.claude": ["us-east-1", "us-west-2", "eu-west-1", "ap-northeast-1"],
    "amazon.titan": ["us-east-1", "us-west-2"],
    "meta.llama": ["us-east-1", "us-west-2"],
    "ai21.jamba": ["us-east-1"],
    "cohere.command": ["us-east-1", "us-west-2"],
    "mistral.mistral": ["us-east-1", "eu-west-3"],
  }

  /** Get the best region for a model */
  export function getRegion(modelId: string, preferredRegion?: string): string {
    // Check if preferred region supports this model
    if (preferredRegion) {
      for (const [pattern, regions] of Object.entries(MODEL_REGIONS)) {
        if (modelId.startsWith(pattern) && regions.includes(preferredRegion)) {
          return preferredRegion
        }
      }
    }

    // Find first matching region
    for (const [pattern, regions] of Object.entries(MODEL_REGIONS)) {
      if (modelId.startsWith(pattern)) {
        return regions[0]
      }
    }

    return DEFAULT_REGION
  }

  /** Check if a model is available in a specific region */
  export function isAvailable(modelId: string, region: string): boolean {
    for (const [pattern, regions] of Object.entries(MODEL_REGIONS)) {
      if (modelId.startsWith(pattern)) {
        return regions.includes(region)
      }
    }
    return false
  }
}
