/**
 * ANR Integration Validation Test Suite
 *
 * This is the top-level test that validates the complete ANR integration
 * is properly wired after upstream syncs. It checks:
 *
 * 1. All ANR exports are accessible and typed correctly
 * 2. The integration points in packages/opencode are intact
 * 3. Config → Auth → OTEL → Quota → Audit pipeline is connected
 *
 * Run: bun test test/integration.test.ts
 */
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs"
import { resolve } from "path"
import { findEnvFiles, loadANRConfig, validateANRConfig } from "../src/config/env-loader"

const OPENCODE_SRC = resolve(import.meta.dir, "../../opencode/src")
const ANR_CORE_SRC = resolve(import.meta.dir, "../src")

describe("ANR exports are intact", () => {
  test("anr-core barrel exports all required modules", async () => {
    const mod = await import("../src/index")
    // Config
    expect(mod.defaultConfig).toBeDefined()
    expect(mod.loadANRConfig).toBeTypeOf("function")
    expect(mod.validateANRConfig).toBeTypeOf("function")
    expect(mod.findEnvFiles).toBeTypeOf("function")
    expect(mod.saveLastEnv).toBeTypeOf("function")
    expect(mod.getLastEnv).toBeTypeOf("function")

    // Auth
    expect(mod.authenticateWithOIDC).toBeTypeOf("function")
    expect(mod.refreshOIDCTokens).toBeTypeOf("function")
    expect(mod.exchangeTokenForAWSCredentials).toBeTypeOf("function")

    // OTEL
    expect(mod.initializeOTEL).toBeTypeOf("function")
    expect(mod.trackModelCall).toBeTypeOf("function")
    expect(mod.trackSessionStart).toBeTypeOf("function")
    expect(mod.trackSessionEnd).toBeTypeOf("function")
    expect(mod.trackLinesOfCode).toBeTypeOf("function")
    expect(mod.trackCodeEditTool).toBeTypeOf("function")
    expect(mod.trackCodeEditDecision).toBeTypeOf("function")
    expect(mod.trackCommit).toBeTypeOf("function")
    expect(mod.trackActiveTime).toBeTypeOf("function")
    expect(mod.flushOTEL).toBeTypeOf("function")
    expect(mod.shutdownOTEL).toBeTypeOf("function")
    expect(mod.getTelemetryContext).toBeTypeOf("function")
    expect(mod.getMeter).toBeTypeOf("function")

    // Quota
    expect(mod.checkQuota).toBeTypeOf("function")
    expect(mod.QuotaExceededError).toBeTypeOf("function")
    expect(mod.QuotaUnavailableError).toBeTypeOf("function")
    expect(mod.dailyResetInfo).toBeTypeOf("function")
    expect(mod.monthlyResetInfo).toBeTypeOf("function")

    // Audit
    expect(mod.initializeAuditLogger).toBeTypeOf("function")
    expect(mod.logAuthEvent).toBeTypeOf("function")
    expect(mod.logSessionStart).toBeTypeOf("function")
    expect(mod.logTokenUsage).toBeTypeOf("function")
    expect(mod.logQuotaCheck).toBeTypeOf("function")

    // Env telemetry
    expect(mod.reconstructTelemetryContextFromEnv).toBeTypeOf("function")
  })
})

describe("integration points exist in opencode package", () => {
  const requiredFiles = [
    "index.ts",                        // Main ANR init, detectANR, selectEnvFile
    "auth/anr-refresh.ts",             // Credential refresh module
    "session/processor.ts",            // Session hooks for tracking
    "provider/provider.ts",            // Model ID passthrough
    "cli/cmd/tui/worker.ts",           // Worker OTEL re-init
    "cli/cmd/tui/context/quota.tsx",   // Quota TUI display
    "cli/cmd/debug/otel.ts",           // Debug commands
  ]

  for (const file of requiredFiles) {
    test(`${file} exists`, () => {
      expect(existsSync(resolve(OPENCODE_SRC, file))).toBe(true)
    })
  }
})

