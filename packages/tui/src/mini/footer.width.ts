import { Locale } from "../util/locale"
import { stringWidth } from "../util/string-width"

type FooterAction = {
  key: string
  label: string
  expanded?: string
}

export type FooterStatuslineGroup = {
  id:
    | "spinner"
    | "status"
    | "escape"
    | "queued"
    | "subagents"
    | "background"
    | "agent"
    | "model"
    | "context"
    | "cost"
    | "provider"
    | "menu"
  parts: Array<{ text: string; tone: "text" | "muted" | "agent" | "status" }>
}

export function footerStatuslinePolicy(input: {
  width: number
  mono?: boolean
  status?: { text: string; expanded?: string }
  escape?: FooterAction
  work: Array<FooterAction & { id: "queued" | "subagents" | "background" }>
  model?: { name: string; variant?: string }
  agent?: string
  context?: { compact: string; full: string }
  cost?: string
  provider?: string
  menu?: FooterAction
  spinner?: string
}) {
  const group = (
    id: FooterStatuslineGroup["id"],
    text: string,
    tone: FooterStatuslineGroup["parts"][number]["tone"] = "muted",
  ): FooterStatuslineGroup => ({ id, parts: [{ text, tone }] })
  const action = (id: FooterStatuslineGroup["id"], value: FooterAction, expanded = false): FooterStatuslineGroup => ({
    id,
    parts: [
      { text: value.key, tone: "text" },
      { text: ` ${expanded ? (value.expanded ?? value.label) : value.label}`, tone: "muted" },
    ],
  })
  const identity = (cells: number) => {
    const name = input.model!.name
    const ellipsis = input.mono ? "..." : "\u2026"
    const text =
      stringWidth(name) > cells + stringWidth(ellipsis) ? Locale.takeWidth(name, cells).trimEnd() + ellipsis : name
    return group("model", text + (input.model!.variant ? ` [${input.model!.variant}]` : ""), "text")
  }
  const selected = new Map<FooterStatuslineGroup["id"], FooterStatuslineGroup>()
  if (input.spinner) selected.set("spinner", group("spinner", input.spinner, "text"))
  if (input.status?.text) selected.set("status", group("status", input.status.text, "status"))
  if (input.escape) selected.set("escape", action("escape", input.escape))

  const place = () => {
    const order: FooterStatuslineGroup["id"][] = [
      "spinner",
      "status",
      "escape",
      "queued",
      "subagents",
      "background",
      "agent",
      "model",
      "context",
      "provider",
      "cost",
      "menu",
    ]
    const groups = order.flatMap((id) => selected.get(id) ?? [])
    const separator = input.mono ? " - " : " \u00b7 "
    return {
      groups,
      text: groups
        .map(
          (item, index) =>
            (index === 0 ? "" : groups[index - 1]!.id === "spinner" ? " " : separator) +
            item.parts.map((part) => part.text).join(""),
        )
        .join(""),
    }
  }
  let layout = place()
  // Required controls may wrap. Optional information never crowds that fallback.
  if (stringWidth(layout.text) > input.width || layout.text.includes("\n")) return layout

  // Each stage retains earlier information. Stop at the first non-fitting stage:
  // backfilling shorter, lower-priority groups would make resizing unstable.
  const stages = [
    ...input.work.map((item) => action(item.id, item)),
    ...(input.model ? [identity(8)] : []),
    ...(input.agent ? [group("agent", input.agent, "agent")] : []),
    ...(input.context ? [group("context", input.context.compact)] : []),
    ...(input.model ? [identity(24)] : []),
    ...(input.context ? [group("context", input.context.full)] : []),
    ...(input.cost ? [group("cost", input.cost)] : []),
    ...(input.provider ? [group("provider", input.provider)] : []),
    ...(input.menu ? [action("menu", input.menu)] : []),
    ...(input.model ? [identity(Infinity)] : []),
    ...input.work.filter((item) => item.expanded).map((item) => action(item.id, item, true)),
    ...(input.status?.expanded ? [group("status", input.status.expanded, "status")] : []),
  ]
  for (const stage of stages) {
    selected.set(stage.id, stage)
    const next = place()
    if (stringWidth(next.text) > input.width || next.text.includes("\n")) break
    layout = next
  }
  return layout
}
