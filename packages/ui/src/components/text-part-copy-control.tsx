import { Show, createSignal } from "solid-js"
import { useI18n } from "../context/i18n"
import type { MarkdownCopyMode } from "./markdown-copy"
import { copyMarkdownElement } from "../lib/clipboard/markdown"
import { DropdownMenu } from "./dropdown-menu"
import { IconButton } from "./icon-button"
import { Tooltip } from "./tooltip"

export function TextPartCopyControl(props: {
  root: HTMLDivElement | undefined
  displayText: () => string
  interrupted: boolean
  copyMode: MarkdownCopyMode
  meta: string
}) {
  const i18n = useI18n()
  const [copied, setCopied] = createSignal(false)

  const copyLabel = () =>
    props.copyMode === "rich" ? i18n.t("ui.message.copyResponseRich") : i18n.t("ui.message.copyResponse")

  const copy = async (mode: "plain" | "rich") => {
    const text = props.displayText()
    if (!text) return

    if (mode === "rich") {
      await copyMarkdownElement(props.root?.querySelector('[data-slot="text-part-body"]') ?? props.root, text)
    }
    if (mode === "plain") await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div data-slot="text-part-copy-wrapper" data-interrupted={props.interrupted ? "" : undefined}>
      <Show when={props.copyMode !== "ask"}>
        <Tooltip value={copied() ? i18n.t("ui.message.copied") : copyLabel()} placement="top" gutter={4}>
          <IconButton
            icon={copied() ? "check" : "copy"}
            size="normal"
            variant="ghost"
            onMouseDown={(e: MouseEvent) => e.preventDefault()}
            onClick={() => void copy(props.copyMode === "rich" ? "rich" : "plain")}
            aria-label={copied() ? i18n.t("ui.message.copied") : copyLabel()}
          />
        </Tooltip>
      </Show>

      <Show when={props.copyMode === "ask"}>
        <DropdownMenu gutter={4} placement="bottom-start">
          <Tooltip value={i18n.t("ui.message.copyOptions")} placement="top" gutter={4}>
            <DropdownMenu.Trigger
              as={IconButton}
              icon="copy"
              size="normal"
              variant="ghost"
              onMouseDown={(e: MouseEvent) => e.preventDefault()}
              aria-label={i18n.t("ui.message.copyOptions")}
            />
          </Tooltip>
          <DropdownMenu.Portal>
            <DropdownMenu.Content>
              <DropdownMenu.Item onSelect={() => void copy("plain")}>
                <DropdownMenu.ItemLabel>{i18n.t("ui.message.copyResponsePlain")}</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => void copy("rich")}>
                <DropdownMenu.ItemLabel>{i18n.t("ui.message.copyResponseRich")}</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </Show>

      <Show when={props.meta}>
        <span data-slot="text-part-meta" class="text-12-regular text-text-weak cursor-default">
          {props.meta}
        </span>
      </Show>
    </div>
  )
}
