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

/**
 * The disclosure key a run of direct calls opens its files under. The group's first run keeps the group's key, so a group
 * without a script keeps its files' state; a later run is scoped by its first call, so two runs that change the same file
 * open on their own.
 */
export function runDisclosureKey(groupKey: string, run: readonly { id: string }[], first: { id: string } | undefined) {
  const head = run[0]

  return head && head.id !== first?.id ? `${groupKey}:${head.id}` : groupKey
}
