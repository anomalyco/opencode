import type { TextareaRenderable } from "@opentui/core"

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export function promptOffsetWidth(value: string) {
  let width = 0
  for (const part of graphemes.segment(value)) {
    // Textarea offsets count newlines as one position; Bun.stringWidth counts them as zero.
    width += part.segment === "\n" ? 1 : Bun.stringWidth(part.segment)
  }
  return width
}

export function displayOffsetIndex(value: string, offset: number) {
  if (offset <= 0) return 0

  let width = 0
  for (const part of graphemes.segment(value)) {
    const next = width + promptOffsetWidth(part.segment)
    if (next > offset) return part.index
    width = next
  }

  return value.length
}

export function displaySlice(value: string, start = 0, end = promptOffsetWidth(value)) {
  return value.slice(displayOffsetIndex(value, start), displayOffsetIndex(value, end))
}

export function displayCharAt(value: string, offset: number) {
  let width = 0
  for (const part of graphemes.segment(value)) {
    const next = width + promptOffsetWidth(part.segment)
    if (offset === width || offset < next) return part.segment
    width = next
  }
}

export function mentionTriggerIndex(value: string, offset = promptOffsetWidth(value)) {
  const text = displaySlice(value, 0, offset)
  const index = text.lastIndexOf("@")
  if (index === -1) return

  const before = index === 0 ? undefined : text[index - 1]
  const query = text.slice(index)
  if ((before === undefined || /\s/.test(before)) && !/\s/.test(query)) {
    return promptOffsetWidth(text.slice(0, index))
  }
}

/** Snap a display-width offset to the nearest grapheme boundary. Direction
 *  "down" returns the largest offset <= the input that is a grapheme start;
 *  "up" returns the smallest offset >= the input that is a grapheme end
 *  (i.e. the offset just after the current grapheme). */
export function snapOffsetToGraphemeBoundary(
  value: string,
  offset: number,
  direction: "down" | "up",
): number {
  const total = promptOffsetWidth(value)
  if (offset <= 0) return 0
  if (offset >= total) return total

  let width = 0
  for (const part of graphemes.segment(value)) {
    const segWidth = promptOffsetWidth(part.segment)
    const next = width + segWidth
    if (direction === "down") {
      if (next > offset) return width
      if (next === offset) return offset
    } else {
      if (width >= offset) return width
      if (next >= offset) return next
    }
    width = next
  }
  return total
}

export type RangeReplaceAction =
  | { type: "setCursor"; offset: number }
  | { type: "setSelection"; start: number; end: number }
  | { type: "insertText"; value: string }
  | { type: "clearSelection" }

export interface RangeReplacePlan {
  /** Final text after the plan is applied. */
  readonly text: string
  /** Display-width cursor offset after the plan is applied. */
  readonly cursor: number
  /** Actions to perform on the textarea in order. */
  readonly actions: readonly RangeReplaceAction[]
}

/** Plan a display-width-offset range replace/insert that preserves the
 *  textarea's extmark controller (uses setSelection+insertText+clearSelection
 *  for non-empty ranges, and cursor-set+insertText for pure insertions). */
export function planRangeReplace(
  text: string,
  startOffset: number,
  endOffset: number,
  replacement: string,
): RangeReplacePlan {
  const total = promptOffsetWidth(text)
  const rawStart = Math.max(0, Math.min(startOffset, total))
  const rawEnd = Math.max(0, Math.min(endOffset, total))
  // Treat start>end as an insertion at the (smaller) start — never a delete.
  const isInsertion = rawStart === rawEnd || rawStart > rawEnd
  const insAt = Math.min(rawStart, rawEnd)

  if (isInsertion) {
    const snapped = snapOffsetToGraphemeBoundary(text, insAt, "down")
    const insertWidth = promptOffsetWidth(replacement)
    const newText = displaySlice(text, 0, snapped) + replacement + displaySlice(text, snapped)
    return {
      text: newText,
      cursor: snapped + insertWidth,
      actions: [{ type: "setCursor", offset: snapped }, { type: "insertText", value: replacement }],
    }
  }

  const sStart = Math.min(snapOffsetToGraphemeBoundary(text, rawStart, "down"), rawEnd)
  const sEnd = Math.max(snapOffsetToGraphemeBoundary(text, rawEnd, "up"), sStart)
  const before = displaySlice(text, 0, sStart)
  const after = displaySlice(text, sEnd)
  const insertWidth = promptOffsetWidth(replacement)
  return {
    text: before + replacement + after,
    cursor: sStart + insertWidth,
    actions: [
      { type: "setSelection", start: sStart, end: sEnd },
      { type: "insertText", value: replacement },
      { type: "clearSelection" },
    ],
  }
}

/** Map a logical edit-buffer position to absolute screen coords, accounting
 *  for both axes of viewport scroll. Returns null when the position is
 *  scrolled outside the viewport on either axis. Pure — no native deps. */
export function viewportScreenCoords(
  pos: { row: number; col: number },
  viewport: { offsetX: number; offsetY: number; width: number; height: number },
  screenX: number,
  screenY: number,
): { x: number; y: number } | null {
  const visualRow = pos.row - viewport.offsetY
  const visualCol = pos.col - viewport.offsetX
  if (visualRow < 0 || visualRow >= viewport.height) return null
  if (visualCol < 0 || visualCol >= viewport.width) return null
  return { x: screenX + visualCol, y: screenY + visualRow }
}

