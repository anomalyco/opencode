import { Component, createSignal, JSX, Show } from "solid-js"
import type { IconProps } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useClientEnv } from "@/context/client-env"
import { useLanguage } from "@/context/language"
import { ACCEPTED_FILE_TYPES } from "./files"
import { PromptDocPanel } from "./doc-panel"
import type { createPromptDoc } from "./doc"

type ShellProps = {
  doc: ReturnType<typeof createPromptDoc>
  submitIcon: IconProps["name"]
  submitLabel: string
  submitDisabled?: boolean
  tip: JSX.Element
  onExit: () => void | Promise<void>
  modes?: JSX.Element
  expand?: {
    expanded: boolean
    onExpand: () => void
    onCollapse: () => void
  }
  autoExpand?: {
    enabled: boolean
    onToggle: () => void
  }
  capture?: {
    active: boolean
    onCapture: () => void
  }
}

export const PromptDocShell: Component<ShellProps> = (props) => {
  const env = useClientEnv()
  const language = useLanguage()
  let fileInputRef: HTMLInputElement | undefined
  const [copied, setCopied] = createSignal(false)
  const history = () => props.doc.history
  const undo = () => props.doc.undo()
  const redo = () => props.doc.redo()
  const label = () => {
    const id = props.doc.docID()
    if (!id) return "—"
    return id.replace(/^doc_/, "").slice(0, 8)
  }
  const copy = async () => {
    const id = props.doc.docID()
    if (!id) return
    await navigator.clipboard.writeText(id)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  const expandLabel = () => {
    const expand = props.expand
    if (!expand) return ""
    return expand.expanded ? language.t("prompt.action.collapseView") : language.t("prompt.action.expandView")
  }

  return (
    <div
      data-component="prompt-doc-shell"
      class="flex min-h-0 w-full flex-1 flex-col overflow-hidden"
    >
      <div
        classList={{
          "relative min-h-0 w-full": true,
          "flex-1": true,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <PromptDocPanel doc={props.doc} />
        <Show when={!env.productionLayout()}>
          <div
            data-component="prompt-doc-id"
            class="absolute bottom-0 right-0 z-10 max-w-[40%] rounded-tl-[10px] text-text-weaker"
          >
            <Tooltip
              placement="top"
              value={copied() ? language.t("ui.message.copied") : language.t("ui.textField.copyToClipboard")}
            >
              <button
                type="button"
                class="flex max-w-full items-center justify-start rounded-tl-lg rounded-tr-none rounded-br-none rounded-bl-none bg-surface-raised-stronger-non-alpha px-2 py-1 font-mono text-11-regular leading-[13px] text-text-weaker shadow-sm ring-1 ring-border-weaker-base hover:ring-border-base"
                title={props.doc.docID() ?? ""}
                onClick={copy}
                aria-label={copied() ? language.t("ui.message.copied") : language.t("ui.textField.copyToClipboard")}
              >
                <span class="truncate">{label()}</span>
              </button>
            </Tooltip>
          </div>
        </Show>
      </div>
      <div
        data-component="prompt-doc-actions"
        class="relative flex h-11 shrink-0 items-center justify-between gap-2 border-t border-border-weaker-base bg-surface-raised-stronger-non-alpha px-2 py-0"
      >
        <div class="flex items-center gap-0.5">
          {props.modes}
          <Tooltip placement="top" value={language.t("prompt.action.docUndo")}>
            <IconButton
              data-action="prompt-doc-undo"
              type="button"
              icon="arrow-left"
              variant="ghost"
              class="size-7.5"
              disabled={!history().undo}
              onClick={undo}
              aria-label={language.t("prompt.action.docUndo")}
            />
          </Tooltip>
          <Tooltip placement="top" value={language.t("prompt.action.docRedo")}>
            <IconButton
              data-action="prompt-doc-redo"
              type="button"
              icon="arrow-right"
              variant="ghost"
              class="size-7.5"
              disabled={!history().redo}
              onClick={redo}
              aria-label={language.t("prompt.action.docRedo")}
            />
          </Tooltip>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPTED_FILE_TYPES.join(",")}
            hidden
            tabindex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const list = e.currentTarget.files
              if (list?.length) void props.doc.addFiles(Array.from(list))
              e.currentTarget.value = ""
            }}
          />
          <Tooltip placement="top" value={language.t("prompt.action.attachFile")}>
            <IconButton
              data-action="prompt-doc-attach"
              type="button"
              icon="plus"
              variant="ghost"
              class="size-7.5"
              disabled={!props.doc.ready()}
              onClick={() => fileInputRef?.click()}
              aria-label={language.t("prompt.action.attachFile")}
            />
          </Tooltip>
          <Show when={props.capture}>
            <Tooltip placement="top" value={language.t("prompt.action.captureTab")}>
              <IconButton
                data-action="prompt-doc-capture-tab"
                type="button"
                icon="photo"
                variant="ghost"
                class="size-7.5"
                disabled={!props.doc.ready() || props.capture!.active}
                onClick={() => props.capture!.onCapture()}
                aria-label={language.t("prompt.action.captureTab")}
              />
            </Tooltip>
          </Show>
          <Show when={props.expand && !env.productionLayout()}>
            <Tooltip placement="top" value={expandLabel()}>
              <IconButton
                data-action={props.expand!.expanded ? "composer-collapse" : "composer-expand"}
                type="button"
                variant="ghost"
                icon={props.expand!.expanded ? "collapse" : "expand"}
                class="size-7.5"
                aria-label={expandLabel()}
                aria-expanded={props.expand!.expanded}
                onClick={() =>
                  props.expand!.expanded ? props.expand!.onCollapse() : props.expand!.onExpand()
                }
              />
            </Tooltip>
          </Show>
          <Show when={props.autoExpand}>
            <span class="mx-1 h-4 w-px shrink-0 bg-border-weaker-base" />
            <Tooltip placement="top" value={language.t("prompt.action.docAutoExpandHint")}>
              <button
                type="button"
                data-action="prompt-doc-auto-expand"
                role="switch"
                aria-checked={props.autoExpand!.enabled}
                aria-label={language.t("prompt.action.docAutoExpand")}
                class="oc-auto-toggle"
                // 토글은 메타 컨트롤이라 포커스를 가져가면 안 된다. 클릭 시 포커스가 옮겨지면
                // focusWithin 이 켜져 자동 확대 효과가 발동(확대됐다가 곧 축소)하므로 mousedown 의
                // 기본 포커스 이동을 막는다. (키보드 Tab 포커스는 영향 없음)
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => props.autoExpand!.onToggle()}
              >
                <span class="oc-auto-track" classList={{ "is-on": props.autoExpand!.enabled }}>
                  <span class="oc-auto-thumb" />
                </span>
                <span class="oc-auto-label">{language.t("prompt.action.docAutoExpand")}</span>
              </button>
            </Tooltip>
          </Show>
        </div>
        <Tooltip
          placement="top"
          inactive={props.submitIcon === "arrow-up-bold" && !props.submitDisabled}
          value={props.tip}
        >
          <IconButton
            data-action="prompt-submit"
            type="submit"
            icon={props.submitIcon}
            variant="primary"
            class="size-7.5"
            disabled={props.submitDisabled}
            aria-label={props.submitLabel}
          />
        </Tooltip>
      </div>
    </div>
  )
}
