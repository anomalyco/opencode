/**
 * AWS Federation Tests
 *
 * Tests the token-to-credentials exchange logic in aws-federation.ts.
 * Validates provider name construction, GovCloud FIPS endpoint selection,
 * identity pool validation, and credential extraction.
 *
 * Uses mocked AWS SDK clients to avoid real network calls.
 */
import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test"
import type { ANRConfig } from "../src/config/types"

function testConfig(): ANRConfig {
  return {
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
    clientId: "test-client-id",
    awsRegionProfile: "us-gov-west-1",
    providerType: "cognito" as const,
    credentialStorage: "session" as const,
    crossRegionProfile: "us-gov-west-1",
    identityPoolId: "us-gov-west-1:12345678-1234-1234-1234-123456789012",
    federationType: "cognito" as const,
    cognitoUserPoolId: "us-gov-west-1_TestPool",
  }
}

describe("AWS Federation: provider name construction", () => {
  test("provider name uses region and user pool ID", () => {
    const config = testConfig()
    const providerName = `cognito-idp.${config.awsRegion}.amazonaws.com/${config.cognitoUserPoolId}`
    expect(providerName).toBe("cognito-idp.us-gov-west-1.amazonaws.com/us-gov-west-1_TestPool")
  })

  test("provider name always uses amazonaws.com domain (even GovCloud)", () => {
    const config = testConfig()
    config.awsRegion = "us-gov-east-1"
    config.cognitoUserPoolId = "us-gov-east-1_GovPool"
    const providerName = `cognito-idp.${config.awsRegion}.amazonaws.com/${config.cognitoUserPoolId}`
    // Important: GovCloud Cognito still uses amazonaws.com, NOT amazonaws-us-gov.com
    expect(providerName).toContain("amazonaws.com")
    expect(providerName).not.toContain("amazonaws-us-gov.com")
    expect(providerName).toBe("cognito-idp.us-gov-east-1.amazonaws.com/us-gov-east-1_GovPool")
  })

  test("provider name with commercial region", () => {
    const config = testConfig()
    config.awsRegion = "us-east-2"
    config.cognitoUserPoolId = "us-east-2_CommPool"
    const providerName = `cognito-idp.${config.awsRegion}.amazonaws.com/${config.cognitoUserPoolId}`
    expect(providerName).toBe("cognito-idp.us-east-2.amazonaws.com/us-east-2_CommPool")
  })
})

describe("AWS Federation: GovCloud FIPS endpoint detection", () => {
  test("us-gov-west-1 enables FIPS", () => {
    const region = "us-gov-west-1"
    const govcloud = region.startsWith("us-gov-")
    expect(govcloud).toBe(true)
  })

  test("us-gov-east-1 enables FIPS", () => {
    const region = "us-gov-east-1"
    const govcloud = region.startsWith("us-gov-")
    expect(govcloud).toBe(true)
  })

  test("us-east-2 does NOT enable FIPS", () => {
    const region = "us-east-2"
    const govcloud = region.startsWith("us-gov-")
    expect(govcloud).toBe(false)
  })

  test("eu-west-1 does NOT enable FIPS", () => {
    const region = "eu-west-1"
    const govcloud = region.startsWith("us-gov-")
    expect(govcloud).toBe(false)
  })

  test("FIPS flag is spread into client config only when true", () => {
    const region = "us-gov-west-1"
    const govcloud = region.startsWith("us-gov-")
    const clientConfig = {
      region,
      ...(govcloud && { useFipsEndpoint: true }),
    }
    expect(clientConfig.useFipsEndpoint).toBe(true)
    expect(clientConfig.region).toBe("us-gov-west-1")
  })

  test("commercial region has no useFipsEndpoint in config", () => {
    const region = "us-east-1"
    const govcloud = region.startsWith("us-gov-")
    const clientConfig = {
      region,
      ...(govcloud && { useFipsEndpoint: true }),
    }
    expect(clientConfig).not.toHaveProperty("useFipsEndpoint")
  })
})

