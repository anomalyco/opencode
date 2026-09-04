import { type ComponentProps, createMemo, Show, splitProps } from "solid-js"
import { createStore } from "solid-js/store"
import { Card, CardDescription } from "@opencode-ai/ui/card"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useI18n } from "@opencode-ai/ui/context/i18n"

function getToolContextLabel(tool: string, input: Record<string, unknown>, t: (key: string) => string): { label: string; value: string } | undefined {
  switch (tool) {
    case "bash":
    case "shell": {
      const command = typeof input.command === "string" ? input.command : undefined
      if (command) return { label: t("ui.toolErrorCard.context.command"), value: command }
      break
    }
    case "read": {
      const filePath = typeof input.filePath === "string" ? input.filePath : undefined
      if (filePath) return { label: t("ui.toolErrorCard.context.file"), value: filePath }
      break
    }
    case "edit": {
      const filePath = typeof input.filePath === "string" ? input.filePath : undefined
      if (filePath) return { label: t("ui.toolErrorCard.context.file"), value: filePath }
      break
    }
    case "write": {
      const filePath = typeof input.filePath === "string" ? input.filePath : undefined
      if (filePath) return { label: t("ui.toolErrorCard.context.file"), value: filePath }
      break
    }
    case "webfetch": {
      const url = typeof input.url === "string" ? input.url : undefined
      if (url) return { label: t("ui.toolErrorCard.context.url"), value: url }
      break
    }
    case "websearch": {
      const query = typeof input.query === "string" ? input.query : undefined
      if (query) return { label: t("ui.toolErrorCard.context.query"), value: query }
      break
    }
    case "glob": {
      const pattern = typeof input.pattern === "string" ? input.pattern : undefined
      const path = typeof input.path === "string" ? input.path : undefined
      if (pattern) return { label: t("ui.toolErrorCard.context.pattern"), value: path ? `${pattern} (${path})` : pattern }
      break
    }
    case "grep": {
      const pattern = typeof input.pattern === "string" ? input.pattern : undefined
      const path = typeof input.path === "string" ? input.path : undefined
      if (pattern) return { label: t("ui.toolErrorCard.context.pattern"), value: path ? `${pattern} (${path})` : pattern }
      break
    }
    case "list": {
      const path = typeof input.path === "string" ? input.path : undefined
      if (path) return { label: t("ui.toolErrorCard.context.directory"), value: path }
      break
    }
    case "task": {
      const description = typeof input.description === "string" ? input.description : undefined
      if (description) return { label: t("ui.toolErrorCard.context.task"), value: description }
      break
    }
    case "patch":
    case "apply_patch": {
      const files = Array.isArray(input.files) ? input.files : undefined
      if (files?.length) {
        const fileNames = files.map((f: any) => typeof f === "string" ? f : f?.path).filter(Boolean)
        if (fileNames.length) return { label: t("ui.toolErrorCard.context.files"), value: fileNames.join(", ") }
      }
      break
    }
  }
  return undefined
}

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
  input?: Record<string, unknown>
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
    "input",
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
      task: "ui.tool.task",
      webfetch: "ui.tool.webfetch",
      websearch: "ui.tool.websearch",
      bash: "ui.tool.shell",
      shell: "ui.tool.shell",
      patch: "ui.tool.patch",
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

  const body = createMemo(() => {
    const parts = tail().split(": ")
    if (parts.length <= 1) return cleaned()
    return parts.slice(1).join(": ").trim() || cleaned()
  })

  const context = createMemo(() => {
    const input = split.input as Record<string, unknown> | undefined
    if (!input) return undefined
    return getToolContextLabel(split.tool, input, i18n.t)
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
                <Icon name="circle-ban-sign" size="small" style={{ "stroke-width": 1.5 }} />
              </span>
              <div data-slot="basic-tool-tool-info">
                <div data-slot="basic-tool-tool-info-structured">
                  <div data-slot="basic-tool-tool-info-main">
                    <span data-slot="basic-tool-tool-title">{name()}</span>
                    <Show
                      when={split.href && split.subtitle}
                      fallback={<span data-slot="basic-tool-tool-subtitle">{subtitle()}</span>}
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
                        {subtitle()}
                      </a>
                    </Show>
                  </div>
                </div>
              </div>
            </div>
            <Collapsible.Arrow />
          </div>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div data-slot="tool-error-card-content">
            <Show when={open()}>
              <div data-slot="tool-error-card-copy">
                <Tooltip
                  value={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.toolErrorCard.copyError")}
                  placement="top"
                  gutter={4}
                >
                  <IconButton
                    icon={copied() ? "check" : "copy"}
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
            <Show when={context()}>
              {(ctx) => (
                <div data-slot="tool-error-card-context">
                  <span data-slot="tool-error-card-context-label">{ctx().label}</span>
                  <span data-slot="tool-error-card-context-value">{ctx().value}</span>
                </div>
              )}
            </Show>
            <Show when={body()}>{(value) => <CardDescription>{value()}</CardDescription>}</Show>
          </div>
        </Collapsible.Content>
      </Collapsible>
    </Card>
  )
}
