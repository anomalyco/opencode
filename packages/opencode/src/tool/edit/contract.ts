import type { Permission } from "../../permission"

type AnyRecord = Record<string, unknown>

export type EditToolFamily = "edit" | "write" | "apply_patch" | "path"
export type EditPreviewKind = "diff" | "patch" | "operations" | "structured"
export type EditPublicStatus = "public" | "compat"
export type EditExecution = "single" | "sequential"
export type EditTargetPublicToolID = "edit" | "write" | "apply_patch" | "path_edit"
export type EditMergedToolMode =
  | "batch"
  | "structured-data"
  | "structured-frontmatter"
  | "structured-markdown"
export type EditLspResourceOperation = "create" | "rename" | "delete"
export type EditLspFailureHandling = "abort" | "transactional" | "undo" | "textOnlyTransactional"
export type EditLspPositionEncoding = "utf-16" | "utf-8" | "utf-32"
export type EditLspQueryOperation =
  | "goToDefinition"
  | "findReferences"
  | "hover"
  | "documentSymbol"
  | "workspaceSymbol"
  | "goToImplementation"
  | "prepareCallHierarchy"
  | "incomingCalls"
  | "outgoingCalls"

export const EDIT_LANE_SCHEMA = "opencode/edit-lane-contract/v1" as const
export const EDIT_RUNTIME_CONTRACT_SCHEMA = "opencode/edit-runtime-contract/v1" as const

export type EditLaneID = "text" | "lsp_semantic"
export type EditLaneStatus = "stable" | "contracts-only"
export type EditLaneRouteTarget = "approval" | "preview" | "approvalPreview" | "result"
export type LspSemanticFallbackReason =
  | "language_server_unavailable"
  | "semantic_operations_unsupported"
  | "unsupported_language"
  | "semantic_edit_failed"
  | "binary_target"
  | "non_text_target"
  | "reproducibility_sensitive"
export type LspSemanticFallbackAction = "fallback" | "reject"

export interface EditLaneRouteContract {
  approval: EditLaneRouteTarget
  preview: EditLaneRouteTarget
  approvalPreview: EditLaneRouteTarget
  result: EditLaneRouteTarget
}

export interface EditToolSpec {
  family: EditToolFamily
  previewKind: EditPreviewKind
  publicStatus: EditPublicStatus
  execution: EditExecution
  grouped: boolean
  defaultOpen: boolean
  modelRouted: boolean
  capabilityGated: boolean
}

export const EDIT_TOOL_SPECS = {
  edit: {
    family: "edit",
    previewKind: "diff",
    publicStatus: "public",
    execution: "sequential",
    grouped: false,
    defaultOpen: false,
    modelRouted: false,
    capabilityGated: false,
  },
  write: {
    family: "write",
    previewKind: "diff",
    publicStatus: "public",
    execution: "single",
    grouped: false,
    defaultOpen: false,
    modelRouted: false,
    capabilityGated: false,
  },
  multiedit: {
    family: "edit",
    previewKind: "diff",
    publicStatus: "compat",
    execution: "sequential",
    grouped: true,
    defaultOpen: false,
    modelRouted: false,
    capabilityGated: false,
  },
  apply_patch: {
    family: "apply_patch",
    previewKind: "patch",
    publicStatus: "public",
    execution: "single",
    grouped: true,
    defaultOpen: false,
    modelRouted: false,
    capabilityGated: false,
  },
  path_edit: {
    family: "path",
    previewKind: "operations",
    publicStatus: "public",
    execution: "single",
    grouped: true,
    defaultOpen: false,
    modelRouted: false,
    capabilityGated: false,
  },
  data_edit: {
    family: "edit",
    previewKind: "structured",
    publicStatus: "compat",
    execution: "single",
    grouped: true,
    defaultOpen: false,
    modelRouted: false,
    capabilityGated: false,
  },
  frontmatter_edit: {
    family: "edit",
    previewKind: "structured",
    publicStatus: "compat",
    execution: "single",
    grouped: true,
    defaultOpen: false,
    modelRouted: false,
    capabilityGated: false,
  },
  markdown_edit: {
    family: "edit",
    previewKind: "structured",
    publicStatus: "compat",
    execution: "single",
    grouped: true,
    defaultOpen: false,
    modelRouted: false,
    capabilityGated: false,
  },
} as const satisfies Record<string, EditToolSpec>

const EDIT_TOOL_ID_LIST = [
  "edit",
  "write",
  "multiedit",
  "apply_patch",
  "path_edit",
  "data_edit",
  "frontmatter_edit",
  "markdown_edit",
] as const

