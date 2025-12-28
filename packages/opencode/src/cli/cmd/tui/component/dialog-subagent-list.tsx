import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { createMemo, onMount, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import { buildSubagentOptions, findRootSession } from "../util/subagent-tree"
import "opentui-spinner/solid"

function getTreePrefix(depth: number): string {
  if (depth === 0) return ""
  return "  ".repeat(depth - 1) + "└─ "
}

export function DialogSubagentList(props: { sessionID: string }) {
  const dialog = useDialog()
  const sync = useSync()
  const { theme } = useTheme()
  const route = useRoute()
  const kv = useKV()

  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

  const rootSession = createMemo(() => findRootSession(sync.data.session, props.sessionID))

  const options = createMemo(() => {
    const subagents = buildSubagentOptions(sync.data.session, sync.data.session_status ?? {}, props.sessionID)

    return subagents.map((sub) => {
      const isRunning = sub.status === "busy"
      const statusColor = sub.status === "busy" ? theme.primary : sub.status === "retry" ? theme.warning : theme.success
      const prefix = getTreePrefix(sub.depth)

      return {
        title: prefix + sub.title,
        value: sub.id,
        description: sub.timeAgo,
        gutter: isRunning ? (
          <Show when={kv.get("animations_enabled", true)} fallback={<text fg={theme.textMuted}>[⋯]</text>}>
            <spinner frames={spinnerFrames} interval={80} color={theme.primary} />
          </Show>
        ) : (
          <text fg={statusColor}>{sub.statusIcon}</text>
        ),
      }
    })
  })

  const hasTree = createMemo(() => options().length > 0)

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <Show
      when={hasTree()}
      fallback={
        <box paddingLeft={4} paddingRight={4} paddingTop={1} paddingBottom={1}>
          <text fg={theme.text}>
            <b>Subagent Tree</b>
          </text>
          <text fg={theme.textMuted}>No subagents in this session tree</text>
          <text fg={theme.textMuted}>Subagents are created when the agent delegates tasks</text>
        </box>
      }
    >
      <DialogSelect
        title={`Subagent Tree (root: ${rootSession()?.title ?? "Session"})`}
        options={options()}
        current={props.sessionID}
        onSelect={(option) => {
          route.navigate({
            type: "session",
            sessionID: option.value,
          })
          dialog.clear()
        }}
      />
    </Show>
  )
}