describe("anr-core source files exist", () => {
  const requiredFiles = [
    "index.ts",
    "config/types.ts",
    "config/env-loader.ts",
    "integrations/oidc-auth.ts",
    "integrations/aws-federation.ts",
    "integrations/otel.ts",
    "integrations/quota.ts",
    "integrations/env-telemetry.ts",
    "middleware/audit-logger.ts",
    "util/debug-logger.ts",
  ]

  for (const file of requiredFiles) {
    test(`${file} exists`, () => {
      expect(existsSync(resolve(ANR_CORE_SRC, file))).toBe(true)
    })
  }
})

describe("critical code patterns are present", () => {
  test("index.ts contains detectANR function", async () => {
    const content = await Bun.file(resolve(OPENCODE_SRC, "index.ts")).text()
    expect(content).toContain("function detectANR()")
    expect(content).toContain("OPENCODE_FLAVOR")
    expect(content).toContain("authenticateWithOIDC")
    expect(content).toContain("exchangeTokenForAWSCredentials")
    expect(content).toContain("initializeOTEL")
    expect(content).toContain("initializeAuditLogger")
    expect(content).toContain("checkQuota")
    expect(content).toContain("ANRRefresh.init")
  })

  test("processor.ts contains all tracking hooks", async () => {
    const content = await Bun.file(resolve(OPENCODE_SRC, "session/processor.ts")).text()
    expect(content).toContain("trackModelCall")
    expect(content).toContain("logTokenUsage")
    expect(content).toContain("trackLinesOfCode")
    expect(content).toContain("trackCodeEditTool")
    expect(content).toContain("trackCodeEditDecision")
    expect(content).toContain("trackCommit")
    expect(content).toContain("trackActiveTime")
    expect(content).toContain("checkQuota")
    expect(content).toContain("refreshANRCredentials")
    expect(content).toContain("isExpiredTokenError")
  })

  test("provider.ts passes model IDs verbatim in ANR mode", async () => {
    const content = await Bun.file(resolve(OPENCODE_SRC, "provider/provider.ts")).text()
    expect(content).toContain("if (isANR)")
    expect(content).toContain("sdk.languageModel(modelID)")
  })

  test("worker.ts re-initializes OTEL in worker process", async () => {
    const content = await Bun.file(resolve(OPENCODE_SRC, "cli/cmd/tui/worker.ts")).text()
    expect(content).toContain("initializeOTEL")
    expect(content).toContain("reconstructTelemetryContextFromEnv")
    expect(content).toContain("OPENCODE_ENABLE_TELEMETRY")
  })

  test("anr-refresh.ts exports required interface", async () => {
    const content = await Bun.file(resolve(OPENCODE_SRC, "auth/anr-refresh.ts")).text()
    expect(content).toContain("export function init")
    expect(content).toContain("export async function refresh")
    expect(content).toContain("export function expired")
    expect(content).toContain("export function onRefresh")
  })
})

describe("env files exist for both environments", () => {
  const ROOT = resolve(import.meta.dir, "../../..")

  test(".env.eikon (GovCloud) exists", () => {
    expect(existsSync(resolve(ROOT, ".opencode/.env.eikon"))).toBe(true)
  })

  test(".env.commercial exists", () => {
    expect(existsSync(resolve(ROOT, ".opencode/.env.commercial"))).toBe(true)
  })
})

// ── Wired Pipeline Tests ──

