export interface PatchHunk {
  readonly patch: string
  readonly header?: string
  readonly rows?: number
}

export function splitPatchHunks(patch: string): PatchHunk[] {
  const starts = [
    ...patch.matchAll(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@.*$/gm),
  ].map((match) => match.index)
  if (starts.length <= 1) return [{ patch }]

  const prefix = patch.slice(0, starts[0])
  return starts.map((start, index) => {
    const end = starts[index + 1] ?? patch.length
    const lineEnd = patch.indexOf("\n", start)
    return {
      header: patch.slice(start, lineEnd === -1 ? end : lineEnd),
      patch: prefix + patch.slice(start, end),
      rows: splitRows(patch.slice(start, end)),
    }
  })
}

function splitRows(hunk: string) {
  const lines = hunk.replace(/\n$/, "").split("\n").slice(1)
  let rows = 0
  let index = 0

  while (index < lines.length) {
    const prefix = lines[index][0]
    if (prefix === " " || !prefix) {
      rows++
      index++
      continue
    }
    if (prefix === "\\") {
      index++
      continue
    }

    let additions = 0
    let deletions = 0
    while (
      index < lines.length &&
      (lines[index][0] === "+" || lines[index][0] === "-")
    ) {
      if (lines[index][0] === "+") additions++
      if (lines[index][0] === "-") deletions++
      index++
    }
    rows += Math.max(additions, deletions)
  }

  return rows
}
