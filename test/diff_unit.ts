// Standalone test for colorizeDiff. Copy of the function so we don't have to
// export it from render.ts.

const TEXT_DIM = "\x1b[90m"
const TEXT_NORMAL = "\x1b[0m"

function colorizeDiff(diff: string, width: number): string {
  const REMOVED_BG = "\x1b[48;5;52m"
  const ADDED_BG = "\x1b[48;5;22m"
  const RESET = "\x1b[0m"
  const GUTTER = 4

  const gutter = (n: number) => String(n).padStart(GUTTER, " ")
  const pad = (s: string) => s + " ".repeat(Math.max(0, width - Bun.stringWidth(s)))

  let oldLine = 0
  let newLine = 0

  return diff
    .split("\n")
    .filter((line) => {
      if (line.startsWith("Index:")) return false
      if (line.startsWith("===")) return false
      if (line.startsWith("---") || line.startsWith("+++")) return false
      return true
    })
    .map((line) => {
      if (line.startsWith("@@")) {
        const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
        if (m) {
          oldLine = parseInt(m[1], 10)
          newLine = parseInt(m[2], 10)
        }
        return TEXT_DIM + line + TEXT_NORMAL
      }
      if (line.startsWith("-")) {
        const out = pad(gutter(oldLine) + " " + line)
        oldLine++
        return REMOVED_BG + out + RESET
      }
      if (line.startsWith("+")) {
        const out = pad(gutter(newLine) + " " + line)
        newLine++
        return ADDED_BG + out + RESET
      }
      const out = TEXT_DIM + gutter(newLine) + TEXT_NORMAL + " " + line
      oldLine++
      newLine++
      return out
    })
    .join("\n")
}

function section(title: string) {
  console.log("\n" + "═".repeat(80))
  console.log(title)
  console.log("═".repeat(80))
}

// 1. simple single hunk
section("1. simple single-line change")
console.log(
  colorizeDiff(
    `Index: foo
===================================================================
--- foo
+++ foo
@@ -1,3 +1,3 @@
 line one
-line two
+line TWO
 line three
`,
    80,
  ),
)

// 2. multi-hunk
section("2. multi-hunk diff")
console.log(
  colorizeDiff(
    `@@ -1,3 +1,3 @@
 line one
-line two
+line TWO
 line three
@@ -10,3 +10,4 @@
 line ten
+inserted
 line eleven
 line twelve
`,
    80,
  ),
)

// 3. long line that exceeds width — should truncate padding to 0, no overflow
section("3. long line exceeding terminal width (40 cols)")
console.log(
  colorizeDiff(
    `@@ -1,2 +1,2 @@
-this is a very long line of text that exceeds 40 chars easily
+this is the replacement long line that is also pretty long
`,
    40,
  ),
)

// 4. tab characters
section("4. tab characters (note: tabs render as variable width)")
console.log(
  colorizeDiff(
    `@@ -1,3 +1,3 @@
 \tindented one
-\tindented two
+\tINDENTED two
`,
    80,
  ),
)

// 5. unicode (CJK + emoji)
section("5. unicode characters")
console.log(
  colorizeDiff(
    `@@ -1,3 +1,3 @@
 plain ascii
-中文测试 line removed 🔥
+中文测试 line added ✨
`,
    80,
  ),
)

// 6. only additions
section("6. only additions")
console.log(
  colorizeDiff(
    `@@ -1,2 +1,4 @@
 first
+added a
+added b
 second
`,
    80,
  ),
)

// 7. only deletions
section("7. only deletions")
console.log(
  colorizeDiff(
    `@@ -1,4 +1,2 @@
 first
-removed a
-removed b
 second
`,
    80,
  ),
)

// 8. narrow terminal (20 cols) with short lines
section("8. narrow terminal (20 cols)")
console.log(
  colorizeDiff(
    `@@ -1,2 +1,2 @@
-foo
+bar
`,
    20,
  ),
)

// 9. hunk starting at non-1 line numbers
section("9. hunk at line 100+")
console.log(
  colorizeDiff(
    `@@ -100,3 +100,3 @@
 ctx
-removed
+added
 ctx2
`,
    80,
  ),
)

// 10. empty diff
section("10. empty diff string")
console.log(JSON.stringify(colorizeDiff("", 80)))

// 11. large line numbers (4-digit gutter check)
section("11. 4-digit line numbers (gutter still aligned)")
console.log(
  colorizeDiff(
    `@@ -9998,3 +9998,3 @@
 ctx
-removed
+added
`,
    80,
  ),
)

// 12. very large line numbers (>4 digits — should overflow gutter gracefully)
section("12. 5-digit line numbers (gutter overflows)")
console.log(
  colorizeDiff(
    `@@ -99998,3 +99998,3 @@
 ctx
-removed
+added
`,
    80,
  ),
)
