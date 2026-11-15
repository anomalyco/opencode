// CommonMark 0.31.2 block parser: a line-by-line port of commonmark.js `blocks.js`, extended with GFM tables and
// OpenCode's `$$`/`$` display-math blocks. The parser is persistent: complete lines are incorporated once, and the
// streaming tail is produced by forking only the open spine (the open last-child chain) of the tree.
import { unescapeString } from "./entities"
import { CLOSETAG, OPENTAG, parseReference, type RefMap } from "./inline"
import type { TableAlign } from "./types"

export type BlockType =
  | "document"
  | "block_quote"
  | "list"
  | "item"
  | "heading"
  | "thematic_break"
  | "code_block"
  | "html_block"
  | "paragraph"
  | "table"
  | "math_block"

export interface ListData {
  type: "bullet" | "ordered"
  tight: boolean
  bulletChar: string | null
  start: number | null
  delimiter: string | null
  padding: number
  markerOffset: number
}

export interface TableMemo {
  version: number
  headers: unknown[] | null
  rows: unknown[]
  rawRows: string[]
  used: Set<string>
  unresolved: Set<string>
}

export interface ListMemo {
  version: number
  items: unknown[]
  count: number
  used: Set<string>
  unresolved: Set<string>
  tightChecked: number
}

const EMPTY_ALIGN: TableAlign[] = []
const EMPTY_STRINGS: string[] = []

export class BNode {
  type: BlockType
  parent: BNode | null = null
  children: BNode[] = []
  open = true
  startLine: number
  endLine = 0
  content = ""
  level = 0
  listData: ListData | null = null
  isFenced = false
  fenceChar = ""
  fenceLength = 0
  fenceOffset = 0
  info = ""
  literal = ""
  htmlBlockType = 0
  /** paragraph whose whole content was reference definitions; renders nothing */
  defsOnly = false
  align: TableAlign[] = EMPTY_ALIGN
  header: string[] = EMPTY_STRINGS
  rows: string[] = EMPTY_STRINGS
  /** shared memo across forks of an open table so streaming flushes only convert newly added rows */
  tableMemo: TableMemo | null = null
  /** shared memo across forks of an open list so streaming flushes only convert newly closed/open items */
  listMemo: ListMemo | null = null
  mathDelimiter = ""
  mathClosed = false
  mathLines = 0
  fenceClosed = false
  lastLineCannotHeadTable = false
  /** created or cloned by a throwaway fork (never cached) */
  forked = false
  rowsCloned = false
  /** monotonically increasing identity, stable across forks of the same logical node */
  serial: number

  constructor(type: BlockType, startLine: number, serial: number) {
    this.type = type
    this.startLine = startLine
    this.serial = serial
  }

  get lastChild(): BNode | undefined {
    return this.children[this.children.length - 1]
  }

  shallowClone(cloneChildren = true): BNode {
    const copy = new BNode(this.type, this.startLine, this.serial)
    copy.parent = this.parent
    copy.children = cloneChildren ? this.children.slice() : []
    copy.open = this.open
    copy.endLine = this.endLine
    copy.content = this.content
    copy.level = this.level
    copy.listData = this.listData ? { ...this.listData } : null
    copy.isFenced = this.isFenced
    copy.fenceChar = this.fenceChar
    copy.fenceLength = this.fenceLength
    copy.fenceOffset = this.fenceOffset
    copy.info = this.info
    copy.literal = this.literal
    copy.htmlBlockType = this.htmlBlockType
    copy.defsOnly = this.defsOnly
    copy.align = this.align
    copy.header = this.header
    copy.rows = this.rows
    copy.tableMemo = this.tableMemo
    copy.listMemo = this.listMemo
    copy.mathDelimiter = this.mathDelimiter
    copy.mathClosed = this.mathClosed
    copy.mathLines = this.mathLines
    copy.fenceClosed = this.fenceClosed
    copy.lastLineCannotHeadTable = this.lastLineCannotHeadTable
    copy.forked = true
    return copy
  }
}

