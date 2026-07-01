/**
 * ANR Environment Loader Tests
 *
 * Validates:
 * - .env file discovery across multiple directories
 * - Config parsing from env files
 * - Config validation (required fields)
 * - Last-used env persistence
 * - Multi-env scenarios (single file, multiple files)
 * - Stale env cleanup
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs"
import { join, resolve } from "path"
import { findEnvFiles, loadANRConfig, validateANRConfig, saveLastEnv, getLastEnv, clearStaleEnv } from "../src/config/env-loader"

const TMP = resolve(import.meta.dir, ".tmp-env-test")
const HOME_BACKUP = process.env.HOME

function setupTmpDir() {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(join(TMP, "project/.opencode"), { recursive: true })
  mkdirSync(join(TMP, "home/.opencode"), { recursive: true })
  mkdirSync(join(TMP, "global"), { recursive: true })
}

function writeEnv(dir: string, name: string, content: string) {
  writeFileSync(join(dir, name), content)
}

const GOVCLOUD_ENV = `
OPENCODE_AWS_REGION=us-gov-west-1
OPENCODE_USE_BEDROCK=1
ANTHROPIC_MODEL=us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0
ANTHROPIC_SMALL_FAST_MODEL=us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0
OPENCODE_ENABLE_TELEMETRY=1
OTEL_METRICS_EXPORTER=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel-collector.example.com
OPENCODE_ENABLE_AUDIT=1
AUDIT_TABLE_NAME=AuditEvents
OPENCODE_API_ENDPOINT=https://api.example.com
PROVIDER_DOMAIN=auth.example.com
CLIENT_ID=test-client-id
AWS_REGION_PROFILE=us-gov-west-1
PROVIDER_TYPE=cognito
CREDENTIAL_STORAGE=session
CROSS_REGION_PROFILE=us-gov-west-1
IDENTITY_POOL_ID=us-gov-west-1:12345678-1234-1234-1234-123456789012
FEDERATION_TYPE=cognito
COGNITO_USER_POOL_ID=us-gov-west-1_testpool
`.trim()

const COMMERCIAL_ENV = `
OPENCODE_AWS_REGION=us-east-2
OPENCODE_USE_BEDROCK=1
ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0
ANTHROPIC_SMALL_FAST_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0
OPENCODE_ENABLE_TELEMETRY=1
OTEL_METRICS_EXPORTER=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel-commercial.example.com
OPENCODE_ENABLE_AUDIT=1
AUDIT_TABLE_NAME=AuditEvents
OPENCODE_API_ENDPOINT=https://api-commercial.example.com
PROVIDER_DOMAIN=auth-commercial.example.com
CLIENT_ID=commercial-client-id
AWS_REGION_PROFILE=us-east-2
PROVIDER_TYPE=cognito
CREDENTIAL_STORAGE=session
CROSS_REGION_PROFILE=us-east-2
IDENTITY_POOL_ID=us-east-2:87654321-4321-4321-4321-210987654321
FEDERATION_TYPE=cognito
COGNITO_USER_POOL_ID=us-east-2_commercialpool
`.trim()

beforeEach(setupTmpDir)
afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
  process.env.HOME = HOME_BACKUP
})

describe("findEnvFiles", () => {
  test("discovers .env.* files in a single directory", () => {
    const dir = join(TMP, "project/.opencode")
    writeEnv(dir, ".env.govcloud", GOVCLOUD_ENV)
    writeEnv(dir, ".env.commercial", COMMERCIAL_ENV)

    const files = findEnvFiles([dir])
    expect(files.length).toBe(2)
    expect(files.map((f) => f.name).sort()).toEqual(["commercial", "govcloud"])
  })

  test("discovers files across multiple directories", () => {
    writeEnv(join(TMP, "project/.opencode"), ".env.govcloud", GOVCLOUD_ENV)
    writeEnv(join(TMP, "home/.opencode"), ".env.commercial", COMMERCIAL_ENV)

    const files = findEnvFiles([
      join(TMP, "project/.opencode"),
      join(TMP, "home/.opencode"),
    ])
    expect(files.length).toBe(2)
  })

  test("deduplicates files found in multiple directories", () => {
    writeEnv(join(TMP, "project/.opencode"), ".env.govcloud", GOVCLOUD_ENV)
    writeEnv(join(TMP, "home/.opencode"), ".env.govcloud", GOVCLOUD_ENV)

    const files = findEnvFiles([
      join(TMP, "project/.opencode"),
      join(TMP, "home/.opencode"),
    ])
    // Should find both since they're different paths
    expect(files.length).toBe(2)
  })

  test("returns empty array when no .env files exist", () => {
    const files = findEnvFiles([join(TMP, "project/.opencode")])
    expect(files.length).toBe(0)
  })

  test("ignores non-existent directories", () => {
    const files = findEnvFiles(["/nonexistent/path/that/does/not/exist"])
    expect(files.length).toBe(0)
  })

  test("ignores plain .env file (only .env.* patterns)", () => {
    writeEnv(join(TMP, "project/.opencode"), ".env", GOVCLOUD_ENV)
    const files = findEnvFiles([join(TMP, "project/.opencode")])
    // .env without suffix should not be picked up
    expect(files.length).toBe(0)
  })
})

describe("loadANRConfig", () => {
  // loadANRConfig() loads env files into the shared process.env and never
  // unsets keys. Without clearing between tests, a prior fixture (e.g. GovCloud)
  // leaks AWS_REGION/OPENCODE_AWS_REGION into the next test, so the commercial
  // case reads a stale region. Clear stale keys before each case so every test
  // observes only its own fixture. (Also guards against the runner's ambient
  // AWS_REGION on developer machines.)
  beforeEach(() => {
    clearStaleEnv()
  })

  test("parses GovCloud env file correctly", async () => {
    const envPath = join(TMP, "project/.opencode/.env.govcloud")
    writeEnv(join(TMP, "project/.opencode"), ".env.govcloud", GOVCLOUD_ENV)

    const config = await loadANRConfig(envPath, true)
    expect(config.awsRegion).toBe("us-gov-west-1")
    expect(config.useBedrockProvider).toBe(true)
    expect(config.anthropicModel).toBe("us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0")
    expect(config.enableTelemetry).toBe(true)
    expect(config.otelEndpoint).toBe("https://otel-collector.example.com")
    expect(config.auditTableName).toBe("AuditEvents")
    expect(config.identityPoolId).toBe("us-gov-west-1:12345678-1234-1234-1234-123456789012")
    expect(config.cognitoUserPoolId).toBe("us-gov-west-1_testpool")
    expect(config.providerDomain).toBe("auth.example.com")
    expect(config.modelsApiEndpoint).toBe("https://api.example.com")
  })

  test("parses commercial env file correctly", async () => {
    const envPath = join(TMP, "project/.opencode/.env.commercial")
    writeEnv(join(TMP, "project/.opencode"), ".env.commercial", COMMERCIAL_ENV)

    const config = await loadANRConfig(envPath, true)
    expect(config.awsRegion).toBe("us-east-2")
    expect(config.anthropicModel).toBe("us.anthropic.claude-sonnet-4-5-20250929-v1:0")
    expect(config.identityPoolId).toBe("us-east-2:87654321-4321-4321-4321-210987654321")
    expect(config.cognitoUserPoolId).toBe("us-east-2_commercialpool")
  })

  test("applies default values for missing optional fields", async () => {
    const minimal = `
OPENCODE_AWS_REGION=us-east-1
USE_BEDROCK_PROVIDER=true
ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0
ANTHROPIC_SMALL_FAST_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0
OPENCODE_API_ENDPOINT=https://api.example.com
PROVIDER_DOMAIN=auth.example.com
CLIENT_ID=test-id
IDENTITY_POOL_ID=us-east-1:test
COGNITO_USER_POOL_ID=us-east-1_pool
`.trim()
    const envPath = join(TMP, "project/.opencode/.env.minimal")
    writeEnv(join(TMP, "project/.opencode"), ".env.minimal", minimal)

    const config = await loadANRConfig(envPath, true)
    expect(config.metricsBatchSize).toBe(100)
    expect(config.metricsIntervalSeconds).toBe(60)
    expect(config.quotaFailMode).toBe("closed")
    expect(config.providerType).toBe("cognito")
    expect(config.credentialStorage).toBe("session")
    expect(config.federationType).toBe("cognito")
  })
})

describe("validateANRConfig", () => {
  test("returns no errors for valid GovCloud config", async () => {
    const envPath = join(TMP, "project/.opencode/.env.govcloud")
    writeEnv(join(TMP, "project/.opencode"), ".env.govcloud", GOVCLOUD_ENV)
    const config = await loadANRConfig(envPath, true)
    const errors = validateANRConfig(config)
    expect(errors).toEqual([])
  })

  test("returns no errors for valid commercial config", async () => {
    const envPath = join(TMP, "project/.opencode/.env.commercial")
    writeEnv(join(TMP, "project/.opencode"), ".env.commercial", COMMERCIAL_ENV)
    const config = await loadANRConfig(envPath, true)
    const errors = validateANRConfig(config)
    expect(errors).toEqual([])
  })

  test("returns errors for missing required fields", async () => {
    // Config with no AWS region at all
    const incomplete = `
OPENCODE_USE_BEDROCK=1
ANTHROPIC_MODEL=test
`.trim()
    const envPath = join(TMP, "project/.opencode/.env.incomplete")
    writeEnv(join(TMP, "project/.opencode"), ".env.incomplete", incomplete)
    // Clear any AWS_REGION from process.env to ensure validation catches it
    const savedRegion = process.env.AWS_REGION
    const savedOCRegion = process.env.OPENCODE_AWS_REGION
    delete process.env.AWS_REGION
    delete process.env.OPENCODE_AWS_REGION
    const config = await loadANRConfig(envPath, true)
    const errors = validateANRConfig(config)
    process.env.AWS_REGION = savedRegion
    process.env.OPENCODE_AWS_REGION = savedOCRegion
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe("last-env persistence", () => {
  test("saves and retrieves last used env path", () => {
    const envPath = "/some/path/.env.govcloud"
    saveLastEnv(envPath)
    expect(getLastEnv()).toBe(envPath)
  })

  test("clearStaleEnv clears stale env vars from process.env", () => {
    process.env.AWS_ACCESS_KEY_ID = "old-key"
    process.env.AWS_SECRET_ACCESS_KEY = "old-secret"
    clearStaleEnv()
    expect(process.env.AWS_ACCESS_KEY_ID).toBeUndefined()
    expect(process.env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
  })
})
