import { type Component, createMemo } from "solid-js"
import { parsePatch } from "diff"
import CodeBlock from "./CodeBlock"
import styles from "./diffview.module.css"

type DiffRow = {
  left: string
  right: string
  type: "added" | "removed" | "unchanged" | "modified"
}

interface DiffViewProps {
  diff: string
  lang?: string
  class?: string
}

const DiffView: Component<DiffViewProps> = (props) => {

  const rows = createMemo(() => {
    const diffRows: DiffRow[] = []

    try {
      const patches = parsePatch(props.diff)

      for (const patch of patches) {
        for (const hunk of patch.hunks) {
          const lines = hunk.lines
          let i = 0

          while (i < lines.length) {
            const line = lines[i]
            const content = line.slice(1)
            const prefix = line[0]

            if (prefix === '-') {
              // Look ahead for consecutive additions to pair with removals
              const removals: string[] = [content]
              let j = i + 1

              // Collect all consecutive removals
              while (j < lines.length && lines[j][0] === '-') {
                removals.push(lines[j].slice(1))
                j++
              }

              // Collect all consecutive additions that follow
              const additions: string[] = []
              while (j < lines.length && lines[j][0] === '+') {
                additions.push(lines[j].slice(1))
                j++
              }

              // Pair removals with additions
              const maxLength = Math.max(removals.length, additions.length)
              for (let k = 0; k < maxLength; k++) {
                const hasLeft = !!removals[k]
                const hasRight = !!additions[k]

                if (hasLeft && hasRight) {
                  // Replacement - left is removed, right is added
                  diffRows.push({
                    left: removals[k],
                    right: additions[k],
                    type: "modified"
                  })
                } else if (hasLeft) {
                  // Pure removal
                  diffRows.push({
                    left: removals[k],
                    right: "",
                    type: "removed"
                  })
                } else {
                  // Pure addition
                  diffRows.push({
                    left: "",
                    right: additions[k],
                    type: "added"
                  })
                }
              }

              i = j
            } else if (prefix === '+') {
              // Standalone addition (not paired with removal)
              diffRows.push({
                left: "",
                right: content,
                type: "added"
              })
              i++
            } else if (prefix === ' ') {
              diffRows.push({
                left: content,
                right: content,
                type: "unchanged"
              })
              i++
            } else {
              i++
            }
          }
        }
      }
    } catch (error) {
      console.error("Failed to parse patch:", error)
      return []
    }

    return diffRows
  })

  return (
    <div class={`${styles.diff} ${props.class ?? ""}`}>
      {rows().map((r) => (
        <div class={styles.row}>
          <div class={styles.beforeColumn}>
            <CodeBlock
              code={r.left}
              lang={props.lang}
              data-section="cell"
              data-diff-type={r.type === "removed" || r.type === "modified" ? "removed" : ""}
              data-display-mobile={r.type === "added" && !r.left ? "false" : undefined}
            />
            {(r.type === "added" || r.type === "modified") && r.right !== undefined && (
              <CodeBlock
                code={r.right}
                lang={props.lang}
                data-section="cell"
                data-diff-type="added"
                data-display-mobile="true"
              />
            )}
          </div>

          <div class={styles.afterColumn}>
            <CodeBlock
              code={r.right}
              lang={props.lang}
              data-section="cell"
              data-diff-type={r.type === "added" || r.type === "modified" ? "added" : ""}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

export default DiffView

// String to test diff viewer with
const testDiff = `--- combined_before.txt	2025-06-24 16:38:08
+++ combined_after.txt	2025-06-24 16:38:12
@@ -1,21 +1,25 @@
 unchanged line
-deleted line
-old content
+added line
+new content
 
-removed empty line below
+added empty line above
 
-	tab indented
-trailing spaces   
-very long line that will definitely wrap in most editors and cause potential alignment issues when displayed in a two column diff view
-unicode content: 🚀 ✨ 中文
-mixed	content with	tabs and spaces
+    space indented
+no trailing spaces
+short line
+very long replacement line that will also wrap and test how the diff viewer handles long line additions after short line removals
+different unicode: 🎉 💻 日本語
+normalized content with consistent spacing
+newline to content
 
-content to remove
-whitespace only:    	  
-multiple
-consecutive
-deletions
-single deletion
+    	  
+single addition
+first addition
+second addition
+third addition
 line before addition
+first added line
+
+third added line
 line after addition
 final unchanged line`