const CODE_INDENT = 4
const C_TAB = 9
const C_GREATERTHAN = 62
const C_LESSTHAN = 60
const C_SPACE = 32
const C_OPEN_BRACKET = 91

const reHtmlBlockOpen: RegExp[] = [
  /./,
  /^<(?:script|pre|textarea|style)(?:\s|>|$)/i,
  /^<!--/,
  /^<[?]/,
  /^<![A-Za-z]/,
  /^<!\[CDATA\[/,
  /^<[/]?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[123456]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|search|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|[/]?[>]|$)/i,
  new RegExp("^(?:" + OPENTAG + "|" + CLOSETAG + ")\\s*$", "i"),
]

const reHtmlBlockClose: RegExp[] = [/./, /<\/(?:script|pre|textarea|style)>/i, /-->/, /\?>/, />/, /\]\]>/]

const reNonSpace = /[^ \t\f\v\r\n]/
const reBulletListMarker = /^[*+-]/
const reOrderedListMarker = /^(\d{1,9})([.)])/
const reATXHeadingMarker = /^#{1,6}(?:[ \t]+|$)/
const reCodeFence = /^`{3,}(?!.*`)|^~{3,}/
const reClosingCodeFence = /^(?:`{3,}|~{3,})(?=[ \t]*$)/
const reSetextHeadingLine = /^(?:=+|-+)[ \t]*$/
const reTableDelimiterRow = /^\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/

const isBlank = (s: string) => !reNonSpace.test(s)
const isSpaceOrTab = (c: number) => c === C_SPACE || c === C_TAB
const peek = (ln: string, pos: number) => (pos < ln.length ? ln.charCodeAt(pos) : -1)

function isThematicBreak(ln: string, start: number): boolean {
  const marker = peek(ln, start)
  if (marker !== 0x2a /* * */ && marker !== 0x5f /* _ */ && marker !== 0x2d /* - */) return false
  let count = 0
  for (let i = ln.length - 1; i >= start; i--) {
    const c = ln.charCodeAt(i)
    if (c === marker) count++
    else if (c !== C_SPACE && c !== C_TAB) return false
  }
  return count >= 3
}

function isMaybeSpecial(c: number, ext: boolean): boolean {
  switch (c) {
    case 0x23: // #
    case 0x60: // `
    case 0x7e: // ~
    case 0x2a: // *
    case 0x2b: // +
    case 0x5f: // _
    case 0x3d: // =
    case 0x3c: // <
    case 0x3e: // >
    case 0x2d: // -
      return true
    case 0x7c: // |
    case 0x3a: // :
    case 0x24: // $
      return ext
    default:
      return c >= 0x30 && c <= 0x39
  }
}

function endsWithBlankLine(block: BNode, next: BNode | undefined): boolean {
  return next !== undefined && block.endLine !== next.startLine - 1
}

/** Split a GFM table row into raw cell strings (escaped pipes stay escaped; they are unescaped per cell later) */
export function splitTableRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith("|")) s = s.slice(1)
  if (s.endsWith("|") && !isEscapedAt(s, s.length - 1)) s = s.slice(0, -1)
  const cells: string[] = []
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 0x5c /* \ */) {
      i++
      continue
    }
    if (c === 0x7c /* | */) {
      cells.push(s.slice(start, i).trim())
      start = i + 1
    }
  }
  cells.push(s.slice(start).trim())
  return cells
}

function isEscapedAt(s: string, idx: number): boolean {
  let backslashes = 0
  for (let k = idx - 1; k >= 0 && s.charCodeAt(k) === 0x5c; k--) backslashes++
  return backslashes % 2 === 1
}

function parseAlign(delimiterRow: string): TableAlign[] {
  return splitTableRow(delimiterRow).map((cell) => {
    const left = cell.startsWith(":")
    const right = cell.endsWith(":")
    if (left && right) return "center"
    if (right) return "right"
    if (left) return "left"
    return null
  })
}

