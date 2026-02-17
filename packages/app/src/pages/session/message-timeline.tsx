import { For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { SessionTurn } from "@opencode-ai/ui/session-turn"
import type { UserMessage } from "@opencode-ai/sdk/v2"
import { shouldMarkBoundaryGesture, normalizeWheelDelta } from "@/pages/session/message-gesture"
import { SessionContextUsage } from "@/components/session-context-usage"

const boundaryTarget = (root: HTMLElement, target: EventTarget | null) => {
  const current = target instanceof Element ? target : undefined
  const nested = current?.closest("[data-scrollable]")
  if (!nested || nested === root) return root
  if (!(nested instanceof HTMLElement)) return root
  return nested
}

const markBoundaryGesture = (input: {
  root: HTMLDivElement
  target: EventTarget | null
  delta: number
  onMarkScrollGesture: (target?: EventTarget | null) => void
}) => {
  const target = boundaryTarget(input.root, input.target)
  if (target === input.root) {
    input.onMarkScrollGesture(input.root)
    return
  }
  if (
    shouldMarkBoundaryGesture({
      delta: input.delta,
      scrollTop: target.scrollTop,
      scrollHeight: target.scrollHeight,
      clientHeight: target.clientHeight,
    })
  ) {
    input.onMarkScrollGesture(input.root)
  }
}

export function MessageTimeline(props: {
  mobileChanges: boolean
  mobileFallback: JSX.Element
  scroll: { overflow: boolean; bottom: boolean }
  onResumeScroll: () => void
  setScrollRef: (el: HTMLDivElement | undefined) => void
  onScheduleScrollState: (el: HTMLDivElement) => void
  onAutoScrollHandleScroll: () => void
  onMarkScrollGesture: (target?: EventTarget | null) => void
  hasScrollGesture: () => boolean
  isDesktop: boolean
  onScrollSpyScroll: () => void
  onAutoScrollInteraction: (event: MouseEvent) => void
  showHeader: boolean
  centered: boolean
  title?: string
  parentID?: string
  openTitleEditor: () => void
  closeTitleEditor: () => void
  saveTitleEditor: () => void | Promise<void>
  titleRef: (el: HTMLInputElement) => void
  titleState: {
    draft: string
    editing: boolean
    saving: boolean
    menuOpen: boolean
    pendingRename: boolean
  }
  onTitleDraft: (value: string) => void
  onTitleMenuOpen: (open: boolean) => void
  onTitlePendingRename: (value: boolean) => void
  onNavigateParent: () => void
  sessionID: string
  onArchiveSession: (sessionID: string) => void
  onDeleteSession: (sessionID: string) => void
  t: (key: string, vars?: Record<string, string | number | boolean>) => string
  setContentRef: (el: HTMLDivElement) => void
  turnStart: number
  onRenderEarlier: () => void
  historyMore: boolean
  historyLoading: boolean
  onLoadEarlier: () => void
  renderedUserMessages: UserMessage[]
  anchor: (id: string) => string
  onRegisterMessage: (el: HTMLDivElement, id: string) => void
  onUnregisterMessage: (id: string) => void
  onFirstTurnMount?: () => void
  lastUserMessageID?: string
}) {
  let touchGesture: number | undefined

  return (
    <Show
      when={!props.mobileChanges}
      fallback={<div class="relative h-full overflow-hidden">{props.mobileFallback}</div>}
    >
      <div class="relative w-full h-full min-w-0">
        <div
          class="absolute left-1/2 -translate-x-1/2 bottom-6 z-[60] pointer-events-none transition-all duration-200 ease-out"
          classList={{
            "opacity-100 translate-y-0 scale-100": props.scroll.overflow && !props.scroll.bottom,
            "opacity-0 translate-y-2 scale-95 pointer-events-none": !props.scroll.overflow || props.scroll.bottom,
          }}
        >
          <button
            class="pointer-events-auto size-8 flex items-center justify-center rounded-full bg-background-base border border-border-base shadow-sm text-text-base hover:bg-background-stronger transition-colors"
            onClick={props.onResumeScroll}
          >
            <Icon name="arrow-down-to-line" />
          </button>
        </div>
        <div
          ref={props.setScrollRef}
          onWheel={(e) => {
            const root = e.currentTarget
            const delta = normalizeWheelDelta({
              deltaY: e.deltaY,
              deltaMode: e.deltaMode,
              rootHeight: root.clientHeight,
            })
            if (!delta) return
            markBoundaryGesture({ root, target: e.target, delta, onMarkScrollGesture: props.onMarkScrollGesture })
          }}
          onTouchStart={(e) => {
            touchGesture = e.touches[0]?.clientY
          }}
          onTouchMove={(e) => {
            const next = e.touches[0]?.clientY
            const prev = touchGesture
            touchGesture = next
            if (next === undefined || prev === undefined) return

            const delta = prev - next
            if (!delta) return

            const root = e.currentTarget
            markBoundaryGesture({ root, target: e.target, delta, onMarkScrollGesture: props.onMarkScrollGesture })
          }}
          onTouchEnd={() => {
            touchGesture = undefined
          }}
          onTouchCancel={() => {
            touchGesture = undefined
          }}
          onPointerDown={(e) => {
            if (e.target !== e.currentTarget) return
            props.onMarkScrollGesture(e.currentTarget)
          }}
          onScroll={(e) => {
            props.onScheduleScrollState(e.currentTarget)
            if (!props.hasScrollGesture()) return
            props.onAutoScrollHandleScroll()
            props.onMarkScrollGesture(e.currentTarget)
            if (props.isDesktop) props.onScrollSpyScroll()
          }}
          onClick={props.onAutoScrollInteraction}
          class="relative min-w-0 w-full h-full overflow-y-auto session-scroller"
          style={{ "--session-title-height": props.showHeader ? "40px" : "0px" }}
        >
          <Show when={props.showHeader}>
            <div
              classList={{
                "sticky top-0 z-30 bg-[linear-gradient(to_bottom,var(--background-stronger)_48px,transparent)]": true,
                "w-full": true,
                "pb-4": true,
                "pl-2 pr-3 md:pl-4 md:pr-3": true,
                "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": props.centered,
              }}
            >
              <div class="h-12 w-full flex items-center justify-between gap-2">
                <div class="flex items-center gap-1 min-w-0 flex-1 pr-3">
                  <Show when={props.parentID}>
                    <IconButton
                      tabIndex={-1}
                      icon="arrow-left"
                      variant="ghost"
                      onClick={props.onNavigateParent}
                      aria-label={props.t("common.goBack")}
                    />
                  </Show>
                  <Show when={props.title || props.titleState.editing}>
                    <Show
                      when={props.titleState.editing}
                      fallback={
                        <h1
                          class="text-14-medium text-text-strong truncate grow-1 min-w-0 pl-2"
                          onDblClick={props.openTitleEditor}
                        >
                          {props.title}
                        </h1>
                      }
                    >
                      <InlineInput
                        ref={props.titleRef}
                        value={props.titleState.draft}
                        disabled={props.titleState.saving}
                        class="text-14-medium text-text-strong grow-1 min-w-0 pl-2 rounded-[6px]"
                        style={{ "--inline-input-shadow": "var(--shadow-xs-border-select)" }}
                        onInput={(event) => props.onTitleDraft(event.currentTarget.value)}
                        onKeyDown={(event) => {
                          event.stopPropagation()
                          if (event.key === "Enter") {
                            event.preventDefault()
                            void props.saveTitleEditor()
                            return
                          }
                          if (event.key === "Escape") {
                            event.preventDefault()
                            props.closeTitleEditor()
                          }
                        }}
                        onBlur={props.closeTitleEditor}
                      />
                    </Show>
                  </Show>
                </div>
                <Show when={props.sessionID}>
                  {(id) => (
                    <div class="shrink-0 flex items-center gap-3">
                      <SessionContextUsage placement="bottom" />
                      <DropdownMenu
                        gutter={4}
                        placement="bottom-end"
                        open={props.titleState.menuOpen}
                        onOpenChange={props.onTitleMenuOpen}
                      >
                        <DropdownMenu.Trigger
                          as={IconButton}
                          icon="dot-grid"
                          variant="ghost"
                          class="size-6 rounded-md data-[expanded]:bg-surface-base-active"
                          aria-label={props.t("common.moreOptions")}
                        />
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content
                            style={{ "min-width": "104px" }}
                            onCloseAutoFocus={(event) => {
                              if (!props.titleState.pendingRename) return
                              event.preventDefault()
                              props.onTitlePendingRename(false)
                              props.openTitleEditor()
                            }}
                          >
                            <DropdownMenu.Item
                              onSelect={() => {
                                props.onTitlePendingRename(true)
                                props.onTitleMenuOpen(false)
                              }}
                            >
                              <DropdownMenu.ItemLabel>{props.t("common.rename")}</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                            <DropdownMenu.Item onSelect={() => props.onArchiveSession(id())}>
                              <DropdownMenu.ItemLabel>{props.t("common.archive")}</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                            <DropdownMenu.Separator />
                            <DropdownMenu.Item onSelect={() => props.onDeleteSession(id())}>
                              <DropdownMenu.ItemLabel>{props.t("common.delete")}</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu>
                    </div>
                  )}
                </Show>
              </div>
            </div>
          </Show>

          <div
            ref={props.setContentRef}
            role="log"
            class="flex flex-col gap-12 items-start justify-start pb-16 transition-[margin]"
            classList={{
              "w-full": true,
              "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": props.centered,
              "mt-0.5": props.centered,
              "mt-0": !props.centered,
            }}
          >
            <Show when={props.turnStart > 0}>
              <div class="w-full flex justify-center">
                <Button variant="ghost" size="large" class="text-12-medium opacity-50" onClick={props.onRenderEarlier}>
                  {props.t("session.messages.renderEarlier")}
                </Button>
              </div>
            </Show>
            <Show when={props.historyMore}>
              <div class="w-full flex justify-center">
                <Button
                  variant="ghost"
                  size="large"
                  class="text-12-medium opacity-50"
                  disabled={props.historyLoading}
                  onClick={props.onLoadEarlier}
                >
                  {props.historyLoading
                    ? props.t("session.messages.loadingEarlier")
                    : props.t("session.messages.loadEarlier")}
                </Button>
              </div>
            </Show>
            <For each={props.renderedUserMessages}>
              {(message) => {
                if (import.meta.env.DEV && props.onFirstTurnMount) {
                  onMount(() => props.onFirstTurnMount?.())
                }

                return (
                  <div
                    id={props.anchor(message.id)}
                    data-message-id={message.id}
                    ref={(el) => {
                      props.onRegisterMessage(el, message.id)
                      onCleanup(() => props.onUnregisterMessage(message.id))
                    }}
                    classList={{
                      "min-w-0 w-full max-w-full": true,
                      "md:max-w-200 2xl:max-w-[1000px]": props.centered,
                    }}
                  >
                    <SessionTurn
                      sessionID={props.sessionID}
                      messageID={message.id}
                      lastUserMessageID={props.lastUserMessageID}
                      classes={{
                        root: "min-w-0 w-full relative",
                        content: "flex flex-col justify-between !overflow-visible",
                        container: "w-full px-4 md:px-6",
                      }}
                    />
                  </div>
                )
              }}
            </For>
          </div>
        </div>
      </div>
    </Show>
  )
}