export type EditToolID = (typeof EDIT_TOOL_ID_LIST)[number]

export type EditRuntimeSDKBoundary = "runtime-only"

export interface EditRuntimeSDKBoundaryContract {
  canonicalEditMetadata: EditRuntimeSDKBoundary
  semanticLaneDescriptors: EditRuntimeSDKBoundary
  followupResults: EditRuntimeSDKBoundary
}

export interface EditSurfaceAliasContract {
  alias: string
  target: EditToolID
}

export interface EditSurfaceDeprecationContract {
  id: string
  replacement?: EditToolID
  replacementMode?: EditMergedToolMode
  reason?: string
}

export interface EditSurfaceMigrationContract {
  source: string
  target: EditTargetPublicToolID
  mode?: EditMergedToolMode
}

export interface EditSemanticSurfacePolicyContract {
  lane: "lsp_semantic"
  publicToolID: null
  runtimeOnly: true
  capabilityGated: true
  status: "stable"
}

export interface EditSurfacePolicyContract {
  aliases: readonly EditSurfaceAliasContract[]
  deprecations: readonly EditSurfaceDeprecationContract[]
  targetPublicTools: readonly EditTargetPublicToolID[]
  migrations: readonly EditSurfaceMigrationContract[]
  semanticLane: EditSemanticSurfacePolicyContract
}

export interface EditLspCapabilityContract {
  rename: true
  prepareRename: true
  codeAction: true
  codeActionResolve: true
  executeCommand: true
  documentChanges: true
  applyEdit: true
  diagnostics: true
  changeAnnotations: true
  resourceOperations: readonly EditLspResourceOperation[]
  failureHandling: readonly EditLspFailureHandling[]
  positionEncodings: readonly EditLspPositionEncoding[]
}

export interface EditLspIntegrationContract {
  embedded: true
  alwaysOnTarget: true
  semanticLane: "lsp_semantic"
  standaloneToolID: "lsp"
  targetPublicToolID: null
  capabilityGated: true
  capabilities: EditLspCapabilityContract
  querySurface: {
    standaloneToolID: "lsp"
    operations: readonly EditLspQueryOperation[]
    targetPublicToolID: null
    runtimeOnlyTarget: boolean
    deprecationReason?: string
  }
}

export interface LspSemanticFallbackContract {
  reason: LspSemanticFallbackReason
  action: LspSemanticFallbackAction
  safe: true
  fallbackTool?: EditToolID
}

export interface EditLaneContract {
  schema: typeof EDIT_LANE_SCHEMA
  lane: EditLaneID
  status: EditLaneStatus
  capabilityGated: boolean
  route: EditLaneRouteContract
  fallbacks: readonly LspSemanticFallbackContract[]
}

type EditToolIDManifest = readonly EditToolID[] & {
  readonly edit?: "edit"
  readonly write?: "write"
  readonly applyPatch?: "apply_patch"
  readonly multiedit?: "multiedit"
  readonly pathEdit?: "path_edit"
  readonly dataEdit?: "data_edit"
  readonly frontmatterEdit?: "frontmatter_edit"
  readonly markdownEdit?: "markdown_edit"
}

export const EDIT_TOOL_IDS = Object.freeze(
  Object.defineProperties([...EDIT_TOOL_ID_LIST], {
    edit: { value: "edit", enumerable: false },
    write: { value: "write", enumerable: false },
    applyPatch: { value: "apply_patch", enumerable: false },
    multiedit: { value: "multiedit", enumerable: false },
    pathEdit: { value: "path_edit", enumerable: false },
    dataEdit: { value: "data_edit", enumerable: false },
    frontmatterEdit: { value: "frontmatter_edit", enumerable: false },
    markdownEdit: { value: "markdown_edit", enumerable: false },
  }),
) as EditToolIDManifest

const EDIT_TARGET_PUBLIC_TOOL_ID_LIST = ["edit", "write", "apply_patch", "path_edit"] as const

export const EDIT_TARGET_PUBLIC_TOOL_IDS = Object.freeze([
  ...EDIT_TARGET_PUBLIC_TOOL_ID_LIST,
]) as readonly EditTargetPublicToolID[]

const SEMANTIC_EDIT_FALLBACK_REASON_LIST = [
  "language_server_unavailable",
  "semantic_operations_unsupported",
  "unsupported_language",
  "semantic_edit_failed",
  "binary_target",
  "non_text_target",
  "reproducibility_sensitive",
] as const satisfies readonly LspSemanticFallbackReason[]

