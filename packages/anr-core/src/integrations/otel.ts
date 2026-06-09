/**
 * OpenTelemetry Integration for ANR OpenCode
 * Sends metrics to internal OTEL collector with comprehensive context enrichment
 */

import { NodeSDK } from "@opentelemetry/sdk-node"
import { MeterProvider, PeriodicExportingMetricReader, AggregationTemporality } from "@opentelemetry/sdk-metrics"
import type { PushMetricExporter, ResourceMetrics } from "@opentelemetry/sdk-metrics"
import { Resource } from "@opentelemetry/resources"
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions"
import type { ANRConfig } from "../config/types"
import { metrics } from "@opentelemetry/api"
import { ExportResultCode } from "@opentelemetry/core"
import type { ExportResult } from "@opentelemetry/core"
import { resolve } from "path"
import { appendFileSync, mkdirSync, existsSync, writeFileSync } from "fs"
import { debugLogger } from "../util/debug-logger"
import { validateContext, printContextReport } from "../util/metrics-validator"
import { contextTracer } from "../util/context-tracer"
import { createExportMetricsServiceRequest } from "@opentelemetry/otlp-transformer"

const logDir = resolve(process.env.HOME || process.env.USERPROFILE || "~", ".opencode", "logs")
const logFile = resolve(logDir, "otel-metrics.log")
const debugMode = process.env.OPENCODE_DEBUG_OTEL === "1" || process.env.OPENCODE_DEBUG === "1"

/**
 * Get the log file path for debugging
 */
export function getOTELLogFilePath(): string {
  return logFile
}

/**
 * Clear/reset the OTEL log file
 */
export function clearOTELLogs(): void {
  try {
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true })
    }
    writeFileSync(logFile, "")
    debugLogger.info("OTEL logs cleared")
  } catch {
    // Silently fail if clearing fails
  }
}

/**
 * Log to file with timestamp
 */
function logToFile(message: string, data?: Record<string, any>): void {
  try {
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true })
    }
    const timestamp = new Date().toISOString()
    const line = data ? `${timestamp} ${message}\n  ${JSON.stringify(data, null, 2)}\n` : `${timestamp} ${message}\n`
    appendFileSync(logFile, line)
    
    // Also log to debug logger if debug mode enabled
    if (debugMode) {
      debugLogger.debug(message, data)
    }
  } catch {
    // Silently fail if logging fails
  }
}

export interface TelemetryContext {
  // User context (from OIDC token)
  userId: string
  userEmail?: string
  userName?: string
  
  // System context (from environment detection)
  osType?: string
  osVersion?: string
  hostArch?: string
  terminalType?: string
  sessionId?: string
  
  // Project context
  projectId?: string

  // Organization context (from config)
  department?: string
  teamId?: string
  costCenter?: string
  manager?: string
  role?: string
  location?: string
  organization?: string
  accountId?: string
}

let otelSDK: NodeSDK | null = null
let meterProvider: MeterProvider | null = null
let telemetryContext: TelemetryContext | null = null
let firstMetricSent = false

// Diagnostic counters
const diagnostics = {
  modelCallsTracked: 0,
  tokensTracked: 0,
  exportsAttempted: 0,
  exportsSuccessful: 0,
  contextAvailableCalls: 0,
  contextMissingCalls: 0,
}

/**
 * Get the current telemetry context (available after initializeOTEL is called)
 * Checks module variable and global fallback to handle module instance issues
 */
export function getTelemetryContext(): TelemetryContext | null {
  return telemetryContext || (global as any).__ANR_TELEMETRY_CONTEXT__ || null
}