// Use TextareaRenderable directly as the input type — it's importable from
// @opentui/core (re-exported via renderables/index.d.ts:23 → Textarea.js) and
// already used in index.tsx. Council R2 Should (rev-1): prefer this over a
// hand-written `GuardInput` intermediate so the helpers' input type can't
// drift from the real textarea. `makeGuardedAccessors` (Task 4) takes the same
// `() => TextareaRenderable | undefined`.
// (If a future opentui bump makes the direct import heavy, fall back to a
//  minimal structural type covering: isDestroyed, extmarks, plainText,
//  getTextRange, cursorOffset, setSelection, insertText, clearSelection, clear.)
type GuardInput = TextareaRenderable

/** Plugin-safe extmarks facade. ALWAYS returns a facade (never undefined) so
 *  it can be built ONCE — the component creates the factory before the
 *  textarea mounts (`input` is assigned later at index.tsx:1504), so a
 *  build-time controller capture would be permanently undefined. Each method
 *  re-reads the input via `live()` and no-ops when absent/destroyed (a plugin
 *  that captured the facade before unmount can't deref a destroyed
 *  controller — finding 6). Delegates as `input.extmarks.method(...)` so
 *  `this` is the controller (finding 5 — no .bind needed). Omits
 *  clear()/destroy() (wipe internal prompt-part marks / tear down).
 *
 *  Unmounted/destroyed sentinel (council R2 Should, rev-1+rev-3): when the
 *  prompt is unmounted these no-op to `create`/`registerType` → -1,
 *  `delete` → false, `get*` → null/[]. A plugin CANNOT distinguish "no
 *  extmarks" from "prompt gone"; treat any -1 type/mark id as a no-op and do
 *  not persist it. Document this on the plugin-facing JSDoc too. */
export function safeExtmarks(getInput: () => GuardInput | undefined): SafeExtmarks {
  const live = () => {
    const input = getInput()
    return !input || input.isDestroyed ? undefined : input.extmarks
  }
  return {
    create: (opts) => live()?.create(opts) ?? -1,
    delete: (id) => live()?.delete(id) ?? false,
    get: (id) => live()?.get(id) ?? null,
    getAll: () => live()?.getAll() ?? [],
    getVirtual: () => live()?.getVirtual() ?? [],
    getAtOffset: (offset) => live()?.getAtOffset(offset) ?? [],
    getAllForTypeId: (typeId) => live()?.getAllForTypeId(typeId) ?? [],
    registerType: (name) => live()?.registerType(name) ?? -1,
    getTypeId: (name) => live()?.getTypeId(name) ?? null,
    getTypeName: (typeId) => live()?.getTypeName(typeId) ?? null,
    getMetadataFor: (id) => live()?.getMetadataFor(id) ?? null,
  }
}

type RawExtmarks = NonNullable<TextareaRenderable["extmarks"]>
export type SafeExtmarks = Pick<
  RawExtmarks,
  | "create" | "delete" | "get" | "getAll" | "getVirtual" | "getAtOffset"
  | "getAllForTypeId" | "registerType" | "getTypeId" | "getTypeName" | "getMetadataFor"
>

/** Guarded PromptRef accessors. Each derefs the live input via getInput and
 *  no-ops when the input is absent or destroyed — so a plugin holding a
 *  retained ref after the prompt unmounts can't crash the TUI. Pure factory
 *  (only a type dep on TextareaRenderable) → unit-testable without a native
 *  textarea. */
export function makeGuardedAccessors(getInput: () => TextareaRenderable | undefined) {
  return {
    text(): string {
      const input = getInput()
      if (!input || input.isDestroyed) return ""
      return input.plainText
    },
    getTextRange(startOffset: number, endOffset: number): string {
      const input = getInput()
      if (!input || input.isDestroyed) return ""
      return input.getTextRange(startOffset, endOffset)
    },
    replaceRange(startOffset: number, endOffset: number, replacement: string): void {
      const input = getInput()
      if (!input || input.isDestroyed) return
      const plan = planRangeReplace(input.plainText, startOffset, endOffset, replacement)
      for (const action of plan.actions) {
        if (action.type === "setCursor") input.cursorOffset = action.offset
        else if (action.type === "setSelection") input.setSelection(action.start, action.end)
        else if (action.type === "insertText") input.insertText(action.value)
        else if (action.type === "clearSelection") input.clearSelection()
      }
    },
    /** Guarded INPUT side of reset (the crash-prone part): clears the textarea
     *  and its extmark controller. The component's reset() calls this, then
     *  does its own SolidJS setStore(...) (which can't live here). Council
     *  consensus finding #1: reset must be in the factory so ALL guarded input
     *  ops share one source of truth. */
    reset(): void {
      const input = getInput()
      if (!input || input.isDestroyed) return
      input.clear()
      input.extmarks.clear()
    },
    // The plugin-safe extmarks facade (Task 3), built once and self-guarding.
    extmarks: safeExtmarks(getInput),
  }
}
