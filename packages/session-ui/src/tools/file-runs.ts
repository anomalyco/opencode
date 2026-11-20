import type { SessionMessageAssistantTool } from "@opencode/client/promise"
import type { FileFact } from "../timeline/facts"

/** Direct file changes and a script's changes in one file group, as runs in the order they happened. */
export type FileRun = { type: "tools"; tools: SessionMessageAssistantTool[] } | { type: "script"; files: FileFact[] }

/** Splits a file group's parts into runs: calls one after another stay one card, and each script's changes follow. */
export function fileRuns(items: readonly (SessionMessageAssistantTool | FileFact)[]) {
  return items.reduce<FileRun[]>((runs, item) => {
    const last = runs.at(-1)

    if ("type" in item) {
      if (last?.type === "tools") last.tools.push(item)
      else runs.push({ type: "tools", tools: [item] })

      return runs
    }

    if (last?.type === "script") last.files.push(item)
    else runs.push({ type: "script", files: [item] })

    return runs
  }, [])
}