export function initializeOTEL(config: ANRConfig, context?: TelemetryContext): void {
  if (!config.enableTelemetry) {
    logToFile("Telemetry disabled")
    return
  }

  try {
    logToFile("═══════════════════════════════════════════════════════════════════════════════")
    logToFile("🚀 OTEL INITIALIZATION START - telemetry enabled")
    logToFile("═══════════════════════════════════════════════════════════════════════════════")
    // Store context for use in metric recording
    telemetryContext = context || { userId: "unknown" }
    
    // Trace context creation if debug mode
    if (debugMode && context) {
      const fieldCount = Object.values(context).filter((v) => !!v).length
      contextTracer.created("otel.ts", fieldCount, {
        userId: context.userId,
        sessionId: context.sessionId,
      })
    }
    
    logToFile("📊 Telemetry context stored:", {
      userId: telemetryContext.userId,
      userEmail: telemetryContext.userEmail,
      sessionId: telemetryContext.sessionId,
      department: telemetryContext.department,
      teamId: telemetryContext.teamId,
    })
    
    // Validate context in debug mode
    if (debugMode) {
      const contextValidation = validateContext(telemetryContext)
      contextTracer.validated("otel.ts", contextValidation.complete, contextValidation.score, contextValidation.missing)
      logToFile("📋 Context Validation Score:", {
        score: (contextValidation.score * 100).toFixed(0) + "%",
        provided: Object.keys(contextValidation.provided).filter((k) => contextValidation.provided[k]).length,
        missing: contextValidation.missing.length,
      })
    }
    
    // Also set global for cross-module access
    ;(global as any).__ANR_TELEMETRY_CONTEXT__ = telemetryContext
    logToFile("🌍 Global telemetry context set:", {
      globalContextSet: !!(global as any).__ANR_TELEMETRY_CONTEXT__,
      globalUserId: (global as any).__ANR_TELEMETRY_CONTEXT__?.userId,
    })

    /**
     * Telemetry Context Flow:
     * 
     * 1. ANR Wrapper extracts context from OIDC token + system detection + config
     * 2. Context passed to OpenCode as environment variables (OPENCODE_ANR_*)
     * 3. OpenCode reconstructs context from env vars
     * 4. Both wrapper and OpenCode call initializeOTEL with context
     * 5. Context converted to HTTP headers (x-user-id, x-department, etc.) in exporter
     * 6. Metrics sent to OTEL collector with headers
     * 7. OTEL collector extracts headers and adds as dimensions to CloudWatch metrics
     * 8. Quota monitor and dashboards read metrics from CloudWatch with full context
     */

    // Build resource attributes
    const resourceAttrs: Record<string, any> = {
      [ATTR_SERVICE_NAME]: "opencode-anr",
      [ATTR_SERVICE_VERSION]: "1.0.0",
      "deployment.environment": config.awsRegionProfile || "production",
      "service.region": config.awsRegion,
    }

    // Add user context
    if (telemetryContext.userId) resourceAttrs["user.id"] = telemetryContext.userId
    if (telemetryContext.userEmail) resourceAttrs["user.email"] = telemetryContext.userEmail
    if (telemetryContext.userName) resourceAttrs["user.name"] = telemetryContext.userName

    // Add system context
    if (telemetryContext.osType) resourceAttrs["os.type"] = telemetryContext.osType
    if (telemetryContext.osVersion) resourceAttrs["os.version"] = telemetryContext.osVersion
    if (telemetryContext.hostArch) resourceAttrs["host.arch"] = telemetryContext.hostArch
    if (telemetryContext.terminalType) resourceAttrs["terminal.type"] = telemetryContext.terminalType
    if (telemetryContext.sessionId) resourceAttrs["session.id"] = telemetryContext.sessionId
    if (telemetryContext.projectId) resourceAttrs["project.id"] = telemetryContext.projectId

    // Add organization context
    if (telemetryContext.department) resourceAttrs["department"] = telemetryContext.department
    if (telemetryContext.teamId) resourceAttrs["team.id"] = telemetryContext.teamId
    if (telemetryContext.costCenter) resourceAttrs["cost_center"] = telemetryContext.costCenter
    if (telemetryContext.manager) resourceAttrs["manager"] = telemetryContext.manager
    if (telemetryContext.role) resourceAttrs["role"] = telemetryContext.role
    if (telemetryContext.location) resourceAttrs["location"] = telemetryContext.location
    if (telemetryContext.organization) resourceAttrs["organization"] = telemetryContext.organization
    if (telemetryContext.accountId) resourceAttrs["aws.account_id"] = telemetryContext.accountId

    // Add config organization context
    if (config.department) resourceAttrs["department"] = config.department
    if (config.teamId) resourceAttrs["team.id"] = config.teamId
    if (config.costCenter) resourceAttrs["cost_center"] = config.costCenter
    if (config.manager) resourceAttrs["manager"] = config.manager
    if (config.role) resourceAttrs["role"] = config.role
    if (config.location) resourceAttrs["location"] = config.location
    if (config.organization) resourceAttrs["organization"] = config.organization
    if (config.accountId) resourceAttrs["aws.account_id"] = config.accountId

    const resource = Resource.default().merge(new Resource(resourceAttrs))

    // Build HTTP headers for OTEL collector (extracted from context and sent as x-* headers)
    // The OTEL collector stack uses these headers to enrich metrics with dimensions
    const exporterHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    }

    // Add context headers that OTEL collector will extract
    if (telemetryContext.userEmail) exporterHeaders["x-user-email"] = telemetryContext.userEmail
    if (telemetryContext.userId) exporterHeaders["x-user-id"] = telemetryContext.userId
    if (telemetryContext.userName) exporterHeaders["x-user-name"] = telemetryContext.userName
    if (telemetryContext.department) exporterHeaders["x-department"] = telemetryContext.department
    if (telemetryContext.teamId) exporterHeaders["x-team-id"] = telemetryContext.teamId
    if (telemetryContext.costCenter) exporterHeaders["x-cost-center"] = telemetryContext.costCenter
    if (telemetryContext.projectId) exporterHeaders["x-project-id"] = telemetryContext.projectId
    if (telemetryContext.organization) exporterHeaders["x-organization"] = telemetryContext.organization
    if (telemetryContext.location) exporterHeaders["x-location"] = telemetryContext.location
    if (telemetryContext.role) exporterHeaders["x-role"] = telemetryContext.role
    if (telemetryContext.manager) exporterHeaders["x-manager"] = telemetryContext.manager

    // Add config-level context headers as fallback
    if (config.department && !exporterHeaders["x-department"]) exporterHeaders["x-department"] = config.department
    if (config.teamId && !exporterHeaders["x-team-id"]) exporterHeaders["x-team-id"] = config.teamId
    if (config.costCenter && !exporterHeaders["x-cost-center"]) exporterHeaders["x-cost-center"] = config.costCenter
    if (config.organization && !exporterHeaders["x-organization"]) exporterHeaders["x-organization"] = config.organization
    if (config.location && !exporterHeaders["x-location"]) exporterHeaders["x-location"] = config.location
    if (config.role && !exporterHeaders["x-role"]) exporterHeaders["x-role"] = config.role
    if (config.manager && !exporterHeaders["x-manager"]) exporterHeaders["x-manager"] = config.manager
    if (config.accountId && !exporterHeaders["x-account-id"]) exporterHeaders["x-account-id"] = config.accountId

    // Only send attribution headers that have real values from JWT claims or config.
    // No fake defaults — missing attributes simply won't appear as dimensions.

    // Create metric exporter with enriched headers and AWS authentication
    // Add AWS credentials as headers if available (for ALB/API Gateway authentication)
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      // If OTEL collector is behind AWS ALB/API Gateway with IAM auth, signature would be needed
      // For now, include credentials context in headers
      exporterHeaders["x-aws-access-key-id"] = process.env.AWS_ACCESS_KEY_ID
      if (process.env.AWS_SESSION_TOKEN) {
        exporterHeaders["x-aws-session-token"] = process.env.AWS_SESSION_TOKEN
      }
      logToFile("OTEL requests will include AWS credential context")
    }

    // Log all headers being sent
    logToFile(`OTEL exporter initialized with headers:`, exporterHeaders)

    // Build a fetch-based metric exporter.
    // The stock OTLPMetricExporter uses Node's http.request + stream piping,
    // which times out under Bun. Using fetch() works correctly in Bun.
    const exportUrl = `${config.otelEndpoint}/v1/metrics`
    logToFile(`📋 OTEL fetch-based exporter targeting: ${exportUrl}`)

    const metricExporter: PushMetricExporter = {
      export(resourceMetrics: ResourceMetrics, cb: (result: ExportResult) => void) {
        const metricCount = resourceMetrics.scopeMetrics?.length || 0
        logToFile(`[FetchExporter.export] called with ${metricCount} scope metrics`)

        // Skip empty exports — with DELTA temporality, most periodic cycles have
        // no new data. Avoids wasted HTTP round-trips to the collector.
        const hasData = resourceMetrics.scopeMetrics?.some(
          sm => sm.metrics?.some(m => (m.dataPoints?.length ?? 0) > 0)
        )
        if (!hasData) {
          cb({ code: ExportResultCode.SUCCESS })
          return
        }

        diagnostics.exportsAttempted++

        // Log metric names and data point counts for debugging
        for (const sm of resourceMetrics.scopeMetrics || []) {
          for (const m of sm.metrics || []) {
            logToFile(`[FetchExporter] metric: ${m.descriptor?.name}, dataPoints: ${m.dataPoints?.length ?? 0}`)
          }
        }

        // Serialize SDK internal objects → proper OTLP JSON using the official transformer
        let body: string
        try {
          const otlp = createExportMetricsServiceRequest([resourceMetrics], { useLongBits: false })
          body = JSON.stringify(otlp)
          logToFile(`[FetchExporter] serialized ${body.length} bytes`)
          // Log full payload for debugging collector issues
          logToFile(`[FetchExporter] OTLP payload:\n${body}`)
        } catch (e) {
          logToFile(`❌ Serialization failed: ${e}`)
          cb({ code: ExportResultCode.FAILED, error: e instanceof Error ? e : new Error(String(e)) })
          return
        }

        fetch(exportUrl, {
          method: "POST",
          headers: exporterHeaders,
          body,
        }).then(async (resp) => {
          const respBody = await resp.text().catch(() => "")
          if (resp.ok) {
            diagnostics.exportsSuccessful++
            logToFile(`✅ Export successful (${resp.status}) - ${metricCount} scope metrics`, { response: respBody })
            cb({ code: ExportResultCode.SUCCESS })
          } else {
            logToFile(`❌ Export HTTP error: ${resp.status} ${resp.statusText}`, { body: respBody })
            cb({ code: ExportResultCode.FAILED, error: new Error(`HTTP ${resp.status}: ${respBody}`) })
          }
        }).catch((err) => {
          logToFile(`❌ Export fetch error: ${err}`)
          cb({ code: ExportResultCode.FAILED, error: err instanceof Error ? err : new Error(String(err)) })
        })
      },

      async forceFlush() { /* no buffering, each export sends immediately */ },
      async shutdown() { logToFile("FetchExporter shutdown") },
      selectAggregationTemporality() {
        return AggregationTemporality.DELTA
      },
    }

    // Create metric reader with periodic export (using configured interval)
    // Use a minimum of 10 seconds for testing visibility
    const configuredInterval = config.metricsIntervalSeconds || 60
    const exportInterval = Math.max(10, configuredInterval) * 1000 // Convert to milliseconds, min 10s
    logToFile(`OTEL export interval: ${exportInterval / 1000} seconds`)
    
    // Timeout must be less than interval; scale it based on interval
    const exportTimeout = Math.max(5000, Math.min(exportInterval - 1000, 30000))
    logToFile(`Creating PeriodicExportingMetricReader with interval=${exportInterval}ms, timeout=${exportTimeout}ms`)
    
    const metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: exportInterval,
      exportTimeoutMillis: exportTimeout,
    })
    
    logToFile(`PeriodicExportingMetricReader created successfully`)

    // Create meter provider
    meterProvider = new MeterProvider({
      resource,
      readers: [metricReader],
    })

    // Set global meter provider
    metrics.setGlobalMeterProvider(meterProvider)
    
    // Pre-register all instruments so MeterProvider knows about them
    // The SDK needs to see instruments during initialization for proper aggregation
    const meter = meterProvider.getMeter("opencode-anr")
    
    // Pre-create all instruments (SDK will cache and reuse them)
    meter.createCounter("opencode.token.usage", {
      description: "Total tokens used in model calls",
      unit: "1",
    })
    meter.createCounter("opencode.model.calls.count", {
      description: "Number of model API calls",
    })
    meter.createCounter("opencode.session.started", {
      description: "Number of sessions started",
    })
    meter.createHistogram("opencode.session.duration_seconds", {
      description: "Duration of sessions",
      unit: "s",
    })
    meter.createHistogram("opencode.command.duration_ms", {
      description: "Duration of CLI command execution",
      unit: "ms",
    })
    meter.createCounter("opencode.command.count", {
      description: "Number of CLI commands executed",
    })
    meter.createCounter("opencode.cost.usage", {
      description: "Estimated cost in USD",
      unit: "USD",
    })
    meter.createCounter("opencode.lines_of_code.count", {
      description: "Lines of code (from CLI hook)",
      unit: "1",
    })
    meter.createCounter("opencode.code_edit_tool.applied", {
      description: "Code edit tool applications (from CLI hook)",
    })
    meter.createCounter("opencode.code_edit_tool.decision", {
      description: "Code edit tool decisions (from CLI hook)",
    })
    meter.createCounter("opencode.commit.count", {
      description: "Commits made during session",
    })
    meter.createCounter("opencode.active_time.total", {
      description: "Active coding time in seconds",
      unit: "s",
    })
    
    logToFile(`[Instruments] Pre-registered 12 instruments with MeterProvider`)

    logToFile(`OpenTelemetry initialized`, { endpoint: config.otelEndpoint })
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    const errorLine = error instanceof Error ? error.stack?.split("\n")[1] : "unknown"
    
    logToFile("❌ Telemetry setup error", { 
      error: errorMsg,
      stack: errorLine,
    })
    
    debugLogger.warn("OTEL initialization failed", {
      error: errorMsg,
      endpoint: config.otelEndpoint,
      type: error instanceof Error ? error.constructor.name : typeof error,
    })
    
    if (debugMode) {
      console.warn(`⚠️  OTEL initialization warning: ${errorMsg}`)
    }
  }
}

