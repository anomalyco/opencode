import { For, Show, createEffect, createSignal, onCleanup, type JSX } from "solid-js"
import type { QuestionRequest } from "@opencode-ai/sdk/v2"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { BasicTool } from "@opencode-ai/ui/basic-tool"
import { PromptInput } from "@/components/prompt-input"
import { QuestionDock } from "@/components/question-dock"
import { questionSubtitle } from "@/pages/session/session-prompt-helpers"

interface CompactPromptDockProps {
  title?: string
  onToggle: () => void
  t: (key: string, vars?: Record<string, string | number | boolean>) => string
  questionRequest: () => QuestionRequest | undefined
  permissionRequest: () => { patterns: string[]; permission: string } | undefined
  blocked: boolean
  promptReady: boolean
  handoffPrompt?: string
  responding: boolean
  onDecide: (response: "once" | "always" | "reject") => void
  inputRef: (el: HTMLDivElement) => void
  newSessionWorktree: string
  onNewSessionWorktreeReset: () => void
  onSubmit: () => void
  setPromptDockRef: (el: HTMLDivElement) => void
  messages?: JSX.Element
}

export function CompactPromptDock(props: CompactPromptDockProps) {
  const [expanded, setExpanded] = createSignal(false)
  let messagesRef!: HTMLDivElement

  const scrollToBottom = () => {
    if (messagesRef) messagesRef.scrollTop = messagesRef.scrollHeight
  }

  // Auto-scroll on expand and when content changes
  createEffect(() => {
    if (!expanded()) return
    // Scroll to bottom when expanded opens
    requestAnimationFrame(scrollToBottom)

    // Watch for new content (messages rendering)
    const observer = new MutationObserver(scrollToBottom)
    if (messagesRef) observer.observe(messagesRef, { childList: true, subtree: true })
    onCleanup(() => observer.disconnect())
  })

  return (
    <div class="flex flex-col items-center w-full max-w-3xl">
      {/* Header tab — peeks out above the dock */}
      <div class="relative z-10 flex items-center justify-between gap-2 px-3 py-1 mb-[-1px] w-19/20 rounded-t-[14px] bg-background-stronger border border-b-0 border-border-base">
        <div class="text-12-regular text-text-weak truncate">{props.title || props.t("session.title")}</div>
        <div class="flex items-center gap-0.5">
          <Tooltip value={expanded() ? props.t("common.collapse") : props.t("common.expand")}>
            <IconButton
              variant="ghost"
              size="small"
              icon={expanded() ? "collapse" : "expand"}
              onClick={() => setExpanded(!expanded())}
            />
          </Tooltip>
          <Tooltip value={props.t("session.showMessages")}>
            <IconButton variant="ghost" size="small" icon="layout-right" onClick={props.onToggle} />
          </Tooltip>
        </div>
      </div>

      {/* Dock container */}
      <div
        ref={props.setPromptDockRef}
        classList={{
          "w-full overflow-hidden transition-all duration-200 rounded-[14px] border border-border-base bg-background-stronger": true,
          "max-h-[70vh]": expanded(),
          "max-h-48": !expanded(),
        }}
      >
        {/* Expandable content area for messages */}
        <Show when={expanded() && props.messages}>
          <div ref={messagesRef} class="border-b border-border-base bg-background-base/50 overflow-y-auto max-h-[30vh]">
            {props.messages}
          </div>
        </Show>

        {/* Prompt content */}
        <div>
          <Show when={props.questionRequest()} keyed>
            {(req) => {
              const subtitle = questionSubtitle(req.questions.length, (key) => props.t(key))
              return (
                <div data-component="tool-part-wrapper" data-question="true" class="mb-3">
                  <BasicTool
                    icon="bubble-5"
                    locked
                    defaultOpen
                    trigger={{
                      title: props.t("ui.tool.questions"),
                      subtitle,
                    }}
                  />
                  <QuestionDock request={req} />
                </div>
              )
            }}
          </Show>

          <Show when={props.permissionRequest()} keyed>
            {(perm) => (
              <div data-component="tool-part-wrapper" data-permission="true" class="mb-3">
                <BasicTool
                  icon="checklist"
                  locked
                  defaultOpen
                  trigger={{
                    title: props.t("notification.permission.title"),
                    subtitle:
                      perm.permission === "doom_loop"
                        ? props.t("settings.permissions.tool.doom_loop.title")
                        : perm.permission,
                  }}
                >
                  <Show when={perm.patterns.length > 0}>
                    <div class="flex flex-col gap-1 py-2 px-3 max-h-40 overflow-y-auto no-scrollbar">
                      <For each={perm.patterns}>
                        {(pattern) => <code class="text-12-regular text-text-base break-all">{pattern}</code>}
                      </For>
                    </div>
                  </Show>
                  <Show when={perm.permission === "doom_loop"}>
                    <div class="text-12-regular text-text-weak pb-2 px-3">
                      {props.t("settings.permissions.tool.doom_loop.description")}
                    </div>
                  </Show>
                </BasicTool>
                <div data-component="permission-prompt">
                  <div data-slot="permission-actions">
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={() => props.onDecide("reject")}
                      disabled={props.responding}
                    >
                      {props.t("ui.permission.deny")}
                    </Button>
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={() => props.onDecide("always")}
                      disabled={props.responding}
                    >
                      {props.t("ui.permission.allowAlways")}
                    </Button>
                    <Button
                      variant="primary"
                      size="small"
                      onClick={() => props.onDecide("once")}
                      disabled={props.responding}
                    >
                      {props.t("ui.permission.allowOnce")}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </Show>

          <Show when={!props.blocked}>
            <Show
              when={props.promptReady}
              fallback={
                <div class="w-full min-h-16 border border-border-weak-base bg-background-base/50 px-4 py-3 text-text-weak whitespace-pre-wrap">
                  {props.handoffPrompt || props.t("prompt.loading")}
                </div>
              }
            >
              <PromptInput
                ref={props.inputRef}
                newSessionWorktree={props.newSessionWorktree}
                onNewSessionWorktreeReset={props.onNewSessionWorktreeReset}
                onSubmit={props.onSubmit}
              />
            </Show>
          </Show>
        </div>
      </div>
    </div>
  )
}
