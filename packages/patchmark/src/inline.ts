// CommonMark 0.31.2 inline parser (a port of commonmark.js's delimiter-stack and bracket-stack algorithm),
// extended with GFM strikethrough and extended autolinks, and OpenCode's `$…$`, `$$…$$`, and `\(…\)` math.
import { decodeEntity, ENTITY_PATTERN, ESCAPABLE, normalizeURI, unescapeString } from "./entities"
import type { InlineNode, MathDelimiter } from "./types"

export { healStreamingInline } from "./heal"

export interface ReferenceDef {
  href: string
  title?: string
  /** Source text of the definition (container prefixes stripped), for renderers that re-parse a block on its own */
  raw?: string
  /** 1-based start line of the paragraph that defined this reference */
  line?: number
}

export type RefMap = Map<string, ReferenceDef>

export interface InlineParseOptions {
  gfm?: boolean
  math?: boolean
  defs?: ReadonlyMap<string, ReferenceDef>
  unresolvedRefs?: Set<string>
  usedRefs?: Set<string>
}

const C_NEWLINE = 10
const C_ASTERISK = 42
const C_UNDERSCORE = 95
const C_BACKTICK = 96
const C_OPEN_BRACKET = 91
const C_CLOSE_BRACKET = 93
const C_LESSTHAN = 60
const C_BANG = 33
const C_BACKSLASH = 92
const C_AMPERSAND = 38
const C_OPEN_PAREN = 40
const C_CLOSE_PAREN = 41
const C_COLON = 58
const C_TILDE = 126
const C_DOLLAR = 36

const ESCAPED_CHAR = "\\\\" + ESCAPABLE
const TAGNAME = "[A-Za-z][A-Za-z0-9-]*"
const ATTRIBUTENAME = "[a-zA-Z_:][a-zA-Z0-9:._-]*"
const UNQUOTEDVALUE = "[^\"'=<>`\\x00-\\x20]+"
const SINGLEQUOTEDVALUE = "'[^']*'"
const DOUBLEQUOTEDVALUE = '"[^"]*"'
const ATTRIBUTEVALUE = "(?:" + UNQUOTEDVALUE + "|" + SINGLEQUOTEDVALUE + "|" + DOUBLEQUOTEDVALUE + ")"
const ATTRIBUTEVALUESPEC = "(?:\\s*=\\s*" + ATTRIBUTEVALUE + ")"
const ATTRIBUTE = "(?:\\s+" + ATTRIBUTENAME + ATTRIBUTEVALUESPEC + "?)"
export const OPENTAG = "<" + TAGNAME + ATTRIBUTE + "*\\s*/?>"
export const CLOSETAG = "</" + TAGNAME + "\\s*[>]"
const HTMLCOMMENT = "<!-->|<!--->|<!--[\\s\\S]*?-->"
const PROCESSINGINSTRUCTION = "[<][?][\\s\\S]*?[?][>]"
const DECLARATION = "<![A-Za-z]+[^>]*>"
const CDATA = "<!\\[CDATA\\[[\\s\\S]*?\\]\\]>"
const HTMLTAG = "(?:" + OPENTAG + "|" + CLOSETAG + "|" + HTMLCOMMENT + "|" + PROCESSINGINSTRUCTION + "|" + DECLARATION + "|" + CDATA + ")"
const reHtmlTag = new RegExp(HTMLTAG, "y")

const rePunctuation = /^[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~\p{P}\p{S}]/u
const reLinkTitle = new RegExp(
  '(?:"(' +
    ESCAPED_CHAR +
    '|\\\\[^\\\\]|[^\\\\"\\x00])*"' +
    "|'(" +
    ESCAPED_CHAR +
    "|\\\\[^\\\\]|[^\\\\'\\x00])*'" +
    "|\\((" +
    ESCAPED_CHAR +
    "|\\\\[^\\\\]|[^\\\\()\\x00])*\\))",
  "y",
)
const reLinkDestinationBraces = /(?:<(?:[^<>\n\\\x00]|\\.)*>)/y
const reEscapable = new RegExp("^" + ESCAPABLE)
const reEntityHere = new RegExp(ENTITY_PATTERN, "iy")
const reTicks = /`+/g
const reTicksHere = /`+/y
const reEmailAutolink =
  /<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/y
