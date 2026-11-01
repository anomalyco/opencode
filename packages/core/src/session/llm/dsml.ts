export const DSML_GUARD_MESSAGE =
  "Model emitted raw DSML closing markup in assistant text. This markup was not dispatched as a tool. Inspect the model/gateway tool parser and any enabled raw stream capture before resuming."

export const EMPTY_VETTING_LOOP_MESSAGE =
  "Model output loop: 16 consecutive empty vetting blocks. Generation stopped; pending tool calls were not dispatched. Earlier calls may already have run."

// Operational limit, not a protocol grammar: constant-size state across deltas.
export function emptyVettingLoopDetector() {
  let phase: "idle" | "open" | "body" | "close" | "nonempty" = "idle"
  let index = 0,
    streak = 0,
    depth = 0
  let tail = "",
    line = "",
    quote = "",
    ticks = 0,
    pendingTicks = 0
  let fence: { character: string; length: number } | undefined
  let fenceLine = 0,
    fenceSpaces = 0,
    fenceLength = 0
  let fenceCharacter = "",
    fenceWhitespace = true
  let ambiguous = false
  const open = "<vetting>",
    close = "</vetting>"
  const nonempty = (value: string) => {
    phase = "nonempty"
    depth = 1
    tail = value.slice(-10)
    streak = 0
  }
  const skipBody = (character: string) => {
    tail = (tail + character).slice(-10)
    if (tail.endsWith(open)) depth++
    if (tail.endsWith(close) && --depth === 0) {
      phase = "idle"
      tail = ""
    }
  }
  return {
    feed(value: string): number {
      for (let at = 0; at < value.length; at++) {
        const character = value[at]
        if (character !== "`" && pendingTicks) {
          if (!ticks) ticks = pendingTicks
          else if (ticks === pendingTicks) ticks = 0
          pendingTicks = 0
        }
        const protectedText = Boolean(
          fence || quote || ticks || pendingTicks || ambiguous || /^(?: {4}|\t|\s*>)/.test(line),
        )
        if (phase === "nonempty") skipBody(character)
        else if (phase === "idle") {
          if (protectedText) streak = 0
          else if (character === "<") {
            phase = "open"
            index = 1
          } else if (!/\s/.test(character)) streak = 0
        } else if (phase === "open") {
          if (character === open[index]) {
            if (++index === open.length) phase = "body"
          } else {
            phase = "idle"
            streak = 0
            if (character === "<" && !protectedText) {
              phase = "open"
              index = 1
            }
          }
        } else if (phase === "body") {
          if (character === "<") {
            phase = "close"
            index = 1
          } else if (!/\s/.test(character)) nonempty(character)
        } else if (phase === "close") {
          if (character === close[index]) {
            if (++index === close.length) {
              phase = "idle"
              if (++streak === 16) return at + 1
            }
          } else nonempty(close.slice(0, index) + character)
        }
        if (!fence && !quote && character === "`") pendingTicks++
        else if (!fence && !ticks && !pendingTicks && (character === "'" || character === '"')) {
          if (quote === character && !/\\(?:\\\\)*$/.test(line)) quote = ""
          else if (!quote && (character === '"' || !/[\p{L}\p{N}_]$/u.test(line))) quote = character
        }
        if (character === "\n") {
          if ((fenceLine === 1 || fenceLine === 2) && fenceLength >= 3) {
            if (!fence) {
              fence = { character: fenceCharacter, length: fenceLength }
              ticks = 0
            } else if (fenceCharacter === fence.character && fenceLength >= fence.length && fenceWhitespace)
              fence = undefined
          }
          fenceLine = 0
          fenceSpaces = 0
          fenceLength = 0
          fenceCharacter = ""
          fenceWhitespace = true
          line = ""
          ambiguous = false
          quote = ""
          ticks = 0
          pendingTicks = 0
        } else {
          if (fenceLine === 0) {
            if (character === " ") {
              if (++fenceSpaces > 3) fenceLine = 3
            } else if (character === "`" || character === "~") {
              fenceLine = 1
              fenceCharacter = character
              fenceLength = 1
            } else fenceLine = 3
          } else if (fenceLine === 1) {
            if (character === fenceCharacter) fenceLength++
            else {
              fenceLine = 2
              fenceWhitespace = /\s/.test(character)
            }
          } else if (fenceLine === 2 && !/\s/.test(character)) fenceWhitespace = false
          line += character
          if (line.length > 4096) {
            line = line.slice(-4096)
            ambiguous = true
          }
        }
      }
      return -1
    },
  }
}

// Mask quoted examples without changing offsets into the durable text.
function proseText(text: string, protectQuotes = false) {
  let fence: { character: string; length: number } | undefined
  return text
    .split("\n")
    .map((line) => {
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)
      if (marker) {
        if (!fence) fence = { character: marker[1][0], length: marker[1].length }
        else if (
          marker[1][0] === fence.character &&
          marker[1].length >= fence.length &&
          /^\s*$/.test(line.slice(marker[0].length))
        )
          fence = undefined
        return " ".repeat(line.length)
      }
      if (fence || /^\s*>/.test(line) || /^(?: {4}|\t)/.test(line)) return " ".repeat(line.length)
      let quote = "",
        ticks = 0
      const parts: string[] = []
      for (let at = 0; at < line.length; at++) {
        const character = line[at]
        if (!quote && character === "`") {
          const start = at
          while (line[at + 1] === "`") at++
          const length = at - start + 1
          if (!ticks) ticks = length
          else if (ticks === length) ticks = 0
          parts.push(" ".repeat(length))
          continue
        }
        if (protectQuotes && !ticks && (character === "'" || character === '"')) {
          let escapes = 0
          for (let before = at - 1; before >= 0 && line[before] === "\\"; before--) escapes++
          const escaped = escapes % 2 !== 0
          if (quote === character && !escaped) {
            quote = ""
            parts.push(" ")
            continue
          }
          if (!quote && !escaped && (character === '"' || !/[\p{L}\p{N}_]$/u.test(line.slice(Math.max(0, at - 2), at))))
            quote = character
        }
        parts.push(quote || ticks ? " " : character)
      }
      return parts.join("")
    })
    .join("\n")
}

