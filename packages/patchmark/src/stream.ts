import { BlockParser, BNode, splitTableRow } from "./blocks"
import { applyTailHeal, computeTailHeal, type TailHeal } from "./heal"
import { renderBlockKindToHtml } from "./html"
import { parseInlines, type ReferenceDef, type RefMap } from "./inline"
import type {
  BlockKind,
  BlockPatch,
  HeadingLevel,
  InlineNode,
  ListItemNode,
  MarkdownBlock,
  StreamFrame,
  StreamOptions,
} from "./types"

/**
 * If the last line holds only a bare block opener (`-`, `*`, `+`, `##`, `12.`, `>`, ```` ``` ````, `$$`), hold that
 * line back until its first content character or newline arrives. Prevents 1-frame paragraph-to-heading/list pops.
 */
export function splitPendingMarker(text: string): { visible: string; held: string } {
  const lastNl = text.lastIndexOf("\n")
  const lineStart = lastNl + 1
  const tailLine = text.slice(lineStart)
  if (!tailLine || tailLine.length > 12) return { visible: text, held: "" }

  const trimmed = tailLine.trim()
  if (!trimmed) return { visible: text, held: "" }

  const first = trimmed.charCodeAt(0)
  if (
    first === 0x23 /* # */ ||
    first === 0x60 /* ` */ ||
    first === 0x7e /* ~ */ ||
    first === 0x2d /* - */ ||
    first === 0x2a /* * */ ||
    first === 0x5f /* _ */ ||
    first === 0x24 /* $ */ ||
    first === 0x3d /* = */
  ) {
    let allSame = true
    for (let i = 1; i < trimmed.length; i++) {
      if (trimmed.charCodeAt(i) !== first) {
        allSame = false
        break
      }
    }
    if (allSame) {
      const maxHold = first === 0x23 ? 6 : first === 0x60 || first === 0x7e ? 3 : 2
      if (trimmed.length <= maxHold) return { visible: text.slice(0, lineStart), held: tailLine }
    }
  }

  if (trimmed === "+" || trimmed === "•" || trimmed === ">" || trimmed === "\\[") {
    return { visible: text.slice(0, lineStart), held: tailLine }
  }

  let d = 0
  while (d < trimmed.length && trimmed.charCodeAt(d) >= 0x30 && trimmed.charCodeAt(d) <= 0x39) d++
  if (d > 0) {
    const rest = trimmed.slice(d)
    if (rest === "" || rest === "." || rest === ")") return { visible: text.slice(0, lineStart), held: tailLine }
  }

  return { visible: text, held: "" }
}

// A partial line that is only `-`/`=` (with optional surrounding spaces) would turn the paragraph above into a
// setext heading for a frame, before it grows into a list item or thematic break. Always hold it.
const RE_SETEXT_CANDIDATE = /^[ \t]*(?:-+|=+)[ \t]*$/

interface Converted {
  kind: BlockKind | null
  used: Set<string>
  unresolved: Set<string>
}

interface ConvertContext {
  refmap: RefMap
  /** whether results for persistent (non-forked) closed nodes may be cached */
  cacheable: boolean
  /** true when converting a block in the active streaming tail */
  inTail: boolean
  /** true when converting the last tail unit and the input ends with a non-empty partial line (no trailing `\n`) */
  partialLine: boolean
  healTarget: BNode | null
  heal: TailHeal | null
  used: Set<string>
  unresolved: Set<string>
}

interface SettledMeta {
  docIndex: number
  lastIndex: number
  unresolved: Set<string>
}

type ResolvedStreamOptions = Required<StreamOptions>

export class PatchmarkStream {
  private readonly options: ResolvedStreamOptions
  private text = ""
  private parser!: BlockParser
  /** offset just past the last complete line */
  private fed = 0
  /** text after the last complete line */
  private partial = ""
  private lineStarts: number[] = []
  /** complete lines, without and with their terminators */
  private lines: string[] = []
  private lineRaw: string[] = []
  private tailRaw: { startLine: number; upTo: number; text: string } | null = null
  private finished = false
  private blocks: MarkdownBlock[] = []
  private settledCount = 0
  private settledNodes = 0
  private settledMeta: SettledMeta[] = []
  private waiting = new Map<string, Set<number>>()
  private refsSeen = 0
  private provisionalRefs: string[] = []
  private nextId = 0
  private cache = new WeakMap<BNode, { version: number; result: Converted }>()
  private itemCache = new WeakMap<BNode, { version: number; item: ListItemNode; used: Set<string>; unresolved: Set<string> }>()
  private disallowMath = new Set<number>()