/**
 * Get the global meter for recording metrics
 */
export function getMeter(name: string = "opencode-anr") {
  if (!meterProvider) {
    return metrics.getMeter(name)
  }
  return meterProvider.getMeter(name)
}

/**
 * Track a command execution with context
 */
export function trackCommand(commandName: string, duration: number): void {
  try {
    logToFile(`Tracking command: ${commandName}`, { duration_ms: duration })

    // Get instruments from global meter
    const meter = getMeter()
    const commandDurationHistogram = meter.createHistogram("opencode.command.duration_ms", {
      description: "Duration of CLI command execution",
      unit: "ms",
    })
    const commandCounter = meter.createCounter("opencode.command.count", {
      description: "Number of CLI commands executed",
    })

    // No per-datapoint dimensions needed for command metrics.
    // department, team.id, organization etc. come from HTTP headers
    // via the collector's attributes processor.
    commandDurationHistogram.record(duration)
    commandCounter.add(1)
    logToFile(`Command tracked successfully`)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    logToFile(`⚠️  Command tracking failed: ${errorMsg}`)
    debugLogger.warn(`Failed to track command: ${commandName}`, { error: errorMsg })
  }
}

/**
 * Track a model invocation with token usage and context attributes
 * Context can be passed explicitly or will use stored context
 */