export interface ParserOptions {
  gfm: boolean
  math: boolean
}

type Continue = 0 | 1 | 2

export class BlockParser {
  doc: BNode
  tip: BNode
  oldtip: BNode
  currentLine = ""
  lineNumber = 0
  offset = 0
  column = 0
  nextNonspace = 0
  nextNonspaceColumn = 0
  indent = 0
  indented = false
  blank = false
  partiallyConsumedTab = false
  allClosed = true
  lastMatchedContainer: BNode
  refmap: RefMap
  options: ParserOptions
  /** lines (1-based) where an unclosed display-math opener must be read as ordinary Markdown */
  disallowMath: Set<number>
  /** set when a math block closed without its closing delimiter; the document must be re-parsed */
  unclosedMathAt = 0
  serialCounter: { n: number }
  /** refmap entries added since construction/fork (labels), so a fork can report new definitions */
  refsAdded: string[] = []

  constructor(
    options: ParserOptions,
    disallowMath: Set<number> = new Set(),
    serialCounter = { n: 0 },
    doc?: BNode,
    refmap?: RefMap,
  ) {
    this.options = options
    this.disallowMath = disallowMath
    this.serialCounter = serialCounter
    this.doc = doc ?? new BNode("document", 1, this.serialCounter.n++)
    this.tip = this.doc
    this.oldtip = this.doc
    this.lastMatchedContainer = this.doc
    this.refmap = refmap ?? new Map()
  }

  forkMode = false
  refmapCloned = false

  newNode(type: BlockType, startLine: number): BNode {
    const node = new BNode(type, startLine, this.serialCounter.n++)
    if (type === "list") {
      node.listMemo = { version: -1, items: [], count: 0, used: new Set(), unresolved: new Set(), tightChecked: 0 }
    } else if (type === "table") {
      node.rows = []
      node.tableMemo = { version: -1, headers: null, rows: [], rawRows: [], used: new Set(), unresolved: new Set() }
    }
    if (this.forkMode) node.forked = true
    return node
  }

  /**
   * Fork the parser for a throwaway continuation (the streaming tail). Only the open spine is cloned; closed
   * nodes are shared and never mutated. The fork's document holds just the open top-level child (if any).
   */
  fork(): BlockParser {
    const doc = this.doc.shallowClone(false)
    const f = new BlockParser(this.options, this.disallowMath, this.serialCounter, doc, this.refmap)
    f.lineNumber = this.lineNumber
    f.forkMode = true
    let src = this.doc
    let dst = doc
    while (src !== this.tip) {
      const child = src.lastChild!
      const copy = child.shallowClone(child.children.length > 0)
      copy.parent = dst
      if (dst === doc) doc.children = [copy]
      else dst.children[dst.children.length - 1] = copy
      src = child
      dst = copy
    }
    f.tip = dst
    f.oldtip = f.tip
    f.lastMatchedContainer = f.tip
    return f
  }

  addLine() {
    if (this.partiallyConsumedTab) {
      this.offset += 1
      const charsToTab = 4 - (this.column % 4)
      this.tip.content += " ".repeat(charsToTab)
    }
    this.tip.content += this.currentLine.slice(this.offset) + "\n"
  }

  addChild(tag: BlockType, offset: number): BNode {
    while (!this.canContain(this.tip.type, tag)) {
      this.finalize(this.tip, this.lineNumber - 1)
    }
    void offset
    const newBlock = this.newNode(tag, this.lineNumber)
    newBlock.parent = this.tip
    this.tip.children.push(newBlock)
    this.tip = newBlock
    return newBlock
  }

  canContain(parent: BlockType, child: BlockType): boolean {
    switch (parent) {
      case "document":
      case "block_quote":
      case "item":
        return child !== "item"
      case "list":
        return child === "item"
      default:
        return false
    }
  }

  acceptsLines(t: BlockType): boolean {
    return t === "paragraph" || t === "code_block" || t === "html_block" || t === "table" || t === "math_block"
  }