  constructor(options: StreamOptions = {}) {
    this.options = {
      gfm: options.gfm ?? true,
      math: options.math ?? true,
      heal: options.heal ?? true,
      holdPendingMarkers: options.holdPendingMarkers ?? true,
      settleOnComplete: options.settleOnComplete ?? true,
      groupHtmlBlocks: options.groupHtmlBlocks ?? false,
      renderHtml: options.renderHtml ?? false,
    }
    this.resetState()
  }

  private resetState() {
    this.text = ""
    this.disallowMath = new Set()
    this.parser = new BlockParser({ gfm: this.options.gfm, math: this.options.math }, this.disallowMath)
    this.fed = 0
    this.partial = ""
    this.lineStarts = []
    this.lines = []
    this.lineRaw = []
    this.tailRaw = null
    this.finished = false
    this.blocks = []
    this.settledCount = 0
    this.settledNodes = 0
    this.settledMeta = []
    this.waiting = new Map()
    this.refsSeen = 0
    this.provisionalRefs = []
    this.cache = new WeakMap()
    this.itemCache = new WeakMap()
  }

  /** Reset the stream to empty state */
  reset(): void {
    this.resetState()
    this.nextId = 0
  }

  getBlocks(): ReadonlyArray<MarkdownBlock> {
    return this.blocks
  }

  getText(): string {
    return this.text
  }

  /** Append a streaming delta chunk */
  append(delta: string): StreamFrame {
    if (!delta) return this.emptyFrame()
    if (this.finished) return this.update(this.text + delta, { streaming: true })
    this.text += delta
    this.partial += delta
    return this.step(true)
  }

  /** Finalize the stream: flush held markers and settle every block */
  finalize(): StreamFrame {
    return this.update(this.text, { streaming: false })
  }

  /** Declarative update: prefix appends are incremental; anything else re-parses and patches the difference */
  update(text: string, opts: { streaming?: boolean } = {}): StreamFrame {
    const streaming = opts.streaming ?? true
    if (this.finished || !text.startsWith(this.text)) {
      if (this.finished && text === this.text) return this.emptyFrame()
      return this.rebuild(text, streaming)
    }
    if (text.length === this.text.length && streaming && this.blocks.length > 0) return this.emptyFrame()
    this.partial += text.slice(this.text.length)
    this.text = text
    return this.step(streaming)
  }

  private emptyFrame(): StreamFrame {
    return {
      text: this.text,
      settledOffset: this.settledOffset(),
      blocks: this.blocks,
      patches: [],
      heldMarker: "",
      charsScanned: 0,
    }
  }

  private settledOffset(): number {
    if (this.settledCount === 0) return 0
    return this.blocks[this.settledCount - 1]!.end
  }

  private rebuild(text: string, streaming: boolean): StreamFrame {
    const previous = this.blocks
    this.resetState()
    this.text = text
    this.partial = text
    const frame = this.step(streaming)
    const next = this.blocks
    let keep = 0
    while (
      keep < previous.length &&
      keep < next.length &&
      previous[keep]!.status === "settled" &&
      next[keep]!.status === "settled" &&
      previous[keep]!.raw === next[keep]!.raw &&
      previous[keep]!.start === next[keep]!.start &&
      previous[keep]!.defs === next[keep]!.defs
    ) {
      next[keep] = previous[keep]!
      keep++
    }
    for (let i = keep; i < next.length; i++) next[i] = { ...next[i]!, id: this.nextId++ }
    const patches: BlockPatch[] = []
    if (keep < previous.length) patches.push({ op: "truncate", keepCount: keep })
    for (let i = keep; i < next.length; i++) {
      patches.push({ op: "append", block: next[i]! })
      if (next[i]!.status === "settled") patches.push({ op: "finalize", id: next[i]!.id, index: i, block: next[i]! })
    }
    return { ...frame, blocks: next, patches }
  }

