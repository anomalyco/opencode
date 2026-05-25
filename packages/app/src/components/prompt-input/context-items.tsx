import { Component, For, Show } from "solid-js"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { getDirectory, getFilename, getFilenameTruncated } from "@opencode-ai/core/util/path"
import type { ContextItem } from "@/context/prompt"

type PromptContextItem = ContextItem & { key: string }

type ContextItemsProps = {
  items: PromptContextItem[]
  active: (item: PromptContextItem) => boolean
  openComment: (item: PromptContextItem) => void
  remove: (item: PromptContextItem) => void
  t: (key: string) => string
}

export const PromptContextItems: Component<ContextItemsProps> = (props) => {
  return (
    <Show when={props.items.length > 0}>
      {/* FORK: 卡片多了从横向滚改为自动换行,max-h 兜底防止挤压聊天区
            (3 行卡片高度 = 3×48 + 2×8 gap + 2×8 padding ≈ 180px)
            [feat: 聊天选区-卡片化-换行] 2026-05-25 */}
      <div class="flex flex-wrap items-start gap-2 p-2 max-h-[180px] overflow-y-auto">
        <For each={props.items}>
          {(item) => {
            // FORK: chat 选区卡片 — kind="chat" 显示聊天气泡图标 + "聊天引用"标签;
            //       file 卡片(默认/原有)显示 FileIcon + 文件名 + 行号。
            // [feat: 聊天选区-卡片化-换行] 2026-05-25
            const isChatQuote = item.kind === "chat"
            const directory = getDirectory(item.path)
            const filename = getFilename(item.path)
            const label = isChatQuote
              ? props.t("prompt.context.chatQuoteLabel")
              : getFilenameTruncated(item.path, 14)
            const selected = props.active(item)
            const tooltipValue = isChatQuote
              ? (
                <span class="flex max-w-[320px] whitespace-pre-wrap break-words">
                  {item.preview ?? ""}
                </span>
              )
              : (
                <span class="flex max-w-[300px]">
                  <span class="text-text-invert-base truncate-start [unicode-bidi:plaintext] min-w-0">
                    {directory}
                  </span>
                  <span class="shrink-0">{filename}</span>
                </span>
              )

            return (
              <Tooltip value={tooltipValue} placement="top" openDelay={isChatQuote ? 400 : 2000}>
                <div
                  classList={{
                    "group shrink-0 flex flex-col rounded-[6px] pl-2 pr-1 py-1 max-w-[200px] h-12 cursor-default transition-all transition-transform shadow-xs-border hover:shadow-xs-border-hover": true,
                    "hover:bg-surface-interactive-weak": !!item.commentID && !selected,
                    "bg-surface-interactive-hover hover:bg-surface-interactive-hover shadow-xs-border-hover": selected,
                    "bg-background-stronger": !selected,
                  }}
                  onClick={() => props.openComment(item)}
                >
                  <div class="flex items-center gap-1.5">
                    <Show
                      when={isChatQuote}
                      fallback={
                        <FileIcon node={{ path: item.path, type: "file" }} class="shrink-0 size-3.5" />
                      }
                    >
                      <Icon name="bubble-5" class="shrink-0 size-3.5 text-text-weak" />
                    </Show>
                    <div class="flex items-center text-11-regular min-w-0 font-medium">
                      <span class="text-text-strong whitespace-nowrap">{label}</span>
                      <Show when={!isChatQuote && item.selection}>
                        {(sel) => (
                          <span class="text-text-weak whitespace-nowrap shrink-0">
                            {sel().startLine === sel().endLine
                              ? `:${sel().startLine}`
                              : `:${sel().startLine}-${sel().endLine}`}
                          </span>
                        )}
                      </Show>
                    </div>
                    <IconButton
                      type="button"
                      icon="close-small"
                      variant="ghost"
                      class="ml-auto size-3.5 text-text-weak hover:text-text-strong transition-all"
                      onClick={(e) => {
                        e.stopPropagation()
                        props.remove(item)
                      }}
                      aria-label={props.t(isChatQuote ? "prompt.context.removeChatQuote" : "prompt.context.removeFile")}
                    />
                  </div>
                  <Show when={item.comment}>
                    {(comment) => <div class="text-12-regular text-text-strong ml-5 pr-1 truncate">{comment()}</div>}
                  </Show>
                </div>
              </Tooltip>
            )
          }}
        </For>
      </div>
    </Show>
  )
}