const SEMANTIC_EDIT_FALLBACK_SPECS = {
  language_server_unavailable: {
    action: "fallback",
    safe: true,
    fallbackTool: EDIT_TOOL_IDS.edit ?? "edit",
  },
  semantic_operations_unsupported: {
    action: "fallback",
    safe: true,
    fallbackTool: EDIT_TOOL_IDS.edit ?? "edit",
  },
  unsupported_language: {
    action: "fallback",
    safe: true,
    fallbackTool: EDIT_TOOL_IDS.edit ?? "edit",
  },
  semantic_edit_failed: {
    action: "fallback",
    safe: true,
    fallbackTool: EDIT_TOOL_IDS.applyPatch ?? "apply_patch",
  },
  binary_target: {
    action: "fallback",
    safe: true,
    fallbackTool: EDIT_TOOL_IDS.pathEdit ?? "path_edit",
  },
  non_text_target: {
    action: "fallback",
    safe: true,
    fallbackTool: EDIT_TOOL_IDS.edit ?? "edit",
  },
  reproducibility_sensitive: {
    action: "fallback",
    safe: true,
    fallbackTool: EDIT_TOOL_IDS.applyPatch ?? "apply_patch",
  },
} as const satisfies Record<LspSemanticFallbackReason, Omit<LspSemanticFallbackContract, "reason">>

export const EDIT_LSP_SEMANTIC_FALLBACKS = Object.freeze(
  SEMANTIC_EDIT_FALLBACK_REASON_LIST.map((reason) => ({
    reason,
    ...SEMANTIC_EDIT_FALLBACK_SPECS[reason],
  })),
) as readonly LspSemanticFallbackContract[]

const EDIT_LANE_ID_LIST = ["text", "lsp_semantic"] as const

export const EDIT_LANE_IDS = Object.freeze([...EDIT_LANE_ID_LIST]) as readonly EditLaneID[]

const EDIT_TEXT_LANE_VALUE = {
  schema: EDIT_LANE_SCHEMA,
  lane: "text",
  status: "stable",
  capabilityGated: false,
  route: {
    approval: "approval",
    preview: "preview",
    approvalPreview: "approvalPreview",
    result: "result",
  },
  fallbacks: [],
} as const satisfies EditLaneContract

export const EDIT_TEXT_LANE = Object.freeze(EDIT_TEXT_LANE_VALUE)

const EDIT_LSP_SEMANTIC_LANE_VALUE = {
  schema: EDIT_LANE_SCHEMA,
  lane: "lsp_semantic",
  status: "stable",
  capabilityGated: true,
  route: {
    approval: "approvalPreview",
    preview: "approvalPreview",
    approvalPreview: "approvalPreview",
    result: "result",
  },
  fallbacks: EDIT_LSP_SEMANTIC_FALLBACKS,
} as const satisfies EditLaneContract

export const EDIT_LSP_SEMANTIC_LANE = Object.freeze(EDIT_LSP_SEMANTIC_LANE_VALUE)

// Lane contracts are additive descriptors only; they do not create new public tool ids.
const EDIT_LANE_CONTRACTS_VALUE = {
  text: EDIT_TEXT_LANE,
  lsp_semantic: EDIT_LSP_SEMANTIC_LANE,
} as const satisfies Record<EditLaneID, EditLaneContract>

export const EDIT_LANE_CONTRACTS = Object.freeze(EDIT_LANE_CONTRACTS_VALUE)

const EDIT_NO_SURFACE_ALIASES = Object.freeze([]) as readonly EditSurfaceAliasContract[]
const EDIT_SURFACE_MIGRATIONS_VALUE = [
  {
    source: "multiedit",
    target: "edit",
    mode: "batch",
  },
  {
    source: "data_edit",
    target: "edit",
    mode: "structured-data",
  },
  {
    source: "frontmatter_edit",
    target: "edit",
    mode: "structured-frontmatter",
  },
  {
    source: "markdown_edit",
    target: "edit",
    mode: "structured-markdown",
  },
] as const satisfies readonly EditSurfaceMigrationContract[]

export const EDIT_SURFACE_MIGRATIONS = Object.freeze(EDIT_SURFACE_MIGRATIONS_VALUE)

const EDIT_SURFACE_DEPRECATIONS_VALUE = [
  {
    id: "multiedit",
    replacement: "edit",
    replacementMode: "batch",
  },
  {
    id: "data_edit",
    replacement: "edit",
    replacementMode: "structured-data",
  },
  {
    id: "frontmatter_edit",
    replacement: "edit",
    replacementMode: "structured-frontmatter",
  },
  {
    id: "markdown_edit",
    replacement: "edit",
    replacementMode: "structured-markdown",
  },
] as const satisfies readonly EditSurfaceDeprecationContract[]