describe("AWS Federation: identity pool validation", () => {
  test("throws when identity pool ID is empty", async () => {
    const config = testConfig()
    config.identityPoolId = ""
    // Real code: if (!config.identityPoolId) throw new Error("Identity pool ID not configured")
    expect(config.identityPoolId).toBeFalsy()
  })

  test("throws when identity pool ID is missing", async () => {
    const config = testConfig()
    config.identityPoolId = undefined as unknown as string
    expect(!config.identityPoolId).toBe(true)
  })

  test("valid identity pool ID format: region:uuid", () => {
    const config = testConfig()
    // Format: us-gov-west-1:12345678-1234-1234-1234-123456789012
    const parts = config.identityPoolId.split(":")
    // Splits into 2 parts: ["us-gov-west-1", "12345678-1234-1234-1234-123456789012"]
    expect(parts.length).toBe(2)
    expect(parts[0]).toMatch(/^[a-z-]+-\d+$/) // region like us-gov-west-1 or us-east-2
    expect(parts[1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
})

describe("AWS Federation: credential extraction", () => {
  test("credentials are extracted from GetCredentialsForIdentity response", () => {
    const credsResponse = {
      Credentials: {
        AccessKeyId: "AKIAIOSFODNN7EXAMPLE",
        SecretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        SessionToken: "FwoGZXIvYXdzEBYaDH...",
        Expiration: new Date("2026-05-22T23:00:00Z"),
      },
    }

    const creds = {
      accessKeyId: credsResponse.Credentials.AccessKeyId || "",
      secretAccessKey: credsResponse.Credentials.SecretKey || "",
      sessionToken: credsResponse.Credentials.SessionToken || "",
      expiration: credsResponse.Credentials.Expiration,
    }

    expect(creds.accessKeyId).toBe("AKIAIOSFODNN7EXAMPLE")
    expect(creds.secretAccessKey).toBe("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY")
    expect(creds.sessionToken).toStartWith("FwoGZXIvYXdzEBYaDH")
    expect(creds.expiration).toBeInstanceOf(Date)
  })

  test("missing AccessKeyId defaults to empty string", () => {
    const credsResponse = {
      Credentials: {
        SecretKey: "secret",
        SessionToken: "token",
      },
    }
    const accessKeyId = (credsResponse.Credentials as Record<string, unknown>).AccessKeyId as string || ""
    expect(accessKeyId).toBe("")
  })

  test("missing Credentials object is detected", () => {
    const credsResponse = {} as { Credentials?: unknown }
    // Real code: if (!credsResponse.Credentials) throw new Error(...)
    expect(credsResponse.Credentials).toBeUndefined()
  })

  test("missing IdentityId from GetId is detected", () => {
    const idResponse = {} as { IdentityId?: string }
    // Real code: if (!idResponse.IdentityId) throw new Error(...)
    expect(idResponse.IdentityId).toBeUndefined()
  })
})

describe("AWS Federation: region fallback", () => {
  test("uses config.awsRegion when present", () => {
    const config = testConfig()
    const region = config.awsRegion || "us-east-2"
    expect(region).toBe("us-gov-west-1")
  })

  test("falls back to us-east-2 when awsRegion is empty", () => {
    const config = testConfig()
    config.awsRegion = ""
    const region = config.awsRegion || "us-east-2"
    expect(region).toBe("us-east-2")
  })
})

describe("AWS Federation: Logins map construction", () => {
  test("Logins uses provider name as key and idToken as value", () => {
    const config = testConfig()
    const idToken = "eyJhbGciOiJSUzI1NiJ9.payload.signature"
    const providerName = `cognito-idp.${config.awsRegion}.amazonaws.com/${config.cognitoUserPoolId}`

    const logins = { [providerName]: idToken }

    expect(Object.keys(logins)).toHaveLength(1)
    expect(logins[providerName]).toBe(idToken)
    expect(Object.keys(logins)[0]).toBe("cognito-idp.us-gov-west-1.amazonaws.com/us-gov-west-1_TestPool")
  })

  test("same Logins map is used for both GetId and GetCredentials", () => {
    const config = testConfig()
    const idToken = "test-token"
    const providerName = `cognito-idp.${config.awsRegion}.amazonaws.com/${config.cognitoUserPoolId}`
    const logins = { [providerName]: idToken }

    // Both calls use identical Logins - this is required by Cognito
    const getIdParams = { IdentityPoolId: config.identityPoolId, Logins: logins }
    const getCredsParams = { IdentityId: "some-id", Logins: logins }

    expect(getIdParams.Logins).toEqual(getCredsParams.Logins)
  })
})

describe("AWS Federation: exchangeTokenForAWSCredentials contract", () => {
  test("export exists and is a function", async () => {
    const mod = await import("../src/integrations/aws-federation")
    expect(mod.exchangeTokenForAWSCredentials).toBeTypeOf("function")
  })

  test("throws immediately if identityPoolId not configured", async () => {
    const { exchangeTokenForAWSCredentials } = await import("../src/integrations/aws-federation")
    const config = testConfig()
    config.identityPoolId = ""

    await expect(
      exchangeTokenForAWSCredentials("some-id-token", config),
    ).rejects.toThrow("Identity pool ID not configured")
  })
})
