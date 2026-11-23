// Streaming tail healing: close inline markers that are still open at the end of the block being written,
// and hide markers that have nothing after them yet, so a half-written `**` never renders as `****` (a rule).

export interface TailHeal {
  /** Characters to remove from the end of the (right-trimmed) text */
  strip: number
  /** Text to append after stripping */
  append: string
}

const reInlineDollarMath =
  /\$\$(?!\$)((?:\\.|[^\\\n])*?(?:\\.|[^\\\n$]))\$\$|\$(?=[^\s$])((?:\\.|[^\\\n$])*?(?:\\\S|[^\s\\$]))\$(?!\w)/y
const reInlineParenMath = /\\\(((?:\\.|[^\\\n])*?)\\\)/y
const reLinkTail = /(!?)\[([^\]\n]*)\]\(([^)\n]*)$/

function isSpace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || Number.isNaN(c)
}

function isAlnum(c: number): boolean {
  return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)
}

function rtrimLength(text: string): number {
  let end = text.length
  while (end > 0 && isSpace(text.charCodeAt(end - 1))) end--
  return end
}

function compose(a: TailHeal, b: TailHeal): TailHeal {
  if (b.strip <= a.append.length) {
    return { strip: a.strip, append: a.append.slice(0, a.append.length - b.strip) + b.append }
  }
  return { strip: a.strip + (b.strip - a.append.length), append: b.append }
}

interface Open {
  ch: number
  len: number
  /** index just after the opening run */
  after: number
  start: number
}

/**
 * Compute the edit that heals the end of `text` (an inline run: a paragraph, heading, or table row).
 * Offsets are relative to `text` with trailing whitespace removed.
 */