const reAutolink = /<[A-Za-z][A-Za-z0-9.+-]{1,31}:[^<>\x00-\x20]*>/iy
const reSpnl = / *(?:\n *)?/y
const reWhitespaceChar = /^[ \t\n\x0b\x0c\x0d]/
const reUnicodeWhitespaceChar = /^\s/
const reFinalSpace = / *$/
const reInitialSpace = / */y
const reSpaceAtEndOfLine = / *(?:\n|$)/y
const reLinkLabel = /\[(?:[^\\[\]]|\\.){0,1000}\]/sy
const reMainCore = /[^\n`[\]\\!<&*_'"]+/y
const reMainGfm = /[^\n`[\]\\!<&*_'"~]+/y
const reMainMath = /[^\n`[\]\\!<&*_'"$]+/y
const reMainGfmMath = /[^\n`[\]\\!<&*_'"~$]+/y

// OpenCode's marked math extension (packages/ui/src/context/marked-parser.tsx), verbatim
const reInlineDollarMath =
  /\$\$(?!\$)((?:\\.|[^\\\n])*?(?:\\.|[^\\\n$]))\$\$|\$(?=[^\s$])((?:\\.|[^\\\n$])*?(?:\\\S|[^\s\\$]))\$(?!\w)/y
const reInlineParenMath = /\\\(((?:\\.|[^\\\n])*?)\\\)/y

type NodeType =
  | "text"
  | "softbreak"
  | "linebreak"
  | "code"
  | "emph"
  | "strong"
  | "del"
  | "link"
  | "image"
  | "html_inline"
  | "math"
  | "root"

class INode {
  type: NodeType
  literal = ""
  escaped = false
  destination = ""
  title = ""
  delimiter: MathDelimiter = "dollar"
  display = false
  parent: INode | null = null
  first: INode | null = null
  last: INode | null = null
  next: INode | null = null
  prev: INode | null = null

  constructor(type: NodeType, literal = "") {
    this.type = type
    this.literal = literal
  }

  appendChild(child: INode) {
    child.unlink()
    child.parent = this
    if (this.last) {
      this.last.next = child
      child.prev = this.last
      this.last = child
    } else {
      this.first = child
      this.last = child
    }
  }

  insertAfter(sibling: INode) {
    sibling.unlink()
    sibling.next = this.next
    if (sibling.next) sibling.next.prev = sibling
    sibling.prev = this
    this.next = sibling
    sibling.parent = this.parent
    if (sibling.parent && !sibling.next) sibling.parent.last = sibling
  }

  insertBefore(sibling: INode) {
    sibling.unlink()
    sibling.prev = this.prev
    if (sibling.prev) sibling.prev.next = sibling
    sibling.next = this
    this.prev = sibling
    sibling.parent = this.parent
    if (sibling.parent && !sibling.prev) sibling.parent.first = sibling
  }

  unlink() {
    if (this.prev) this.prev.next = this.next
    else if (this.parent) this.parent.first = this.next
    if (this.next) this.next.prev = this.prev
    else if (this.parent) this.parent.last = this.prev
    this.parent = null
    this.next = null
    this.prev = null
  }
}

interface Delimiter {
  cc: number
  numdelims: number
  origdelims: number
  node: INode
  previous: Delimiter | null
  next: Delimiter | null
  canOpen: boolean
  canClose: boolean
}

interface Bracket {
  node: INode
  previous: Bracket | null
  previousDelimiter: Delimiter | null
  index: number
  image: boolean
  active: boolean
  bracketAfter: boolean
}

const text = (s: string) => new INode("text", s)

/** Normalize a link label: strip brackets, trim, collapse whitespace, Unicode case fold */
export function normalizeReference(label: string): string {
  return label
    .slice(1, label.length - 1)
    .trim()
    .replace(/[ \t\r\n]+/g, " ")
    .toLowerCase()
    .toUpperCase()
}

function isSpecialFastPath(src: string, gfm: boolean, math: boolean): boolean {
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i)
    if (
      c === C_NEWLINE ||
      c === C_BACKSLASH ||
      c === C_BACKTICK ||
      c === C_ASTERISK ||
      c === C_UNDERSCORE ||
      c === C_OPEN_BRACKET ||
      c === C_CLOSE_BRACKET ||
      c === C_BANG ||
      c === C_LESSTHAN ||
      c === C_AMPERSAND ||
      (gfm && (c === C_TILDE || c === C_COLON || c === 0x40 /* @ */ || c === 0x2e /* . */)) ||
      (math && c === C_DOLLAR)
    ) {
      return true
    }
  }
  return false
}

class InlineParser {
  subject = ""
  pos = 0
  delimiters: Delimiter | null = null
  brackets: Bracket | null = null
  refmap: ReadonlyMap<string, ReferenceDef> = new Map()
  gfm = false
  math = false
  reMain = reMainCore
  tickRuns: Map<number, number[]> | null = null
  unresolvedRefs?: Set<string>
  usedRefs?: Set<string>

  /** `re` must be sticky (anchored at `pos`) or global (searching forward from `pos`) */
  match(re: RegExp): string | null {
    re.lastIndex = this.pos
    const m = re.exec(this.subject)
    if (m === null) return null
    this.pos = re.lastIndex
    return m[0]
  }

  peek(): number {
    return this.pos < this.subject.length ? this.subject.charCodeAt(this.pos) : -1
  }

  spnl(): true {
    this.match(reSpnl)
    return true
  }

