import z from "zod"
import { Effect, Schema, ServiceMap } from "effect"
import { Log } from "@/util/log"

export namespace PermissionRouter {
  const log = Log.create({ service: "permission.router" })

  export const RiskLevel = z.enum(["low", "medium", "high", "critical"]).meta({
    ref: "PermissionRiskLevel",
  })
  export type RiskLevel = z.infer<typeof RiskLevel>

  export const ToolFlags = z
    .object({
      isReadOnly: z.boolean().default(false),
      isDestructive: z.boolean().default(false),
      isNetwork: z.boolean().default(false),
      isSystem: z.boolean().default(false),
      isFileSystem: z.boolean().default(false),
    })
    .meta({ ref: "PermissionToolFlags" })
  export type ToolFlags = z.infer<typeof ToolFlags>

  export const ToolDefinition = z
    .object({
      id: z.string().min(1).max(64),
      description: z.string().min(1).max(1000),
      category: z.enum(["read", "write", "execute", "network", "system", "other"]),
      flags: ToolFlags,
      defaultRisk: RiskLevel,
      parameters: z.custom<z.ZodType>(),
      requiredApprovals: z.array(z.enum(["user", "auto", "classifier", "never"])).default(["user"]),
    })
    .meta({ ref: "PermissionToolDefinition" })
  export type ToolDefinition = z.infer<typeof ToolDefinition>

  export const ToolCallRequest = z
    .object({
      toolId: z.string(),
      params: z.record(z.string(), z.any()),
      sessionID: z.string(),
      context: z
        .object({
          cwd: z.string(),
          previousCalls: z.array(z.string()).default([]),
          userIntent: z.string().optional(),
        })
        .default({ cwd: ".", previousCalls: [] }),
    })
    .meta({ ref: "PermissionToolCallRequest" })
  export type ToolCallRequest = z.infer<typeof ToolCallRequest>

  export const ClassificationResult = z
    .object({
      riskLevel: RiskLevel,
      confidence: z.number().min(0).max(1),
      reasoning: z.string(),
      suggestedAction: z.enum(["allow", "ask", "deny", "escalate"]),
      requiresHumanReview: z.boolean(),
    })
    .meta({ ref: "PermissionClassificationResult" })
  export type ClassificationResult = z.infer<typeof ClassificationResult>

  export const RoutingDecision = z
    .object({
      toolId: z.string(),
      action: z.enum(["allow", "deny", "ask", "classify"]),
      riskLevel: RiskLevel,
      reasoning: z.string(),
      classification: ClassificationResult.optional(),
    })
    .meta({ ref: "PermissionRoutingDecision" })
  export type RoutingDecision = z.infer<typeof RoutingDecision>

  export class ValidationError extends Schema.TaggedErrorClass<ValidationError>()("PermissionValidationError", {
    toolId: Schema.String,
    field: Schema.String,
    message: Schema.String,
  }) {
    override get message(): string {
      return `Validation failed for tool '${this.toolId}' on field '${this.field}': ${this.message}`
    }
  }

  export class RoutingError extends Schema.TaggedErrorClass<RoutingError>()("PermissionRoutingError", {
    toolId: Schema.String,
    reason: Schema.String,
  }) {
    override get message(): string {
      return `Routing failed for tool '${this.toolId}': ${this.reason}`
    }
  }

  export const BuiltinToolClassifications: Record<string, ToolDefinition> = {
    read: {
      id: "read",
      description: "Read file contents",
      category: "read",
      flags: { isReadOnly: true, isDestructive: false, isNetwork: false, isSystem: false, isFileSystem: true },
      defaultRisk: "low",
      parameters: z.object({ filePath: z.string(), offset: z.number().optional(), limit: z.number().optional() }),
      requiredApprovals: ["auto"],
    },
    bash: {
      id: "bash",
      description: "Execute shell commands",
      category: "execute",
      flags: { isReadOnly: false, isDestructive: true, isNetwork: false, isSystem: true, isFileSystem: true },
      defaultRisk: "high",
      parameters: z.object({ command: z.string(), timeout: z.number().optional(), workdir: z.string().optional() }),
      requiredApprovals: ["user"],
    },
    write: {
      id: "write",
      description: "Write file contents",
      category: "write",
      flags: { isReadOnly: false, isDestructive: true, isNetwork: false, isSystem: false, isFileSystem: true },
      defaultRisk: "medium",
      parameters: z.object({ filePath: z.string(), content: z.string() }),
      requiredApprovals: ["user"],
    },
    edit: {
      id: "edit",
      description: "Edit file contents",
      category: "write",
      flags: { isReadOnly: false, isDestructive: true, isNetwork: false, isSystem: false, isFileSystem: true },
      defaultRisk: "medium",
      parameters: z.object({ filePath: z.string(), oldString: z.string(), newString: z.string() }),
      requiredApprovals: ["user"],
    },
    glob: {
      id: "glob",
      description: "Find files matching pattern",
      category: "read",
      flags: { isReadOnly: true, isDestructive: false, isNetwork: false, isSystem: false, isFileSystem: true },
      defaultRisk: "low",
      parameters: z.object({ pattern: z.string(), path: z.string().optional() }),
      requiredApprovals: ["auto"],
    },
    grep: {
      id: "grep",
      description: "Search file contents",
      category: "read",
      flags: { isReadOnly: true, isDestructive: false, isNetwork: false, isSystem: false, isFileSystem: true },
      defaultRisk: "low",
      parameters: z.object({ pattern: z.string(), path: z.string().optional(), include: z.string().optional() }),
      requiredApprovals: ["auto"],
    },
    webfetch: {
      id: "webfetch",
      description: "Fetch web content",
      category: "network",
      flags: { isReadOnly: true, isDestructive: false, isNetwork: true, isSystem: false, isFileSystem: false },
      defaultRisk: "medium",
      parameters: z.object({ url: z.string() }),
      requiredApprovals: ["classifier"],
    },
    websearch: {
      id: "websearch",
      description: "Search the web",
      category: "network",
      flags: { isReadOnly: true, isDestructive: false, isNetwork: true, isSystem: false, isFileSystem: false },
      defaultRisk: "medium",
      parameters: z.object({ query: z.string() }),
      requiredApprovals: ["classifier"],
    },
  }

  export type Error = ValidationError | RoutingError

  export interface Interface {
    readonly register: (def: ToolDefinition) => Effect.Effect<void>
    readonly route: (req: ToolCallRequest) => Effect.Effect<RoutingDecision, Error>
    readonly validate: (req: ToolCallRequest) => Effect.Effect<void, ValidationError>
    readonly classify: (req: ToolCallRequest) => Effect.Effect<ClassificationResult>
    readonly getToolDef: (toolId: string) => Effect.Effect<ToolDefinition | undefined>
    readonly listTools: () => Effect.Effect<ToolDefinition[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/PermissionRouter") {}
}
