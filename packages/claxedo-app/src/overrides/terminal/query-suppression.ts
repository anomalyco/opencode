export function createQuerySuppressor(input?: { maxTail?: number }) {
  const maxTail = input?.maxTail ?? 64
  let carry = ""
  const cprPattern = /^\x1b\[\??[0-9]{1,4}(?:;[0-9]{1,4}){1,2}R$/
  const modeReportPattern = /^\x1b\[[\?0-9;]*\$y$/
  const daReplyPattern = /^\x1b\[(?:\?|>)[0-9;]+c$/
  const dcsReportPattern = /^\x1bP[01][+$]r[\s\S]*(?:\x1b\\|\x07)$/

  return {
    scan(chunk: string) {
      const data = carry + chunk
      let out = ""
      let i = 0
      carry = ""

      while (i < data.length) {
        const ch = data[i]
        if (ch !== "\u001b") {
          out += ch
          i += 1
          continue
        }

        if (i + 1 >= data.length) {
          carry = data.slice(i)
          break
        }

        const next = data[i + 1]
        if (next !== "[") {
          if (next === "P") {
            // DCS sequence: ESC P ... ST (ESC \) or BEL.
            // Query replies (DECRQSS/XTGETTCAP) can leak visually as trailing
            // digits like "1" after split/remount if not filtered.
            let j = i + 2
            let term = -1
            while (j < data.length) {
              const code = data.charCodeAt(j)
              if (code === 0x07) {
                term = j
                break
              }
              if (code === 0x1b && j + 1 < data.length && data.charCodeAt(j + 1) === 0x5c) {
                term = j + 1
                break
              }
              j += 1
            }
            if (term === -1) {
              carry = data.slice(i)
              break
            }
            const seq = data.slice(i, term + 1)
            if (!dcsReportPattern.test(seq)) out += seq
            i = term + 1
            continue
          }
          out += ch
          i += 1
          continue
        }

        let j = i + 2
        while (j < data.length) {
          const code = data.charCodeAt(j)
          if (code >= 0x40 && code <= 0x7e) break
          j += 1
        }

        if (j >= data.length) {
          carry = data.slice(i)
          break
        }

        const seq = data.slice(i, j + 1)
        const suppress =
          cprPattern.test(seq) ||
          modeReportPattern.test(seq) ||
          daReplyPattern.test(seq) ||
          seq === "\x1b[I" ||
          seq === "\x1b[O"
        if (!suppress) out += seq
        i = j + 1
      }

      if (carry.length > maxTail) carry = ""
      return out
    },
    tail() {
      return carry
    },
  }
}
