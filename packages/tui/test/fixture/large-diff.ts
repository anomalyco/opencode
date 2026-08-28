export function largeDiffFixture(kind: "hunks" | "lines" | "long", count: number) {
  const file = {
    file: "snapshot.json",
    additions: kind === "long" ? 1 : count,
    deletions: kind === "long" ? 1 : count,
    status: "modified" as const,
  }
  const prefix = "--- a/snapshot.json\n+++ b/snapshot.json\n"
  if (kind === "long") {
    return {
      ...file,
      patch: `${prefix}@@ -1 +1 @@\n-${"x".repeat(count)}_OLD_END\n+${"y".repeat(count)}_NEW_END\n`,
      tail: "_NEW_END",
    }
  }
  if (kind === "lines") {
    return {
      ...file,
      patch:
        prefix +
        `@@ -1,${count} +1,${count} @@\n` +
        Array.from({ length: count }, (_, index) => `-  "column_${index}": ${index},\n`).join("") +
        Array.from({ length: count }, (_, index) => `+  "column_${index}": ${index + 1},\n`).join(""),
      tail: `"column_${count - 1}"`,
    }
  }
  return {
    ...file,
    patch:
      prefix +
      Array.from({ length: count }, (_, index) => {
        const start = index * 40 + 1
        return (
          `@@ -${start},25 +${start},25 @@\n` +
          Array.from({ length: 12 }, (_, offset) => `   "column_${start + offset}": ${start + offset},\n`).join("") +
          `-  "column_${start + 12}": ${start + 12},\n+  "column_${start + 12}": ${start + 13},\n` +
          Array.from(
            { length: 12 },
            (_, offset) => `   "column_${start + 13 + offset}": ${start + 13 + offset},\n`,
          ).join("")
        )
      }).join(""),
    tail: `"column_${(count - 1) * 40 + 25}"`,
  }
}