export const EDIT_SURFACE_DEPRECATIONS = Object.freeze(EDIT_SURFACE_DEPRECATIONS_VALUE)

const EDIT_RUNTIME_SDK_BOUNDARY_VALUE = {
  canonicalEditMetadata: "runtime-only",
  semanticLaneDescriptors: "runtime-only",
  followupResults: "runtime-only",
} as const satisfies EditRuntimeSDKBoundaryContract

export const EDIT_RUNTIME_SDK_BOUNDARY = Object.freeze(EDIT_RUNTIME_SDK_BOUNDARY_VALUE)

const EDIT_RUNTIME_SURFACE_POLICY_VALUE = {
  aliases: EDIT_NO_SURFACE_ALIASES,
  deprecations: EDIT_SURFACE_DEPRECATIONS,
  targetPublicTools: EDIT_TARGET_PUBLIC_TOOL_IDS,
  migrations: EDIT_SURFACE_MIGRATIONS,
  semanticLane: {
    lane: EDIT_LSP_SEMANTIC_LANE.lane,
    publicToolID: null,
    runtimeOnly: true,
    capabilityGated: EDIT_LSP_SEMANTIC_LANE.capabilityGated,
    status: EDIT_LSP_SEMANTIC_LANE.status,
  },
} as const satisfies EditSurfacePolicyContract

export const EDIT_RUNTIME_SURFACE_POLICY = Object.freeze(EDIT_RUNTIME_SURFACE_POLICY_VALUE)

const EDIT_LSP_INTEGRATION_VALUE = {
  embedded: true,
  alwaysOnTarget: true,
  semanticLane: "lsp_semantic",
  standaloneToolID: "lsp",
  targetPublicToolID: null,
  capabilityGated: true,
  capabilities: {
    rename: true,
    prepareRename: true,
    codeAction: true,
    codeActionResolve: true,
    executeCommand: true,
    documentChanges: true,
    applyEdit: true,
    diagnostics: true,
    changeAnnotations: true,
    resourceOperations: ["create", "rename", "delete"],
    failureHandling: ["abort", "transactional", "undo", "textOnlyTransactional"],
    positionEncodings: ["utf-16", "utf-8", "utf-32"],
  },
  querySurface: {
    standaloneToolID: "lsp",
    operations: [
      "goToDefinition",
      "findReferences",
      "hover",
      "documentSymbol",
      "workspaceSymbol",
      "goToImplementation",
      "prepareCallHierarchy",
      "incomingCalls",
      "outgoingCalls",
    ],
    targetPublicToolID: null,
    runtimeOnlyTarget: false,
  },
} as const satisfies EditLspIntegrationContract

export const EDIT_LSP_INTEGRATION = Object.freeze(EDIT_LSP_INTEGRATION_VALUE)

export interface EditRuntimeContracts {
  schema: typeof EDIT_RUNTIME_CONTRACT_SCHEMA
  toolIDs: readonly EditToolID[]
  toolSpecs: Readonly<Record<EditToolID, EditToolSpec>>
  laneIDs: readonly EditLaneID[]
  laneContracts: Readonly<Record<EditLaneID, EditLaneContract>>
  semanticFallbacks: readonly LspSemanticFallbackContract[]
  sdkBoundary: EditRuntimeSDKBoundaryContract
  surfacePolicy: EditSurfacePolicyContract
  lsp: EditLspIntegrationContract
}

const EDIT_RUNTIME_CONTRACTS_VALUE = {
  schema: EDIT_RUNTIME_CONTRACT_SCHEMA,
  toolIDs: EDIT_TOOL_IDS,
  toolSpecs: EDIT_TOOL_SPECS,
  laneIDs: EDIT_LANE_IDS,
  laneContracts: EDIT_LANE_CONTRACTS,
  semanticFallbacks: EDIT_LSP_SEMANTIC_FALLBACKS,
  sdkBoundary: EDIT_RUNTIME_SDK_BOUNDARY,
  surfacePolicy: EDIT_RUNTIME_SURFACE_POLICY,
  lsp: EDIT_LSP_INTEGRATION,
} as const satisfies EditRuntimeContracts

export const EDIT_RUNTIME_CONTRACTS = Object.freeze(EDIT_RUNTIME_CONTRACTS_VALUE)