  parseBackticks(block: INode): boolean {
    const ticks = this.match(reTicksHere)
    if (ticks === null) return false
    const afterOpenTicks = this.pos
    const len = ticks.length
    if (this.tickRuns === null) {
      const first = this.match(reTicks)
      if (first === null) {
        this.pos = afterOpenTicks
        block.appendChild(text(ticks))
        return true
      }
      if (first.length === len) {
        const node = new INode("code")
        const contents = this.subject.slice(afterOpenTicks, this.pos - len).replace(/\n/gm, " ")
        if (contents.length > 0 && /[^ ]/.test(contents) && contents[0] === " " && contents[contents.length - 1] === " ") {
          node.literal = contents.slice(1, contents.length - 1)
        } else {
          node.literal = contents
        }
        block.appendChild(node)
        return true
      }
      const map = new Map<number, number[]>()
      map.set(first.length, [this.pos])
      let m: string | null
      while ((m = this.match(reTicks)) !== null) {
        let list = map.get(m.length)
        if (!list) map.set(m.length, (list = []))
        list.push(this.pos)
      }
      this.tickRuns = map
    }
    const candidates = this.tickRuns.get(len)
    if (candidates) {
      for (let i = 0; i < candidates.length; i++) {
        const endPos = candidates[i]!
        if (endPos - len >= afterOpenTicks) {
          this.pos = endPos
          const node = new INode("code")
          const contents = this.subject.slice(afterOpenTicks, endPos - len).replace(/\n/gm, " ")
          if (contents.length > 0 && /[^ ]/.test(contents) && contents[0] === " " && contents[contents.length - 1] === " ") {
            node.literal = contents.slice(1, contents.length - 1)
          } else {
            node.literal = contents
          }
          block.appendChild(node)
          return true
        }
      }
    }
    this.pos = afterOpenTicks
    block.appendChild(text(ticks))
    return true
  }

  parseBackslash(block: INode): boolean {
    const subj = this.subject
    if (this.math) {
      reInlineParenMath.lastIndex = this.pos
      const m = reInlineParenMath.exec(subj)
      if (m) {
        const node = new INode("math", m[1]!.trim())
        node.delimiter = "paren"
        node.display = false
        block.appendChild(node)
        this.pos += m[0].length
        return true
      }
    }
    this.pos += 1
    if (this.peek() === C_NEWLINE) {
      this.pos += 1
      block.appendChild(new INode("linebreak"))
    } else if (reEscapable.test(subj.charAt(this.pos))) {
      const node = text(subj.charAt(this.pos))
      node.escaped = true
      block.appendChild(node)
      this.pos += 1
    } else {
      block.appendChild(text("\\"))
    }
    return true
  }

  parseDollar(block: INode): boolean {
    reInlineDollarMath.lastIndex = this.pos
    const m = reInlineDollarMath.exec(this.subject)
    if (!m) return false
    const display = m[1] !== undefined
    const node = new INode("math", (m[1] ?? m[2])!.trim())
    node.delimiter = display ? "double-dollar" : "dollar"
    node.display = display
    block.appendChild(node)
    this.pos += m[0].length
    return true
  }

  parseAutolink(block: INode): boolean {
    let m: string | null
    if ((m = this.match(reEmailAutolink))) {
      const dest = m.slice(1, m.length - 1)
      const node = new INode("link")
      node.destination = normalizeURI("mailto:" + dest)
      node.appendChild(text(dest))
      block.appendChild(node)
      return true
    }
    if ((m = this.match(reAutolink))) {
      const dest = m.slice(1, m.length - 1)
      const node = new INode("link")
      node.destination = normalizeURI(dest)
      node.appendChild(text(dest))
      block.appendChild(node)
      return true
    }
    return false
  }

  parseHtmlTag(block: INode): boolean {
    const m = this.match(reHtmlTag)
    if (m === null) return false
    block.appendChild(new INode("html_inline", m))
    return true
  }

  scanDelims(cc: number): { numdelims: number; canOpen: boolean; canClose: boolean } | null {
    let numdelims = 0
    const startpos = this.pos
    while (this.peek() === cc) {
      numdelims++
      this.pos++
    }
    if (numdelims === 0) return null

    const charBefore = startpos === 0 ? "\n" : this.subject.charAt(startpos - 1)
    const ccAfter = this.peek()
    const charAfter = ccAfter === -1 ? "\n" : this.subject.charAt(this.pos)

    const afterIsWhitespace = reUnicodeWhitespaceChar.test(charAfter)
    const afterIsPunctuation = rePunctuation.test(charAfter)
    const beforeIsWhitespace = reUnicodeWhitespaceChar.test(charBefore)
    const beforeIsPunctuation = rePunctuation.test(charBefore)

    const leftFlanking =
      (!afterIsWhitespace && (!afterIsPunctuation || beforeIsWhitespace || beforeIsPunctuation)) ||
      (this.gfm && cc !== C_TILDE && charAfter === "~")
    const rightFlanking =
      (!beforeIsWhitespace && (!beforeIsPunctuation || afterIsWhitespace || afterIsPunctuation)) ||
      (this.gfm && cc !== C_TILDE && charBefore === "~")
    let canOpen: boolean
    let canClose: boolean
    if (cc === C_UNDERSCORE) {
      canOpen = leftFlanking && (!rightFlanking || beforeIsPunctuation)
      canClose = rightFlanking && (!leftFlanking || afterIsPunctuation)
    } else {
      canOpen = leftFlanking
      canClose = rightFlanking
    }
    if (cc === C_TILDE && numdelims > 2) {
      canOpen = false
      canClose = false
    }
    this.pos = startpos
    return { numdelims, canOpen, canClose }
  }