export function trackModelCall(modelId: string, inputTokens: number, outputTokens: number, reasoningTokens: number = 0, cacheReadTokens: number = 0, cacheWriteTokens: number = 0, context?: TelemetryContext, cost: number = 0, projectId?: string): void {
  const totalTokens = inputTokens + outputTokens + reasoningTokens + cacheReadTokens + cacheWriteTokens
  
  try {
    // Use provided context, stored context, or global context (handles module instance issues)
    const globalCtx = (global as any).__ANR_TELEMETRY_CONTEXT__
    const ctx = context || telemetryContext || globalCtx
    
    const hasContext = !!ctx
    
    // Track diagnostics
    diagnostics.modelCallsTracked++
    diagnostics.tokensTracked += totalTokens
    if (hasContext) {
      diagnostics.contextAvailableCalls++
    } else {
      diagnostics.contextMissingCalls++
    }
    
    logToFile(`Tracking model call: ${modelId}`, {
      inputTokens,
      outputTokens,
      reasoningTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens,
      providedContextUserId: context?.userId,
      storedContextUserId: telemetryContext?.userId,
      globalContextUserId: globalCtx?.userId,
      contextUsed: ctx?.userId,
      contextAvailable: hasContext,
      providedContext: !!context,
      storedContext: !!telemetryContext,
      globalContext: !!globalCtx,
    })

    // Get instruments from global meter
    const meter = getMeter()
    const tokenCounter = meter.createCounter("opencode.token.usage", {
      description: "Total tokens used in model calls",
      unit: "1",
    })
    const modelCallCounter = meter.createCounter("opencode.model.calls.count", {
      description: "Number of model API calls",
    })

    // Only attach dimensions declared in collector metric_declarations.
    // department, team.id, organization, cost_center, user.* come from
    // HTTP headers via the collector's attributes processor +
    // resource_to_telemetry_conversion.
    const modelAttr: Record<string, string> = { model: modelId }
    if (projectId) modelAttr["project.id"] = projectId

    logToFile(`Recording metrics with model attr:`, modelAttr)

    // Record token usage with type + model dimensions
    tokenCounter.add(totalTokens, { ...modelAttr, type: "total" })
    tokenCounter.add(inputTokens, { ...modelAttr, type: "input" })
    tokenCounter.add(outputTokens, { ...modelAttr, type: "output" })
    if (reasoningTokens > 0) {
      tokenCounter.add(reasoningTokens, { ...modelAttr, type: "reasoning" })
    }
    if (cacheReadTokens > 0) {
      tokenCounter.add(cacheReadTokens, { ...modelAttr, type: "cacheRead" })
    }
    if (cacheWriteTokens > 0) {
      tokenCounter.add(cacheWriteTokens, { ...modelAttr, type: "cacheCreation" })
    }
    
    // Record model call count
    modelCallCounter.add(1, modelAttr)

    // Record cost (calculated by caller from ModelsDev cached prices)
    if (cost > 0) {
      const costCounter = meter.createCounter("opencode.cost.usage", {
        description: "Estimated cost in USD",
        unit: "USD",
      })
      costCounter.add(cost, modelAttr)
      logToFile(`Cost tracked: $${cost.toFixed(6)} for ${modelId}`)
    }
    logToFile(`Model call tracked successfully - recorded ${totalTokens} tokens`)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    logToFile(`⚠️  Model call tracking failed: ${errorMsg}`)
    debugLogger.warn(`Failed to track model call: ${modelId}`, { error: errorMsg, tokens: totalTokens })
  }
}

