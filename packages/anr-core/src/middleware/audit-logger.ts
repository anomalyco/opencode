/**
 * DynamoDB Audit Logger for ANR OpenCode
 * Logs all significant events to DynamoDB for compliance, with complete telemetry context
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb"
import type { ANRConfig } from "../config/types"
import type { TelemetryContext } from "../integrations/otel"
import { randomUUID } from "crypto"

export interface AuditEvent {
  // Primary keys
  pk: string // userId#timestamp for sorting
  sk: string // eventId for uniqueness

  // Event tracking
  eventId: string
  userId: string
  eventType: "auth" | "session" | "command" | "token_usage" | "quota_check" | "api_call"
  action: string
  resource?: string
  result: "success" | "failure" | "denied"

  // Telemetry context (enriched from OIDC + system detection)
  userEmail?: string
  userName?: string
  department?: string
  teamId?: string
  costCenter?: string
  organization?: string
  role?: string
  location?: string
  manager?: string
  sessionId?: string

  // Metadata and timestamps
  metadata?: Record<string, unknown>
  timestamp: string
  ttl?: number // For DynamoDB TTL cleanup
}

let dynamoClient: DynamoDBDocumentClient | null = null

/**
 * Credentials for audit logger
 */
export interface AuditLoggerCredentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
}

/**
 * Initialize DynamoDB client for audit logging with optional credentials
 */
export function initializeAuditLogger(config: ANRConfig, credentials?: AuditLoggerCredentials): void {
  try {
    // Bun resolves some AWS SDK CJS modules differently across platforms, causing
    // loadConfig() to appear as a Symbol instead of a function for options like
    // accountIdEndpointMode and authSchemePreference. Supplying these explicitly
    // prevents the SDK from calling loadConfig() for those paths at all.
    const clientConfig: any = {
      region: config.awsRegion,
      accountIdEndpointMode: "disabled",
      authSchemePreference: [],
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      ...(credentials && {
        credentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          sessionToken: credentials.sessionToken,
        },
      }),
    }
    const client = new DynamoDBClient(clientConfig)

    dynamoClient = DynamoDBDocumentClient.from(client)
    // Audit logger initialized (silent to avoid TUI pollution)
  } catch {
    // Keep ANR startup resilient if SDK runtime wiring is incompatible.
    dynamoClient = null
    console.error("⚠️ Audit logger initialization failed; continuing without audit logging")
  }
}

/**
 * Convert camelCase to snake_case
 */
function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

/**
 * Convert audit event fields to snake_case for DynamoDB
 */
function convertToSnakeCase(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    result[toSnakeCase(key)] = value
  }
  return result
}

/**
 * Log an audit event to DynamoDB with full telemetry context
 */
export async function logAuditEvent(
  config: ANRConfig,
  event: Omit<AuditEvent, "pk" | "sk" | "eventId" | "timestamp" | "ttl">,
  context?: TelemetryContext,
): Promise<void> {
  if (!dynamoClient) {
    // Audit logger not initialized, skipping event (silent)
    return
  }

  try {
    const now = new Date()
    const ttl = Math.floor(now.getTime() / 1000) + 365 * 24 * 60 * 60 // 1 year retention
    const eventId = randomUUID()
    const timestamp = now.toISOString()

    const auditEvent: AuditEvent = {
      // DynamoDB keys
      pk: `USER#${event.userId}#${now.getTime()}`,
      sk: `EVENT#${eventId}`,

      // Event data
      eventId,
      timestamp,
      ttl,
      ...event,

      // Enrich with telemetry context if provided
      ...(context && {
        userEmail: context.userEmail,
        userName: context.userName,
        department: context.department,
        teamId: context.teamId,
        costCenter: context.costCenter,
        organization: context.organization,
        role: context.role,
        location: context.location,
        manager: context.manager,
        sessionId: context.sessionId,
      }),
    }

    // Convert to snake_case for DynamoDB
    const dbItem = convertToSnakeCase(auditEvent as unknown as Record<string, unknown>)

    await dynamoClient.send(
      new PutCommand({
        TableName: config.auditTableName,
        Item: dbItem,
      }) as any,
    )

    // Audit event logged to DynamoDB (silent to avoid TUI pollution)
  } catch (error) {
    // Failed to write audit log (silent to avoid TUI pollution)
    // Error is swallowed as audit logging should not fail the operation
  }
}

/**
 * Helper to log authentication event
 */
export async function logAuthEvent(
  config: ANRConfig,
  userId: string,
  result: "success" | "failure",
  context?: TelemetryContext,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await logAuditEvent(
    config,
    {
      userId,
      eventType: "auth",
      action: "oidc_authenticate",
      result,
      metadata: {
        ...metadata,
        authenticationType: "OIDC",
        domain: config.providerDomain,
      },
    },
    context,
  )
}

/**
 * Helper to log session startup
 */
export async function logSessionStart(
  config: ANRConfig,
  userId: string,
  context?: TelemetryContext,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await logAuditEvent(
    config,
    {
      userId,
      eventType: "session",
      action: "start",
      result: "success",
      metadata: {
        ...metadata,
        model: config.anthropicModel,
        region: config.awsRegion,
      },
    },
    context,
  )
}

/**
 * Helper to log session end
 */
export async function logSessionEnd(
  config: ANRConfig,
  userId: string,
  duration: number,
  context?: TelemetryContext,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await logAuditEvent(
    config,
    {
      userId,
      eventType: "session",
      action: "end",
      result: "success",
      metadata: {
        ...metadata,
        durationSeconds: duration,
      },
    },
    context,
  )
}

/**
 * Helper to log command execution
 */
export async function logCommandExecution(
  config: ANRConfig,
  userId: string,
  command: string,
  duration: number,
  context?: TelemetryContext,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await logAuditEvent(
    config,
    {
      userId,
      eventType: "command",
      action: command,
      result: "success",
      metadata: {
        ...metadata,
        durationMs: duration,
      },
    },
    context,
  )
}

/**
 * Helper to log token usage
 */
export async function logTokenUsage(
  config: ANRConfig,
  userId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  context?: TelemetryContext,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await logAuditEvent(
    config,
    {
      userId,
      eventType: "token_usage",
      action: "model_invocation",
      result: "success",
      metadata: {
        ...metadata,
        model,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
    },
    context,
  )
}

/**
 * Helper to log API call
 */
export async function logAPICall(
  config: ANRConfig,
  userId: string,
  action: string,
  result: AuditEvent["result"],
  context?: TelemetryContext,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await logAuditEvent(
    config,
    {
      userId,
      eventType: "api_call",
      action,
      result,
      metadata,
    },
    context,
  )
}

/**
 * Helper to log quota check
 */
export async function logQuotaCheck(
  config: ANRConfig,
  userId: string,
  allowed: boolean,
  context?: TelemetryContext,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await logAuditEvent(
    config,
    {
      userId,
      eventType: "quota_check",
      action: "check",
      result: allowed ? "success" : "denied",
      metadata,
    },
    context,
  )
}
