import { useI18n } from "@opencode/ui/context/i18n"
import { Icon } from "@opencode/ui/icon"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { createMemo, Show } from "solid-js"
import { BasicTool } from "../../components/basic-tool"
import { displayDirectory, ExaOutput, toolInput, urls, type ToolProps } from "../../tools/tool-renderer"

/**
 * The New timeline's exploring tools. A search shows what was searched, never the raw list it returned, so it has
 * nothing to open; the web tools are named by what they did rather than the provider.
 */

export function ListTool(props: ToolProps) {
  const i18n = useI18n()

  return (
    <BasicTool
      {...props}
      icon="bullet-list"
      hasContent={false}
      trigger={{ title: i18n.t("ui.tool.list"), subtitle: displayDirectory(toolInput(props.input).path ?? "/") }}
    />
  )
}

export function GlobTool(props: ToolProps) {
  const i18n = useI18n()
  const input = createMemo(() => toolInput(props.input))

  return (
    <BasicTool
      {...props}
      icon="magnifying-glass-menu"
      hasContent={false}
      trigger={{
        title: i18n.t("ui.tool.glob"),
        subtitle: displayDirectory(input().path ?? "/"),
        args: input().pattern === undefined ? [] : ["pattern=" + input().pattern],
      }}
    />
  )
}

export function GrepTool(props: ToolProps) {
  const i18n = useI18n()
  const input = createMemo(() => toolInput(props.input))

  return (
    <BasicTool
      {...props}
      icon="magnifying-glass-menu"
      hasContent={false}
      trigger={{
        title: i18n.t("ui.tool.grep"),
        subtitle: displayDirectory(input().path ?? "/"),
        args: [
          ...(input().pattern === undefined ? [] : ["pattern=" + input().pattern]),
          ...(input().include === undefined ? [] : ["include=" + input().include]),
        ],
      }}
    />
  )
}

export function WebFetchTool(props: ToolProps) {
  const i18n = useI18n()
  const pending = createMemo(() => props.status === "streaming" || props.status === "running")
  const url = createMemo(() => toolInput(props.input).url ?? "")

  return (
    <BasicTool
      {...props}
      hideDetails
      icon="window-cursor"
      trigger={
        <div data-slot="basic-tool-tool-info-structured">
          <div data-slot="basic-tool-tool-info-main">
            <span data-slot="basic-tool-tool-title">
              <TextShimmer text={i18n.t("ui.tool.fetch")} active={pending()} />
            </span>
            <Show when={props.status !== "streaming" && url()}>
              <a
                data-slot="basic-tool-tool-subtitle"
                class="webfetch-link"
                href={url()}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                <span data-slot="webfetch-link-text">{url()}</span>
                <Icon name="outline-square-arrow" class="webfetch-link-icon" />
              </a>
            </Show>
          </div>
        </div>
      }
    />
  )
}

// The body lists the result links, so a search that returned none has nothing to open.
export function WebSearchTool(props: ToolProps) {
  const i18n = useI18n()

  return (
    <BasicTool
      {...props}
      icon="window-cursor"
      hasContent={urls(props.output).length > 0}
      trigger={{
        title: i18n.t("ui.tool.searchWeb"),
        subtitle: toolInput(props.input).query ?? "",
        subtitleClass: "exa-tool-query",
      }}
    >
      <ExaOutput output={props.output} />
    </BasicTool>
  )
}