/**
 * Track session start
 */
export function trackSessionStart(userId: string): void {
  try {
    logToFile(`Tracking session start: ${userId}`)

    // Get instrument from global meter
    const meter = getMeter()
    const sessionStartCounter = meter.createCounter("opencode.session.started", {
      description: "Number of sessions started",
    })

    // No per-datapoint dimensions — department, organization etc.
    // come from headers via collector attributes processor.
    sessionStartCounter.add(1)
    logToFile(`Session start tracked successfully`)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    logToFile(`⚠️  Session start tracking failed: ${errorMsg}`)
    debugLogger.warn(`Failed to track session start: ${userId}`, { error: errorMsg })
  }
}

/**
 * Track session end
 */
export function trackSessionEnd(userId: string, duration: number): void {
  try {
    logToFile(`Tracking session end: ${userId}`, { duration_seconds: duration })

    // Get instrument from global meter
    const meter = getMeter()
    const sessionEndHistogram = meter.createHistogram("opencode.session.duration_seconds", {
      description: "Duration of sessions",
      unit: "s",
    })

    // No per-datapoint dimensions — department, organization etc.
    // come from headers via collector attributes processor.
    sessionEndHistogram.record(duration)
    logToFile(`Session end tracked successfully`)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    logToFile(`⚠️  Session end tracking failed: ${errorMsg}`)
    debugLogger.warn(`Failed to track session end: ${userId}`, { error: errorMsg, duration })
  }
}