  private step(streaming: boolean): StreamFrame {
    const before = this.fed
    this.feedCompleteLines(streaming)
    let partial = this.partial

    if (!streaming) {
      if (partial.length > 0) {
        this.pushLine(partial.endsWith("\r") ? partial.slice(0, -1) : partial, partial)
        this.parser.incorporateLine(this.lines[this.lines.length - 1]!)
        this.partial = ""
        partial = ""
      }
      this.parser.finish()
      while (this.parser.unclosedMathAt) this.reparse(true)
      this.finished = true
    } else if (this.parser.unclosedMathAt) {
      this.reparse(false)
    }

    const oldSettledCount = this.settledCount
    const prevTail = this.blocks.slice(oldSettledCount)
    const nextBlocks: MarkdownBlock[] = []
    const newSettledMeta: SettledMeta[] = []

    let held = ""
    let visible = ""
    let preFork: { fork: BlockParser; tip: BNode } | null = null
    if (streaming) {
      visible = partial
      if (visible.endsWith("\r")) visible = visible.slice(0, -1)
      if (visible && RE_SETEXT_CANDIDATE.test(visible)) {
        held = visible
        visible = ""
      } else if (visible && this.options.holdPendingMarkers) {
        const split = splitPendingMarker(visible)
        held = split.held
        visible = split.visible
      }
    }
    const ensureFork = () => {
      if (!preFork) {
        const fork = this.parser.fork()
        if (visible) fork.incorporateLine(visible)
        const tip = fork.tip
        fork.finish()
        preFork = { fork, tip }
      }
      return preFork
    }

    // 1. Newly settled top-level blocks (or groups of them)
    const children = this.parser.doc.children
    while (this.settledNodes < children.length) {
      const first = this.settledNodes
      const grouped = this.groupEnd(children, first)
      if (grouped < 0 && streaming) break
      const last = grouped < 0 ? children.length - 1 : grouped
      const node = children[first]!
      const isLast = last === children.length - 1
      const early =
        this.options.settleOnComplete &&
        first === last &&
        node.open &&
        isLast &&
        streaming &&
        (node.type === "heading" || node.type === "thematic_break")
      let open = false
      for (let k = first; k <= last; k++) if (children[k]!.open) open = true
      if (open && !early) break
      if (!this.options.settleOnComplete && streaming) {
        let hasVisibleAfter = false
        for (let m = last + 1; m < children.length; m++) {
          if (!children[m]!.open && !children[m]!.defsOnly) {
            hasVisibleAfter = true
            break
          }
        }
        if (!hasVisibleAfter) {
          const lastChild = children[children.length - 1]
          const openAfter = lastChild && lastChild.open && children.length - 1 > last ? lastChild : null
          if (!openAfter && !visible) break
          const mayBeDef =
            (openAfter && openAfter.type === "paragraph" && openAfter.content.charCodeAt(0) === 0x5b) ||
            (!openAfter && /^[ \t]{0,3}\[/.test(visible))
          if (mayBeDef) {
            const { fork } = ensureFork()
            if (!fork.doc.children.some((n) => !n.defsOnly)) break
          }
        }
      }
      const ctx: ConvertContext = {
        refmap: this.parser.refmap,
        cacheable: true,
        inTail: false,
        partialLine: false,
        healTarget: null,
        heal: null,
        used: new Set(),
        unresolved: new Set(),
      }
      const kind = this.convertUnit(children, first, last, ctx)
      if (kind) {
        const end = children[last]!
        const rawEndLine = !this.options.settleOnComplete
          ? last + 1 < children.length
            ? children[last + 1]!.startLine - 1
            : this.lines.length
          : end.open
            ? this.lines.length
            : end.endLine
        const raw = this.joinLines(node.startLine, rawEndLine)
        nextBlocks.push(this.makeBlock(-1, this.lineStarts[node.startLine - 1]!, raw, "settled", kind, ctx.used, this.parser.refmap, null))
        newSettledMeta.push({ docIndex: first, lastIndex: last, unresolved: ctx.unresolved })
      }
      this.settledNodes = last + 1
      if (early) break
    }

    // 2. The streaming tail
    let tailRefmap: RefMap | null = null
    let tailRefsAdded: string[] = []
    if (streaming) {
      const tail = this.buildTail(visible, preFork)
      tailRefmap = tail.refmap
      tailRefsAdded = tail.refsAdded
      for (const block of tail.blocks) nextBlocks.push(block)
    }

    // 3. Reconcile against the previous tail and emit patches
    const patches: BlockPatch[] = []
    for (let j = 0; j < nextBlocks.length; j++) {
      const index = oldSettledCount + j
      let block = nextBlocks[j]!
      const prev = prevTail[j]
      if (prev) {
        block.id = prev.id
        if (block.status === "settled") {
          patches.push({ op: "finalize", id: block.id, index, block })
        } else if (prev.raw === block.raw && prev.liveRaw === block.liveRaw && prev.status === block.status && prev.defs === block.defs) {
          block = prev
        } else {
          patches.push({ op: "replace", id: block.id, index, block })
        }
      } else {
        block.id = this.nextId++
        patches.push({ op: "append", block })
        if (block.status === "settled") patches.push({ op: "finalize", id: block.id, index, block })
      }
      nextBlocks[j] = block
    }
    if (prevTail.length > nextBlocks.length) {
      patches.push({ op: "truncate", keepCount: oldSettledCount + nextBlocks.length })
    }
    this.blocks.length = oldSettledCount
    for (const block of nextBlocks) this.blocks.push(block)
    for (const meta of newSettledMeta) {
      const index = this.settledMeta.length
      this.settledMeta.push(meta)
      for (const label of meta.unresolved) {
        let set = this.waiting.get(label)
        if (!set) this.waiting.set(label, (set = new Set()))
        set.add(index)
      }
    }
    this.settledCount = oldSettledCount + newSettledMeta.length

    // 4. Reference definitions that arrived after the blocks that use them: patch those blocks
    this.backfillRefs(patches, tailRefmap, tailRefsAdded)

    return {
      text: this.text,
      settledOffset: this.settledOffset(),
      blocks: this.blocks,
      patches,
      heldMarker: held,
      charsScanned: this.fed - before + partial.length,
    }
  }

  private backfillRefs(patches: BlockPatch[], tailRefmap: RefMap | null, tailRefsAdded: string[]) {
    const added = this.parser.refsAdded
    const provisional = this.provisionalRefs
    this.provisionalRefs = tailRefsAdded
    if (this.refsSeen >= added.length && tailRefsAdded.length === 0 && provisional.length === 0) return
    const touched = new Set<number>()
    // A fork's definitions can disappear as the partial line grows or at EOF.
    for (const label of provisional) {
      const set = this.waiting.get(label)
      if (set) for (const idx of set) touched.add(idx)
    }
    for (let i = this.refsSeen; i < added.length; i++) {
      const set = this.waiting.get(added[i]!)
      if (!set) continue
      for (const idx of set) touched.add(idx)
      this.waiting.delete(added[i]!)
    }
    this.refsSeen = added.length
    for (const label of tailRefsAdded) {
      const set = this.waiting.get(label)
      if (!set) continue
      for (const idx of set) touched.add(idx)
    }
    const refmap = tailRefmap ?? this.parser.refmap
    for (const idx of [...touched].sort((a, b) => a - b)) {
      const meta = this.settledMeta[idx]!
      const ctx: ConvertContext = {
        refmap,
        cacheable: false,
        inTail: false,
        partialLine: false,
        healTarget: null,
        heal: null,
        used: new Set(),
        unresolved: new Set(),
      }
      const kind = this.convertUnit(this.parser.doc.children, meta.docIndex, meta.lastIndex, ctx)
      if (!kind) continue
      const old = this.blocks[idx]!
      const updated = this.makeBlock(old.id, old.start, old.raw, "settled", kind, ctx.used, refmap, null)
      meta.unresolved = ctx.unresolved
      for (const label of ctx.unresolved) {
        let set = this.waiting.get(label)
        if (!set) this.waiting.set(label, (set = new Set()))
        set.add(idx)
      }
      for (const label of ctx.used) {
        if (!this.parser.refmap.has(label)) {
          let set = this.waiting.get(label)
          if (!set) this.waiting.set(label, (set = new Set()))
          set.add(idx)
        }
      }
      let patchedInFrame = false
      for (const p of patches) {
        if (p.op !== "truncate" && p.block.id === updated.id) {
          p.block = updated
          patchedInFrame = true
        }
      }
      if (patchedInFrame) {
        this.blocks[idx] = updated
      } else if (old.defs !== updated.defs || old.html !== updated.html || JSON.stringify(old.kind) !== JSON.stringify(updated.kind)) {
        this.blocks[idx] = updated
        patches.push({ op: "replace", id: updated.id, index: idx, block: updated })
      }
    }
  }

  /** Raw source of complete lines `from`..`to` (1-based, inclusive) */
  private joinLines(from: number, to: number): string {
    if (to < from) return ""
    if (from === to) return this.lineRaw[from - 1]!
    let out = ""
    for (let i = from - 1; i < to; i++) out += this.lineRaw[i]!
    return out
  }

  private pushLine(line: string, raw: string) {
    this.lineStarts.push(this.fed)
    this.lines.push(line)
    this.lineRaw.push(raw)
    this.fed += raw.length
  }

  private feedCompleteLines(streaming: boolean) {
    const partial = this.partial
    const len = partial.length
    let pos = 0
    while (pos < len) {
      let idx = partial.indexOf("\n", pos)
      const cr = partial.indexOf("\r", pos)
      if (cr >= 0 && (idx < 0 || cr < idx)) idx = cr
      if (idx < 0) break
      let term = 1
      if (partial.charCodeAt(idx) === 0x0d) {
        if (idx + 1 < len) term = partial.charCodeAt(idx + 1) === 0x0a ? 2 : 1
        else if (streaming) break
      }
      this.pushLine(partial.slice(pos, idx), partial.slice(pos, idx + term))
      this.parser.incorporateLine(this.lines[this.lines.length - 1]!)
      pos = idx + term
      if (this.parser.unclosedMathAt) this.reparse(false)
    }
    if (pos > 0) this.partial = partial.slice(pos)
  }

  /** An unclosed `$$` block is not math after all: re-read the document with that opener disabled */
  private reparse(finish: boolean) {
    while (this.parser.unclosedMathAt) {
      this.disallowMath.add(this.parser.unclosedMathAt)
      const parser = new BlockParser({ gfm: this.options.gfm, math: this.options.math }, this.disallowMath)
      for (let i = 0; i < this.lines.length; i++) {
        parser.incorporateLine(this.lines[i]!)
        if (parser.unclosedMathAt) break
      }
      if (!parser.unclosedMathAt && finish) parser.finish()
      this.parser = parser
      this.cache = new WeakMap()
      this.itemCache = new WeakMap()
    }
    this.refsSeen = Math.min(this.refsSeen, this.parser.refsAdded.length)
  }

  private buildTail(
    visible: string,
    preFork: { fork: BlockParser; tip: BNode } | null,
  ): { blocks: MarkdownBlock[]; refmap: RefMap | null; refsAdded: string[] } {
    const children = this.parser.doc.children
    const last = children[children.length - 1]
    const openChild = last && last.open ? last : null
    const openIndex = openChild ? children.length - 1 : -1
    if (this.settledNodes >= children.length && !visible) {
      return { blocks: [], refmap: null, refsAdded: [] }
    }

    let fork: BlockParser
    let tip: BNode
    if (preFork) {
      fork = preFork.fork
      tip = preFork.tip
    } else {
      fork = this.parser.fork()
      if (visible) fork.incorporateLine(visible)
      tip = fork.tip
      fork.finish()
    }

    let healTarget: BNode | null = null
    let heal: TailHeal | null = null
    if (this.options.heal && (tip.type === "paragraph" || tip.type === "heading" || tip.type === "table")) {
      const content = tip.type === "table" ? (tip.rows[tip.rows.length - 1] ?? "") : tip.content
      if (content) {
        const h = computeTailHeal(content)
        if (h.strip > 0 || h.append) {
          healTarget = tip
          heal = h
        }
      }
    }

    const lineCount = this.lines.length
    // closed top-level blocks still waiting on an open HTML group (or settleOnComplete: false), then the fork's blocks
    const tailNodes = children.slice(this.settledNodes, openChild ? openIndex : children.length)
    for (const node of fork.doc.children.slice(openChild && openIndex < this.settledNodes ? 1 : 0)) tailNodes.push(node)

    const units: Array<{ first: number; last: number; kind: BlockKind; ctx: ConvertContext }> = []
    let first = 0
    while (first < tailNodes.length) {
      let last = this.groupEnd(tailNodes, first)
      if (last < 0) last = tailNodes.length - 1
      const isLastUnit = last === tailNodes.length - 1
      const ctx: ConvertContext = {
        refmap: fork.refmap,
        cacheable: fork.refmap.size === this.parser.refmap.size,
        inTail: true,
        partialLine: isLastUnit && visible.length > 0,
        healTarget,
        heal,
        used: new Set(),
        unresolved: new Set(),
      }
      const kind = this.convertUnit(tailNodes, first, last, ctx)
      if (kind) units.push({ first, last, kind, ctx })
      first = last + 1
    }

    const out: MarkdownBlock[] = []
    for (let u = 0; u < units.length; u++) {
      const { first: f, last: l, kind, ctx } = units[u]!
      const node = tailNodes[f]!
      const end = tailNodes[l]!
      const isLastVisUnit = u === units.length - 1
      let raw: string
      let start: number
      if (node.startLine > lineCount) {
        start = this.fed
        raw = visible
      } else {
        start = this.lineStarts[node.startLine - 1]!
        if (isLastVisUnit && (!this.options.settleOnComplete || l === tailNodes.length - 1)) {
          raw = this.joinTail(node.startLine, lineCount) + visible
        } else {
          const nextStart = !isLastVisUnit ? tailNodes[units[u + 1]!.first]!.startLine - 1 : end.endLine
          const endLine = !this.options.settleOnComplete ? Math.min(nextStart, lineCount) : Math.min(end.endLine, lineCount)
          raw = this.joinLines(node.startLine, endLine) + (end.endLine > lineCount ? visible : "")
        }
      }
      const liveRaw = heal !== null && isLastVisUnit && healTarget !== null ? applyTailHeal(raw, heal) : null
      out.push(this.makeBlock(-1, start, raw, "streaming", kind, ctx.used, fork.refmap, liveRaw))
    }
    return { blocks: out, refmap: fork.refmap, refsAdded: fork.refsAdded }
  }

  /** Index of the last node in the display unit starting at `first`, or -1 if an HTML group is still open */
  private groupEnd(nodes: BNode[], first: number): number {
    if (!this.options.groupHtmlBlocks) return first
    let balance = htmlBalance(nodes[first]!)
    if (balance <= 0) return first
    for (let k = first + 1; k < nodes.length; k++) {
      balance += htmlBalance(nodes[k]!)
      if (balance <= 0) return k
    }
    return -1
  }

  private convertUnit(nodes: BNode[], first: number, last: number, ctx: ConvertContext): BlockKind | null {
    if (first === last) return this.convert(nodes[first]!, ctx)
    const blocks: BlockKind[] = []
    for (let k = first; k <= last; k++) {
      const kind = this.convert(nodes[k]!, ctx)
      if (kind) blocks.push(kind)
    }
    return { type: "group", blocks }
  }

  /** Lines `from`..`to` joined, extending the previous flush's join when the open block is the same */
  private joinTail(from: number, to: number): string {
    const cached = this.tailRaw
    if (cached && cached.startLine === from && cached.upTo <= to) {
      if (cached.upTo < to) {
        cached.text += this.joinLines(cached.upTo + 1, to)
        cached.upTo = to
      }
      return cached.text
    }
    const text = this.joinLines(from, to)
    this.tailRaw = { startLine: from, upTo: to, text }
    return text
  }

  private makeBlock(
    id: number,
    start: number,
    raw: string,
    status: "streaming" | "settled",
    kind: BlockKind,
    used: Set<string>,
    refmap: RefMap,
    liveRaw: string | null,
  ): MarkdownBlock {
    const block: MarkdownBlock = { id, start, end: start + raw.length, raw, status, kind }
    if (used.size > 0) {
      const defs: string[] = []
      for (const label of used) {
        const def = refmap.get(label)
        if (!def?.raw) continue
        const defStart =
          def.line !== undefined ? (def.line <= this.lineStarts.length ? this.lineStarts[def.line - 1]! : this.fed) : -1
        if (!this.options.settleOnComplete && defStart >= start && defStart < block.end) continue
        defs.push(def.raw)
      }
      if (defs.length > 0) block.defs = defs.join("\n")
    }
    if (liveRaw !== null) block.liveRaw = liveRaw
    if (this.options.renderHtml) block.html = renderBlockKindToHtml(kind, { gfm: this.options.gfm, math: this.options.math })
    return block
  }

  private convert(node: BNode, ctx: ConvertContext): BlockKind | null {
    const persistent = ctx.cacheable && !node.open && !node.forked
    if (persistent) {
      const hit = this.cache.get(node)
      if (hit && hit.version === ctx.refmap.size) {
        for (const label of hit.result.used) ctx.used.add(label)
        for (const label of hit.result.unresolved) ctx.unresolved.add(label)
        return hit.result.kind
      }
      const sub: ConvertContext = { ...ctx, used: new Set(), unresolved: new Set() }
      const kind = this.convertUncached(node, sub)
      this.cache.set(node, { version: ctx.refmap.size, result: { kind, used: sub.used, unresolved: sub.unresolved } })
      for (const label of sub.used) ctx.used.add(label)
      for (const label of sub.unresolved) ctx.unresolved.add(label)
      return kind
    }
    return this.convertUncached(node, ctx)
  }

  private inlines(content: string, ctx: ConvertContext): InlineNode[] {
    return parseInlines(content, {
      gfm: this.options.gfm,
      math: this.options.math,
      defs: ctx.refmap as ReadonlyMap<string, ReferenceDef>,
      usedRefs: ctx.used,
      unresolvedRefs: ctx.unresolved,
    })
  }

  private convertUncached(node: BNode, ctx: ConvertContext): BlockKind | null {
    const healHere = ctx.healTarget === node && ctx.heal !== null
    switch (node.type) {
      case "paragraph": {
        if (node.defsOnly) return null
        const content = healHere ? applyTailHeal(node.content, ctx.heal!) : node.content
        return { type: "paragraph", inlines: this.inlines(content, ctx) }
      }
      case "heading": {
        const content = healHere ? applyTailHeal(node.content, ctx.heal!) : node.content
        return { type: "heading", level: node.level as HeadingLevel, inlines: this.inlines(content, ctx) }
      }
      case "thematic_break":
        return { type: "hr" }
      case "code_block": {
        const literal = node.literal
        const info = node.info
        const words = info ? info.split(/\s+/) : []
        const language = words[0] || undefined
        const meta = language ? info.slice(info.indexOf(language) + language.length).trim() || undefined : undefined
        // an indented code block is complete only once the persistent parser has closed it
        const complete = node.isFenced ? node.fenceClosed : !node.forked
        const keepTrailingNewline = ctx.inTail && node.isFenced && !complete && !ctx.partialLine
        const source = !keepTrailingNewline && literal.endsWith("\n") ? literal.slice(0, -1) : literal
        const defaultHtmlLiteral = source ? (source.endsWith("\n") && !complete ? source : `${source}\n`) : ""
        const htmlLiteral = literal !== defaultHtmlLiteral ? literal : undefined
        if (language && language.toLowerCase() === "mermaid") {
          return { type: "mermaid", source, complete, ...(htmlLiteral !== undefined ? { htmlLiteral } : {}) }
        }
        return {
          type: "code",
          ...(language ? { language } : {}),
          ...(meta ? { meta } : {}),
          source,
          fence: node.isFenced ? node.fenceChar.repeat(node.fenceLength) : "",
          ...(node.isFenced ? {} : { indented: true }),
          complete,
          ...(htmlLiteral !== undefined ? { htmlLiteral } : {}),
        }
      }
      case "html_block":
        return { type: "html_block", raw: node.literal }
      case "math_block":
        return {
          type: "math",
          source: node.literal.trim(),
          delimiter: node.mathDelimiter === "$" ? "dollar" : "double-dollar",
          complete: node.mathClosed,
        }
      case "block_quote": {
        const blocks: BlockKind[] = []
        for (const child of node.children) {
          const kind = this.convert(child, ctx)
          if (kind) blocks.push(kind)
        }
        return { type: "blockquote", blocks }
      }
      case "list": {
        const ld = node.listData!
        const version = ctx.cacheable ? ctx.refmap.size : -1
        const memo = node.listMemo!
        if (version < 0 || memo.version !== version) {
          memo.version = version
          memo.items = []
          memo.count = 0
          memo.used = new Set()
          memo.unresolved = new Set()
        }
        const ch = node.children
        let closedPrefix = ch.length
        while (closedPrefix > 0 && ch[closedPrefix - 1]!.forked) closedPrefix--
        if (memo.count > closedPrefix) {
          memo.items.length = closedPrefix
          memo.count = closedPrefix
        }
        for (let i = memo.count; i < closedPrefix; i++) {
          memo.items.push(this.convertItemCached(ch[i]!, { ...ctx, used: memo.used, unresolved: memo.unresolved }))
          memo.count = i + 1
        }
        for (const label of memo.used) ctx.used.add(label)
        for (const label of memo.unresolved) ctx.unresolved.add(label)
        const items = (memo.items as ListItemNode[]).slice()
        for (let i = closedPrefix; i < ch.length; i++) {
          items.push(this.convertItemCached(ch[i]!, ctx))
        }
        return {
          type: "list",
          ordered: ld.type === "ordered",
          marker: ld.type === "ordered" ? ld.delimiter! : ld.bulletChar!,
          ...(ld.type === "ordered" ? { start: ld.start! } : {}),
          tight: ld.tight,
          items,
        }
      }
      case "table": {
        const width = node.header.length
        const version = ctx.cacheable ? ctx.refmap.size : -1
        const memo = node.tableMemo!
        if (version < 0 || memo.version !== version) {
          memo.version = version
          memo.headers = null
          memo.rows = []
          memo.rawRows = []
          memo.used = new Set()
          memo.unresolved = new Set()
        }
        const parseRow = (split: string[], targetUsed: Set<string>, targetUnresolved: Set<string>): InlineNode[][] => {
          const sub: ConvertContext = { ...ctx, used: targetUsed, unresolved: targetUnresolved }
          const row: InlineNode[][] = []
          for (let c = 0; c < width; c++) row.push(c < split.length ? this.inlines(unescapePipes(split[c]!), sub) : [])
          return row
        }
        if (!memo.headers) {
          memo.headers = parseRow(node.header, memo.used, memo.unresolved)
        }
        const headers = memo.headers as InlineNode[][]
        const stableCount = healHere && node.rows.length > 0 ? node.rows.length - 1 : node.rows.length
        let common = Math.min(memo.rows.length, stableCount)
        while (common > 0 && memo.rawRows[common - 1] !== node.rows[common - 1]) common--
        if (common < memo.rows.length) {
          memo.rows.length = common
          memo.rawRows.length = common
        }
        for (let r = common; r < stableCount; r++) {
          const rowText = node.rows[r]!
          memo.rawRows.push(rowText)
          memo.rows.push(parseRow(splitTableRow(rowText), memo.used, memo.unresolved))
        }
        for (const label of memo.used) ctx.used.add(label)
        for (const label of memo.unresolved) ctx.unresolved.add(label)
        const rows = (memo.rows as InlineNode[][][]).slice()
        if (stableCount < node.rows.length) {
          const rowText = applyTailHeal(node.rows[node.rows.length - 1]!, ctx.heal!)
          rows.push(parseRow(splitTableRow(rowText), ctx.used, ctx.unresolved))
        }
        return { type: "table", align: node.align, headers, rows }
      }
      case "document":
      case "item":
        return null
    }
  }

  private convertItemCached(item: BNode, ctx: ConvertContext): ListItemNode {
    if (!ctx.cacheable || item.forked) return this.convertItem(item, ctx)
    const version = ctx.refmap.size
    const hit = this.itemCache.get(item)
    if (hit && hit.version === version) {
      for (const label of hit.used) ctx.used.add(label)
      for (const label of hit.unresolved) ctx.unresolved.add(label)
      return hit.item
    }
    const sub: ConvertContext = { ...ctx, used: new Set(), unresolved: new Set() }
    const result = this.convertItem(item, sub)
    this.itemCache.set(item, { version, item: result, used: sub.used, unresolved: sub.unresolved })
    for (const label of sub.used) ctx.used.add(label)
    for (const label of sub.unresolved) ctx.unresolved.add(label)
    return result
  }

  private convertItem(item: BNode, ctx: ConvertContext): ListItemNode {
    const blocks: BlockKind[] = []
    let checked: boolean | undefined
    const children = item.children
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!
      if (i === 0 && this.options.gfm && child.type === "paragraph" && !child.defsOnly) {
        const task = matchTask(child.content)
        if (task) {
          checked = task.checked
          const content = task.rest
          const leadingBr = /^[ ]+\n/.test(content)
          const leadingWs = leadingBr ? "" : (content.match(/^[ \t]+(?=[^\s])/)?.[0] ?? "")
          const healed = ctx.healTarget === child && ctx.heal ? applyTailHeal(content, ctx.heal) : content
          const inlines = this.inlines(healed, ctx)
          if (leadingBr) {
            inlines.unshift({ type: "br" })
          } else if (leadingWs && inlines.length > 0) {
            if (inlines[0]!.type === "text") {
              inlines[0] = { type: "text", text: leadingWs + inlines[0]!.text }
            } else {
              inlines.unshift({ type: "text", text: leadingWs })
            }
          }
          blocks.push({ type: "paragraph", inlines })
          continue
        }
      }
      const kind = this.convert(child, ctx)
      if (kind) blocks.push(kind)
    }
    return { ...(checked !== undefined ? { checked } : {}), blocks }
  }
}

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"])
const RE_TAG = /<(\/?)([A-Za-z][A-Za-z0-9-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*?(\/?)>/g

/** Open minus closed (non-void) tags in an HTML block */
function htmlBalance(node: BNode): number {
  if (node.type !== "html_block") return 0
  // Comments, declarations and raw-text blocks already have their own terminators.
  if (node.htmlBlockType <= 5) return 0
  const html = (node.open ? node.content : node.literal).replace(/<!--[\s\S]*?(?:-->|$)/g, "")
  let balance = 0
  for (const m of html.matchAll(RE_TAG)) {
    if (m[3] || VOID_TAGS.has(m[2]!.toLowerCase())) continue
    balance += m[1] ? -1 : 1
  }
  return balance
}

function unescapePipes(cell: string): string {
  return cell.includes("\\|") ? cell.replace(/\\\|/g, "|") : cell
}

function matchTask(content: string): { checked: boolean; rest: string } | null {
  if (content.length < 4 || content.charCodeAt(0) !== 0x5b || content.charCodeAt(2) !== 0x5d) return null
  const mark = content[1]!
  if (mark !== " " && mark !== "x" && mark !== "X") return null
  const after = content.charCodeAt(3)
  if (after !== 0x20 && after !== 0x09 && after !== 0x0a) return null
  if (content.slice(3).trim().length === 0) return null
  return { checked: mark !== " ", rest: content.slice(4) }
}

export function createMarkdownStream(options?: StreamOptions): PatchmarkStream {
  return new PatchmarkStream(options)
}
