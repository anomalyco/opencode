import { For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { SessionTurn } from "@opencode-ai/ui/session-turn"
import type { UserMessage } from "@opencode-ai/sdk/v2"
import { shouldMarkBoundaryGesture, normalizeWheelDelta } from "@/pages/session/message-gesture"

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
  expanded: Record<string, boolean>
  onToggleExpanded: (id: string) => void
}) {
  let touchGesture: number | undefined

  return (
    <Show
      when={!props.mobileChanges}
      fallback={<div class="relative h-full overflow-hidden">{props.mobileFallback}</div>}
    >
      <div class="relative w-full h-full min-w-0">
        <div
          class="absolute left-1/2 -translate-x-1/2 bottom-[calc(var(--prompt-height,8rem)+32px)] z-[60] pointer-events-none transition-all duration-200 ease-out"
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
            const target = e.target instanceof Element ? e.target : undefined
            const nested = target?.closest("[data-scrollable]")
            if (!nested || nested === root) {
              props.onMarkScrollGesture(root)
              return
            }

            if (!(nested instanceof HTMLElement)) {
              props.onMarkScrollGesture(root)
              return
            }

            const delta = normalizeWheelDelta({
              deltaY: e.deltaY,
              deltaMode: e.deltaMode,
              rootHeight: root.clientHeight,
            })
            if (!delta) return

            if (
              shouldMarkBoundaryGesture({
                delta,
                scrollTop: nested.scrollTop,
                scrollHeight: nested.scrollHeight,
                clientHeight: nested.clientHeight,
              })
            ) {
              props.onMarkScrollGesture(root)
            }
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
            const target = e.target instanceof Element ? e.target : undefined
            const nested = target?.closest("[data-scrollable]")
            if (!nested || nested === root) {
              props.onMarkScrollGesture(root)
              return
            }

            if (!(nested instanceof HTMLElement)) {
              props.onMarkScrollGesture(root)
              return
            }

            if (
              shouldMarkBoundaryGesture({
                delta,
                scrollTop: nested.scrollTop,
                scrollHeight: nested.scrollHeight,
                clientHeight: nested.clientHeight,
              })
            ) {
              props.onMarkScrollGesture(root)
            }
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
                "sticky top-0 z-30 bg-background-stronger": true,
                "w-full": true,
                "px-4 md:px-6": true,
                "md:max-w-200 md:mx-auto 3xl:max-w-[1200px]": props.centered,
              }}
            >
              <div class="h-10 w-full flex items-center justify-between gap-2">
                <div class="flex items-center gap-1 min-w-0 flex-1">
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
                        <h1 class="text-16-medium text-text-strong truncate min-w-0" onDblClick={props.openTitleEditor}>
                          {props.title}
                        </h1>
                      }
                    >
                      <InlineInput
                        ref={props.titleRef}
                        value={props.titleState.draft}
                        disabled={props.titleState.saving}
                        class="text-16-medium text-text-strong grow-1 min-w-0"
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
                    <div class="shrink-0 flex items-center">
                      <DropdownMenu open={props.titleState.menuOpen} onOpenChange={props.onTitleMenuOpen}>
                        <Tooltip value={props.t("common.moreOptions")} placement="top">
                          <DropdownMenu.Trigger
                            as={IconButton}
                            icon="dot-grid"
                            variant="ghost"
                            class="size-6 rounded-md data-[expanded]:bg-surface-base-active"
                            aria-label={props.t("common.moreOptions")}
                          />
                        </Tooltip>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content
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
            class="flex flex-col gap-12 items-start justify-start pb-[calc(var(--prompt-height,8rem)+64px)] md:pb-[calc(var(--prompt-height,10rem)+64px)] transition-[margin]"
            classList={{
              "w-full": true,
              "md:max-w-200 md:mx-auto 3xl:max-w-[1200px]": props.centered,
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
                      "md:max-w-200 3xl:max-w-[1200px]": props.centered,
                    }}
                  >
                    <SessionTurn
                      sessionID={props.sessionID}
                      messageID={message.id}
                      lastUserMessageID={props.lastUserMessageID}
                      stepsExpanded={props.expanded[message.id] ?? false}
                      onStepsExpandedToggle={() => props.onToggleExpanded(message.id)}
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