  handleDelim(cc: number, block: INode): boolean {
    const res = this.scanDelims(cc)
    if (!res) return false
    const numdelims = res.numdelims
    const startpos = this.pos
    this.pos += numdelims
    const node = text(this.subject.slice(startpos, this.pos))
    block.appendChild(node)

    if (res.canOpen || res.canClose) {
      this.delimiters = {
        cc,
        numdelims,
        origdelims: numdelims,
        node,
        previous: this.delimiters,
        next: null,
        canOpen: res.canOpen,
        canClose: res.canClose,
      }
      if (this.delimiters.previous !== null) this.delimiters.previous.next = this.delimiters
    }
    return true
  }

  removeDelimiter(delim: Delimiter) {
    if (delim.previous !== null) delim.previous.next = delim.next
    if (delim.next === null) this.delimiters = delim.previous
    else delim.next.previous = delim.previous
  }

  processEmphasis(stackBottom: Delimiter | null) {
    if (this.delimiters === stackBottom) return
    const openersBottom: (Delimiter | null)[] = []
    for (let i = 0; i < 16; i++) openersBottom[i] = stackBottom

    let closer = this.delimiters
    while (closer !== null && closer.previous !== stackBottom) closer = closer.previous

    while (closer !== null) {
      const closercc = closer.cc
      if (!closer.canClose) {
        closer = closer.next
        continue
      }
      let opener = closer.previous
      let openerFound = false
      const openersBottomIndex =
        closercc === C_UNDERSCORE
          ? 2 + (closer.canOpen ? 3 : 0) + (closer.origdelims % 3)
          : closercc === C_ASTERISK
            ? 8 + (closer.canOpen ? 3 : 0) + (closer.origdelims % 3)
            : 14 + (closer.origdelims === 2 ? 1 : 0)
      while (opener !== null && opener !== stackBottom && opener !== openersBottom[openersBottomIndex]) {
        if (closercc === C_TILDE) {
          if (opener.cc === C_TILDE && opener.canOpen && opener.origdelims === closer.origdelims) {
            openerFound = true
            break
          }
        } else {
          const oddMatch =
            (closer.canOpen || opener.canClose) &&
            closer.origdelims % 3 !== 0 &&
            (opener.origdelims + closer.origdelims) % 3 === 0
          if (opener.cc === closer.cc && opener.canOpen && !oddMatch) {
            openerFound = true
            break
          }
        }
        opener = opener.previous
      }
      const oldCloser = closer

      if (!openerFound) {
        closer = closer.next
      } else {
        const op = opener!
        const useDelims = closercc === C_TILDE ? closer.numdelims : closer.numdelims >= 2 && op.numdelims >= 2 ? 2 : 1
        const openerInl = op.node
        const closerInl = closer.node
        op.numdelims -= useDelims
        closer.numdelims -= useDelims
        openerInl.literal = openerInl.literal.slice(0, openerInl.literal.length - useDelims)
        closerInl.literal = closerInl.literal.slice(0, closerInl.literal.length - useDelims)

        const emph = new INode(closercc === C_TILDE ? "del" : useDelims === 1 ? "emph" : "strong")
        let tmp = openerInl.next
        while (tmp && tmp !== closerInl) {
          const next = tmp.next
          tmp.unlink()
          emph.appendChild(tmp)
          tmp = next
        }
        openerInl.insertAfter(emph)

        // remove delimiters between opener and closer
        if (op.next !== closer) {
          op.next = closer
          closer.previous = op
        }

        if (op.numdelims === 0) {
          openerInl.unlink()
          this.removeDelimiter(op)
        }
        if (closer.numdelims === 0) {
          closerInl.unlink()
          const tempstack = closer.next
          this.removeDelimiter(closer)
          closer = tempstack
        }
      }
      if (!openerFound) {
        openersBottom[openersBottomIndex] = oldCloser.previous
        if (!oldCloser.canOpen) this.removeDelimiter(oldCloser)
      }
    }

    while (this.delimiters !== null && this.delimiters !== stackBottom) this.removeDelimiter(this.delimiters)
  }

  parseLinkTitle(): string | null {
    const title = this.match(reLinkTitle)
    if (title === null) return null
    return unescapeString(title.slice(1, -1))
  }

