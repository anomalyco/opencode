import { Permission } from "../../permission"
import { Wildcard } from "../../util/wildcard"
import {
  EDIT_CONTRACT_SCHEMA,
  EDIT_FOLLOWUP_RESULT_SCHEMA,
  EDIT_LANE_CONTRACTS,
  EDIT_LANE_IDS,
  EDIT_RUNTIME_SDK_BOUNDARY,
  EDIT_RUNTIME_SURFACE_POLICY,
  EDIT_TOOL_IDS,
  EDIT_TOOL_SPECS,
  type EditContractBody,
  type EditFileContract,
  type EditFollowupResult,
  type EditLaneID,
  type EditMergedToolMode,
  type EditPreviewKind,
  type EditStepContract,
  type EditTargetPublicToolID,
  type EditToolID,
  type EditToolSpec,
  type EvaluateSemanticEditLaneInput,
  type LspSemanticFallbackContract,
  type LspSemanticFallbackReason,
  type NormalizedEditMetadata,
  type NormalizeEditFollowupResultInput,
  type NormalizeEditMetadataInput,
  type NormalizeSemanticEditContractInput,
  type SemanticEditCapabilities,
  type SemanticEditContract,
  type SemanticEditLaneDecision,
} from "./contract"

type AnyRecord = Record<string, unknown>

const EDIT_TOOL_ID_SET = new Set<string>(EDIT_TOOL_IDS)
const EDIT_LANE_ID_SET = new Set<string>(EDIT_LANE_IDS)

export function isEditTool(tool: string): tool is EditToolID {
  return EDIT_TOOL_ID_SET.has(tool)
}

export function isEditLane(lane: string): lane is EditLaneID {
  return EDIT_LANE_ID_SET.has(lane)
}

export function editPermissionFor(tool: string) {
  return isEditTool(tool) ? "edit" : tool
}

export function disabledToolIDs(toolIDs: Iterable<string>, ruleset: Permission.Ruleset) {
  const disabled = new Set<string>()
  const editToolID = EDIT_TOOL_IDS.edit ?? "edit"
  const editDisabled = Permission.disabled([editToolID], ruleset).has(editToolID)

  for (const tool of toolIDs) {
    if (Permission.disabled([tool], ruleset).has(tool)) {
      disabled.add(tool)
      continue
    }

    if (!isEditTool(tool) || !editDisabled) continue

    const hasSpecificRule = ruleset.some(
      (rule) => rule.permission !== "*" && rule.permission !== "edit" && Wildcard.match(tool, rule.permission),
    )
    if (!hasSpecificRule) disabled.add(tool)
  }

  return disabled
}

export function evaluateSemanticEditLane(input: EvaluateSemanticEditLaneInput = {}): SemanticEditLaneDecision {
  const capabilities = normalizeSemanticCapabilities(input.capabilities)
  const gating = {
    languageServerAvailable: input.languageServerAvailable === true,
    semanticOperationSupported: capabilities.semanticOperationSupported,
    languageSupported: isSupportedLanguage(input.language, input.supportedLanguages),
    textDocument: input.isTextDocument !== false,
    binaryTarget: input.isBinary === true,
    reproducibilitySensitive: input.reproducibilitySensitive === true,
    previousFailure: input.semanticEditFailed === true,
  }

  const reason = gating.binaryTarget
    ? "binary_target"
    : !gating.textDocument
      ? "non_text_target"
      : gating.reproducibilitySensitive
        ? "reproducibility_sensitive"
        : gating.previousFailure
          ? "semantic_edit_failed"
          : !gating.languageSupported
            ? "unsupported_language"
            : !gating.languageServerAvailable
              ? "language_server_unavailable"
              : !gating.semanticOperationSupported
                ? "semantic_operations_unsupported"
                : undefined

  return {
    lane: "lsp_semantic",
    status: "stable",
    capabilityGated: true,
    available: !reason,
    reason,
    capabilities,
    gating,
    fallback: reason ? semanticFallback(reason) : undefined,
  }
}

