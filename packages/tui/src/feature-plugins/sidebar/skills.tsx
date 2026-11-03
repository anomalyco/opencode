import type { SkillInfo } from "@opencode/client"
import { Plugin } from "@opencode/plugin/tui"
import { Path } from "@opencode/util/global"
import path from "path"
import { createMemo, For, Show } from "solid-js"

const contains = (root: string, target: string) => {
  const relative = path.relative(root, target)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

const source = (skill: SkillInfo, directory: string | undefined) => {
  if (skill.path.startsWith("skill://")) return "built-in"
  if (directory && contains(directory, skill.path)) return "project"
  if (contains(Path.config, skill.path)) return "global"
  return "external"
}

export function SidebarSkills(props: { context: Plugin.Context; sessionID: string }) {
  const [view, updateView] = props.context.storage.store("view", { initial: { open: true } })
  const theme = props.context.theme
  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  const available = createMemo(() => props.context.data.location.skill.list(session()?.location) ?? [])
  const loaded = createMemo(() => {
    const ids = new Set<string>()
    for (const message of props.context.data.session.message.list(props.sessionID)) {
      if (message.type === "skill") {
        ids.add(message.skill)
        continue
      }
      if (message.type === "user") {
        for (const skill of message.skills ?? []) ids.add(skill.id)
        continue
      }
      if (message.type !== "assistant") continue
      for (const item of message.content) {
        if (item.type !== "tool" || item.name !== "skill" || item.state.status !== "completed") continue
        const id = item.state.input.id
        if (typeof id === "string") ids.add(id)
      }
    }
    return ids
  })
  const list = createMemo(() => available().filter((skill) => loaded().has(skill.id)))

  return (
    <box>
      <box
        flexDirection="row"
        gap={1}
        onMouseDown={() => {
          if (list().length <= 2) return
          void updateView((draft) => {
            draft.open = !draft.open
          }).catch((error) => console.error("Failed to persist skill sidebar state", error))
        }}
      >
        <Show when={list().length > 2}>
          <text fg={theme.text.base}>{view.open ? "▼" : "▶"}</text>
        </Show>
        <text fg={theme.text.base}>
          <b>Active Skills</b>
        </text>
      </box>
      <Show when={list().length <= 2 || view.open}>
        <Show when={list().length === 0}>
          <text fg={theme.text.muted}>No skills loaded</text>
        </Show>
        <For each={list()}>
          {(skill) => (
            <box flexDirection="row" gap={1}>
              <text flexShrink={0} style={{ fg: theme.text.feedback.success.base }}>
                •
              </text>
              <text fg={theme.text.base} wrapMode="word">
                {skill.name}{" "}
                <span style={{ fg: theme.text.muted }}>{source(skill, session()?.location.directory)}</span>
              </text>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "opencode.sidebar.skills",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <SidebarSkills context={context} sessionID={props.sessionID} />,
    })
  },
})