  parseLinkDestination(): string | null {
    let res = this.match(reLinkDestinationBraces)
    if (res !== null) return normalizeURI(unescapeString(res.slice(1, -1)))
    if (this.peek() === C_LESSTHAN) return null
    const savepos = this.pos
    let openparens = 0
    let c: number
    while ((c = this.peek()) !== -1) {
      if (c === C_BACKSLASH && reEscapable.test(this.subject.charAt(this.pos + 1))) {
        this.pos += 1
        if (this.peek() !== -1) this.pos += 1
      } else if (c === C_OPEN_PAREN) {
        this.pos += 1
        openparens += 1
      } else if (c === C_CLOSE_PAREN) {
        if (openparens < 1) break
        this.pos += 1
        openparens -= 1
      } else if (reWhitespaceChar.test(String.fromCharCode(c))) {
        break
      } else if (c < 0x20 || c === 0x7f) {
        break
      } else {
        this.pos += 1
      }
    }
    if (this.pos === savepos && c !== C_CLOSE_PAREN) return null
    if (openparens !== 0) return null
    res = this.subject.slice(savepos, this.pos)
    return normalizeURI(unescapeString(res))
  }

  parseLinkLabel(): number {
    const m = this.match(reLinkLabel)
    if (m === null || m.length > 1001) return 0
    return m.length
  }

  parseOpenBracket(block: INode): boolean {
    const startpos = this.pos
    this.pos += 1
    const node = text("[")
    block.appendChild(node)
    this.addBracket(node, startpos, false)
    return true
  }

  parseBang(block: INode): boolean {
    const startpos = this.pos
    this.pos += 1
    if (this.peek() === C_OPEN_BRACKET) {
      this.pos += 1
      const node = text("![")
      block.appendChild(node)
      this.addBracket(node, startpos + 1, true)
    } else {
      block.appendChild(text("!"))
    }
    return true
  }

  lookupRef(label: string): ReferenceDef | undefined {
    const norm = normalizeReference(label)
    const def = this.refmap.get(norm)
    if (def) this.usedRefs?.add(norm)
    else if (norm) this.unresolvedRefs?.add(norm)
    return def
  }

  parseCloseBracket(block: INode): boolean {
    let dest: string | null = null
    let title: string | null = null
    let matched = false

    this.pos += 1
    const startpos = this.pos
    let opener = this.brackets
    if (opener === null) {
      block.appendChild(text("]"))
      return true
    }
    if (!opener.active) {
      block.appendChild(text("]"))
      this.removeBracket()
      return true
    }
    const isImage = opener.image
    const savepos = this.pos

    if (this.peek() === C_OPEN_PAREN) {
      this.pos++
      if (
        this.spnl() &&
        (dest = this.parseLinkDestination()) !== null &&
        this.spnl() &&
        ((reWhitespaceChar.test(this.subject.charAt(this.pos - 1)) && (title = this.parseLinkTitle())) || true) &&
        this.spnl() &&
        this.peek() === C_CLOSE_PAREN
      ) {
        this.pos += 1
        matched = true
      } else {
        this.pos = savepos
      }
    }

    if (!matched) {
      const beforelabel = this.pos
      const n = this.parseLinkLabel()
      let reflabel: string | undefined
      if (n > 2) {
        reflabel = this.subject.slice(beforelabel, beforelabel + n)
      } else if (!opener.bracketAfter) {
        reflabel = this.subject.slice(opener.index, startpos)
      }
      if (n === 0) this.pos = savepos
      if (reflabel) {
        const link = this.lookupRef(reflabel)
        if (link) {
          dest = link.href
          title = link.title ?? null
          matched = true
        }
      }
    }

    if (matched) {
      const node = new INode(isImage ? "image" : "link")
      node.destination = dest ?? ""
      node.title = title || ""
      let tmp = opener.node.next
      while (tmp) {
        const next = tmp.next
        tmp.unlink()
        node.appendChild(tmp)
        tmp = next
      }
      block.appendChild(node)
      this.processEmphasis(opener.previousDelimiter)
      this.removeBracket()
      opener.node.unlink()
      if (!isImage) {
        opener = this.brackets
        while (opener !== null) {
          if (!opener.image) {
            if (!opener.active) break
            opener.active = false
          }
          opener = opener.previous
        }
      }
      return true
    }

    this.removeBracket()
    this.pos = startpos
    block.appendChild(text("]"))
    return true
  }

  addBracket(node: INode, index: number, image: boolean) {
    if (this.brackets !== null) this.brackets.bracketAfter = true
    this.brackets = {
      node,
      previous: this.brackets,
      previousDelimiter: this.delimiters,
      index,
      image,
      active: true,
      bracketAfter: false,
    }
  }

  removeBracket() {
    this.brackets = this.brackets!.previous
  }

  parseEntity(block: INode): boolean {
    const m = this.match(reEntityHere)
    if (!m) return false
    const node = text(decodeEntity(m))
    node.escaped = true
    block.appendChild(node)
    return true
  }

  parseString(block: INode): boolean {
    const m = this.match(this.reMain)
    if (!m) return false
    block.appendChild(text(m))
    return true
  }

  parseNewline(block: INode): boolean {
    this.pos += 1
    const lastc = block.last
    if (lastc && lastc.type === "text" && lastc.literal[lastc.literal.length - 1] === " ") {
      const hardbreak = lastc.literal[lastc.literal.length - 2] === " "
      lastc.literal = lastc.literal.replace(reFinalSpace, "")
      block.appendChild(new INode(hardbreak ? "linebreak" : "softbreak"))
    } else {
      block.appendChild(new INode("softbreak"))
    }
    this.match(reInitialSpace)
    return true
  }

