import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Part as SdkPart } from "@opencode-ai/sdk/v2"
import { createMemo, createSignal } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { Keybind } from "@/util/keybind"

type Value = {
  sessionID: string
  messageID: string
  partID: string
  kind: string
}

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function estimate(part: SdkPart): number {
  switch (part.type) {
    case "text":
      return Math.ceil((part.text?.length ?? 0) / 4)
    case "tool": {
      if (part.state.status !== "completed") return 0
      const raw = JSON.stringify(part.state.input ?? "").length + (part.state.output ?? "").length
      return Math.ceil(raw / 4)
    }
    case "reasoning":
      return Math.ceil((part.text?.length ?? 0) / 4)
    case "subtask":
      return Math.ceil((part.prompt?.length ?? 0) / 4)
    default:
      return 0
  }
}

function label(part: SdkPart): string {
  switch (part.type) {
    case "text":
      return (part.text ?? "").slice(0, 60).replace(/\n/g, " ") || "(empty)"
    case "tool": {
      const icon =
        part.state.status === "completed"
          ? "✓"
          : part.state.status === "error"
            ? "✗"
            : part.state.status === "running"
              ? "…"
              : "○"
      const flag = part.state.status === "completed" && part.state.time?.compacted ? " [compacted]" : ""
      return `[${part.tool}] ${icon}${flag}`
    }
    case "reasoning":
      return "[reasoning] " + (part.text ?? "").slice(0, 40).replace(/\n/g, " ")
    case "subtask":
      return `[subtask] ${part.description ?? part.prompt?.slice(0, 40) ?? ""}`
    case "file":
      return `[file] ${part.filename ?? part.url ?? ""}`
    case "step-start":
      return "[step-start]"
    case "step-finish":
      return `[step-finish] ${part.reason ?? ""}`
    case "patch":
      return `[patch] ${part.files?.length ?? 0} files`
    case "agent":
      return `[@${part.name}]`
    case "retry":
      return `[retry] #${part.attempt}`
    case "compaction":
      return "[compaction]"
    case "snapshot":
      return "[snapshot]"
    default:
      return `[unknown]`
  }
}

function desc(part: SdkPart): string | undefined {
  if (part.type === "tool" && part.state.status === "completed") return part.state.title ?? undefined
  return undefined
}

export function show(api: TuiPluginApi, sessionID: string) {
  api.ui.dialog.setSize("xlarge")
  api.ui.dialog.replace(() => <Viewer api={api} sessionID={sessionID} />)
}

function Viewer(props: { api: TuiPluginApi; sessionID: string }) {
  const dialog = useDialog()
  const theme = () => props.api.theme.current
  const [pending, setPending] = createSignal<string>()
  const msgs = createMemo(() => props.api.state.session.messages(props.sessionID))
  const cost = createMemo(() => msgs().reduce((sum, m) => sum + (m.role === "assistant" ? m.cost : 0), 0))

  const options = createMemo(() => {
    const result: DialogSelectOption<Value>[] = []
    const all = msgs()
    for (let i = 0; i < all.length; i++) {
      const msg = all[i]
      const parts = props.api.state.part(msg.id)
      const role = msg.role === "user" ? "User" : "Assistant"
      let info = ""
      if (msg.role === "assistant") {
        const t = msg.tokens
        const total = t.input + t.output + t.reasoning + t.cache.read + t.cache.write
        info = ` · ${total.toLocaleString()} tok`
        if (msg.cost > 0) info += ` · ${money.format(msg.cost)}`
      }
      const category = `#${i + 1} ${role}${info}`

      for (const part of parts) {
        const tok = estimate(part)
        const deleting = pending() === part.id
        result.push({
          title: deleting ? "Press again to confirm delete" : label(part),
          value: {
            sessionID: props.sessionID,
            messageID: msg.id,
            partID: part.id,
            kind: part.type,
          },
          description: deleting ? undefined : desc(part),
          footer: tok > 0 ? `~${tok.toLocaleString()} tok` : undefined,
          category,
          bg: deleting ? theme().error : undefined,
        })
      }

      if (parts.length === 0) {
        result.push({
          title: "(no parts)",
          value: {
            sessionID: props.sessionID,
            messageID: msg.id,
            partID: "",
            kind: "empty",
          },
          category,
          disabled: true,
        })
      }
    }
    return result
  })

  return (
    <DialogSelect
      title={`Context · ${money.format(cost())} spent`}
      options={options()}
      skipFilter={false}
      placeholder="Filter parts..."
      flat={true}
      onMove={() => setPending(undefined)}
      keybind={[
        {
          keybind: Keybind.parse("alt+c")[0],
          title: "compact",
          onTrigger: async (opt: DialogSelectOption<Value>) => {
            if (opt.value.kind !== "tool") return
            const parts = props.api.state.part(opt.value.messageID)
            const part = parts.find((p) => p.id === opt.value.partID)
            if (!part || part.type !== "tool") return
            if (part.state.status !== "completed") return
            if (part.state.time?.compacted) return
            await props.api.client.part.update({
              sessionID: opt.value.sessionID,
              messageID: opt.value.messageID,
              partID: opt.value.partID,
              part: {
                ...part,
                state: {
                  ...part.state,
                  time: { ...part.state.time, compacted: Date.now() },
                },
              },
            })
          },
        },
        {
          keybind: Keybind.parse("alt+d")[0],
          title: "delete",
          onTrigger: async (opt: DialogSelectOption<Value>) => {
            if (!opt.value.partID) return
            if (pending() !== opt.value.partID) {
              setPending(opt.value.partID)
              return
            }
            setPending(undefined)
            await props.api.client.part.delete({
              sessionID: opt.value.sessionID,
              messageID: opt.value.messageID,
              partID: opt.value.partID,
            })
          },
        },
      ]}
    />
  )
}
