import path from "path"
import { TextAttributes } from "@opentui/core"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { createResource, createMemo, createSignal } from "solid-js"
import { useDialog } from "../ui/dialog"
import { usePathFormatter } from "../context/path-format"
import { useTuiPaths } from "../context/runtime"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { errorMessage } from "../util/error"

export type DialogSkillProps = {
  onSelect: (skill: string) => void
}

export function skillSource(location: string, directory: string) {
  if (location === "<built-in>") return "Built-in"
  const relative = path.relative(directory, location)
  // path.relative returns an absolute path when the two share no root - different
  // Windows drives, a UNC share - and an absolute result is outside the project too.
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) return "Global"
  return "Project"
}

export function DialogSkill(props: DialogSkillProps) {
  const dialog = useDialog()
  const sdk = useSDK()
  const { theme } = useTheme()
  const paths = useTuiPaths()
  const formatter = usePathFormatter()
  dialog.setSize("large")

  // Classify against the worktree, not the cwd: project skills are discovered from
  // .opencode directories between the cwd and the worktree root, so a session started
  // in a subdirectory would otherwise label its own project skills "Global".
  const source = (location: string) => skillSource(location, paths.worktree || formatter.path())

  const [loadError, setLoadError] = createSignal<unknown>()

  const [skills] = createResource(() =>
    sdk.client.app
      .skills({}, { throwOnError: true })
      .then((result) => result.data ?? [])
      // Catch so the rejected resource never reaches the memo below: reading
      // skills() in an errored state re-throws and tears down the dialog.
      .catch((error) => {
        setLoadError(error)
        return undefined
      }),
  )

  const showError = createMemo(() => Boolean(loadError()))

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    if (showError()) return []
    const rank = { Project: 0, Global: 1, "Built-in": 2 }
    const list = (skills() ?? []).toSorted(
      (a, b) => rank[source(a.location)] - rank[source(b.location)] || a.name.localeCompare(b.name),
    )
    const maxWidth = Math.max(0, ...list.map((s) => s.name.length))
    return list.map((skill) => ({
      title: skill.name.padEnd(maxWidth),
      description: skill.description?.replace(/\s+/g, " ").trim(),
      value: skill.name,
      category: source(skill.location),
      onSelect: () => {
        props.onSelect(skill.name)
        dialog.clear()
      },
    }))
  })

  return (
    <DialogSelect
      title="Skills"
      placeholder="Search skills…"
      options={options()}
      renderFilter={!showError()}
      locked={showError()}
      emptyView={
        showError() ? (
          <box paddingLeft={4} paddingRight={4}>
            <text fg={theme.error} attributes={TextAttributes.BOLD}>
              Could not load skills
            </text>
            <text fg={theme.textMuted}>{errorMessage(loadError())}</text>
          </box>
        ) : undefined
      }
    />
  )
}
