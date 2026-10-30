export * as Extension from "./extension.js"

import { Schema } from "effect"
import { optional } from "./schema.js"

export const Platform = Schema.Literals(["opencode", "claude", "codex", "antigravity", "cursor", "custom"]).annotate({
  identifier: "Extension.Platform",
  description: "Originating AI agent ecosystem or extension platform.",
})
export type Platform = typeof Platform.Type

export const Category = Schema.Literals(["skill", "mcp", "rule", "plugin"]).annotate({
  identifier: "Extension.Category",
  description: "Universal extension functional category.",
})
export type Category = typeof Category.Type

export const SourceType = Schema.Literals(["git", "local", "archive", "builtin"]).annotate({
  identifier: "Extension.SourceType",
})
export type SourceType = typeof SourceType.Type

export const Source = Schema.Struct({
  type: SourceType,
  location: Schema.String,
  subpath: optional(Schema.String),
  ref: optional(Schema.String),
  checksum: optional(Schema.String),
}).annotate({ identifier: "Extension.Source" })
export interface Source extends Schema.Schema.Type<typeof Source> {}

export const Permissions = Schema.Struct({
  filesystem: optional(Schema.Array(Schema.String)),
  network: optional(Schema.Array(Schema.String)),
  commands: optional(Schema.Array(Schema.String)),
  environment: optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "Extension.Permissions" })
export interface Permissions extends Schema.Schema.Type<typeof Permissions> {}

export const SecurityFinding = Schema.Struct({
  severity: Schema.Literals(["info", "warning", "error", "critical"]),
  code: Schema.String,
  message: Schema.String,
  file: optional(Schema.String),
  line: optional(Schema.Int),
}).annotate({ identifier: "Extension.SecurityFinding" })
export interface SecurityFinding extends Schema.Schema.Type<typeof SecurityFinding> {}

export const SecurityReport = Schema.Struct({
  safe: Schema.Boolean,
  riskLevel: Schema.Literals(["low", "medium", "high", "critical"]),
  findings: Schema.Array(SecurityFinding),
  scannedFiles: Schema.Int,
  timestamp: Schema.Finite,
}).annotate({ identifier: "Extension.SecurityReport" })
export interface SecurityReport extends Schema.Schema.Type<typeof SecurityReport> {}

export const Status = Schema.Literals(["installed", "enabled", "disabled", "failed", "needs_auth"]).annotate({
  identifier: "Extension.Status",
})
export type Status = typeof Status.Type

export const Scope = Schema.Literals(["global", "project"]).annotate({
  identifier: "Extension.Scope",
})
export type Scope = typeof Scope.Type

export const CIR = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  version: Schema.String,
  category: Category,
  originPlatform: Platform,
  source: Source,
  scope: Scope,
  description: optional(Schema.String),
  author: optional(Schema.String),
  license: optional(Schema.String),
  homepage: optional(Schema.String),
  permissions: Permissions,
  status: Status,
  enabled: Schema.Boolean,
  security: optional(SecurityReport),
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  error: optional(Schema.String),
}).annotate({ identifier: "Extension.CIR" })
export interface CIR extends Schema.Schema.Type<typeof CIR> {}

export const McpToolDescriptor = Schema.Struct({
  name: Schema.String,
  description: optional(Schema.String),
  parameters: optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "Extension.McpToolDescriptor" })
export interface McpToolDescriptor extends Schema.Schema.Type<typeof McpToolDescriptor> {}

export const McpDiagnosticResult = Schema.Struct({
  server: Schema.String,
  transport: Schema.Literals(["stdio", "http", "sse"]),
  success: Schema.Boolean,
  latencyMs: Schema.Finite,
  tools: Schema.Array(McpToolDescriptor),
  error: optional(Schema.String),
  details: Schema.Struct({
    executableFound: Schema.Boolean,
    exitCode: optional(Schema.Int),
    stderr: optional(Schema.String),
    authValid: optional(Schema.Boolean),
  }),
}).annotate({ identifier: "Extension.McpDiagnosticResult" })
export interface McpDiagnosticResult extends Schema.Schema.Type<typeof McpDiagnosticResult> {}

export const InstallInput = Schema.Struct({
  sourceUrlOrPath: Schema.String,
  subpath: optional(Schema.String),
  ref: optional(Schema.String),
  targetScope: Scope,
  expectedCategory: optional(Category),
  overrideName: optional(Schema.String),
}).annotate({ identifier: "Extension.InstallInput" })
export interface InstallInput extends Schema.Schema.Type<typeof InstallInput> {}