export function normalizeEditFollowupResult(input: NormalizeEditFollowupResultInput = {}): EditFollowupResult {
  const lane = input.lane ?? (input.evaluation ? "lsp_semantic" : "text")
  const contract = EDIT_LANE_CONTRACTS[lane]
  const decision = input.evaluation ? evaluateSemanticEditLane(input.evaluation) : undefined
  const approvalStatus = followupApprovalStatus(input.approvalPending, input.approvalReply)

  const followupState = approvalStatus === "pending"
    ? "approval-pending"
    : approvalStatus === "rejected"
      ? "rejected"
      : input.completed === true
        ? "completed"
        : decision && !decision.available
          ? "fallback"
          : "result-pending"

  return {
    schema: EDIT_FOLLOWUP_RESULT_SCHEMA,
    sdkBoundary: EDIT_RUNTIME_SDK_BOUNDARY.followupResults,
    lane,
    status: contract.status,
    capabilityGated: contract.capabilityGated,
    approvalStatus,
    approvalReply: input.approvalReply,
    followupState,
    surfacePolicy: EDIT_RUNTIME_SURFACE_POLICY,
    reason: decision?.reason,
    fallback: decision?.fallback,
  }
}

export function normalizeSemanticEditContract(input: NormalizeSemanticEditContractInput = {}): SemanticEditContract {
  const rawMetadata = record(input.metadata)
  const existing = record(rawMetadata.edit)
  const existingApproval = record(existing.approval)
  const existingPreview = record(existing.preview)
  const existingApprovalPreview = record(existing.approvalPreview)
  const existingResult = record(existing.result)

  const derivedSteps = normalizeSteps(rawMetadata.results)
  const derivedFiles = collectFiles(rawMetadata, {})
  const derivedOperations = collectOperations(rawMetadata, {})
  const derivedDiff = string(rawMetadata.diff) ?? mergeDiffs(derivedSteps) ?? mergePatches(derivedFiles)
  const fallbackKind = derivedDiff ? "diff" : "structured"

  const base = normalizeBody(existingApprovalPreview, fallbackKind, {
    kind: fallbackKind,
    diff: derivedDiff,
    patchText: string(rawMetadata.patchText),
    files: derivedFiles,
    operations: derivedOperations,
    steps: derivedSteps,
    paths: collectPaths(rawMetadata, {}, derivedFiles, derivedSteps),
  })

  const approval = normalizeBody(existingApproval, base.kind, base)
  const preview = normalizeBody(existingPreview, base.kind, {
    ...approval,
    ...base,
  })
  const approvalPreview = normalizeBody(existingApprovalPreview, base.kind, {
    ...preview,
  })
  const result = normalizeBody(existingResult, base.kind, {
    ...approvalPreview,
  })

  return {
    schema: EDIT_CONTRACT_SCHEMA,
    lane: "lsp_semantic",
    status: "stable",
    capabilityGated: true,
    approval,
    preview,
    approvalPreview,
    result,
    decision: evaluateSemanticEditLane(input.evaluation),
    legacy: {
      metadata: rawMetadata,
    },
  }
}

