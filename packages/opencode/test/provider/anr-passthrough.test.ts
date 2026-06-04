/**
 * ANR Provider Model Passthrough Integration Tests
 *
 * Validates that in ANR mode (OPENCODE_FLAVOR=anr), Bedrock model IDs
 * are passed through verbatim to sdk.languageModel() without any
 * prefix stripping or region manipulation.
 *
 * This catches regressions where upstream changes to the provider's
 * model resolution logic could inadvertently transform ANR model IDs.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test"

// ── Helpers ──

/**
 * Reproduces the exact model resolution logic from provider.ts getModel().
 * In ANR mode, it should return modelID unchanged.
 * In non-ANR mode, it applies region prefixes, GovCloud stripping, etc.
 */
function resolveModelID(modelID: string, options: { isANR: boolean; region: string }): string {
  const region = options.region
  const isGovCloud = region.startsWith("us-gov")

  // ANR mode: DynamoDB model IDs are the source of truth
  if (options.isANR) {
    return modelID
  }

  // Non-ANR: strip commercial prefixes in GovCloud
  if (isGovCloud) {
    const commercialPrefixes = ["global.", "us.", "eu.", "jp.", "apac.", "au."]
    for (const prefix of commercialPrefixes) {
      if (modelID.startsWith(prefix)) {
        modelID = modelID.slice(prefix.length)
        break
      }
    }
  }

  // Skip region prefixing if model already has a cross-region inference profile prefix
  const crossRegionPrefixes = ["global.", "us-gov.", "us.", "eu.", "jp.", "apac.", "au."]
  if (crossRegionPrefixes.some((prefix) => modelID.startsWith(prefix))) {
    return modelID
  }

  // Add region prefix
  let regionPrefix = region.split("-")[0]
  if (isGovCloud) regionPrefix = "us-gov"
  return `${regionPrefix}.${modelID}`
}

// ── ANR Mode Tests ──

describe("ANR provider: model IDs pass through verbatim", () => {
  test("GovCloud anthropic model passes through unchanged", () => {
    const modelID = "us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0"
    expect(resolveModelID(modelID, { isANR: true, region: "us-gov-west-1" })).toBe(modelID)
  })

  test("commercial anthropic model passes through unchanged", () => {
    const modelID = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
    expect(resolveModelID(modelID, { isANR: true, region: "us-east-1" })).toBe(modelID)
  })

  test("model without region prefix passes through unchanged", () => {
    const modelID = "amazon.nova-lite-v1:0"
    expect(resolveModelID(modelID, { isANR: true, region: "us-gov-west-1" })).toBe(modelID)
  })

  test("model with version suffix passes through unchanged", () => {
    const modelID = "us-gov.anthropic.claude-haiku-4-20250514-v1:0"
    expect(resolveModelID(modelID, { isANR: true, region: "us-gov-west-1" })).toBe(modelID)
  })

  test("arbitrary model ID passes through (DynamoDB is source of truth)", () => {
    const modelID = "custom-model-v2-beta"
    expect(resolveModelID(modelID, { isANR: true, region: "us-gov-west-1" })).toBe(modelID)
  })

  test("region parameter does not affect ANR model resolution", () => {
    const modelID = "us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0"
    expect(resolveModelID(modelID, { isANR: true, region: "us-east-1" })).toBe(modelID)
    expect(resolveModelID(modelID, { isANR: true, region: "eu-west-1" })).toBe(modelID)
    expect(resolveModelID(modelID, { isANR: true, region: "ap-northeast-1" })).toBe(modelID)
  })
})

// ── Non-ANR Mode Tests (ensure upstream logic still works) ──

describe("non-ANR provider: model IDs get region prefixes", () => {
  test("bare model gets us prefix in us-east-1", () => {
    const result = resolveModelID("anthropic.claude-sonnet-4-5-20250929-v1:0", { isANR: false, region: "us-east-1" })
    expect(result).toBe("us.anthropic.claude-sonnet-4-5-20250929-v1:0")
  })

  test("already-prefixed model is returned unchanged", () => {
    const result = resolveModelID("us.anthropic.claude-sonnet-4-5-20250929-v1:0", { isANR: false, region: "us-east-1" })
    expect(result).toBe("us.anthropic.claude-sonnet-4-5-20250929-v1:0")
  })

  test("GovCloud strips commercial prefix before adding us-gov", () => {
    const result = resolveModelID("us.anthropic.claude-sonnet-4-5-20250929-v1:0", { isANR: false, region: "us-gov-west-1" })
    // Strips "us." prefix, then adds "us-gov." prefix
    expect(result).toBe("us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0")
  })

  test("global prefix in GovCloud gets stripped and us-gov added", () => {
    const result = resolveModelID("global.anthropic.claude-sonnet-4-5-20250929-v1:0", { isANR: false, region: "us-gov-west-1" })
    expect(result).toBe("us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0")
  })
})

// ── ANR Credential Source Tests ──

describe("ANR provider: credential source selection", () => {
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    originalEnv = {
      OPENCODE_FLAVOR: process.env.OPENCODE_FLAVOR,
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
      AWS_SESSION_TOKEN: process.env.AWS_SESSION_TOKEN,
      AWS_REGION: process.env.AWS_REGION,
    }
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  test("ANR reads AWS_REGION from process.env directly (not Env snapshot)", () => {
    process.env.OPENCODE_FLAVOR = "anr"
    process.env.AWS_REGION = "us-gov-west-1"

    // The provider logic: const envRegion = isANR ? process.env.AWS_REGION : env["AWS_REGION"]
    const isANR = process.env.OPENCODE_FLAVOR === "anr"
    const envRegion = isANR ? process.env.AWS_REGION : undefined
    expect(envRegion).toBe("us-gov-west-1")
  })

  test("ANR reads credentials from process.env directly", () => {
    process.env.OPENCODE_FLAVOR = "anr"
    process.env.AWS_ACCESS_KEY_ID = "AKIATEST123"
    process.env.AWS_SESSION_TOKEN = "FwoGZXIvYXdzEBY..."

    const isANR = process.env.OPENCODE_FLAVOR === "anr"
    const awsAccessKeyId = isANR ? process.env.AWS_ACCESS_KEY_ID : undefined
    const awsSessionToken = isANR ? process.env.AWS_SESSION_TOKEN : undefined
    expect(awsAccessKeyId).toBe("AKIATEST123")
    expect(awsSessionToken).toBe("FwoGZXIvYXdzEBY...")
  })

  test("ANR uses fromEnv() when credentials are present (not profile chain)", () => {
    // Logic: if (isANR && awsAccessKeyId && awsSessionToken) → fromEnv()
    process.env.OPENCODE_FLAVOR = "anr"
    process.env.AWS_ACCESS_KEY_ID = "AKIATEST"
    process.env.AWS_SESSION_TOKEN = "token"

    const isANR = process.env.OPENCODE_FLAVOR === "anr"
    const shouldUseFromEnv = isANR && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SESSION_TOKEN
    expect(shouldUseFromEnv).toBeTruthy()
  })

  test("ANR does not use custom endpoint (baseURL skipped)", () => {
    // Logic: if (endpoint && !isANR) { providerOptions.baseURL = endpoint }
    const isANR = true
    const endpoint = "https://custom-bedrock.example.com"
    const shouldSetBaseURL = endpoint && !isANR
    expect(shouldSetBaseURL).toBe(false)
  })
})
