const modeReportPattern = /^\x1b\[[\?0-9;]*\$y$/
const daReplyPattern = /^\x1b\[(?:\?|>)[0-9;]+c$/
const dcsReportPattern = /^\x1bP[01][+$]r[\s\S]*(?:\x1b\\|\x07)$/

/**
 * Drop synthetic terminal reply frames xterm can emit on onData()
 * (focus reports, mode reports, DA replies, DECRQSS/XTGETTCAP replies).
 *
 * Important: CPR replies (CSI ... R) are intentionally NOT filtered because
 * tools like Codex depend on them to read cursor position.
 */
export function stripTerminalRepliesFromInput(chunk: string): string {
  if (!chunk.includes("\x1b")) return chunk

  let out = ""
  let i = 0

  while (i < chunk.length) {
    const ch = chunk[i]
    if (ch !== "\x1b") {
      out += ch
      i += 1
      continue
    }

    if (i + 1 >= chunk.length) {
      // Keep trailing ESC; do not buffer/carry across user input events.
      out += ch
      break
    }

    const next = chunk[i + 1]
    if (next === "P") {
      // DCS sequence: ESC P ... ST (ESC \\) or BEL
      let j = i + 2
      let term = -1
      while (j < chunk.length) {
        const code = chunk.charCodeAt(j)
        if (code === 0x07) {
          term = j
          break
        }
        if (code === 0x1b && j + 1 < chunk.length && chunk.charCodeAt(j + 1) === 0x5c) {
          term = j + 1
          break
        }
        j += 1
      }

      if (term === -1) {
        // Keep incomplete DCS as-is.
        out += chunk.slice(i)
        break
      }

      const seq = chunk.slice(i, term + 1)
      if (!dcsReportPattern.test(seq)) out += seq
      i = term + 1
      continue
    }

    if (next !== "[") {
      // Not a CSI/DCS sequence we manage; keep raw ESC.
      out += ch
      i += 1
      continue
    }

    let j = i + 2
    while (j < chunk.length) {
      const code = chunk.charCodeAt(j)
      if (code >= 0x40 && code <= 0x7e) break
      j += 1
    }

    if (j >= chunk.length) {
      // Keep incomplete CSI as-is.
      out += chunk.slice(i)
      break
    }

    const seq = chunk.slice(i, j + 1)
    const suppress =
      seq === "\x1b[I" ||
      seq === "\x1b[O" ||
      modeReportPattern.test(seq) ||
      daReplyPattern.test(seq)
    if (!suppress) out += seq
    i = j + 1
  }

  return out
}
