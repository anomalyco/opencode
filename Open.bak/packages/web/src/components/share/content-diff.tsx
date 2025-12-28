import { parsePatch } from "diff"
import { createMemo } from "solid-js"
import { ContentCode } from "./content-code"
import styles from "./content-diff.module.css"

type DiffRow = {
  left: string
  right: string
  type: "added" | "removed" | "unchanged" | "modified"
}

interface Props {
  diff: string
  lang?: string
}

export function ContentDiff(props: Props) {
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

            if (prefix === "-") {
              // Look ahead for consecutive additions to pair with removals
              const removals: string[] = [content]
              let j = i + 1

              // Collect all consecutive removals
              while (j < lines.length && lines[j][0] === "-") {
                removals.push(lines[j].slice(1))
                j++
              }

              // Collect all consecutive additions that follow
              const additions: string[] = []
              while (j < lines.length && lines[j][0] === "+") {
                additions.push(lines[j].slice(1))
                j++
              }

              // Pair removals with additions
              const maxLength = Math.max(removals.length, additions.length)
              for (let k = 0; k < maxLength; k++) {
                const hasLeft = k < removals.length
                const hasRight = k < additions.length

                if (hasLeft && hasRight) {
                  // Replacement - left is removed, right is added
                  diffRows.push({
                    left: removals[k],
                    right: additions[k],
                    type: "modified",
                  })
                } else if (hasLeft) {
                  // Pure removal
                  diffRows.push({
                    left: removals[k],
                    right: "",
                    type: "removed",
                  })
                } else if (hasRight) {
                  // Pure addition - only create if we actually have content
                  diffRows.push({
                    left: "",
                    right: additions[k],
                    type: "added",
                  })
                }
              }

              i = j
            } else if (prefix === "+") {
              // Standalone addition (not paired with removal)
              diffRows.push({
                left: "",
                right: content,
                type: "added",
              })
              i++
            } else if (prefix === " ") {
              diffRows.push({
                left: content === "" ? " " : content,
                right: content === "" ? " " : content,
                type: "unchanged",
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

  const mobileRows = createMemo(() => {
    const mobileBlocks: {
      type: "removed" | "added" | "unchanged"
      lines: string[]
    }[] = []
    const currentRows = rows()

    let i = 0
    while (i < currentRows.length) {
      const removedLines: string[] = []
      const addedLines: string[] = []

      // Collect consecutive modified/removed/added rows
      while (
        i < currentRows.length &&
        (currentRows[i].type === "modified" || currentRows[i].type === "removed" || currentRows[i].type === "added")
      ) {
        const row = currentRows[i]
        if (row.left && (row.type === "removed" || row.type === "modified")) {
          removedLines.push(row.left)
        }
        if (row.right && (row.type === "added" || row.type === "modified")) {
          addedLines.push(row.right)
        }
        i++
      }

      // Add grouped blocks
      if (removedLines.length > 0) {
        mobileBlocks.push({ type: "removed", lines: removedLines })
      }
      if (addedLines.length > 0) {
        mobileBlocks.push({ type: "added", lines: addedLines })
      }

      // Add unchanged rows as-is
      if (i < currentRows.length && currentRows[i].type === "unchanged") {
        mobileBlocks.push({
          type: "unchanged",
          lines: [currentRows[i].left],
        })
        i++
      }
    }

    return mobileBlocks
  })

  return (
    <div class={styles.root}>
      <div data-component="desktop">
        {rows().map((r) => (
          <div data-component="diff-row" data-type={r.type}>
            <div data-slot="before" data-diff-type={r.type === "removed" || r.type === "modified" ? "removed" : ""}>
              <ContentCode code={r.left} flush lang={props.lang} />
            </div>
            <div data-slot="after" data-diff-type={r.type === "added" || r.type === "modified" ? "added" : ""}>
              <ContentCode code={r.right} lang={props.lang} flush />
            </div>
          </div>
        ))}
      </div>

      <div data-component="mobile">
        {mobileRows().map((block) => (
          <div data-component="diff-block" data-type={block.type}>
            {block.lines.map((line) => (
              <div data-diff-type={block.type === "removed" ? "removed" : block.type === "added" ? "added" : ""}>
                <ContentCode code={line} lang={props.lang} flush />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// const testDiff = `--- combined_before.txt	2025-06-24 16:38:08
// +++ combined_after.txt	2025-06-24 16:38:12
// @@ -1,21 +1,25 @@
//  unchanged line
// -deleted line
// -old content
// +added line
// +new content
//
// -removed empty line below
// +added empty line above
//
// -	tab indented
// -trailing spaces
// -very long line that will definitely wrap in most editors and cause potential alignment issues when displayed in a two column diff view
// -unicode content: 🚀 ✨ 中文
// -mixed	content with	tabs and spaces
// +    space indented
// +no trailing spaces
// +short line
// +very long replacement line that will also wrap and test how the diff viewer handles long line additions after short line removals
// +different unicode: 🎉 💻 日本語
// +normalized content with consistent spacing
// +newline to content
//
// -content to remove
// -whitespace only:
// -multiple
// -consecutive
// -deletions
// -single deletion
// +
// +single addition
// +first addition
// +second addition
// +third addition
//  line before addition
// +first added line
// +
// +third added line
//  line after addition
//  final unchanged line`
