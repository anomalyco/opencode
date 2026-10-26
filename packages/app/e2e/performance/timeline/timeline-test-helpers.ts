export function createReviewDiffs() {
  return Array.from({ length: Number(process.env.REVIEW_PANE_DIFF_COUNT ?? 72) }, (_, index) => {
    const lines = index % 3 === 0 ? 300 : index % 3 === 1 ? 120 : 38
    const file = `src/review/generated-${String(index).padStart(3, "0")}.ts`
    const before = reviewSource(index, lines)

    const after = before
      .replace(`value_${index}_4`, `updated_${index}_4`)
      .replace(
        `value_${index}_${Math.max(8, Math.floor(lines / 2))}`,
        `updated_${index}_${Math.max(8, Math.floor(lines / 2))}`,
      )
      .replace(`value_${index}_${lines - 4}`, `updated_${index}_${lines - 4}`)

    return {
      file,
      patch: reviewPatch(file, before, after),
      additions: 3,
      deletions: 3,
      status: "modified" as const,
    }
  })
}

function reviewSource(seed: number, lines: number) {
  return Array.from(
    { length: lines },
    (_, index) => `export const value_${seed}_${index} = "${reviewWords(seed + index, index % 5 === 0 ? 180 : 42)}"`,
  ).join("\n")
}

function reviewPatch(file: string, before: string, after: string) {
  const beforeLines = before.split("\n")
  const afterLines = after.split("\n")

  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...beforeLines.flatMap((line, index) => {
      const next = afterLines[index]!

      if (line === next) return [` ${line}`]

      return [`-${line}`, `+${next}`]
    }),
  ].join("\n")
}

function reviewWords(seed: number, length: number) {
  const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet"]

  return Array.from({ length: Math.ceil(length / 7) }, (_, index) => words[(seed + index * 3) % words.length]).join(" ")
}
