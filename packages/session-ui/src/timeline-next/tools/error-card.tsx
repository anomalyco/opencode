import { Badge } from "@opencode/ui/badge"
import { Card, CardDescription } from "@opencode/ui/card"
import { Collapsible } from "@opencode/ui/collapsible"
import { useI18n } from "@opencode/ui/context/i18n"
import { type ComponentProps, createMemo, onMount, Show, splitProps } from "solid-js"
import { createStore } from "solid-js/store"
import { createDisclosure } from "../../components/disclosure"

export interface ErrorCardProps extends Omit<ComponentProps<typeof Card>, "children" | "variant"> {
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

// Tools named by what they did rather than the provider or the raw tool name.
const titles = new Map([
  ["read", "ui.tool.read"],
  ["list", "ui.tool.list"],
  ["glob", "ui.tool.glob"],
  ["grep", "ui.tool.grep"],
  ["browser", "ui.tool.browser"],
  ["subagent", "ui.tool.agent.default"],
  ["webfetch", "ui.tool.fetch"],
  ["websearch", "ui.tool.searchWeb"],
  ["shell", "ui.tool.shell"],
  ["execute", "ui.tool.execute"],
  ["edit", "ui.messagePart.title.edit"],
  ["write", "ui.messagePart.title.write"],
  ["skill", "ui.tool.skill"],
  ["patch", "ui.tool.patch"],
  ["question", "ui.tool.questions"],
])

/** A call that failed: the tool tagged Failed, open or closed; opening it shows the error itself. */
export function ErrorCard(props: ErrorCardProps) {
  const i18n = useI18n()
  const [state, setState] = createStore({ clipped: false })

  const disclosure = createDisclosure({
    open: () => props.open,
    defaultOpen: () => props.defaultOpen ?? false,
    onOpenChange: (open) => props.onOpenChange?.(open),
  })

  const open = disclosure.open
  let subtitle: HTMLSpanElement | undefined

  // Measured in the collapsed layout: a clipped subtitle moves from the one-line header into the open body.
  const measure = () => {
    if (!subtitle) return
    setState("clipped", subtitle.textContent!.includes("\n") || subtitle.scrollWidth > subtitle.clientWidth)
  }

  onMount(() => {
    if (open()) measure()
  })

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
    if (value) measure()
    disclosure.setOpen(value)
  }

  const name = createMemo(() => {
    if (split.title) return split.title
    const key = titles.get(split.tool)

    return key ? i18n.t(key) : split.tool
  })

  return (
    <Card
      {...rest}
      data-kind="tool-error-card"
      data-tool={split.tool}
      data-open={open() ? "true" : "false"}
      variant="error"
    >
      <Collapsible class="tool-collapsible" data-open={open() ? "true" : "false"} open={open()} onOpenChange={setOpen}>
        <Collapsible.Trigger>
          <div data-component="tool-trigger">
            <div data-slot="basic-tool-tool-trigger-content">
              <div data-slot="basic-tool-tool-info">
                <div data-slot="basic-tool-tool-info-structured">
                  <div data-slot="basic-tool-tool-info-main">
                    <span data-slot="basic-tool-tool-title">{name()}</span>
                    <Show when={split.subtitle && (split.href || !(open() && state.clipped))}>
                      <Show
                        when={split.href}
                        fallback={
                          <span ref={subtitle} data-slot="basic-tool-tool-subtitle">
                            {split.subtitle}
                          </span>
                        }
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
                    <Badge data-slot="tool-error-card-failed" variant="danger">
                      {i18n.t("ui.toolErrorCard.failed")}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>
            <Collapsible.Arrow />
          </div>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div data-slot="tool-error-card-content">
            <Show when={state.clipped && split.subtitle}>
              {(text) => <p data-slot="tool-error-card-subtitle">{text()}</p>}
            </Show>
            <CardDescription>{split.error.replace(/^Error:\s*/, "").trim()}</CardDescription>
          </div>
        </Collapsible.Content>
      </Collapsible>
    </Card>
  )
}