export function normalizeEditMetadata(input: NormalizeEditMetadataInput): NormalizedEditMetadata | undefined
export function normalizeEditMetadata(
  tool: string,
  metadata?: unknown,
  input?: unknown,
): NormalizedEditMetadata | undefined
export function normalizeEditMetadata(
  input: NormalizeEditMetadataInput | string,
  metadata?: unknown,
  toolInput?: unknown,
): NormalizedEditMetadata | undefined {
  const source = typeof input === "string" ? { tool: input, metadata, input: toolInput } : input
  if (!isEditTool(source.tool)) return undefined

  const rawMetadata = record(source.metadata)
  const rawInput = record(source.input)
  const spec = effectiveEditSpec(source.tool, rawInput)
  const existing = record(rawMetadata.edit)

  const derivedSteps = normalizeSteps(rawMetadata.results)
  const existingApproval = record(existing.approval)
  const existingPreview = record(existing.preview)
  const existingApprovalPreview = record(existing.approvalPreview)
  const existingResult = record(existing.result)

  const derivedFiles = collectFiles(rawMetadata, rawInput)
  const derivedOperations = collectOperations(rawMetadata, rawInput)
  const derivedDiff = string(rawMetadata.diff) ?? mergeDiffs(derivedSteps) ?? mergePatches(derivedFiles)
  const derivedPatchText =
    source.tool === (EDIT_TOOL_IDS.applyPatch ?? "apply_patch") ? string(rawInput.patchText) : undefined

  const approval = normalizeBody(existingApproval, spec.previewKind, {
    kind: spec.previewKind,
    diff: derivedDiff,
    patchText: derivedPatchText,
    files: derivedFiles,
    operations: derivedOperations,
    steps: derivedSteps,
    paths: collectPaths(rawMetadata, rawInput, derivedFiles, derivedSteps),
  })

  const preview = normalizeBody(existingPreview, spec.previewKind, {
    ...approval,
    ...normalizeBody(existingApprovalPreview, spec.previewKind, approval),
  })

  const approvalPreview = normalizeBody(existingApprovalPreview, spec.previewKind, preview)

  const result = normalizeBody(existingResult, spec.previewKind, {
    ...preview,
  })

  const edit = {
    schema: EDIT_CONTRACT_SCHEMA,
    tool: source.tool,
    targetPublicToolID: targetPublicToolID(source.tool),
    mergedMode: mergedMode(source.tool, rawInput),
    lane: normalizedLane(source.tool, rawInput, rawMetadata),
    family: spec.family,
    previewKind: spec.previewKind,
    publicStatus: spec.publicStatus,
    execution: spec.execution,
    grouped: spec.grouped,
    defaultOpen: spec.defaultOpen,
    gating: {
      modelRouted: spec.modelRouted,
      capabilityGated: spec.capabilityGated,
    },
    approval,
    preview,
    approvalPreview,
    result,
    legacy: {
      metadata: rawMetadata,
      input: rawInput,
    },
  } satisfies NormalizedEditMetadata["edit"]

  return {
    tool: source.tool,
    spec,
    input: rawInput,
    metadata: {
      ...rawMetadata,
      approval,
      preview,
      result,
      edit,
    },
    edit,
  }
}

function targetPublicToolID(tool: EditToolID): EditTargetPublicToolID | undefined {
  if (tool === (EDIT_TOOL_IDS.edit ?? "edit")) return EDIT_TOOL_IDS.edit ?? "edit"
  if (tool === (EDIT_TOOL_IDS.write ?? "write")) return EDIT_TOOL_IDS.write ?? "write"
  if (tool === (EDIT_TOOL_IDS.applyPatch ?? "apply_patch")) return EDIT_TOOL_IDS.applyPatch ?? "apply_patch"
  if (tool === (EDIT_TOOL_IDS.pathEdit ?? "path_edit")) return EDIT_TOOL_IDS.pathEdit ?? "path_edit"
  if (
    tool === (EDIT_TOOL_IDS.multiedit ?? "multiedit") ||
    tool === (EDIT_TOOL_IDS.dataEdit ?? "data_edit") ||
    tool === (EDIT_TOOL_IDS.frontmatterEdit ?? "frontmatter_edit") ||
    tool === (EDIT_TOOL_IDS.markdownEdit ?? "markdown_edit")
  ) {
    return EDIT_TOOL_IDS.edit ?? "edit"
  }
}