export function computeTailHeal(input: string): TailHeal {
  const end = rtrimLength(input)
  let text = input.slice(0, end)
  if (!text) return { strip: 0, append: "" }

  let heal: TailHeal = { strip: 0, append: "" }

  // 1. An unfinished inline link or image at the very end: `[label](https://…` shows just the label.
  const lastOpen = text.lastIndexOf("[")
  if (lastOpen >= 0 && (lastOpen === 0 || text[lastOpen - 1] !== "\\")) {
    const m = reLinkTail.exec(text.slice(lastOpen > 0 && text[lastOpen - 1] === "!" ? lastOpen - 1 : lastOpen))
    if (m) {
      const matchLen = m[0].length
      const replacement = m[1] ? "" : m[2]!
      heal = { strip: matchLen, append: replacement }
      text = text.slice(0, text.length - matchLen) + replacement
    }
  }

  // 2. Scan code spans, math, and emphasis delimiters.
  const n = text.length
  let codeOpen: { len: number; start: number } | null = null
  let wordHadEm = false
  const stack: Open[] = []
  let stars = 0
  let underscores = 0
  let tildes = 0
  const push = (open: Open) => {
    if (open.ch === 0x2a) stars++
    else if (open.ch === 0x5f) underscores++
    else tildes++
    stack.push(open)
  }
  const pop = () => {
    const open = stack.pop()!
    if (open.ch === 0x2a) stars--
    else if (open.ch === 0x5f) underscores--
    else tildes--
  }
  const hasOpen = (ch: number) => (ch === 0x2a ? stars : ch === 0x5f ? underscores : tildes) > 0
  let i = 0
  while (i < n) {
    const c = text.charCodeAt(i)
    if (codeOpen) {
      if (c === 0x60) {
        let run = 1
        while (i + run < n && text.charCodeAt(i + run) === 0x60) run++
        if (run === codeOpen.len) codeOpen = null
        i += run
      } else {
        i++
      }
      continue
    }
    if (isSpace(c)) {
      wordHadEm = false
      i++
      continue
    }
    if (c === 0x5c /* \ */) {
      reInlineParenMath.lastIndex = i
      const pm = reInlineParenMath.exec(text)
      if (pm) {
        i += pm[0].length
        continue
      }
      i += 2
      continue
    }
    if (c === 0x60 /* ` */) {
      let run = 1
      while (i + run < n && text.charCodeAt(i + run) === 0x60) run++
      codeOpen = { len: run, start: i }
      i += run
      continue
    }
    if (c === 0x24 /* $ */) {
      reInlineDollarMath.lastIndex = i
      const mm = reInlineDollarMath.exec(text)
      if (mm) {
        i += mm[0].length
        continue
      }
      i++
      continue
    }
    if (c === 0x2a /* * */ || c === 0x5f /* _ */ || c === 0x7e /* ~ */) {
      let run = 1
      while (i + run < n && text.charCodeAt(i + run) === c) run++
      const prev = i > 0 ? text.charCodeAt(i - 1) : NaN
      const next = i + run < n ? text.charCodeAt(i + run) : NaN
      const isUnderscore = c === 0x5f
      const isSingleStar = c === 0x2a && run === 1
      const canOpen =
        !isSpace(next) &&
        !(isUnderscore && isAlnum(prev)) &&
        !(isSingleStar && isAlnum(prev) && !wordHadEm)
      const canClose = !isSpace(prev) && !(isUnderscore && isAlnum(next))
      if (c === 0x2a && (run >= 2 || canOpen)) wordHadEm = true
      if (c === 0x7e && run > 2) {
        i += run
        continue
      }
      let remaining = run
      if (canClose) {
        while (remaining > 0 && stack.length > 0) {
          if (stack[stack.length - 1]!.ch !== c) {
            if (!hasOpen(c)) break
            while (stack[stack.length - 1]!.ch !== c) pop()
          }
          const top = stack[stack.length - 1]!
          if (top.len <= remaining) {
            remaining -= top.len
            pop()
          } else {
            top.len -= remaining
            remaining = 0
          }
        }
      }
      if (remaining > 0 && canOpen) {
        if (c === 0x7e) {
          push({ ch: c, len: remaining, after: i + run, start: i + (run - remaining) })
        } else if (remaining >= 3) {
          push({ ch: c, len: 2, after: i + run, start: i + (run - remaining) })
          push({ ch: c, len: 1, after: i + run, start: i + (run - remaining) + 2 })
        } else {
          push({ ch: c, len: remaining, after: i + run, start: i + (run - remaining) })
        }
      }
      i += run
      continue
    }
    i++
  }

  let strip = 0
  let append = ""
  let codeClosed = false
  let nonSpaceEnd = rtrimLength(text)

  if (codeOpen) {
    if (codeOpen.start + codeOpen.len >= nonSpaceEnd) {
      strip = n - codeOpen.start
    } else {
      append += "`".repeat(codeOpen.len)
      codeClosed = true
    }
  }

  // Close (innermost first) markers that have content after them; drop trailing markers that have none.
  let limit = n - strip
  if (nonSpaceEnd > limit) {
    nonSpaceEnd = limit
    while (nonSpaceEnd > 0 && isSpace(text.charCodeAt(nonSpaceEnd - 1))) nonSpaceEnd--
  }
  for (let s = stack.length - 1; s >= 0; s--) {
    const open = stack[s]!
    if (open.start >= limit) continue
    if (open.after >= nonSpaceEnd) {
      if (append === "") {
        // dangling opener at the end: hide it (and the whitespace before it)
        let cut = open.start
        while (cut > 0 && (text.charCodeAt(cut - 1) === 0x20 || text.charCodeAt(cut - 1) === 0x09)) cut--
        strip = n - cut
        limit = cut
        if (nonSpaceEnd > limit) {
          nonSpaceEnd = limit
          while (nonSpaceEnd > 0 && isSpace(text.charCodeAt(nonSpaceEnd - 1))) nonSpaceEnd--
        }
      }
      continue
    }
    append += String.fromCharCode(open.ch).repeat(open.len)
  }

  // Closers must hug the text: drop trailing spaces before appending
  if (append && !codeClosed) {
    let cut = n - strip
    while (cut > 0 && isSpace(text.charCodeAt(cut - 1))) cut--
    strip = n - cut
  }

  return compose(heal, { strip, append })
}

export function applyTailHeal(text: string, heal: TailHeal): string {
  if (heal.strip === 0 && heal.append === "") return text
  const end = rtrimLength(text)
  return text.slice(0, Math.max(0, end - heal.strip)) + heal.append
}

/**
 * Repairs incomplete inline markers at the tail of an actively streaming block without touching closed spans.
 * `**bold` → `**bold**`, `` `code `` → `` `code` ``, `[label](https://…` → `label`, and a trailing `**` with
 * nothing after it yet is hidden rather than doubled.
 */
export function healStreamingInline(raw: string): string {
  if (!raw) return raw
  const heal = computeTailHeal(raw)
  if (heal.strip === 0 && heal.append === "") return raw
  return applyTailHeal(raw, heal)
}
