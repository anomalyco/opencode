import path from "path"
import { Global } from "@kancode/core/global"
import { FSUtil } from "@kancode/core/fs-util"
import { Effect } from "effect"
import { isRecord } from "@/util/record"

export type ModelRef = {
  providerID: string
  modelID: string
}

export type AttachmentFallbackState = {
  attachmentFallback: ModelRef | null
  modelAttachmentFallback: Record<string, ModelRef | null>
}

const MODEL_FILE = path.join(Global.Path.state, "model.json")

function parseTarget(value: unknown): ModelRef | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.providerID !== "string") return undefined
  if (typeof value.modelID !== "string") return undefined
  return { providerID: value.providerID, modelID: value.modelID }
}

/** Defensive parse matching the TUI `modelStore` loader for vision-fallback keys. */
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
 * Resolve effective vision fallback for a primary model.
 * Per-model map entry (including explicit `null` opt-out) wins; otherwise global.
 * Returns `undefined` when there is no usable target.
 */
export function fallbackFor(state: AttachmentFallbackState, primary: ModelRef): ModelRef | undefined {
  const key = modelKey(primary)
  if (key in state.modelAttachmentFallback) {
    return state.modelAttachmentFallback[key] ?? undefined
  }
  return state.attachmentFallback ?? undefined
}

export const readFallbackFor = Effect.fn("ModelState.readFallbackFor")(function* (primary: ModelRef) {
  const fs = yield* FSUtil.Service
  const raw = yield* fs.readJson(MODEL_FILE).pipe(
    Effect.catch(() => Effect.succeed(undefined as unknown)),
  )
  return fallbackFor(parseAttachmentFallbackState(raw), primary)
})

export * as ModelState from "./model-state"