  parseListMarker(container: BNode): ListData | null {
    const rest = this.currentLine.slice(this.nextNonspace)
    let match: RegExpMatchArray | null
    const data: ListData = {
      type: "bullet",
      tight: true,
      bulletChar: null,
      start: null,
      delimiter: null,
      padding: 0,
      markerOffset: this.indent,
    }
    if (this.indent >= 4) return null
    if ((match = rest.match(reBulletListMarker))) {
      data.type = "bullet"
      data.bulletChar = match[0][0]!
    } else if ((match = rest.match(reOrderedListMarker)) && (container.type !== "paragraph" || match[1] === "1")) {
      data.type = "ordered"
      data.start = Number.parseInt(match[1]!, 10)
      data.delimiter = match[2]!
    } else {
      return null
    }
    let nextc = peek(this.currentLine, this.nextNonspace + match[0].length)
    if (!(nextc === -1 || nextc === C_TAB || nextc === C_SPACE)) return null
    if (container.type === "paragraph" && !reNonSpace.test(this.currentLine.slice(this.nextNonspace + match[0].length))) {
      return null
    }
    this.advanceNextNonspace()
    this.advanceOffset(match[0].length, true)
    const spacesStartCol = this.column
    const spacesStartOffset = this.offset
    do {
      this.advanceOffset(1, true)
      nextc = peek(this.currentLine, this.offset)
    } while (this.column - spacesStartCol < 5 && isSpaceOrTab(nextc))
    const blankItem = peek(this.currentLine, this.offset) === -1
    const spacesAfterMarker = this.column - spacesStartCol
    if (spacesAfterMarker >= 5 || spacesAfterMarker < 1 || blankItem) {
      data.padding = match[0].length + 1
      this.column = spacesStartCol
      this.offset = spacesStartOffset
      if (isSpaceOrTab(peek(this.currentLine, this.offset))) this.advanceOffset(1, true)
    } else {
      data.padding = match[0].length + spacesAfterMarker
    }
    return data
  }

  closeUnmatchedBlocks() {
    if (!this.allClosed) {
      while (this.oldtip !== this.lastMatchedContainer) {
        const parent = this.oldtip.parent!
        this.finalize(this.oldtip, this.lineNumber - 1)
        this.oldtip = parent
      }
      this.allClosed = true
    }
  }

  continueBlock(container: BNode): Continue {
    const ln = this.currentLine
    switch (container.type) {
      case "document":
      case "list":
        return 0
      case "block_quote":
        if (!this.indented && peek(ln, this.nextNonspace) === C_GREATERTHAN) {
          this.advanceNextNonspace()
          this.advanceOffset(1, false)
          if (isSpaceOrTab(peek(ln, this.offset))) this.advanceOffset(1, true)
          return 0
        }
        return 1
      case "item": {
        const ld = container.listData!
        if (this.blank) {
          if (container.children.length === 0) return 1
          this.advanceNextNonspace()
        } else if (this.indent >= ld.markerOffset + ld.padding) {
          this.advanceOffset(ld.markerOffset + ld.padding, true)
        } else {
          return 1
        }
        return 0
      }
      case "heading":
      case "thematic_break":
        return 1
      case "code_block": {
        const indent = this.indent
        if (container.isFenced) {
          const match =
            indent <= 3 &&
            ln.charAt(this.nextNonspace) === container.fenceChar &&
            ln.slice(this.nextNonspace).match(reClosingCodeFence)
          if (match && match[0].length >= container.fenceLength) {
            container.fenceClosed = true
            this.finalize(container, this.lineNumber)
            return 2
          }
          let i = container.fenceOffset
          while (i > 0 && isSpaceOrTab(peek(ln, this.offset))) {
            this.advanceOffset(1, true)
            i--
          }
        } else if (indent >= CODE_INDENT) {
          this.advanceOffset(CODE_INDENT, true)
        } else if (this.blank) {
          this.advanceNextNonspace()
        } else {
          return 1
        }
        return 0
      }
      case "html_block":
        return this.blank && (container.htmlBlockType === 6 || container.htmlBlockType === 7) ? 1 : 0
      case "paragraph":
        return this.blank ? 1 : 0
      case "table":
        return this.blank ? 1 : 0
      case "math_block": {
        if (container.mathLines > 0 && ln.slice(this.offset) === container.mathDelimiter) {
          container.mathClosed = true
          this.finalize(container, this.lineNumber)
          return 2
        }
        return 0
      }
    }
  }

