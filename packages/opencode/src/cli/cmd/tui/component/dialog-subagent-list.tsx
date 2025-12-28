import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { createMemo, createSignal, onMount, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import { useSDK } from "../context/sdk"
import { Keybind } from "@/util/keybind"
import { DialogSessionRename } from "./dialog-session-rename"
import { buildSubagentOptions, findRootSession, getStatusIndicator, formatTimeAgo } from "../util/subagent-tree"
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
  const sdk = useSDK()

  const [toDelete, setToDelete] = createSignal<string>()
  const deleteKeybind = "ctrl+d"

  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

  const rootSession = createMemo(() => findRootSession(sync.data.session, props.sessionID))

  const options = createMemo(() => {
    const root = rootSession()
    const subagents = buildSubagentOptions(sync.data.session, sync.data.session_status ?? {}, props.sessionID)

    const rootOption = root
      ? (() => {
          const statusInfo = getStatusIndicator(sync.data.session_status?.[root.id])
          const isRunning = statusInfo.status === "busy"
          const isDeleting = toDelete() === root.id
          const statusColor =
            statusInfo.status === "busy" ? theme.primary : statusInfo.status === "retry" ? theme.warning : theme.success
          return {
            title: isDeleting ? `Press ${deleteKeybind} again to confirm` : root.title,
            value: root.id,
            description: "(main)",
            bg: isDeleting ? theme.error : undefined,
            gutter: isRunning ? (
              <Show when={kv.get("animations_enabled", true)} fallback={<text fg={theme.textMuted}>[⋯]</text>}>
                <spinner frames={spinnerFrames} interval={80} color={theme.primary} />
              </Show>
            ) : (
              <text fg={statusColor}>{statusInfo.icon}</text>
            ),
          }
        })()
      : null

    const subagentOptions = subagents.map((sub) => {
      const isRunning = sub.status === "busy"
      const isDeleting = toDelete() === sub.id
      const statusColor = sub.status === "busy" ? theme.primary : sub.status === "retry" ? theme.warning : theme.success
      const prefix = getTreePrefix(sub.depth + 1)

      return {
        title: isDeleting ? `Press ${deleteKeybind} again to confirm` : prefix + sub.title,
        value: sub.id,
        description: sub.timeAgo,
        bg: isDeleting ? theme.error : undefined,
        gutter: isRunning ? (
          <Show when={kv.get("animations_enabled", true)} fallback={<text fg={theme.textMuted}>[⋯]</text>}>
            <spinner frames={spinnerFrames} interval={80} color={theme.primary} />
          </Show>
        ) : (
          <text fg={statusColor}>{sub.statusIcon}</text>
        ),
      }
    })

    return rootOption ? [rootOption, ...subagentOptions] : subagentOptions
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
        onMove={() => {
          setToDelete(undefined)
        }}
        onSelect={(option) => {
          route.navigate({
            type: "session",
            sessionID: option.value,
          })
          dialog.clear()
        }}
        keybind={[
          {
            keybind: Keybind.parse(deleteKeybind)[0],
            title: "delete",
            onTrigger: async (option) => {
              if (toDelete() === option.value) {
                sdk.client.session.delete({
                  sessionID: option.value,
                })
                setToDelete(undefined)
                return
              }
              setToDelete(option.value)
            },
          },
          {
            keybind: Keybind.parse("ctrl+r")[0],
            title: "rename",
            onTrigger: async (option) => {
              dialog.replace(() => <DialogSessionRename session={option.value} />)
            },
          },
        ]}
      />
    </Show>
  )
}
