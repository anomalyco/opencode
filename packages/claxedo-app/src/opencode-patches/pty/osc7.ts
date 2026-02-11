/**
 * OSC-7 CWD tracking parser.
 *
 * Parses terminal escape sequences of the form:
 *   ESC ] 7 ; file://hostname/path BEL
 *   ESC ] 7 ; file://hostname/path ESC \
 *
 * Returns the last CWD found and a partial buffer for split-chunk reassembly.
 */
export function osc7(buf: string, chunk: string) {
  const esc = "\x1b"
  const bel = "\x07"
  const prefix = `${esc}]7;file://`
  const max = 1024

  const data = buf + chunk

  let pos = 0
  let cwd: string | undefined
  for (;;) {
    const start = data.indexOf(prefix, pos)
    if (start === -1) break

    const from = start + prefix.length
    const belEnd = data.indexOf(bel, from)
    const st = `${esc}\\`
    const stEnd = data.indexOf(st, from)

    const end = (() => {
      if (belEnd === -1) return stEnd
      if (stEnd === -1) return belEnd
      return Math.min(belEnd, stEnd)
    })()

    if (end === -1) {
      const tail = data.slice(start)
      return {
        cwd,
        buf: tail.length <= max ? tail : "",
      }
    }

    const body = data.slice(from, end)
    const slash = body.indexOf("/")
    if (slash !== -1) {
      const raw = body.slice(slash)
      cwd = (() => {
        if (!raw.includes("%")) return raw
        try {
          return decodeURIComponent(raw)
        } catch {
          return raw
        }
      })()
    }

    pos = end + (end === stEnd ? st.length : 1)
  }

  const last = data.lastIndexOf(esc)
  if (last === -1) return { cwd, buf: "" }

  const tail = data.slice(last)
  if (!prefix.startsWith(tail)) return { cwd, buf: "" }
  return { cwd, buf: tail.length <= max ? tail : "" }
}