function mergedMode(tool: EditToolID, input: AnyRecord): EditMergedToolMode | undefined {
  if (tool === (EDIT_TOOL_IDS.multiedit ?? "multiedit")) return "batch"
  if (tool === (EDIT_TOOL_IDS.dataEdit ?? "data_edit")) return "structured-data"
  if (tool === (EDIT_TOOL_IDS.frontmatterEdit ?? "frontmatter_edit")) return "structured-frontmatter"
  if (tool === (EDIT_TOOL_IDS.markdownEdit ?? "markdown_edit")) return "structured-markdown"
  if (tool !== (EDIT_TOOL_IDS.edit ?? "edit")) return
  if (Array.isArray(input.edits)) return "batch"
  const mode = string(input.mode)
  if (mode === "data") return "structured-data"
  if (mode === "frontmatter") return "structured-frontmatter"
  if (mode === "markdown") return "structured-markdown"
}

function normalizedLane(tool: EditToolID, input: AnyRecord, metadata: AnyRecord): EditLaneID | undefined {
  if (targetPublicToolID(tool) !== (EDIT_TOOL_IDS.edit ?? "edit")) return
  if (record(metadata.semantic).rename === true) return "lsp_semantic"
  if (tool === (EDIT_TOOL_IDS.edit ?? "edit") || mergedMode(tool, input)) return "text"
}

function effectiveEditSpec(tool: EditToolID, input: AnyRecord): EditToolSpec {
  const spec = EDIT_TOOL_SPECS[tool]
  if (tool !== (EDIT_TOOL_IDS.edit ?? "edit")) return spec
  const mode = string(input.mode)
  if (mode === "data" || mode === "frontmatter" || mode === "markdown") {
    return {
      ...spec,
      previewKind: "structured",
      execution: "single",
      grouped: true,
    }
  }
  return spec
}

function normalizeBody(value: unknown, fallbackKind: EditPreviewKind, fallback: EditContractBody): EditContractBody {
  const body = record(value)
  const steps = dedupeSteps([...normalizeStepList(body.steps), ...fallback.steps])
  const files = dedupeFiles([
    ...normalizeFileList(body.files),
    ...fallback.files,
    ...steps.flatMap((item) => item.files),
  ])
  const operations = dedupeStrings([
    ...strings(body.operations),
    ...fallback.operations,
    ...steps.flatMap((item) => item.operations),
  ])
  const diff = string(body.diff) ?? fallback.diff ?? mergeDiffs(steps) ?? mergePatches(files)
  const patchText = string(body.patchText) ?? fallback.patchText
  const paths = dedupeStrings([
    ...strings(body.paths),
    ...fallback.paths,
    ...files.flatMap(filePaths),
    ...steps.flatMap((item) => item.paths),
  ])

  return {
    kind: previewKind(body.kind) ?? fallbackKind,
    diff,
    patchText,
    files,
    paths,
    operations,
    steps,
  }
}

function normalizeSteps(value: unknown) {
  if (!Array.isArray(value)) return [] as EditStepContract[]
  return value.map((item, index) => normalizeStep(item, index)).filter((item): item is EditStepContract => !!item)
}

function normalizeStep(value: unknown, fallbackIndex: number): EditStepContract | undefined {
  const item = record(value)
  const index = number(item.index) ?? fallbackIndex
  const files = collectFiles(item, {})
  const operations = collectOperations(item, {})
  const paths = collectPaths(item, {}, files, [])
  const diff = string(item.diff) ?? mergePatches(files)

  if (!files.length && !operations.length && !paths.length && !diff) return undefined

  return {
    index,
    diff,
    files,
    paths,
    operations,
  }
}

function normalizeStepList(value: unknown) {
  if (!Array.isArray(value)) return [] as EditStepContract[]
  return value
    .map((item, index) => normalizeExistingStep(item, index))
    .filter((item): item is EditStepContract => !!item)
}