  /** Attempt to parse a link reference definition at the start of `s`, adding it to `refmap`. Returns chars consumed. */
  parseReference(s: string, refmap: RefMap): number {
    this.subject = s
    this.pos = 0
    const startpos = 0
    let title: string | null = null

    const matchChars = this.parseLinkLabel()
    if (matchChars === 0) return 0
    const rawlabel = this.subject.slice(0, matchChars)

    if (this.peek() === C_COLON) {
      this.pos++
    } else {
      this.pos = startpos
      return 0
    }

    this.spnl()
    const dest = this.parseLinkDestination()
    if (dest === null) {
      this.pos = startpos
      return 0
    }

    const beforetitle = this.pos
    this.spnl()
    if (this.pos !== beforetitle) title = this.parseLinkTitle()
    if (title === null) this.pos = beforetitle

    let atLineEnd = true
    if (this.match(reSpaceAtEndOfLine) === null) {
      if (title === null) {
        atLineEnd = false
      } else {
        title = null
        this.pos = beforetitle
        atLineEnd = this.match(reSpaceAtEndOfLine) !== null
      }
    }
    if (!atLineEnd) {
      this.pos = startpos
      return 0
    }

    const normlabel = normalizeReference(rawlabel)
    if (normlabel === "") {
      this.pos = startpos
      return 0
    }
    if (!refmap.has(normlabel)) {
      refmap.set(normlabel, {
        href: dest,
        ...(title ? { title } : {}),
        raw: s.slice(0, this.pos).trim(),
      })
    }
    return this.pos - startpos
  }

  parseInline(block: INode): boolean {
    const c = this.peek()
    if (c === -1) return false
    let res = false
    switch (c) {
      case C_NEWLINE:
        res = this.parseNewline(block)
        break
      case C_BACKSLASH:
        res = this.parseBackslash(block)
        break
      case C_BACKTICK:
        res = this.parseBackticks(block)
        break
      case C_ASTERISK:
      case C_UNDERSCORE:
        res = this.handleDelim(c, block)
        break
      case C_TILDE:
        res = this.gfm && this.handleDelim(c, block)
        break
      case C_DOLLAR:
        res = this.math && this.parseDollar(block)
        break
      case C_OPEN_BRACKET:
        res = this.parseOpenBracket(block)
        break
      case C_BANG:
        res = this.parseBang(block)
        break
      case C_CLOSE_BRACKET:
        res = this.parseCloseBracket(block)
        break
      case C_LESSTHAN:
        res = this.parseAutolink(block) || this.parseHtmlTag(block)
        break
      case C_AMPERSAND:
        res = this.parseEntity(block)
        break
      default:
        res = this.parseString(block)
        break
    }
    if (!res) {
      this.pos += 1
      block.appendChild(text(String.fromCharCode(c)))
    }
    return true
  }

  parse(content: string): INode {
    const root = new INode("root")
    this.subject = content.trim()
    this.pos = 0
    this.delimiters = null
    this.brackets = null
    this.tickRuns = null
    while (this.parseInline(root)) {}
    this.processEmphasis(null)
    return root
  }
}

const sharedParser = new InlineParser()
const EMPTY_REFMAP: ReadonlyMap<string, ReferenceDef> = new Map()

/** Parse a link reference definition at the start of `s` into `refmap`; returns the number of characters consumed */
export function parseReference(s: string, refmap: RefMap): number {
  return sharedParser.parseReference(s, refmap)
}

export function parseInlines(raw: string, options: InlineParseOptions = {}): InlineNode[] {
  const gfm = options.gfm !== false
  const math = options.math !== false
  const src = raw.trim()
  if (!src) return []
  if (!isSpecialFastPath(src, gfm, math)) return [{ type: "text", text: src }]

  const p = sharedParser
  p.refmap = options.defs ?? EMPTY_REFMAP
  p.gfm = gfm
  p.math = math
  p.reMain = gfm ? (math ? reMainGfmMath : reMainGfm) : math ? reMainMath : reMainCore
  p.unresolvedRefs = options.unresolvedRefs
  p.usedRefs = options.usedRefs
  const root = p.parse(src)
  return convertChildren(root, gfm, false)
}

