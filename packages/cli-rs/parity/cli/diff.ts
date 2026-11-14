// A readable report of how two P-CLI or P-PTY records differ: one block per differing field, with
// the lines of each side marked where they differ. An empty string means equal.

export function diffRecords(left: Record<string, unknown>, right: Record<string, unknown>, sides: readonly string[]) {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])]
  return keys
    .flatMap((key) => {
      const a = lines(left[key])
      const b = lines(right[key])
      if (a.join("\n") === b.join("\n")) return []
      const width = Math.max(a.length, b.length)
      const rows = Array.from({ length: width }, (_, index) => {
        const same = a[index] === b[index]
        return [
          `  ${same ? " " : "-"} ${sides[0]} | ${a[index] ?? "<none>"}`,
          ...(same ? [] : [`  + ${sides[1]} | ${b[index] ?? "<none>"}`]),
        ]
      })
      return [`${key}:`, ...rows.flat()]
    })
    .join("\n")
}

function lines(value: unknown) {
  if (value === undefined) return []
  if (typeof value === "string") return value.split("\n")
  return JSON.stringify(value, null, 2).split("\n")
}