  finalizeBlock(block: BNode) {
    switch (block.type) {
      case "list": {
        const items = block.children
        const memo = block.listMemo!
        const start = block.listData!.tight ? Math.max(0, memo.tightChecked - 1) : items.length
        outer: for (let i = start; i < items.length; i++) {
          const item = items[i]!
          if (i + 1 < items.length && endsWithBlankLine(item, items[i + 1])) {
            block.listData!.tight = false
            break
          }
          const subs = item.children
          for (let j = 0; j < subs.length; j++) {
            if (j + 1 < subs.length && endsWithBlankLine(subs[j]!, subs[j + 1])) {
              block.listData!.tight = false
              break outer
            }
          }
        }
        if (block.listData!.tight && items.length > 1 && !block.forked) {
          memo.tightChecked = Math.max(memo.tightChecked, items.length - 1)
        }
        block.endLine = block.lastChild!.endLine
        break
      }
      case "item":
        if (block.lastChild) block.endLine = block.lastChild.endLine
        else block.endLine = block.startLine
        break
      case "code_block":
        if (block.isFenced) {
          const content = block.content
          const newlinePos = content.indexOf("\n")
          const firstLine = content.slice(0, newlinePos)
          block.info = unescapeString(firstLine.trim())
          block.literal = content.slice(newlinePos + 1)
        } else {
          const lines = block.content.split("\n")
          while (lines.length > 0 && /^[ \t]*$/.test(lines[lines.length - 1]!)) lines.pop()
          block.literal = lines.join("\n") + "\n"
          block.endLine = block.startLine + lines.length - 1
        }
        block.content = ""
        break
      case "html_block":
        block.literal = block.content.replace(/\n$/, "")
        block.content = ""
        break
      case "paragraph": {
        let pos: number
        while (
          peek(block.content, 0) === C_OPEN_BRACKET &&
          (pos = this.parseRef(block.content, block.startLine))
        ) {
          block.content = block.content.slice(pos)
        }
        if (isBlank(block.content)) block.defsOnly = true
        break
      }
      case "math_block":
        block.literal = block.content.slice(block.content.indexOf("\n") + 1)
        block.content = ""
        if (!block.mathClosed && this.unclosedMathAt === 0) this.unclosedMathAt = block.startLine
        break
      default:
        break
    }
  }

  parseRef(s: string, startLine: number): number {
    if (this.forkMode && !this.refmapCloned) {
      this.refmap = new Map(this.refmap)
      this.refmapCloned = true
    }
    const before = this.refmap.size
    const pos = parseReference(s, this.refmap)
    if (pos && this.refmap.size > before) {
      // the newest key is the last inserted
      let lastKey = ""
      for (const key of this.refmap.keys()) lastKey = key
      const def = this.refmap.get(lastKey)
      if (def) def.line = startLine
      this.refsAdded.push(lastKey)
    }
    return pos
  }

