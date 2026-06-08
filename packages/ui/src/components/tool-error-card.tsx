import { type ComponentProps, createMemo, splitProps } from "solid-js"
import { Icon } from "./icon"
import { useI18n } from "../context/i18n"

export interface ToolErrorCardProps extends ComponentProps<"div"> {
  tool: string
  error: string
  defaultOpen?: boolean
  subtitle?: string
  href?: string
}

export function ToolErrorCard(props: ToolErrorCardProps) {
  const i18n = useI18n()
  const [split, rest] = splitProps(props, ["tool", "error", "defaultOpen", "subtitle", "href"])
  const name = createMemo(() => {
    const map: Record<string, string> = {
      read: "ui.tool.read",
      list: "ui.tool.list",
      glob: "ui.tool.glob",
      grep: "ui.tool.grep",
      task: "ui.tool.task",
      webfetch: "ui.tool.webfetch",
      websearch: "ui.tool.websearch",
      codesearch: "ui.tool.codesearch",
      bash: "ui.tool.shell",
      apply_patch: "ui.tool.patch",
      question: "ui.tool.questions",
    }
    const key = map[split.tool]
    if (!key) return split.tool
    if (!key.includes(".")) return key
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
    if (split.subtitle) return split.subtitle
    const parts = tail().split(": ")
    if (parts.length <= 1) return i18n.t("ui.toolErrorCard.failed")
    const head = (parts[0] ?? "").trim()
    if (!head) return i18n.t("ui.toolErrorCard.failed")
    return head[0] ? head[0].toUpperCase() + head.slice(1) : i18n.t("ui.toolErrorCard.failed")
  })

  return (
    <div {...rest} data-kind="tool-error-card">
      <div data-component="tool-trigger">
        <div data-slot="basic-tool-tool-trigger-content">
          <span data-slot="basic-tool-tool-indicator" data-component="tool-error-card-icon">
            <Icon name="circle-x" size="small" />
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
      </div>
    </div>
  )
}
