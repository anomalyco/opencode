import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { Markdown } from "@opencode-ai/ui/markdown"
import { createEffect, createMemo, For, onCleanup, Show } from "solid-js"
import { render } from "./helpers"

type Props = {
  list: Message[]
  parts: Record<string, Part[] | undefined> | undefined
  busy: boolean
}

const BOTTOM_GAP = 8

function isAtBottom(node: HTMLDivElement) {
  return node.scrollHeight - node.scrollTop - node.clientHeight <= BOTTOM_GAP
}

export function QuickAssistantMessages(props: Props) {
  let viewport: HTMLDivElement | undefined
  let followBottom = true
  let frame: number | undefined

  const scrollKey = createMemo(() =>
    props.list
      .map((item) => {
        const text = render(props.parts?.[item.id])
        const completed = "completed" in item.time ? (item.time.completed ?? "") : ""
        return `${item.id}:${item.role}:${text.length}:${completed}`
      })
      .join("|"),
  )

  const scheduleBottomFollow = () => {
    if (!followBottom) return
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        frame = undefined
        if (!followBottom || !viewport) return
        viewport.scrollTop = viewport.scrollHeight
      })
    })
  }

  createEffect(() => {
    if (props.list.length === 0) followBottom = true
    scrollKey()
    props.busy
    scheduleBottomFollow()
  })

  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
  })

  return (
    <Show when={props.list.length > 0}>
      <div
        ref={(node) => {
          viewport = node
          scheduleBottomFollow()
        }}
        class="max-h-[48vh] overflow-y-auto border-b border-border-weak-base bg-background-base/20 px-4 py-4"
        onScroll={(event) => {
          followBottom = isAtBottom(event.currentTarget)
        }}
      >
        <div class="flex flex-col gap-3">
          <For each={props.list}>
            {(item) => {
              const text = createMemo(() => render(props.parts?.[item.id]))
              return (
                <div
                  data-component="quick-assistant-message"
                  data-role={item.role}
                  classList={{
                    "px-3.5 py-3": true,
                    "ml-10 rounded-[18px] border border-border-weak-base bg-surface-panel": item.role === "user",
                    "mr-10 rounded-[20px] border border-border-weaker-base bg-background-stronger":
                      item.role === "assistant",
                  }}
                >
                  <Show
                    when={item.role === "assistant"}
                    fallback={
                      <div class="whitespace-pre-wrap break-words text-[15px] leading-7 text-text-strong">
                        {text()}
                      </div>
                    }
                  >
                    <div class="quick-assistant-markdown text-[15px] leading-7 text-text-base">
                      <Markdown text={text() || (props.busy ? "Thinking..." : "")} math="defer" />
                    </div>
                  </Show>
                </div>
              )
            }}
          </For>
        </div>
      </div>
    </Show>
  )
}