/**
 * Track lines-of-code metric (typically fired by CLI hook)
 */
export function trackLinesOfCode(count: number, type: string, language?: string): void {
  try {
    const meter = getMeter()
    const counter = meter.createCounter("opencode.lines_of_code.count", {
      description: "Lines of code",
      unit: "1",
    })
    // Only type + language are declared dimensions for this metric.
    const attrs: Record<string, string> = { type }
    if (language) attrs.language = language
    counter.add(count, attrs)
    logToFile(`Lines of code tracked: ${count} (${type}, ${language || "unknown"})`)
  } catch (error) {
    logToFile(`⚠️  Lines of code tracking failed: ${error}`)
  }
}

/**
 * Track code-edit-tool usage (typically fired by CLI hook)
 */
export function trackCodeEditTool(toolName: string, language: string, applied: boolean): void {
  try {
    const meter = getMeter()
    const counter = meter.createCounter("opencode.code_edit_tool.applied", {
      description: "Code edit tool applications",
    })
    // Only tool_name + language are declared dimensions for this metric.
    counter.add(1, { tool_name: toolName, language })
    logToFile(`Code edit tool tracked: ${toolName} (${language}, applied=${applied})`)
  } catch (error) {
    logToFile(`⚠️  Code edit tool tracking failed: ${error}`)
  }
}

/**
 * Track code-edit-tool decision (accepted/rejected by user)
 */
export function trackCodeEditDecision(decision: string, language?: string): void {
  try {
    const meter = getMeter()
    const counter = meter.createCounter("opencode.code_edit_tool.decision", {
      description: "Code edit tool decisions",
    })
    const attrs: Record<string, string> = { decision }
    if (language) attrs.language = language
    counter.add(1, attrs)
    logToFile(`Code edit decision tracked: ${decision} (${language || "unknown"})`)
  } catch (error) {
    logToFile(`⚠️  Code edit decision tracking failed: ${error}`)
  }
}

/**
 * Track a git commit made during the session
 */
export function trackCommit(): void {
  try {
    const meter = getMeter()
    const counter = meter.createCounter("opencode.commit.count", {
      description: "Commits made during session",
    })
    counter.add(1)
    logToFile(`Commit tracked`)
  } catch (error) {
    logToFile(`⚠️  Commit tracking failed: ${error}`)
  }
}

/**
 * Track active coding time in seconds
 */
export function trackActiveTime(seconds: number): void {
  try {
    const meter = getMeter()
    const counter = meter.createCounter("opencode.active_time.total", {
      description: "Active coding time in seconds",
      unit: "s",
    })
    counter.add(seconds)
    logToFile(`Active time tracked: ${seconds}s`)
  } catch (error) {
    logToFile(`⚠️  Active time tracking failed: ${error}`)
  }
}

/**
 * Print diagnostic summary
 */