export const EDIT_CONTRACT_SCHEMA = "opencode/edit-contract/v1" as const
export const EDIT_FOLLOWUP_RESULT_SCHEMA = "opencode/edit-followup-result/v1" as const

export type EditApprovalStatus = "not-requested" | "pending" | "approved-once" | "approved-always" | "rejected"
export type EditFollowupState = "approval-pending" | "result-pending" | "fallback" | "rejected" | "completed"

export interface EditFollowupResult {
  schema: typeof EDIT_FOLLOWUP_RESULT_SCHEMA
  sdkBoundary: EditRuntimeSDKBoundary
  lane: EditLaneID
  status: EditLaneStatus
  capabilityGated: boolean
  approvalStatus: EditApprovalStatus
  approvalReply?: Permission.Reply
  followupState: EditFollowupState
  surfacePolicy: EditSurfacePolicyContract
  reason?: LspSemanticFallbackReason
  fallback?: LspSemanticFallbackContract
}

export interface SemanticEditCapabilities {
  rename: boolean
  codeAction: boolean
  executeCommand: boolean
  semanticOperationSupported: boolean
}

export interface EvaluateSemanticEditLaneInput {
  language?: string
  supportedLanguages?: Iterable<string>
  languageServerAvailable?: boolean
  capabilities?: Partial<Omit<SemanticEditCapabilities, "semanticOperationSupported">>
  isTextDocument?: boolean
  isBinary?: boolean
  reproducibilitySensitive?: boolean
  semanticEditFailed?: boolean
}

export interface SemanticEditLaneDecision {
  lane: "lsp_semantic"
  status: "stable"
  capabilityGated: true
  available: boolean
  reason?: LspSemanticFallbackReason
  capabilities: SemanticEditCapabilities
  gating: {
    languageServerAvailable: boolean
    semanticOperationSupported: boolean
    languageSupported: boolean
    textDocument: boolean
    binaryTarget: boolean
    reproducibilitySensitive: boolean
    previousFailure: boolean
  }
  fallback?: LspSemanticFallbackContract
}

export interface SemanticEditContract {
  schema: typeof EDIT_CONTRACT_SCHEMA
  lane: "lsp_semantic"
  status: "stable"
  capabilityGated: true
  approval: EditContractBody
  preview: EditContractBody
  approvalPreview: EditContractBody
  result: EditContractBody
  decision: SemanticEditLaneDecision
  legacy: {
    metadata: AnyRecord
  }
}

export interface NormalizeSemanticEditContractInput {
  metadata?: unknown
  evaluation?: EvaluateSemanticEditLaneInput
}

export interface NormalizeEditFollowupResultInput {
  lane?: EditLaneID
  approvalPending?: boolean
  approvalReply?: Permission.Reply
  evaluation?: EvaluateSemanticEditLaneInput
  completed?: boolean
}

export interface EditFileContract {
  path?: string
  filePath?: string
  relativePath?: string
  movePath?: string
  type?: string
  patch?: string
  additions?: number
  deletions?: number
}

export interface EditStepContract {
  index: number
  diff?: string
  files: EditFileContract[]
  paths: string[]
  operations: string[]
}

export interface EditContractBody {
  kind: EditPreviewKind
  diff?: string
  patchText?: string
  files: EditFileContract[]
  paths: string[]
  operations: string[]
  steps: EditStepContract[]
}

export interface CanonicalEditContract {
  schema: typeof EDIT_CONTRACT_SCHEMA
  tool: EditToolID
  targetPublicToolID?: EditTargetPublicToolID
  mergedMode?: EditMergedToolMode
  lane?: EditLaneID
  family: EditToolFamily
  previewKind: EditPreviewKind
  publicStatus: EditPublicStatus
  execution: EditExecution
  grouped: boolean
  defaultOpen: boolean
  gating: {
    modelRouted: boolean
    capabilityGated: boolean
  }
  approval: EditContractBody
  preview: EditContractBody
  approvalPreview: EditContractBody
  result: EditContractBody
  legacy: {
    metadata: AnyRecord
    input: AnyRecord
  }
}

export interface NormalizedEditMetadata {
  tool: EditToolID
  spec: EditToolSpec
  input: AnyRecord
  metadata: AnyRecord & {
    approval: EditContractBody
    preview: EditContractBody
    result: EditContractBody
    edit: CanonicalEditContract
  }
  edit: CanonicalEditContract
}

export interface NormalizeEditMetadataInput {
  tool: string
  metadata?: unknown
  input?: unknown
}