  /** Block starts. Returns 0 = no match, 1 = matched container, 2 = matched leaf. */
  tryStart(i: number, container: BNode): 0 | 1 | 2 {
    switch (i) {
      case 0: {
        // block quote
        if (!this.indented && peek(this.currentLine, this.nextNonspace) === C_GREATERTHAN) {
          this.advanceNextNonspace()
          this.advanceOffset(1, false)
          if (isSpaceOrTab(peek(this.currentLine, this.offset))) this.advanceOffset(1, true)
          this.closeUnmatchedBlocks()
          this.addChild("block_quote", this.nextNonspace)
          return 1
        }
        return 0
      }
      case 1: {
        // ATX heading
        let match: RegExpMatchArray | null
        if (
          !this.indented &&
          peek(this.currentLine, this.nextNonspace) === 0x23 &&
          (match = this.currentLine.slice(this.nextNonspace).match(reATXHeadingMarker))
        ) {
          this.advanceNextNonspace()
          this.advanceOffset(match[0].length, false)
          this.closeUnmatchedBlocks()
          const c = this.addChild("heading", this.nextNonspace)
          c.level = match[0].trim().length
          c.content = this.currentLine
            .slice(this.offset)
            .replace(/^[ \t]*#+[ \t]*$/, "")
            .replace(/[ \t]+#+[ \t]*$/, "")
          this.advanceOffset(this.currentLine.length - this.offset, false)
          return 2
        }
        return 0
      }
      case 2: {
        // fenced code block
        const first = peek(this.currentLine, this.nextNonspace)
        let match: RegExpMatchArray | null
        if (
          !this.indented &&
          (first === 0x60 || first === 0x7e) &&
          (match = this.currentLine.slice(this.nextNonspace).match(reCodeFence))
        ) {
          const fenceLength = match[0].length
          this.closeUnmatchedBlocks()
          const c = this.addChild("code_block", this.nextNonspace)
          c.isFenced = true
          c.fenceLength = fenceLength
          c.fenceChar = match[0][0]!
          c.fenceOffset = this.indent
          this.advanceNextNonspace()
          this.advanceOffset(fenceLength, false)
          return 2
        }
        return 0
      }
      case 3: {
        // HTML block
        if (!this.indented && peek(this.currentLine, this.nextNonspace) === C_LESSTHAN) {
          const s = this.currentLine.slice(this.nextNonspace)
          for (let blockType = 1; blockType <= 7; blockType++) {
            if (
              reHtmlBlockOpen[blockType]!.test(s) &&
              (blockType < 7 ||
                (container.type !== "paragraph" && !(!this.allClosed && !this.blank && this.tip.type === "paragraph")))
            ) {
              this.closeUnmatchedBlocks()
              const b = this.addChild("html_block", this.offset)
              b.htmlBlockType = blockType
              return 2
            }
          }
        }
        return 0
      }
      case 4: {
        // setext heading
        const first = peek(this.currentLine, this.nextNonspace)
        let match: RegExpMatchArray | null
        if (
          !this.indented &&
          container.type === "paragraph" &&
          (first === 0x3d || first === 0x2d) &&
          (match = this.currentLine.slice(this.nextNonspace).match(reSetextHeadingLine))
        ) {
          this.closeUnmatchedBlocks()
          let pos: number
          while (
            peek(container.content, 0) === C_OPEN_BRACKET &&
            (pos = this.parseRef(container.content, container.startLine))
          ) {
            container.content = container.content.slice(pos)
          }
          if (container.content.length > 0) {
            const heading = this.newNode("heading", container.startLine)
            heading.level = match[0][0] === "=" ? 1 : 2
            heading.content = container.content
            const parent = container.parent!
            heading.parent = parent
            parent.children[parent.children.indexOf(container)] = heading
            this.tip = heading
            this.advanceOffset(this.currentLine.length - this.offset, false)
            return 2
          }
          return 0
        }
        return 0
      }
      case 5: {
        // thematic break
        if (!this.indented && isThematicBreak(this.currentLine, this.nextNonspace)) {
          this.closeUnmatchedBlocks()
          this.addChild("thematic_break", this.nextNonspace)
          this.advanceOffset(this.currentLine.length - this.offset, false)
          return 2
        }
        return 0
      }
      case 8: {
        // GFM table: the paragraph's last line is the header row, this line the delimiter row
        if (!this.options.gfm || this.indented || container.type !== "paragraph" || container.lastLineCannotHeadTable) return 0
        const rest = this.currentLine.slice(this.nextNonspace)
        if (!reTableDelimiterRow.test(rest)) return 0
        const content = container.content
        const body = content.endsWith("\n") ? content.slice(0, -1) : content
        const lastNl = body.lastIndexOf("\n")
        const headerLine = body.slice(lastNl + 1)
        const align = parseAlign(rest)
        if (headerLine.trim() === "|") return 0
        const header = splitTableRow(headerLine)
        if (header.length !== align.length) return 0
        if (!rest.includes("|") && !rest.includes(":")) return 0
        this.closeUnmatchedBlocks()
        const parent = container.parent!
        const table = this.newNode("table", this.lineNumber - 1)
        table.align = align
        table.header = header
        table.parent = parent
        if (lastNl < 0) {
          parent.children[parent.children.indexOf(container)] = table
        } else {
          container.content = body.slice(0, lastNl + 1)
          this.tip = container
          this.finalize(container, this.lineNumber - 2)
          parent.children.push(table)
        }
        this.tip = table
        this.advanceOffset(this.currentLine.length - this.offset, false)
        return 2
      }
      case 6: {
        // list item
        const first = peek(this.currentLine, this.nextNonspace)
        let data: ListData | null
        if (
          (!this.indented || container.type === "list") &&
          (first === 0x2a || first === 0x2b || first === 0x2d || (first >= 0x30 && first <= 0x39)) &&
          (data = this.parseListMarker(container))
        ) {
          this.closeUnmatchedBlocks()
          if (this.tip.type !== "list" || !listsMatch(container.listData, data)) {
            container = this.addChild("list", this.nextNonspace)
            container.listData = data
          }
          container = this.addChild("item", this.nextNonspace)
          container.listData = data
          return 1
        }
        return 0
      }
      case 7: {
        // indented code block
        if (this.indented && this.tip.type !== "paragraph" && !this.blank) {
          this.advanceOffset(CODE_INDENT, true)
          this.closeUnmatchedBlocks()
          this.addChild("code_block", this.offset)
          return 2
        }
        return 0
      }
      case 9: {
        // OpenCode display math: `$$` or `$` alone on a line, closed by the same delimiter alone on a line
        if (!this.options.math || this.indent !== 0 || this.tip.type === "paragraph" || container.type === "paragraph") {
          return 0
        }
        const rest = this.currentLine.slice(this.nextNonspace)
        if ((rest === "$$" || rest === "$") && !this.disallowMath.has(this.lineNumber)) {
          this.closeUnmatchedBlocks()
          const b = this.addChild("math_block", this.nextNonspace)
          b.mathDelimiter = rest
          b.mathLines = -1
          this.advanceOffset(this.currentLine.length - this.offset, false)
          return 2
        }
        return 0
      }
    }
    return 0
  }

  advanceOffset(count: number, columns = false) {
    const currentLine = this.currentLine
    let c: string | undefined
    while (count > 0 && (c = currentLine[this.offset])) {
      if (c === "\t") {
        const charsToTab = 4 - (this.column % 4)
        if (columns) {
          this.partiallyConsumedTab = charsToTab > count
          const charsToAdvance = charsToTab > count ? count : charsToTab
          this.column += charsToAdvance
          this.offset += this.partiallyConsumedTab ? 0 : 1
          count -= charsToAdvance
        } else {
          this.partiallyConsumedTab = false
          this.column += charsToTab
          this.offset += 1
          count -= 1
        }
      } else {
        this.partiallyConsumedTab = false
        this.offset += 1
        this.column += 1
        count -= 1
      }
    }
  }

  advanceNextNonspace() {
    this.offset = this.nextNonspace
    this.column = this.nextNonspaceColumn
    this.partiallyConsumedTab = false
  }

  findNextNonspace() {
    const currentLine = this.currentLine
    const len = currentLine.length
    let i = this.offset
    let cols = this.column
    while (i < len) {
      const c = currentLine.charCodeAt(i)
      if (c === C_SPACE) {
        i++
        cols++
      } else if (c === C_TAB) {
        i++
        cols += 4 - (cols % 4)
      } else {
        break
      }
    }
    const c = i < len ? currentLine.charCodeAt(i) : -1
    this.blank = c === 0x0a || c === 0x0d || c === -1
    this.nextNonspace = i
    this.nextNonspaceColumn = cols
    this.indent = this.nextNonspaceColumn - this.column
    this.indented = this.indent >= CODE_INDENT
  }

  incorporateLine(input: string) {
    let container = this.doc
    this.oldtip = this.tip
    this.offset = 0
    this.column = 0
    this.blank = false
    this.partiallyConsumedTab = false
    this.lineNumber += 1
    const ln = input.indexOf("\u0000") !== -1 ? input.replace(/\0/g, "\uFFFD") : input
    this.currentLine = ln

    let lastChild: BNode | undefined
    while ((lastChild = container.lastChild) && lastChild.open) {
      container = lastChild
      this.findNextNonspace()
      const res = this.continueBlock(container)
      if (res === 2) return
      if (res === 1) {
        container = container.parent!
        break
      }
    }

    this.allClosed = container === this.oldtip
    this.lastMatchedContainer = container

    let matchedLeaf =
      container.type !== "paragraph" && container.type !== "table" && this.acceptsLines(container.type)
    const ext = this.options.gfm || this.options.math
    while (!matchedLeaf) {
      this.findNextNonspace()
      if (!this.indented && !isMaybeSpecial(peek(ln, this.nextNonspace), ext)) {
        this.advanceNextNonspace()
        break
      }
      let i = 0
      let matched = false
      while (i < 10) {
        const res = this.tryStart(i, container)
        if (res === 1) {
          container = this.tip
          matched = true
          break
        } else if (res === 2) {
          container = this.tip
          matchedLeaf = true
          matched = true
          break
        }
        i++
      }
      if (!matched) {
        this.advanceNextNonspace()
        break
      }
    }

    if (!this.allClosed && !this.blank && this.tip.type === "paragraph") {
      this.tip.lastLineCannotHeadTable = this.indented
      this.addLine()
    } else {
      this.closeUnmatchedBlocks()
      const t = container.type
      if (this.acceptsLines(t)) {
        if (t === "table") {
          if (this.lineNumber > container.startLine + 1) {
            if (container.forked && !container.rowsCloned) {
              container.rows = container.rows.slice()
              container.rowsCloned = true
            }
            container.rows.push(ln.slice(this.offset))
          }
        } else {
          if (t === "paragraph") container.lastLineCannotHeadTable = this.indented
          this.addLine()
          if (t === "math_block") container.mathLines++
        }
        if (
          t === "html_block" &&
          container.htmlBlockType >= 1 &&
          container.htmlBlockType <= 5 &&
          reHtmlBlockClose[container.htmlBlockType]!.test(this.currentLine.slice(this.offset))
        ) {
          this.finalize(container, this.lineNumber)
        }
      } else if (this.offset < ln.length && !this.blank) {
        container = this.addChild("paragraph", this.offset)
        this.advanceNextNonspace()
        this.addLine()
      }
    }
  }

  finalize(block: BNode, lineNumber: number) {
    const above = block.parent
    block.open = false
    block.endLine = lineNumber
    this.finalizeBlock(block)
    this.tip = above!
  }

  /** Close every open block, as at the end of the document */
  finish() {
    while (this.tip && this.tip !== this.doc) this.finalize(this.tip, this.lineNumber)
    this.doc.open = false
    this.doc.endLine = this.lineNumber
  }
}

function listsMatch(listData: ListData | null, itemData: ListData): boolean {
  return (
    listData !== null &&
    listData.type === itemData.type &&
    listData.delimiter === itemData.delimiter &&
    listData.bulletChar === itemData.bulletChar
  )
}
