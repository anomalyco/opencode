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
import { existsSync } from "fs"
import { resolve } from "path"

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