function convertChildren(parent: INode, gfm: boolean, inLink: boolean): InlineNode[] {
  const out: InlineNode[] = []
  let pendingText = ""
  let prevChar = ""
  const pushText = (s: string) => {
    if (!s) return
    const prev = out[out.length - 1]
    if (prev && prev.type === "text") prev.text += s
    else out.push({ type: "text", text: s })
  }
  const flush = () => {
    if (!pendingText) return
    if (gfm && !inLink) {
      for (const node of autolinkLiterals(pendingText, prevChar)) {
        if (node.type === "text") pushText(node.text)
        else out.push(node)
      }
    } else {
      pushText(pendingText)
    }
    prevChar = pendingText[pendingText.length - 1]!
    pendingText = ""
  }
  for (let n = parent.first; n; n = n.next) {
    switch (n.type) {
      case "text":
        if (gfm && !inLink && n.escaped) {
          flush()
          pushText(n.literal)
          prevChar = n.literal[n.literal.length - 1] ?? ""
        } else {
          pendingText += n.literal
        }
        break
      case "softbreak":
        pendingText += "\n"
        break
      case "linebreak":
        flush()
        out.push({ type: "br" })
        prevChar = "\n"
        break
      case "code":
        flush()
        out.push({ type: "code", text: n.literal })
        prevChar = "`"
        break
      case "emph":
        flush()
        out.push({ type: "em", children: convertChildren(n, gfm, inLink) })
        prevChar = "*"
        break
      case "strong":
        flush()
        out.push({ type: "strong", children: convertChildren(n, gfm, inLink) })
        prevChar = "*"
        break
      case "del":
        flush()
        out.push({ type: "del", children: convertChildren(n, gfm, inLink) })
        prevChar = "~"
        break
      case "link":
        flush()
        out.push({
          type: "link",
          href: n.destination,
          ...(n.title ? { title: n.title } : {}),
          children: convertChildren(n, gfm, true),
        })
        prevChar = ")"
        break
      case "image": {
        flush()
        const children = convertChildren(n, gfm, true)
        out.push({
          type: "image",
          src: n.destination,
          alt: inlinePlainText(children),
          ...(n.title ? { title: n.title } : {}),
          children,
        })
        prevChar = ")"
        break
      }
      case "html_inline":
        flush()
        out.push({ type: "html_inline", raw: n.literal })
        prevChar = ">"
        break
      case "math":
        flush()
        out.push({ type: "math", source: n.literal, delimiter: n.delimiter, display: n.display })
        prevChar = "$"
        break
    }
  }
  flush()
  return out
}

function inlinePlainText(nodes: ReadonlyArray<InlineNode>): string {
  let out = ""
  for (const node of nodes) {
    switch (node.type) {
      case "text":
      case "code":
        out += node.text
        break
      case "strong":
      case "em":
      case "del":
      case "link":
        out += inlinePlainText(node.children)
        break
      case "image":
        out += node.children ? inlinePlainText(node.children) : node.alt
        break
      case "math":
        out += node.source
        break
      case "br":
        out += "\n"
        break
      case "html_inline":
        out += node.raw
        break
    }
  }
  return out
}

// GFM extended autolinks (www., http://, https://, ftp://, and bare emails), applied to merged text runs
// outside links, following cmark-gfm's autolink extension.

function isAlnum(c: number): boolean {
  return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)
}

function isAutolinkWhitespace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0b || c === 0x0c || c === 0x0d
}

function isValidPrecedingForWww(s: string, i: number, prevChar: string): boolean {
  if (i === 0 && !prevChar) return true
  const c = i === 0 ? prevChar.charCodeAt(0) : s.charCodeAt(i - 1)
  return (
    isAutolinkWhitespace(c) ||
    c === C_ASTERISK ||
    c === C_UNDERSCORE ||
    c === C_TILDE ||
    c === C_OPEN_PAREN ||
    c === C_OPEN_BRACKET ||
    c === C_CLOSE_BRACKET
  )
}

/** Length of a valid domain at `i`, or 0. Mirrors cmark-gfm `check_domain`. */
function checkDomain(s: string, i: number, allowShort: boolean): number {
  let np = 0
  let uscore1 = 0
  let uscore2 = 0
  let j = i
  for (; j < s.length; j++) {
    const c = s.charCodeAt(j)
    if (c === 0x5c /* \ */ && j + 1 < s.length) {
      // a backslash is never part of a domain
      break
    }
    if (c === C_UNDERSCORE) {
      uscore2++
    } else if (c === 0x2e /* . */) {
      uscore1 = uscore2
      uscore2 = 0
      np++
    } else if (!isAlnum(c) && c !== 0x2d /* - */ && c < 0x80) {
      break
    }
  }
  if ((uscore1 > 0 || uscore2 > 0) && np <= 10) return 0
  if (allowShort || np > 0) return j - i
  return 0
}

/** Trim trailing punctuation from a candidate link of length `len` starting at `start`. Mirrors cmark-gfm `autolink_delim`. */
function autolinkDelim(s: string, start: number, len: number): number {
  for (let k = 0; k < len; k++) {
    if (s.charCodeAt(start + k) === C_LESSTHAN) {
      len = k
      break
    }
  }
  while (len > 0) {
    const cclose = s.charCodeAt(start + len - 1)
    if (cclose === C_CLOSE_PAREN) {
      let opening = 0
      let closing = 0
      for (let k = 0; k < len; k++) {
        const c = s.charCodeAt(start + k)
        if (c === C_OPEN_PAREN) opening++
        else if (c === C_CLOSE_PAREN) closing++
      }
      if (closing <= opening) break
      len--
    } else if (
      cclose === 0x3f /* ? */ ||
      cclose === 0x21 /* ! */ ||
      cclose === 0x2e /* . */ ||
      cclose === 0x2c /* , */ ||
      cclose === 0x3a /* : */ ||
      cclose === C_ASTERISK ||
      cclose === C_UNDERSCORE ||
      cclose === C_TILDE ||
      cclose === 0x27 /* ' */ ||
      cclose === 0x22 /* " */
    ) {
      len--
    } else if (cclose === 0x3b /* ; */) {
      let newEnd = len - 2
      while (newEnd > 0 && isAlnum(s.charCodeAt(start + newEnd))) newEnd--
      if (newEnd < len - 2 && s.charCodeAt(start + newEnd) === C_AMPERSAND) len = newEnd
      else len--
    } else {
      break
    }
  }
  return len
}

