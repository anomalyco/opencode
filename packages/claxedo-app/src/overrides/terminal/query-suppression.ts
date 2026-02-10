export function createQuerySuppressor(input?: { maxTail?: number }) {
  const maxTail = input?.maxTail ?? 64
  let carry = ""
  const cprPattern = /^\x1b\[[0-9]{1,4}(?:;[0-9]{1,4})?R$/
  const modeReportPattern = /^\x1b\[[\?0-9;]*\$y$/

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
          cprPattern.test(seq) || modeReportPattern.test(seq) || seq === "\x1b[I" || seq === "\x1b[O"
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
