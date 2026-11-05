import { createComputed, createEffect, createSignal, onCleanup, Show, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { Popover } from "@kobalte/core/popover"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Icon } from "@opencode/ui/icon"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import { Typeahead } from "@opencode/ui/typeahead"
import { useLanguage } from "@/runtime/i18n/language"
import { useCommand } from "@/shell/commands/command"
import {
  BRANCH_PRELOAD_TIMEOUT_MS,
  INITIAL_BRANCH_PICKER_STATE,
  selectBranchBusy,
  selectBranchInitial,
  selectBranchPending,
  selectBranchPopoverOpen,
  transitionBranchPicker,
  type BranchPickerEffect,
  type BranchPickerEvent,
} from "./branch-machine"
import type { NewSessionWorkspaceController } from "./controller"

export function NewSessionBranch(props: { workspace: NewSessionWorkspaceController; onDone: () => void }) {
  const language = useLanguage()

  const command = useCommand()

  const [layout, setLayout] = createStore({ truncated: false })

  const [picker, setPicker] = createSignal(INITIAL_BRANCH_PICKER_STATE)

  const requests = new Map<number, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>()

  let trigger: HTMLButtonElement | undefined

  const creating = () => props.workspace.selection.value() === "create"

  const dispatch = (event: BranchPickerEvent) =>
    untrack(() => {
      const next = transitionBranchPicker(picker(), event)
      setPicker(next.state)
      next.effects.forEach(run)
    })

  const run = (effect: BranchPickerEffect) => {
    if (effect.type === "focus.composer") return props.onDone()

    if (effect.type === "branch.choose") return props.workspace.selection.branch(effect.branch)

    if (effect.type === "branches.abort") {
      const request = requests.get(effect.attempt)
      requests.delete(effect.attempt)
      clearTimeout(request?.timer)
      request?.controller.abort()

      return
    }

    const attempt = effect.attempt
    const controller = new AbortController()
    const timer = setTimeout(() => dispatch({ type: "branches.timed-out", attempt }), BRANCH_PRELOAD_TIMEOUT_MS)
    requests.set(attempt, { controller, timer })
    props.workspace.branches("", controller.signal).then(
      (items) => settle(attempt, controller, { type: "branches.loaded", attempt, items }),
      () => settle(attempt, controller, { type: "branches.failed", attempt }),
    )
  }

  const settle = (attempt: number, controller: AbortController, event: BranchPickerEvent) => {
    if (controller.signal.aborted) return
    clearTimeout(requests.get(attempt)?.timer)
    requests.delete(attempt)
    dispatch(event)
  }

  // Branches load before the picker opens, so it never shows a smaller loading panel.
  createComputed(() =>
    dispatch({ type: "target.changed", directory: creating() ? props.workspace.project.root() : undefined }),
  )

  onCleanup(() => dispatch({ type: "disposed" }))

  command.register("new-session-branch", () => [
    {
      id: "session.branch.choose",
      title: language.t("command.session.branch.choose"),
      titleKey: "command.session.branch.choose",
      category: language.t("command.category.workspace"),
      keybind: "mod+alt+b",
      disabled: !creating() || !props.workspace.bar.branch(),
      onSelect: (source) => dispatch({ type: "command.select", source }),
    },
  ])

  // Until content mounts, Kobalte has no dismissable layer to cancel a pending open.
  createEffect(() => {
    if (!selectBranchPending(picker())) return

    const close = (event: Event) => {
      if (event.target instanceof Node && trigger?.contains(event.target)) return
      dispatch({ type: "pending.dismiss" })
    }

    makeEventListener(document, "pointerdown", close, { capture: true })
    makeEventListener(document, "focusin", close)
    makeEventListener(window, "blur", close)
    makeEventListener(
      window,
      "keydown",
      (event) => {
        if (event.key === "Escape") dispatch({ type: "pending.dismiss" })
      },
      { capture: true },
    )
  })

  const label = () =>
    creating()
      ? language.t("session.new.workspace.fromBranch", { branch: props.workspace.bar.branch() ?? "" })
      : props.workspace.bar.branch()

  const observe = (element: HTMLSpanElement) =>
    createResizeObserver(element, () => setLayout("truncated", element.scrollWidth > element.clientWidth))

  return (
    <Show when={props.workspace.bar.branch()}>
      <Tooltip
        placement="top"
        openDelay={creating() ? 800 : 400}
        value={
          <Show when={creating()} fallback={label()}>
            <div class="flex flex-col gap-1">
              <span class="flex items-center gap-2">
                {language.t("command.session.branch.choose")}
                <Show when={command.keybindParts("session.branch.choose").length}>
                  <Keybind keys={command.keybindParts("session.branch.choose")} variant="neutral" />
                </Show>
              </span>
              <Show when={layout.truncated}>{label()}</Show>
            </div>
          </Show>
        }
        disabled={!creating() && !layout.truncated}
        class="flex min-w-0 max-w-[220px]"
        contentClass="max-w-[calc(100vw-32px)] break-all"
      >
        <Show
          when={creating()}
          fallback={
            <div class="flex h-7 min-w-0 max-w-[220px] items-center gap-1.5 ps-1.5 pe-2 text-v2-text-text-faint">
              <Icon name="branch" size="normal" class="shrink-0 text-v2-icon-icon-muted" />
              <span ref={observe} dir="auto" class="min-w-0 truncate">
                {label()}
              </span>
            </div>
          }
        >
          <Popover
            open={selectBranchPopoverOpen(picker())}
            onOpenChange={(open) => dispatch({ type: "open.change", open })}
            placement="bottom-start"
            gutter={4}
          >
            <Popover.Trigger
              ref={trigger}
              aria-busy={selectBranchBusy(picker())}
              aria-description={language.t("command.session.branch.choose")}
              class="flex h-7 min-w-0 max-w-[220px] items-center gap-1.5 rounded-sm px-1.5 text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-text-text-base focus-visible:outline-none data-[expanded]:bg-v2-overlay-simple-overlay-pressed data-[expanded]:text-v2-text-text-base"
            >
              <Icon name="branch-out" size="normal" class="shrink-0 text-v2-icon-icon-muted" />
              <span ref={observe} dir="auto" class="min-w-0 truncate">
                {label()}
              </span>
              <Icon name="chevron-down" size="small" class="-ms-0.5 shrink-0 text-v2-icon-icon-muted" />
            </Popover.Trigger>
            <Popover.Portal>
              <Show when={selectBranchInitial(picker())}>
                {(initial) => (
                  <Popover.Content
                    class="w-[243px] overflow-hidden rounded-lg bg-v2-background-bg-layer-01 shadow-[var(--v2-elevation-floating)] focus:outline-none"
                    onInteractOutside={(event) => {
                      if (!event.defaultPrevented) dispatch({ type: "interact.outside" })
                    }}
                    // The machine returns focus to the composer, unless the user moved it outside.
                    onCloseAutoFocus={(event) => event.preventDefault()}
                  >
                    <Typeahead
                      initial={initial()}
                      placeholder={language.t("session.new.workspace.branch.search.placeholder")}
                      emptyLabel={language.t("palette.empty")}
                      retryLabel={language.t("common.retry")}
                      source={async (query, signal) => {
                        const directory = props.workspace.project.root()
                        const items = await props.workspace.branches(query, signal)

                        if (!query) dispatch({ type: "branches.synced", directory, items })

                        return items
                      }}
                      match={(branch, query) => branch.toLowerCase().includes(query.toLowerCase())}
                      delay={100}
                      key={(branch) => branch}
                      selected={props.workspace.bar.branch()}
                      onSelect={(branch) => dispatch({ type: "branch.selected", branch })}
                    >
                      {(branch) => (
                        <span dir="auto" class="min-w-0 truncate">
                          {branch}
                        </span>
                      )}
                    </Typeahead>
                  </Popover.Content>
                )}
              </Show>
            </Popover.Portal>
          </Popover>
        </Show>
      </Tooltip>
    </Show>
  )
}