describe("wired pipeline: config → OTEL init → track → verify", () => {
  test("full pipeline: validate config, init OTEL, track metric, verify diagnostics", async () => {
    const { initializeOTEL, trackModelCall, getOTELDiagnostics, resetOTELDiagnostics } = await import("../src/integrations/otel")

    // Step 1: Validate a config
    const config = {
      awsRegion: "us-gov-west-1",
      useBedrockProvider: true,
      anthropicModel: "us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0",
      anthropicSmallFastModel: "us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0",
      enableTelemetry: true,
      otelMetricsExporter: "otlp",
      otelProtocol: "http/protobuf",
      otelEndpoint: "http://localhost:4318",
      enableAudit: false,
      metricsBatchSize: 100,
      metricsIntervalSeconds: 60,
      auditTableName: "AuditEvents",
      quotaFailMode: "closed" as const,
      quotaCheckInterval: 300,
      modelsApiEndpoint: "https://api.example.com",
      providerDomain: "auth.example.com",
      clientId: "test-client",
    }
    const errors = validateANRConfig(config)
    expect(errors).toHaveLength(0)

    // Step 2: Init OTEL with validated config
    initializeOTEL(config, {
      userId: "pipeline-test-user",
      sessionId: "pipeline-test-session",
      userEmail: "test@gov.example.com",
    })
    resetOTELDiagnostics()

    // Step 3: Track a model call (simulates step-finish handler)
    trackModelCall("us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0", 500, 200, 0, 100, 0, {
      userId: "pipeline-test-user",
      sessionId: "pipeline-test-session",
      userEmail: "test@gov.example.com",
      department: "engineering",
      teamId: "team-1",
      organization: "test-org",
    }, 0.005)

    // Step 4: Verify diagnostics show the tracked call
    const diags = getOTELDiagnostics()
    expect(diags.initialized).toBe(true)
    expect(diags.metrics.modelCallsTracked).toBe(1)
    expect(diags.metrics.tokensTracked).toBe(800) // 500 input + 200 output + 100 cache_read
    expect(diags.metrics.contextAvailableCalls).toBe(1)
  })

  test("full pipeline: track multiple tool edits and verify cumulative diagnostics", async () => {
    const { initializeOTEL, trackLinesOfCode, trackCodeEditTool, trackCodeEditDecision, getOTELDiagnostics, resetOTELDiagnostics } = await import("../src/integrations/otel")

    initializeOTEL({
      awsRegion: "us-gov-west-1",
      useBedrockProvider: true,
      anthropicModel: "test",
      anthropicSmallFastModel: "test",
      enableTelemetry: true,
      otelMetricsExporter: "otlp",
      otelProtocol: "http/protobuf",
      otelEndpoint: "http://localhost:4318",
      enableAudit: false,
      metricsBatchSize: 100,
      metricsIntervalSeconds: 60,
      auditTableName: "AuditEvents",
      quotaFailMode: "closed" as const,
      quotaCheckInterval: 300,
      modelsApiEndpoint: "https://api.example.com",
      providerDomain: "auth.example.com",
      clientId: "test-client",
    }, {
      userId: "pipeline-user",
      sessionId: "pipeline-session",
      userEmail: "test@gov.example.com",
    })
    resetOTELDiagnostics()

    // Simulate 3 edit tool calls
    for (let i = 0; i < 3; i++) {
      trackLinesOfCode(10, "added", "typescript")
      trackLinesOfCode(5, "removed", "typescript")
      trackCodeEditTool("edit", "typescript", true)
      trackCodeEditDecision("accepted", "typescript")
    }

    // These don't go through the modelCallsTracked counter, they use their own metrics
    // But they should not throw
    const diags = getOTELDiagnostics()
    expect(diags.initialized).toBe(true)
  })
})

