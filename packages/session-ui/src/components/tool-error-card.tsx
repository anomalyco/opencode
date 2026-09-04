import { type ComponentProps, createMemo, Show, splitProps } from "solid-js"
import { createStore } from "solid-js/store"
import { Card, CardDescription } from "@opencode-ai/ui/card"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useI18n } from "@opencode-ai/ui/context/i18n"

export interface ToolErrorCardProps extends Omit<ComponentProps<typeof Card>, "children" | "variant"> {
  tool: string
  error: string
  title?: string
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  subtitle?: string
  href?: string
  onSubtitleClick?: (event: MouseEvent) => void
}

export function ToolErrorCard(props: ToolErrorCardProps) {
  const i18n = useI18n()
  const [state, setState] = createStore({
    open: props.defaultOpen ?? false,
    copied: false,
  })
  const open = () => props.open ?? state.open
  const copied = () => state.copied
  const [split, rest] = splitProps(props, [
    "tool",
    "error",
    "title",
    "defaultOpen",
    "open",
    "onOpenChange",
    "subtitle",
    "href",
    "onSubtitleClick",
  ])
  const setOpen = (value: boolean) => {
    if (props.open === undefined) setState("open", value)
    props.onOpenChange?.(value)
  }
  const name = createMemo(() => {
    if (split.title) return split.title
    const map: Record<string, string> = {
      read: "ui.tool.read",
      list: "ui.tool.list",
      glob: "ui.tool.glob",
      grep: "ui.tool.grep",
      subagent: "ui.tool.agent.default",
      webfetch: "ui.tool.webfetch",
      websearch: "ui.tool.websearch",
      shell: "ui.tool.shell",
      execute: "ui.tool.execute",
      patch: "ui.tool.patch",
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

  const summary = createMemo(() => {
    const head = (tail().split(": ")[0] ?? "").trim()
    if (!head) return i18n.t("ui.toolErrorCard.failed")
    return head[0].toUpperCase() + head.slice(1)
  })

  const detail = createMemo(() => {
    const parts = tail().split(": ")
    if (parts.length <= 1) return ""
    return parts.slice(1).join(": ").trim()
  })

  const copy = async () => {
    const text = cleaned()
    if (!text) return
    await navigator.clipboard.writeText(text)
    setState("copied", true)
    setTimeout(() => setState("copied", false), 2000)
  }

  return (
    <Card {...rest} data-kind="tool-error-card" data-open={open() ? "true" : "false"} variant="error">
      <Collapsible class="tool-collapsible" data-open={open() ? "true" : "false"} open={open()} onOpenChange={setOpen}>
        <Collapsible.Trigger>
          <div data-component="tool-trigger">
            <div data-slot="basic-tool-tool-trigger-content">
              <span data-slot="basic-tool-tool-indicator" data-component="tool-error-card-icon">
                <Icon name="outline-hexagonal-warning" />
              </span>
              <div data-slot="basic-tool-tool-info">
                <div data-slot="basic-tool-tool-info-structured">
                  <div data-slot="basic-tool-tool-info-main">
                    <span data-slot="basic-tool-tool-title">{name()}</span>
                    <Show when={split.subtitle}>
                      <Show
                        when={split.href}
                        fallback={<span data-slot="basic-tool-tool-subtitle">{split.subtitle}</span>}
                      >
                        <a
                          data-slot="basic-tool-tool-subtitle"
                          class="clickable subagent-link"
                          href={split.href!}
                          onClick={(event) => {
                            event.stopPropagation()
                            split.onSubtitleClick?.(event)
                          }}
                        >
                          {split.subtitle}
                        </a>
                      </Show>
                    </Show>
                    <span data-slot="tool-error-card-summary">{summary()}</span>
                  </div>
                </div>
              </div>
            </div>
            <Collapsible.Arrow />
          </div>
        </Collapsible.Trigger>
        <Show when={detail()}>
          <Collapsible.Content>
            <div data-slot="tool-error-card-content">
              <Show when={open()}>
                <div data-slot="tool-error-card-copy">
                  <Tooltip
                    appearance="standard"
                    value={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.toolErrorCard.copyError")}
                    placement="top"
                    gutter={4}
                  >
                    <IconButton
                      icon={<Icon name={copied() ? "check" : "copy"} />}
                      size="normal"
                      variant="ghost"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        e.stopPropagation()
                        void copy()
                      }}
                      aria-label={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.toolErrorCard.copyError")}
                    />
                  </Tooltip>
                </div>
              </Show>
              <CardDescription>{detail()}</CardDescription>
            </div>
          </Collapsible.Content>
        </Show>
      </Collapsible>
    </Card>
  )
}
