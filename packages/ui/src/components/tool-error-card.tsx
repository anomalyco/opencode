import { type ComponentProps, createMemo, createSignal, Show, splitProps } from "solid-js"
import { Card, CardDescription } from "./card"
import { Collapsible } from "./collapsible"
import { Icon } from "./icon"
import { useI18n } from "../context/i18n"

export interface ToolErrorCardProps extends Omit<ComponentProps<typeof Card>, "children" | "variant" | "icon"> {
  tool: string
  error: string
}

export function ToolErrorCard(props: ToolErrorCardProps) {
  const i18n = useI18n()
  const [open, setOpen] = createSignal(true)
  const [split, rest] = splitProps(props, ["tool", "error"])
  const name = createMemo(() => {
    const map: Record<string, string> = {
      read: "ui.tool.read",
      list: "ui.tool.list",
      glob: "ui.tool.glob",
      grep: "ui.tool.grep",
      webfetch: "ui.tool.webfetch",
      websearch: "ui.tool.websearch",
      codesearch: "ui.tool.codesearch",
      bash: "ui.tool.shell",
      apply_patch: "ui.tool.patch",
      question: "ui.tool.questions",
    }
    const key = map[split.tool]
    if (!key) return split.tool
    return i18n.t(key)
  })
  const cleaned = createMemo(() => split.error.replace(/^Error:\s*/, "").trim())
  const tail = createMemo(() => {
    const value = cleaned()
    const prefix = `${split.tool} `
    if (value.startsWith(prefix)) return value.slice(prefix.length)
    return value
  })

  const subtitle = createMemo(() => {
    const parts = tail().split(": ")
    if (parts.length <= 1) return "Failed"
    const head = (parts[0] ?? "").trim()
    if (!head) return "Failed"
    return head[0] ? head[0].toUpperCase() + head.slice(1) : "Failed"
  })

  const body = createMemo(() => {
    const parts = tail().split(": ")
    if (parts.length <= 1) return cleaned()
    return parts.slice(1).join(": ").trim() || cleaned()
  })

  return (
    <Card {...rest} data-kind="tool-error-card" data-open={open() ? "true" : "false"} variant="error">
      <Collapsible class="tool-collapsible" open={open()} onOpenChange={setOpen}>
        <Collapsible.Trigger>
          <div data-component="tool-trigger">
            <div data-slot="basic-tool-tool-trigger-content">
              <span data-slot="basic-tool-tool-indicator" data-component="tool-error-card-icon">
                <Icon name="circle-ban-sign" size="small" />
              </span>
              <div data-slot="basic-tool-tool-info">
                <div data-slot="basic-tool-tool-info-structured">
                  <div data-slot="basic-tool-tool-info-main">
                    <span data-slot="basic-tool-tool-title">{name()}</span>
                    <span data-slot="basic-tool-tool-subtitle">{subtitle()}</span>
                  </div>
                </div>
              </div>
            </div>
            <Collapsible.Arrow />
          </div>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div data-slot="tool-error-card-content">
            <Show when={body()}>{(value) => <CardDescription>{value()}</CardDescription>}</Show>
          </div>
        </Collapsible.Content>
      </Collapsible>
    </Card>
  )
}