function normalizeExistingStep(value: unknown, fallbackIndex: number): EditStepContract | undefined {
  const item = record(value)
  const files = dedupeFiles(normalizeFileList(item.files))
  const operations = dedupeStrings(strings(item.operations))
  const paths = dedupeStrings([...strings(item.paths), ...files.flatMap(filePaths)])
  const diff = string(item.diff) ?? mergePatches(files)
  const index = number(item.index) ?? fallbackIndex

  if (!files.length && !operations.length && !paths.length && !diff) return undefined

  return {
    index,
    diff,
    files,
    paths,
    operations,
  }
}

function collectFiles(metadata: AnyRecord, input: AnyRecord) {
  const files = dedupeFiles([
    ...normalizeFileList(metadata.files),
    ...normalizeFileList(metadata.edit && record(metadata.edit).result && record(record(metadata.edit).result).files),
    ...normalizeFileList(
      metadata.edit && record(metadata.edit).approvalPreview && record(record(metadata.edit).approvalPreview).files,
    ),
    ...fileDiffList(metadata.filediff),
  ])

  if (files.length) return files

  const fallbackPaths = splitPaths(metadata.filepath)
  const inputFilePath = string(input.filePath)
  const fallback: EditFileContract[] = fallbackPaths.map((item) => ({ path: item }))

  if (inputFilePath) {
    const match = fallback.find((item) => item.path === inputFilePath)
    if (match) match.filePath = inputFilePath
    else fallback.push({ path: inputFilePath, filePath: inputFilePath })
  }

  return fallback
}

function collectOperations(metadata: AnyRecord, input: AnyRecord) {
  return dedupeStrings([...strings(metadata.operations), ...describeOperations(input.operations)])
}

function collectPaths(metadata: AnyRecord, input: AnyRecord, files: EditFileContract[], steps: EditStepContract[]) {
  return dedupeStrings([
    ...splitPaths(metadata.filepath),
    ...optional(metadata.source),
    ...optional(metadata.target),
    ...optional(metadata.backup),
    ...optional(input.filePath),
    ...optional(input.path),
    ...inputOperationPaths(input.operations),
    ...files.flatMap(filePaths),
    ...steps.flatMap((item) => item.paths),
  ])
}

function fileDiffList(value: unknown) {
  const file = normalizeFileDiff(value)
  return file ? [file] : []
}

function normalizeFileDiff(value: unknown): EditFileContract | undefined {
  const item = record(value)
  const file = string(item.file)
  if (!file) return undefined
  return compactFile({
    path: file,
    filePath: file,
    patch: string(item.patch),
    additions: number(item.additions),
    deletions: number(item.deletions),
    type: string(item.status),
  })
}

function normalizeFileList(value: unknown) {
  if (!Array.isArray(value)) return [] as EditFileContract[]
  return value.map(normalizeFile).filter((item): item is EditFileContract => !!item)
}

function normalizeFile(value: unknown): EditFileContract | undefined {
  if (typeof value === "string") return compactFile({ path: value })

  const item = record(value)
  const filePath = string(item.filePath)
  const relativePath = string(item.relativePath)
  const movePath = string(item.movePath)
  const path = filePath ?? relativePath ?? string(item.file) ?? string(item.path)
  return compactFile({
    path,
    filePath,
    relativePath,
    movePath,
    patch: string(item.patch),
    additions: number(item.additions),
    deletions: number(item.deletions),
    type: string(item.type) ?? string(item.action) ?? string(item.status),
  })
}

function compactFile(value: EditFileContract): EditFileContract | undefined {
  if (!value.path && !value.filePath && !value.relativePath && !value.movePath && !value.patch && !value.type) {
    if (value.additions === undefined && value.deletions === undefined) return undefined
  }

  return value
}

function filePaths(value: EditFileContract) {
  return dedupeStrings([value.path, value.filePath, value.relativePath, value.movePath])
}

function describeOperations(value: unknown) {
  if (!Array.isArray(value)) return [] as string[]
  return value.map((item) => describeOperation(record(item))).filter((item): item is string => !!item)
}