describe("wired pipeline: env file discovery → config load → validate", () => {
  const TMP = resolve(import.meta.dir, ".tmp-pipeline-test")

  test("discover multiple env files, load each, validate", async () => {
    // Setup: create two env files
    rmSync(TMP, { recursive: true, force: true })
    mkdirSync(resolve(TMP, ".opencode"), { recursive: true })
    writeFileSync(resolve(TMP, ".opencode/.env.govcloud"), [
      "AWS_REGION=us-gov-west-1",
      "OPENCODE_AWS_REGION=us-gov-west-1",
      "OPENCODE_USE_BEDROCK=1",
      "ANTHROPIC_MODEL=us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0",
      "ANTHROPIC_SMALL_FAST_MODEL=us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0",
      "OPENCODE_ENABLE_TELEMETRY=1",
      "OTEL_METRICS_EXPORTER=otlp",
      "OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf",
      "OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.gov.example.com",
      "OPENCODE_ENABLE_AUDIT=0",
      "AUDIT_TABLE_NAME=AuditEvents",
      "OPENCODE_API_ENDPOINT=https://api.gov.example.com",
      "PROVIDER_DOMAIN=auth.gov.example.com",
      "CLIENT_ID=govcloud-client",
    ].join("\n"))
    writeFileSync(resolve(TMP, ".opencode/.env.commercial"), [
      "AWS_REGION=us-east-1",
      "OPENCODE_AWS_REGION=us-east-1",
      "OPENCODE_USE_BEDROCK=1",
      "ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0",
      "ANTHROPIC_SMALL_FAST_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0",
      "OPENCODE_ENABLE_TELEMETRY=1",
      "OTEL_METRICS_EXPORTER=otlp",
      "OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf",
      "OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.commercial.example.com",
      "OPENCODE_ENABLE_AUDIT=0",
      "AUDIT_TABLE_NAME=AuditEvents",
      "OPENCODE_API_ENDPOINT=https://api.commercial.example.com",
      "PROVIDER_DOMAIN=auth.commercial.example.com",
      "CLIENT_ID=commercial-client",
    ].join("\n"))

    try {
      // Step 1: Discover env files (returns EnvFileInfo[] with .path, .name, .display)
      const files = findEnvFiles([resolve(TMP, ".opencode")])
      expect(files.length).toBeGreaterThanOrEqual(2)

      // Step 2: Load each by path and validate
      for (const file of files) {
        const config = await loadANRConfig(file.path)
        const errors = validateANRConfig(config)
        expect(errors).toHaveLength(0)
        expect(config.awsRegion).toBeDefined()
        expect(config.useBedrockProvider).toBe(true)
        expect(config.enableTelemetry).toBe(true)
      }

      // Step 3: Verify different environments have different configs
      const govConfig = await loadANRConfig(resolve(TMP, ".opencode/.env.govcloud"))
      const comConfig = await loadANRConfig(resolve(TMP, ".opencode/.env.commercial"))
      expect(govConfig.awsRegion).toBe("us-gov-west-1")
      expect(comConfig.awsRegion).toBe("us-east-1")
      expect(govConfig.otelEndpoint).toContain("gov")
      expect(comConfig.otelEndpoint).toContain("commercial")
    } finally {
      rmSync(TMP, { recursive: true, force: true })
    }
  })

  test("single env file scenario (no picker needed)", async () => {
    rmSync(TMP, { recursive: true, force: true })
    mkdirSync(resolve(TMP, ".opencode"), { recursive: true })
    writeFileSync(resolve(TMP, ".opencode/.env.single"), [
      "AWS_REGION=us-gov-west-1",
      "OPENCODE_AWS_REGION=us-gov-west-1",
      "OPENCODE_USE_BEDROCK=1",
      "ANTHROPIC_MODEL=us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0",
      "ANTHROPIC_SMALL_FAST_MODEL=us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0",
      "OPENCODE_ENABLE_TELEMETRY=1",
      "OTEL_METRICS_EXPORTER=otlp",
      "OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf",
      "OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.example.com",
      "OPENCODE_ENABLE_AUDIT=0",
      "AUDIT_TABLE_NAME=AuditEvents",
      "OPENCODE_API_ENDPOINT=https://api.example.com",
      "PROVIDER_DOMAIN=auth.example.com",
      "CLIENT_ID=test-client",
    ].join("\n"))

    try {
      const files = findEnvFiles([resolve(TMP, ".opencode")])
      expect(files.length).toBe(1)
      // When only one env exists, no picker is needed — auto-select
      const config = await loadANRConfig(files[0].path)
      expect(config.awsRegion).toBe("us-gov-west-1")
    } finally {
      rmSync(TMP, { recursive: true, force: true })
    }
  })
})
