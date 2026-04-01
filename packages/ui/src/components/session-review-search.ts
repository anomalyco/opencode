export type SessionSearchHit = {
  file: string
  side: "additions" | "deletions"
  line: number
  col: number
  len: number
}

type SessionSearchFile = {
  file: string
  before?: string
  after?: string
}

function hitsForSide(args: { file: string; side: SessionSearchHit["side"]; text: string; needle: string }) {
  return args.text.split("\n").flatMap((line, i) => {
    if (!line) return []

    const hay = line.toLowerCase()
    let at = hay.indexOf(args.needle)
    if (at < 0) return []

    const out: SessionSearchHit[] = []
    while (at >= 0) {
      out.push({
        file: args.file,
        side: args.side,
        line: i + 1,
        col: at + 1,
        len: args.needle.length,
      })
      at = hay.indexOf(args.needle, at + args.needle.length)
    }

    return out
  })
}

export function buildSessionSearchHits(args: { query: string; files: SessionSearchFile[] }) {
  const value = args.query.trim().toLowerCase()
  if (!value) return []

  return args.files.flatMap((file) => {
    const out: SessionSearchHit[] = []
    if (typeof file.before === "string") {
      out.push(...hitsForSide({ file: file.file, side: "deletions", text: file.before, needle: value }))
    }
    if (typeof file.after === "string") {
      out.push(...hitsForSide({ file: file.file, side: "additions", text: file.after, needle: value }))
    }
    return out
  })
}

export function stepSessionSearchIndex(total: number, current: number, dir: 1 | -1) {
  if (total <= 0) return 0
  if (current < 0 || current >= total) return dir > 0 ? 0 : total - 1
  return (current + dir + total) % total
}
