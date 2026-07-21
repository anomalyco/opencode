export type ModelRef = {
  providerID: string
  modelID: string
}

export type AttachmentFallbackState = {
  attachmentFallback: ModelRef | null
  modelAttachmentFallback: Record<string, ModelRef | null>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parseTarget(value: unknown): ModelRef | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.providerID !== "string") return undefined
  if (typeof value.modelID !== "string") return undefined
  return { providerID: value.providerID, modelID: value.modelID }
}

/** Defensive parse matching `local.tsx` model.json loaders for vision-fallback keys. */
export function parseAttachmentFallbackState(raw: unknown): AttachmentFallbackState {
  if (!isRecord(raw)) {
    return { attachmentFallback: null, modelAttachmentFallback: {} }
  }

  let attachmentFallback: ModelRef | null = null
  if (raw.attachmentFallback === null) {
    attachmentFallback = null
  } else {
    const parsed = parseTarget(raw.attachmentFallback)
    if (parsed) attachmentFallback = parsed
  }

  const modelAttachmentFallback: Record<string, ModelRef | null> = {}
  if (isRecord(raw.modelAttachmentFallback)) {
    for (const [key, entry] of Object.entries(raw.modelAttachmentFallback)) {
      if (entry === null) {
        modelAttachmentFallback[key] = null
        continue
      }
      const parsed = parseTarget(entry)
      if (parsed) modelAttachmentFallback[key] = parsed
    }
  }

  return { attachmentFallback, modelAttachmentFallback }
}

export function modelKey(model: ModelRef) {
  return `${model.providerID}/${model.modelID}`
}

/**
 * Effective vision fallback for a primary model.
 * Per-model map entry (including explicit `null` opt-out) wins; otherwise global.
 */
export function fallbackFor(state: AttachmentFallbackState, primary: ModelRef): ModelRef | undefined {
  const key = modelKey(primary)
  if (key in state.modelAttachmentFallback) {
    return state.modelAttachmentFallback[key] ?? undefined
  }
  return state.attachmentFallback ?? undefined
}

/** Format a fallback target for DialogConfig labels; `(none)` for explicit opt-out. */
export function formatFallbackTarget(ref: ModelRef | null | undefined) {
  if (ref === null) return "(none)"
  if (ref === undefined) return ""
  return modelKey(ref)
}

/**
 * Apply a per-model override (or `null` opt-out). Always spreads so Solid sees a new object.
 * Callers that need Solid path-delete for clear should use `clearModelAttachmentFallbackEntry`.
 */
export function withModelAttachmentFallback(
  map: Record<string, ModelRef | null>,
  model: ModelRef,
  target: ModelRef | null,
): Record<string, ModelRef | null> {
  return {
    ...map,
    [modelKey(model)]: target,
  }
}
