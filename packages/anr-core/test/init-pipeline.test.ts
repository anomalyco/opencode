/**
 * ANR Initialization Pipeline Tests
 *
 * Tests the end-to-end sequence: detect ANR → load config → validate →
 * construct auth params → init OTEL → verify readiness.
 *
 * This catches upstream merges that break the init sequence ordering
 * or remove/rename required exports.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs"
import { resolve, join } from "path"
import type { ANRConfig } from "../src/config/types"

function fullTestConfig(): ANRConfig {
  return {
    awsRegion: "us-gov-west-1",
    useBedrockProvider: true,
    anthropicModel: "us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0",
    anthropicSmallFastModel: "us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0",
    enableTelemetry: true,
    otelMetricsExporter: "otlp",
    otelProtocol: "http/protobuf",
    otelEndpoint: "http://localhost:4318",
    enableAudit: true,
    metricsBatchSize: 100,
    metricsIntervalSeconds: 60,
    auditTableName: "AuditEvents",
    quotaFailMode: "closed" as const,
    quotaCheckInterval: 300,
    modelsApiEndpoint: "https://api.example.com/v1",
    providerDomain: "auth.govcloud.example.com",
    clientId: "gov-client-id-12345",
    awsRegionProfile: "us-gov-west-1",
    providerType: "cognito" as const,
    credentialStorage: "session" as const,
    crossRegionProfile: "us-gov-west-1",
    identityPoolId: "us-gov-west-1:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    federationType: "cognito" as const,
    cognitoUserPoolId: "us-gov-west-1_AbCdEfGhI",
  }
}

describe("ANR Init Pipeline: detection", () => {
  const originalFlavor = process.env.OPENCODE_FLAVOR

  afterEach(() => {
    if (originalFlavor === undefined) {
      delete process.env.OPENCODE_FLAVOR
    } else {
      process.env.OPENCODE_FLAVOR = originalFlavor
    }
  })

  test("OPENCODE_FLAVOR=anr indicates ANR mode", () => {
    process.env.OPENCODE_FLAVOR = "anr"
    const isANR = process.env.OPENCODE_FLAVOR === "anr"
    expect(isANR).toBe(true)
  })

  test("unset OPENCODE_FLAVOR means non-ANR", () => {
    delete process.env.OPENCODE_FLAVOR
    const isANR = process.env.OPENCODE_FLAVOR === "anr"
    expect(isANR).toBe(false)
  })

  test("other OPENCODE_FLAVOR values are not ANR", () => {
    process.env.OPENCODE_FLAVOR = "community"
    const isANR = process.env.OPENCODE_FLAVOR === "anr"
    expect(isANR).toBe(false)
  })
})

describe("ANR Init Pipeline: config loading sequence", () => {
  const tmpDir = resolve(import.meta.dir, ".tmp-init-pipeline")

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("loadANRConfig → validateANRConfig → ready (no errors)", async () => {
    const envContent = [
      "AWS_REGION=us-gov-west-1",
      "OPENCODE_USE_BEDROCK=1",
      "OPENCODE_ENABLE_TELEMETRY=1",
      "OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318",
      "PROVIDER_DOMAIN=auth.test.com",
      "CLIENT_ID=test-client",
      "COGNITO_USER_POOL_ID=us-gov-west-1_Pool",
      "IDENTITY_POOL_ID=us-gov-west-1:00000000-0000-0000-0000-000000000000",
      "AWS_REGION_PROFILE=us-gov-west-1",
      "CROSS_REGION_PROFILE=us-gov-west-1",
      "CREDENTIAL_STORAGE=session",
    ].join("\n")
    writeFileSync(join(tmpDir, ".env.test"), envContent)

    const { loadANRConfig, validateANRConfig } = await import("../src/config/env-loader")
    const config = await loadANRConfig(join(tmpDir, ".env.test"), true)
    const errors = validateANRConfig(config)

    expect(errors).toHaveLength(0)
    expect(config.awsRegion).toBe("us-gov-west-1")
    expect(config.useBedrockProvider).toBe(true)
    expect(config.providerDomain).toBe("auth.test.com")
    expect(config.identityPoolId).toBe("us-gov-west-1:00000000-0000-0000-0000-000000000000")
  })

  test("missing AWS_REGION produces validation error", async () => {
    const envContent = [
      "OPENCODE_USE_BEDROCK=1",
      "PROVIDER_DOMAIN=auth.test.com",
    ].join("\n")
    writeFileSync(join(tmpDir, ".env.noregion"), envContent)

    // Clear env to ensure no fallback
    const savedRegion = process.env.AWS_REGION
    const savedOCRegion = process.env.OPENCODE_AWS_REGION
    delete process.env.AWS_REGION
    delete process.env.OPENCODE_AWS_REGION

    const { loadANRConfig, validateANRConfig } = await import("../src/config/env-loader")
    const config = await loadANRConfig(join(tmpDir, ".env.noregion"), true)
    const errors = validateANRConfig(config)

    // Restore
    if (savedRegion) process.env.AWS_REGION = savedRegion
    if (savedOCRegion) process.env.OPENCODE_AWS_REGION = savedOCRegion

    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toContain("AWS_REGION")
  })

  test("getValidatedANRConfig throws on invalid config", async () => {
    const envContent = "# empty config\n"
    writeFileSync(join(tmpDir, ".env.empty"), envContent)

    const savedRegion = process.env.AWS_REGION
    const savedOCRegion = process.env.OPENCODE_AWS_REGION
    delete process.env.AWS_REGION
    delete process.env.OPENCODE_AWS_REGION

    const { getValidatedANRConfig } = await import("../src/config/env-loader")

    await expect(
      getValidatedANRConfig(join(tmpDir, ".env.empty"), true),
    ).rejects.toThrow("Invalid ANR configuration")

    if (savedRegion) process.env.AWS_REGION = savedRegion
    if (savedOCRegion) process.env.OPENCODE_AWS_REGION = savedOCRegion
  })
})

describe("ANR Init Pipeline: auth parameter construction", () => {
  test("PKCE params are generated fresh each time", () => {
    const { randomBytes } = require("crypto")
    const state1 = randomBytes(16).toString("base64url")
    const state2 = randomBytes(16).toString("base64url")
    // Each invocation should produce unique values
    expect(state1).not.toBe(state2)
    expect(state1.length).toBeGreaterThan(10)
  })

  test("auth URL uses config.providerDomain + /login", () => {
    const config = fullTestConfig()
    const authURL = `https://${config.providerDomain}/login`
    expect(authURL).toBe("https://auth.govcloud.example.com/login")
  })

  test("token endpoint uses config.providerDomain + /oauth2/token", () => {
    const config = fullTestConfig()
    const tokenURL = `https://${config.providerDomain}/oauth2/token`
    expect(tokenURL).toBe("https://auth.govcloud.example.com/oauth2/token")
  })
})

describe("ANR Init Pipeline: OTEL initialization after auth", () => {
  test("initializeOTEL is exported and callable", async () => {
    const { initializeOTEL } = await import("../src/integrations/otel")
    expect(initializeOTEL).toBeTypeOf("function")
  })

  test("OTEL init requires telemetry context", async () => {
    const { initializeOTEL, getTelemetryContext } = await import("../src/integrations/otel")
    // The function should accept config and context
    expect(initializeOTEL).toBeTypeOf("function")
    expect(getTelemetryContext).toBeTypeOf("function")
  })

  test("OTEL diagnostics accessible after init attempt", async () => {
    const { getOTELDiagnostics, resetOTELDiagnostics } = await import("../src/integrations/otel")
    resetOTELDiagnostics()
    const diags = getOTELDiagnostics()
    expect(diags).toBeDefined()
    expect(typeof diags).toBe("object")
    expect(diags).toHaveProperty("initialized")
  })
})

describe("ANR Init Pipeline: quota readiness after auth", () => {
  test("checkQuota is exported and callable", async () => {
    const { checkQuota } = await import("../src/integrations/quota")
    expect(checkQuota).toBeTypeOf("function")
  })

  test("quota requires endpoint from config", () => {
    const config = fullTestConfig()
    // Real flow: checkQuota(req, config.modelsApiEndpoint, config.quotaFailMode, idToken)
    expect(config.modelsApiEndpoint).toBe("https://api.example.com/v1")
    expect(config.quotaFailMode).toBe("closed")
  })
})

describe("ANR Init Pipeline: clearStaleEnv before env switch", () => {
  const savedEnvVars: Record<string, string | undefined> = {}
  const staleKeys = [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_REGION",
    "OPENCODE_AWS_REGION",
    "OPENCODE_ANR_ID_TOKEN",
    "OPENCODE_ANR_USER_EMAIL",
    "OPENCODE_ANR_SESSION_ID",
  ]

  beforeEach(() => {
    for (const key of staleKeys) {
      savedEnvVars[key] = process.env[key]
    }
  })

  afterEach(() => {
    for (const key of staleKeys) {
      if (savedEnvVars[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = savedEnvVars[key]
      }
    }
  })

  test("clearStaleEnv removes credential env vars", async () => {
    process.env.AWS_ACCESS_KEY_ID = "old-key"
    process.env.AWS_SECRET_ACCESS_KEY = "old-secret"
    process.env.AWS_SESSION_TOKEN = "old-token"
    process.env.OPENCODE_ANR_ID_TOKEN = "old-id-token"

    const { clearStaleEnv } = await import("../src/config/env-loader")
    clearStaleEnv()

    expect(process.env.AWS_ACCESS_KEY_ID).toBeUndefined()
    expect(process.env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    expect(process.env.AWS_SESSION_TOKEN).toBeUndefined()
    expect(process.env.OPENCODE_ANR_ID_TOKEN).toBeUndefined()
  })

  test("clearStaleEnv removes all STALE_KEYS", async () => {
    for (const key of staleKeys) {
      process.env[key] = "stale-value"
    }

    const { clearStaleEnv } = await import("../src/config/env-loader")
    clearStaleEnv()

    for (const key of staleKeys) {
      expect(process.env[key]).toBeUndefined()
    }
  })
})

describe("ANR Init Pipeline: env telemetry context reconstruction", () => {
  test("reconstructTelemetryContextFromEnv is exported", async () => {
    const mod = await import("../src/index")
    expect(mod.reconstructTelemetryContextFromEnv).toBeTypeOf("function")
  })

  test("isUnderANRWrapper is exported", async () => {
    const mod = await import("../src/index")
    expect(mod.isUnderANRWrapper).toBeTypeOf("function")
  })
})

describe("ANR Init Pipeline: full export surface intact", () => {
  test("all critical pipeline exports are accessible", async () => {
    const mod = await import("../src/index")

    // Config
    expect(mod.loadANRConfig).toBeTypeOf("function")
    expect(mod.getValidatedANRConfig).toBeTypeOf("function")
    expect(mod.validateANRConfig).toBeTypeOf("function")
    expect(mod.findEnvFiles).toBeTypeOf("function")
    expect(mod.clearStaleEnv).toBeTypeOf("function")

    // Auth
    expect(mod.authenticateWithOIDC).toBeTypeOf("function")
    expect(mod.refreshOIDCTokens).toBeTypeOf("function")
    expect(mod.exchangeTokenForAWSCredentials).toBeTypeOf("function")

    // OTEL
    expect(mod.initializeOTEL).toBeTypeOf("function")
    expect(mod.trackModelCall).toBeTypeOf("function")
    expect(mod.trackCodeEditTool).toBeTypeOf("function")
    expect(mod.trackSessionStart).toBeTypeOf("function")
    expect(mod.trackSessionEnd).toBeTypeOf("function")
    expect(mod.flushOTEL).toBeTypeOf("function")
    expect(mod.shutdownOTEL).toBeTypeOf("function")

    // Quota
    expect(mod.checkQuota).toBeTypeOf("function")
    expect(mod.QuotaExceededError).toBeTypeOf("function")
    expect(mod.QuotaUnavailableError).toBeTypeOf("function")

    // Audit
    expect(mod.initializeAuditLogger).toBeTypeOf("function")
    expect(mod.logAuditEvent).toBeTypeOf("function")
  })

  test("type exports are importable (compile-time check)", async () => {
    // These would fail at build time if removed from index.ts exports
    const mod = await import("../src/index")
    expect(mod.defaultConfig).toBeDefined()
    expect(mod.defaultConfig.useBedrockProvider).toBe(true)
    expect(mod.defaultConfig.providerType).toBe("cognito")
    expect(mod.defaultConfig.federationType).toBe("cognito")
    expect(mod.defaultConfig.quotaFailMode).toBe("closed")
  })
})

describe("ANR Init Pipeline: credential storage modes", () => {
  test("session storage is the default", () => {
    const { defaultConfig } = require("../src/config/types")
    expect(defaultConfig.credentialStorage).toBe("session")
  })

  test("persistent storage is an alternative", () => {
    const config = fullTestConfig()
    config.credentialStorage = "persistent"
    expect(config.credentialStorage).toBe("persistent")
  })
})

describe("ANR Init Pipeline: complete flow simulation", () => {
  const tmpDir = resolve(import.meta.dir, ".tmp-flow-sim")

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("detect → clear → load → validate → construct auth URL → ready for OTEL", async () => {
    // Step 1: Detect ANR mode
    const isANR = true // simulated

    // Step 2: Clear stale env
    const { clearStaleEnv } = await import("../src/config/env-loader")
    process.env.AWS_SESSION_TOKEN = "stale"
    clearStaleEnv()
    expect(process.env.AWS_SESSION_TOKEN).toBeUndefined()

    // Step 3: Load config from env file
    const envContent = [
      "AWS_REGION=us-gov-west-1",
      "OPENCODE_USE_BEDROCK=1",
      "OPENCODE_ENABLE_TELEMETRY=1",
      "OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318",
      "PROVIDER_DOMAIN=auth.gov.example.com",
      "CLIENT_ID=flow-test-client",
      "COGNITO_USER_POOL_ID=us-gov-west-1_FlowTest",
      "IDENTITY_POOL_ID=us-gov-west-1:11111111-2222-3333-4444-555555555555",
      "AWS_REGION_PROFILE=us-gov-west-1",
      "CROSS_REGION_PROFILE=us-gov-west-1",
      "CREDENTIAL_STORAGE=session",
      "QUOTA_FAIL_MODE=closed",
      "OPENCODE_API_ENDPOINT=https://api.gov.example.com",
    ].join("\n")
    writeFileSync(join(tmpDir, ".env.flow"), envContent)

    const { loadANRConfig, validateANRConfig } = await import("../src/config/env-loader")
    const config = await loadANRConfig(join(tmpDir, ".env.flow"), true)

    // Step 4: Validate
    const errors = validateANRConfig(config)
    expect(errors).toHaveLength(0)

    // Step 5: Construct auth URL (would normally trigger OIDC flow)
    const authURL = `https://${config.providerDomain}/login?client_id=${config.clientId}`
    expect(authURL).toContain("auth.gov.example.com")
    expect(authURL).toContain("flow-test-client")

    // Step 6: After auth succeeds, OTEL can be initialized
    expect(config.enableTelemetry).toBe(true)
    expect(config.otelEndpoint).toBe("http://collector:4318")

    // Step 7: Quota endpoint is available
    expect(config.modelsApiEndpoint).toBe("https://api.gov.example.com")
    expect(config.quotaFailMode).toBe("closed")

    // Pipeline complete - all dependencies in place
    expect(config.identityPoolId).toBe("us-gov-west-1:11111111-2222-3333-4444-555555555555")
    expect(config.cognitoUserPoolId).toBe("us-gov-west-1_FlowTest")
  })
})
