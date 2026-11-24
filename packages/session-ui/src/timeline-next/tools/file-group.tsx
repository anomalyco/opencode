import type { FileDiffInfo, SessionMessageAssistantTool } from "@opencode/client/promise"
import { createTwoFilesPatch, diffLines } from "diff"
import { createMemo } from "solid-js"
import { changedFileDiff } from "../../components/apply-patch-file"
import { currentToolInput, currentToolMetadata } from "../../message/current-tool-state"
import { samePatchFile, toolInput, toolMetadata } from "../../tools/tool-renderer"
import { PatchTool } from "./patch"

/** Calls that changed files, one after another, as one list of files. An edit or a write still in progress shows the change it is making. */
export function FileGroup(props: {
  tools: SessionMessageAssistantTool[]
  fileOpen?: (path: string) => boolean | undefined
  onFileOpenChange?: (path: string, open: boolean) => void
  onSizeChange?: () => void
}) {
  const files = createMemo((previous: { key: string; toolID: string; value: FileDiffInfo }[]) => {
    const next = props.tools.flatMap((tool) => {
      const files = toolMetadata(currentToolMetadata(tool)).files ?? []

      // Invalid entries render nothing, but metadata files still replace the input-derived preview.
      if (files.length > 0)
        return files.flatMap((value, index) =>
          changedFileDiff(value) ? [{ key: `${tool.id}:${index}`, toolID: tool.id, value }] : [],
        )
      const input = toolInput(currentToolInput(tool))

      if (input.path === undefined) return []

      if (tool.name === "edit" && input.oldString !== undefined && input.newString !== undefined) {
        const changes = diffLines(input.oldString, input.newString)

        const additions = changes
          .filter((change) => change.added)
          .reduce((total, change) => total + (change.count ?? 0), 0)

        const deletions = changes
          .filter((change) => change.removed)
          .reduce((total, change) => total + (change.count ?? 0), 0)

        if (additions === 0 && deletions === 0) return []

        return [
          {
            key: `${tool.id}:0`,
            toolID: tool.id,
            value: {
              file: input.path,
              patch: createTwoFilesPatch(input.path, input.path, input.oldString, input.newString),
              additions,
              deletions,
              status: "modified" as const,
            },
          },
        ]
      }

      if (tool.name !== "write" || !input.content) return []

      return [
        {
          key: `${tool.id}:0`,
          toolID: tool.id,
          value: {
            file: input.path,
            patch: createTwoFilesPatch(input.path, input.path, "", input.content),
            additions: input.content.split("\n").length - Number(input.content.endsWith("\n")),
            deletions: 0,
            status: "modified" as const,
          },
        },
      ]
    })

    const updates = new Map(next.map((entry) => [entry.key, entry.value]))
    const existing = new Set(previous.map((entry) => entry.key))
    const owners = new Set(props.tools.map((tool) => tool.id))

    const result = [
      ...previous.flatMap((entry) => {
        if (!owners.has(entry.toolID)) return []
        const value = updates.get(entry.key)

        if (!value || samePatchFile(value, entry.value)) return [entry]

        return [{ ...entry, value }]
      }),
      ...next.filter((entry) => !existing.has(entry.key)),
    ]

    return result.length === previous.length && result.every((entry, index) => entry === previous[index])
      ? previous
      : result
  }, [])

  const metadata = createMemo(() => ({
    files: files().map((entry) => entry.value),
  }))

  const pending = createMemo(() =>
    props.tools.some((tool) => tool.state.status === "streaming" || tool.state.status === "running"),
  )

  const tool = createMemo(() => {
    const name = props.tools[0]?.name

    return name === "edit" || name === "write" ? name : "patch"
  })

  return (
    <div
      data-component="tool-part-wrapper"
      data-timeline-part-id={props.tools.length === 1 ? props.tools[0]?.id : undefined}
      data-timeline-part-ids={props.tools.length > 1 ? props.tools.map((tool) => tool.id).join(",") : undefined}
    >
      <PatchTool
        tool={tool()}
        input={{}}
        metadata={metadata()}
        status={pending() ? "running" : "completed"}
        fileOpen={props.fileOpen}
        onFileOpenChange={props.onFileOpenChange}
        deferContent
        virtualizeDiff={false}
        onContentRendered={props.onSizeChange}
      />
    </div>
  )
}