function matchWww(s: string, i: number, prevChar: string): number {
  if (!isValidPrecedingForWww(s, i, prevChar)) return 0
  if (!s.startsWith("www.", i)) return 0
  const domainLen = checkDomain(s, i, false)
  if (domainLen === 0) return 0
  let end = i + domainLen
  while (end < s.length && !isAutolinkWhitespace(s.charCodeAt(end))) end++
  return autolinkDelim(s, i, end - i)
}

function matchUrl(s: string, i: number, prevChar: string): { len: number; schemeLen: number } | null {
  // `i` points at ':' of "://"
  if (!s.startsWith("://", i)) return null
  let start = i
  while (start > 0 && /[A-Za-z]/.test(s[start - 1]!)) start--
  if (start === 0 && prevChar && /[A-Za-z]/.test(prevChar)) return null
  const scheme = s.slice(start, i).toLowerCase()
  const matchedScheme =
    scheme === "https" || scheme === "http" || scheme === "ftp" ? scheme : ""
  if (!matchedScheme) return null
  const schemeStart = start
  const domainLen = checkDomain(s, i + 3, true)
  if (domainLen === 0) return null
  let end = i + 3 + domainLen
  while (end < s.length && !isAutolinkWhitespace(s.charCodeAt(end))) end++
  const len = autolinkDelim(s, schemeStart, end - schemeStart)
  if (len <= i + 3 - schemeStart) return null
  return { len, schemeLen: i - schemeStart }
}

function isEmailLocal(c: number): boolean {
  return isAlnum(c) || c === 0x2e || c === 0x2b || c === 0x2d || c === C_UNDERSCORE
}

function matchEmail(s: string, at: number, minStart: number, prevChar: string): { start: number; end: number } | null {
  let start = at
  while (start > minStart && isEmailLocal(s.charCodeAt(start - 1))) start--
  if (start === at) return null
  if (start > 0) {
    if (s.charCodeAt(start - 1) === 0x2f /* / */) return null
  } else if (prevChar) {
    const pc = prevChar.charCodeAt(0)
    if (pc === 0x2f /* / */ || isEmailLocal(pc)) return null
  }
  let np = 0
  let end = at + 1
  for (; end < s.length; end++) {
    const c = s.charCodeAt(end)
    if (isAlnum(c)) continue
    if (c === 0x40 /* @ */) return null
    if (c === 0x2e && end + 1 < s.length && isAlnum(s.charCodeAt(end + 1))) {
      np++
      continue
    }
    if (c !== 0x2d && c !== C_UNDERSCORE) break
  }
  if (end - at < 2 || np === 0) return null
  const last = s.charCodeAt(end - 1)
  if (!((last >= 0x41 && last <= 0x5a) || (last >= 0x61 && last <= 0x7a))) return null
  return { start, end }
}

const RE_AUTOLINK_CANDIDATE = /www\.|:\/\/|@/i

function autolinkLiterals(s: string, prevChar: string): InlineNode[] {
  if (!RE_AUTOLINK_CANDIDATE.test(s)) return [{ type: "text", text: s }]
  const out: InlineNode[] = []
  let textStart = 0
  let i = 0
  const emit = (start: number, end: number, href: string) => {
    if (start > textStart) out.push({ type: "text", text: s.slice(textStart, start) })
    const label = s.slice(start, end)
    out.push({ type: "link", href: normalizeURI(href), children: [{ type: "text", text: label }] })
    textStart = end
    i = end
  }
  while (i < s.length) {
    const c = s.charCodeAt(i)
    if ((c === 0x77 || c === 0x57) && s.startsWith("www.", i)) {
      const len = matchWww(s, i, prevChar)
      if (len > 0) {
        emit(i, i + len, "http://" + s.slice(i, i + len))
        continue
      }
    } else if (c === C_COLON) {
      const m = matchUrl(s, i, prevChar)
      if (m) {
        const start = i - m.schemeLen
        if (start >= textStart) {
          emit(start, start + m.len, s.slice(start, start + m.len))
          continue
        }
      }
    } else if (c === 0x40 /* @ */) {
      const m = matchEmail(s, i, textStart, prevChar)
      if (m) {
        emit(m.start, m.end, "mailto:" + s.slice(m.start, m.end))
        continue
      }
    }
    i++
  }
  if (textStart === 0) return [{ type: "text", text: s }]
  if (textStart < s.length) out.push({ type: "text", text: s.slice(textStart) })
  return out
}
