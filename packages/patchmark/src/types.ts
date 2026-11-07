export type MathDelimiter = "dollar" | "double-dollar" | "paren"

export type InlineNode =
  | { type: "text"; text: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "del"; children: InlineNode[] }
  | { type: "code"; text: string }
  | { type: "math"; source: string; delimiter: MathDelimiter; display: boolean }
  | { type: "link"; href: string; title?: string; children: InlineNode[] }
  | { type: "image"; src: string; alt: string; title?: string; children?: InlineNode[] }
  | { type: "html_inline"; raw: string }
  | { type: "br" }

export type TableAlign = "left" | "center" | "right" | null

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

export interface ListItemNode {
  checked?: boolean | null
  blocks: BlockKind[]
}

export type BlockKind =
  | {
      type: "paragraph"
      inlines: InlineNode[]
    }
  | {
      type: "heading"
      level: HeadingLevel
      inlines: InlineNode[]
    }
  | {
      type: "code"
      language?: string
      meta?: string
      source: string
      htmlLiteral?: string
      fence: string
      indented?: boolean
      complete: boolean
    }
  | {
      type: "mermaid"
      source: string
      htmlLiteral?: string
      complete: boolean
    }
  | {
      type: "math"
      source: string
      delimiter: "double-dollar" | "dollar"
      complete: boolean
    }
  | {
      type: "blockquote"
      blocks: BlockKind[]
    }
  | {
      type: "list"
      ordered: boolean
      marker: string
      start?: number
      tight: boolean
      items: ListItemNode[]
    }
  | {
      type: "table"
      align: TableAlign[]
      headers: InlineNode[][]
      rows: InlineNode[][][]
    }
  | {
      type: "html_block"
      raw: string
    }
  | {
      type: "hr"
    }
  | {
      /** Consecutive top-level blocks kept together because an HTML block opened a tag a later block closes */
      type: "group"
      blocks: BlockKind[]
    }

export interface MarkdownBlock {
  /** Monotonic stable block ID within the stream (0, 1, 2, ...) */
  id: number
  /** Start offset in the source string (UTF-16 code units) */
  start: number
  /** End offset in the source string (UTF-16 code units) */
  end: number
  /** Raw markdown slice for this block */
  raw: string
  /** Whether this block is settled (immutable) or still actively growing at the stream tail */
  status: "streaming" | "settled"
  /** Parsed block payload and inline AST */
  kind: BlockKind
  /** Lazily or eagerly rendered HTML when requested */
  html?: string
  /** Source of the reference definitions this block uses, for renderers that parse one block at a time */
  defs?: string
  /** For a streaming block: `raw` with the tail healed (open markers closed, dangling markers hidden) */
  liveRaw?: string
}

export type BlockPatch =
  | { op: "append"; block: MarkdownBlock }
  | { op: "replace"; id: number; index: number; block: MarkdownBlock }
  | { op: "finalize"; id: number; index: number; block: MarkdownBlock }
  | { op: "truncate"; keepCount: number }

export interface StreamFrame {
  /** Full accumulated source text */
  text: string
  /** Byte/char offset up to which blocks are settled and will never be reparsed on append */
  settledOffset: number
  /** Current blocks array (settled prefix references are preserved identically across frames) */
  blocks: ReadonlyArray<MarkdownBlock>
  /** Minimal patch list transforming the previous frame's blocks into `blocks` */
  patches: ReadonlyArray<BlockPatch>
  /** Any trailing bare marker held back to prevent 1-frame paragraph-to-heading/list pops */
  heldMarker: string
  /** Exact number of source characters scanned during this step */
  charsScanned: number
}

export interface StreamOptions {
  /** Enable GFM tables, strikethrough, task lists, and autolinks (default: true) */
  gfm?: boolean
  /** Enable TeX math ($...$, $$...$$, \(...\), \[...\]) with Pandoc currency rules (default: true) */
  math?: boolean
  /** Repair unclosed inline syntax on the active streaming tail block (default: true) */
  heal?: boolean
  /** Hold bare trailing block markers (-, ##, 1., >) until their first word arrives (default: true) */
  holdPendingMarkers?: boolean
  /** Settle top-level blocks as soon as CommonMark closes them, or wait until a later visible block begins (default: true) */
  settleOnComplete?: boolean
  /**
   * Keep an HTML block that opens a tag (e.g. `<details>`) together with the following blocks up to the block that
   * closes it, as one `group` block. For renderers that turn each block into a DOM fragment (default: false).
   */
  groupHtmlBlocks?: boolean
  /** Eagerly populate `block.html` on each emitted block (default: false) */
  renderHtml?: boolean
}