function printDiagnosticSummary(): void {
  const ctx = getTelemetryContext()
  logToFile("═══════════════════════════════════════════════════════════════════════════════")
  logToFile("📊 DIAGNOSTIC SUMMARY")
  logToFile("═══════════════════════════════════════════════════════════════════════════════", {
    sessionId: ctx?.sessionId || "none",
    userId: ctx?.userId || "none",
    email: ctx?.userEmail || "none",
    modelCallsTracked: diagnostics.modelCallsTracked,
    tokensTracked: diagnostics.tokensTracked,
    contextAvailable: `${diagnostics.contextAvailableCalls}/${diagnostics.modelCallsTracked}`,
    contextMissing: diagnostics.contextMissingCalls > 0 ? `⚠️  ${diagnostics.contextMissingCalls}` : "✓ none",
    exportsAttempted: diagnostics.exportsAttempted,
    exportsSuccessful: diagnostics.exportsSuccessful,
  })
  logToFile("═══════════════════════════════════════════════════════════════════════════════")
}

/**
 * Force-flush pending metrics to the collector immediately.
 * Call after trackModelCall() so data reaches CloudWatch
 * without waiting for the periodic export timer.
 */
export async function flushOTEL(): Promise<void> {
  if (meterProvider) {
    try {
      await meterProvider.forceFlush()
    } catch {
      // silently fail — don't block model calls
    }
  }
}

/**
 * Shutdown OpenTelemetry gracefully
 */