function invocationRanges(text: string) {
  const prose = proseText(text)
  const markers = [...prose.matchAll(/^ {0,3}<(?:｜DSML｜)?(tool_calls>|invoke\b|parameter\s+name=["']([^"']+)["'])/gm)]
  const ranges: { start: number; end: number }[] = []
  let note: number | undefined
  for (const marker of markers) {
    if (marker.index < (ranges.at(-1)?.end ?? 0)) continue
    // Plain XML parameters alone are prose; mixed syntax is an attempted tool
    // only when it still carries DeepSeek invocation-closing evidence.
    if (
      !marker[0].includes("｜DSML｜") &&
      prose.indexOf("</｜DSML｜invoke>", marker.index) === -1 &&
      prose.indexOf("</｜DSML｜tool_calls>", marker.index) === -1
    )
      continue
    if (marker[2] === "note") {
      note = marker.index
      continue
    }
    if (marker[2] && marker[2] !== "command" && prose.indexOf("</｜DSML｜invoke>", marker.index) === -1) continue
    const closing =
      marker[1] === "tool_calls>"
        ? "</｜DSML｜tool_calls>"
        : marker[1].startsWith("invoke")
          ? "</｜DSML｜invoke>"
          : "</｜DSML｜parameter>"
    const position = prose.indexOf(closing, marker.index)
    const end = position === -1 ? prose.length : position + closing.length
    const suffix = /^(?:\s*<\/｜DSML｜(?:invoke|tool_calls)>)+/.exec(prose.slice(end))
    const noteEnd =
      note === undefined ? -1 : prose.indexOf("</｜DSML｜parameter>", note) + "</｜DSML｜parameter>".length
    let start =
      note !== undefined && noteEnd <= marker.index && /^\s*$/.test(prose.slice(noteEnd, marker.index))
        ? note
        : marker.index
    const wrapper = /^ {0,3}<vetting>[ \t]*\r?\n(?:[ \t]*\r?\n)*[ \t]*$/m.exec(prose.slice(0, start))
    if (wrapper) start = wrapper.index
    ranges.push({ start, end: end + (suffix?.[0].length ?? 0) })
    note = undefined
  }
  // Lost opening tokens can leave only closing invocation markers behind.
  for (const closing of prose.matchAll(/^ {0,3}<\/｜DSML｜(?:invoke|tool_calls)>/gm)) {
    if (ranges.some((range) => closing.index >= range.start && closing.index < range.end)) continue
    ranges.push({ start: closing.index, end: closing.index + closing[0].length })
  }
  return ranges.sort((a, b) => a.start - b.start)
}

export function attemptedDSMLInvocation(text: string) {
  return invocationRanges(text).length > 0
}

export function withoutAttemptedDSMLInvocation(text: string) {
  // Orphan advisory notes are malformed protocol exemplars too, but they are
  // not executable invocations. Only sanitize closed, unquoted DSML ranges.
  const prose = proseText(text)
  const ranges = invocationRanges(text)
  // Only complete, unnested literal-empty blocks qualify. An unmatched tag
  // makes the vetting structure ambiguous, so keep its exemplars intact.
  const empty: { start: number; end: number }[] = []
  let depth = 0,
    start = 0,
    nested = false,
    unmatched = false
  for (const marker of proseText(text, true).matchAll(/<\/?vetting>/g)) {
    if (text.slice(marker.index, marker.index + marker[0].length) !== marker[0]) continue
    if (marker[0] === "<vetting>") {
      if (depth++ === 0) {
        start = marker.index
        nested = false
      } else nested = true
      continue
    }
    if (depth === 0) {
      unmatched = true
      continue
    }
    if (--depth !== 0 || nested) continue
    const end = marker.index + marker[0].length
    if (/^\s*$/.test(text.slice(start + "<vetting>".length, marker.index))) empty.push({ start, end })
  }
  const vettingCleanup = !depth && !unmatched && empty.length > 0
  if (vettingCleanup) ranges.push(...empty)
  for (const note of prose.matchAll(
    /^ {0,3}<｜DSML｜parameter\s+name=["']note["'][^>]*>(?:(?!<(?:｜DSML｜)?(?:parameter|invoke|tool_calls)\b)[\s\S])*?<\/｜DSML｜parameter>/gm,
  )) {
    if (text.slice(note.index, note.index + note[0].length) !== note[0]) continue
    if (ranges.some((range) => note.index >= range.start && note.index < range.end)) continue
    ranges.push({ start: note.index, end: note.index + note[0].length })
  }
  ranges.sort((a, b) => a.start - b.start)
  if (ranges.length === 0) return text
  let offset = 0
  const parts = ranges.map((range) => {
    const part = text.slice(offset, Math.max(offset, range.start))
    offset = Math.max(offset, range.end)
    return part
  })
  const cleaned = [...parts, text.slice(offset)].join("")
  // Empty-vetting removal preserves the surrounding literal bytes, including
  // trailing whitespace. Keep legacy protocol-only suffix cleanup unchanged.
  return vettingCleanup ? cleaned : cleaned.trimEnd()
}