function describeOperation(value: AnyRecord) {
  const action = string(value.action)
  if (!action) return undefined
  const source = string(value.source)
  const target = string(value.target)

  if (action === "mkdir") return target ? `${action} ${target}` : action
  if (source && target) return `${action} ${source} -> ${target}`
  if (source) return `${action} ${source}`
  if (target) return `${action} ${target}`
  return action
}

function inputOperationPaths(value: unknown) {
  if (!Array.isArray(value)) return [] as string[]
  const out: string[] = []
  for (const item of value) {
    const op = record(item)
    const source = string(op.source)
    const target = string(op.target)
    if (source) out.push(source)
    if (target) out.push(target)
  }
  return dedupeStrings(out)
}

function previewKind(value: unknown) {
  if (value === "diff" || value === "patch" || value === "operations" || value === "structured") return value
  return undefined
}

function mergeDiffs(steps: EditStepContract[]) {
  const diffs = steps.map((item) => item.diff).filter((item): item is string => !!item)
  if (!diffs.length) return undefined
  return diffs.join("\n")
}

function mergePatches(files: EditFileContract[]) {
  const diffs = files.map((item) => item.patch).filter((item): item is string => !!item)
  if (!diffs.length) return undefined
  return diffs.join("\n")
}

function splitPaths(value: unknown) {
  const text = string(value)
  if (!text) return [] as string[]
  return dedupeStrings(
    text
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  )
}

function strings(value: unknown) {
  if (!Array.isArray(value)) return [] as string[]
  return dedupeStrings(value.map(string).filter((item): item is string => !!item))
}

function optional(value: unknown) {
  const out = string(value)
  return out ? [out] : []
}

function dedupeFiles(values: EditFileContract[]) {
  const out: EditFileContract[] = []
  const seen = new Set<string>()
  for (const item of values) {
    const key = JSON.stringify(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function dedupeSteps(values: EditStepContract[]) {
  const out: EditStepContract[] = []
  const seen = new Set<string>()
  for (const item of values) {
    const key = JSON.stringify(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out.sort((a, b) => a.index - b.index)
}

function dedupeStrings(values: Array<string | undefined>) {
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of values) {
    const next = string(item)
    if (!next || seen.has(next)) continue
    seen.add(next)
    out.push(next)
  }
  return out
}

function semanticFallback(reason: LspSemanticFallbackReason): LspSemanticFallbackContract {
  const fallback = EDIT_LANE_CONTRACTS.lsp_semantic.fallbacks.find((item) => item.reason === reason)
  if (fallback) return fallback
  return {
    reason,
    action: "fallback",
    safe: true,
  }
}

function followupApprovalStatus(
  pending: boolean | undefined,
  reply: Permission.Reply | undefined,
): EditFollowupResult["approvalStatus"] {
  if (reply === "once") return "approved-once"
  if (reply === "always") return "approved-always"
  if (reply === "reject") return "rejected"
  if (pending === true) return "pending"
  return "not-requested"
}

function normalizeSemanticCapabilities(value: EvaluateSemanticEditLaneInput["capabilities"]): SemanticEditCapabilities {
  const rename = value?.rename === true
  const codeAction = value?.codeAction === true
  const executeCommand = value?.executeCommand === true
  return {
    rename,
    codeAction,
    executeCommand,
    semanticOperationSupported: rename || codeAction || executeCommand,
  }
}

function isSupportedLanguage(language?: string, supportedLanguages?: Iterable<string>) {
  const current = normalizeLanguage(language)
  if (!current || !supportedLanguages) return true

  let found = false
  for (const item of supportedLanguages) {
    found = true
    if (normalizeLanguage(item) === current) return true
  }

  return !found
}

function normalizeLanguage(value: unknown) {
  if (typeof value !== "string") return undefined
  const out = value.trim().toLowerCase()
  return out ? out : undefined
}

function record(value: unknown): AnyRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as AnyRecord
}

function string(value: unknown) {
  if (typeof value !== "string") return undefined
  const out = value.trim()
  return out ? out : undefined
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}