export async function shutdownOTEL(): Promise<void> {
  if (meterProvider) {
    try {
      logToFile("🛑 OTEL SHUTDOWN START - Flushing metrics")
      await meterProvider.shutdown()
      logToFile("✅ OpenTelemetry shut down successfully")
      // Print diagnostic summary AFTER exports complete so counts are accurate
      printDiagnosticSummary()
      logToFile("═══════════════════════════════════════════════════════════════════════════════")
      
      if (debugMode) {
        debugLogger.info("OTEL shutdown completed successfully")
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logToFile("❌ Error shutting down OpenTelemetry", { error: errorMsg })
      debugLogger.error("OTEL shutdown error", { error: errorMsg })
    }
  }
}

/**
 * Register shutdown handlers
 */
export function registerOTELShutdownHandlers(): void {
  process.on("SIGTERM", async () => {
    await shutdownOTEL()
    process.exit(0)
  })

  process.on("SIGINT", async () => {
    await shutdownOTEL()
    process.exit(0)
  })
}

/**
 * Get diagnostic information for debugging
 */
export function getOTELDiagnostics() {
  const ctx = getTelemetryContext()
  const contextValidation = validateContext(ctx)

  return {
    initialized: !!meterProvider,
    debugMode,
    telemetryContext: ctx ? {
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      userEmail: ctx.userEmail,
      department: ctx.department,
      teamId: ctx.teamId,
      organization: ctx.organization,
    } : null,
    contextValidation: {
      complete: contextValidation.complete,
      score: (contextValidation.score * 100).toFixed(0) + "%",
      providedCount: Object.values(contextValidation.provided).filter((v) => v).length,
      missingCount: contextValidation.missing.length,
    },
    metrics: diagnostics,
    logFile,
  }
}

/**
 * Print OTEL diagnostics to console
 */
export function printOTELDiagnostics(): void {
  const diags = getOTELDiagnostics()

  console.log("\n📊 OpenTelemetry Diagnostics")
  console.log("═".repeat(60))

  console.log("\n🔧 Configuration:")
  console.log(`  Initialized: ${diags.initialized ? "✓" : "✗"}`)
  console.log(`  Debug Mode: ${diags.debugMode ? "✓" : "✗"}`)

  if (diags.telemetryContext) {
    console.log("\n👤 Context:")
    console.log(`  User ID: ${diags.telemetryContext.userId}`)
    console.log(`  Session ID: ${diags.telemetryContext.sessionId}`)
    console.log(`  Email: ${diags.telemetryContext.userEmail || "(not set)"}`)
    console.log(`  Department: ${diags.telemetryContext.department || "(not set)"}`)
    console.log(`  Team: ${diags.telemetryContext.teamId || "(not set)"}`)
    console.log(`  Organization: ${diags.telemetryContext.organization || "(not set)"}`)
  }

  console.log("\n✅ Context Validation:")
  console.log(`  complete: ${diags.contextValidation.complete ? "✓" : "✗"}`)
  console.log(`  Score: ${diags.contextValidation.score} (${diags.contextValidation.providedCount} provided, ${diags.contextValidation.missingCount} missing)`)

  console.log("\n📈 Metrics:")
  console.log(`  Model Calls Tracked: ${diags.metrics.modelCallsTracked}`)
  console.log(`  Tokens Tracked: ${diags.metrics.tokensTracked}`)
  console.log(`  Context Available: ${diags.metrics.contextAvailableCalls}/${diags.metrics.modelCallsTracked}`)
  console.log(`  Context Missing: ${diags.metrics.contextMissingCalls}`)
  console.log(`  Export Attempts: ${diags.metrics.exportsAttempted}`)
  console.log(`  Export Successes: ${diags.metrics.exportsSuccessful}`)

  console.log(`\n📄 Log File: ${diags.logFile}`)
  console.log("═".repeat(60) + "\n")
}

/**
 * Reset diagnostic counters (useful for testing)
 */
export function resetOTELDiagnostics(): void {
  diagnostics.modelCallsTracked = 0
  diagnostics.tokensTracked = 0
  diagnostics.exportsAttempted = 0
  diagnostics.exportsSuccessful = 0
  diagnostics.contextAvailableCalls = 0
  diagnostics.contextMissingCalls = 0
  logToFile("🔄 Diagnostic counters reset")
}

/**
 * Get context flow trace diagram
 */
export function getContextFlowDiagram(): string {
  return contextTracer.getFlowDiagram()
}

/**
 * Print context flow trace to console
 */
export function printContextFlowDiagram(): void {
  contextTracer.printFlowDiagram()
}

/**
 * Get context trace events
 */
export function getContextTraceEvents() {
  return contextTracer.getEvents()
}
export function getMetricsPreview() {
  const ctx = getTelemetryContext()
  
  return {
    exampleModelCallMetric: {
      name: "opencode.model.calls.count",
      value: 1,
      attributes: ctx ? {
        model: "claude-3-5-sonnet",
        user_id: ctx.userId,
        session_id: ctx.sessionId,
        department: ctx.department || "(not set)",
        team_id: ctx.teamId || "(not set)",
      } : {
        model: "claude-3-5-sonnet",
        user_id: "(no context)",
      },
    },
    exampleTokenMetric: {
      name: "opencode.token.usage",
      value: 5000,
      unit: "tokens",
      attributes: ctx ? {
        model: "claude-3-5-sonnet",
        user_id: ctx.userId,
        session_id: ctx.sessionId,
      } : {
        model: "claude-3-5-sonnet",
        user_id: "(no context)",
      },
    },
    exampleCommandMetric: {
      name: "opencode.command.duration_ms",
      value: 2456,
      unit: "ms",
      attributes: ctx ? {
        command: "run",
        user_id: ctx.userId,
        session_id: ctx.sessionId,
        department: ctx.department || "(not set)",
        team_id: ctx.teamId || "(not set)",
      } : {
        command: "run",
        user_id: "(no context)",
      },
    },
  }
}

/**
 * Print example metrics that would be sent
 */
export function printMetricsPreview(): void {
  const preview = getMetricsPreview()
  const validation = validateContext(getTelemetryContext())

  console.log("\n📊 Metrics Preview")
  console.log("═".repeat(70))
  console.log(`\n⚠️  Context Validation: ${validation.score > 0.5 ? "✓" : "✗"} (${(validation.score * 100).toFixed(0)}% complete)`)

  if (validation.missing.length > 0) {
    console.log(`\n⚠️  Missing context fields will result in incomplete metrics:`)
    validation.missing.slice(0, 5).forEach((field) => {
      console.log(`    • ${field}`)
    })
  }

  console.log("\n\n📈 Example Metrics:")
  console.log("─".repeat(70))

  // Model call metric
  console.log(`\n1. Model Call Counter`)
  console.log(`   Name: ${preview.exampleModelCallMetric.name}`)
  console.log(`   Value: ${preview.exampleModelCallMetric.value}`)
  console.log(`   Attributes:`)
  Object.entries(preview.exampleModelCallMetric.attributes).forEach(([key, value]) => {
    console.log(`     • ${key}: ${value}`)
  })

  // Token metric
  console.log(`\n2. Token Usage Counter`)
  console.log(`   Name: ${preview.exampleTokenMetric.name}`)
  console.log(`   Value: ${preview.exampleTokenMetric.value} ${preview.exampleTokenMetric.unit}`)
  console.log(`   Attributes:`)
  Object.entries(preview.exampleTokenMetric.attributes).forEach(([key, value]) => {
    console.log(`     • ${key}: ${value}`)
  })

  // Command metric
  console.log(`\n3. Command Duration Histogram`)
  console.log(`   Name: ${preview.exampleCommandMetric.name}`)
  console.log(`   Value: ${preview.exampleCommandMetric.value} ${preview.exampleCommandMetric.unit}`)
  console.log(`   Attributes:`)
  Object.entries(preview.exampleCommandMetric.attributes).forEach(([key, value]) => {
    console.log(`     • ${key}: ${value}`)
  })

  console.log("\n═".repeat(70) + "\n")
}

