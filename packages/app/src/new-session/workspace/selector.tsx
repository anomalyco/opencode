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

const MAIN_CHECKOUT = Symbol("main checkout")

export function BaseBranchPicker(props: { workspace: NewSessionWorkspaceController; onDone: () => void }) {
  const language = useLanguage()

  const command = useCommand()

  const [layout, setLayout] = createStore({ truncated: false })

  const [picker, setPicker] = createSignal(INITIAL_BRANCH_PICKER_STATE)

  const requests = new Map<number, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>()

  let trigger: HTMLButtonElement | undefined

  const dispatch = (event: BranchPickerEvent) =>
    untrack(() => {
      const next = transitionBranchPicker(picker(), event)
      setPicker(next.state)
      next.effects.forEach(run)
    })

  const run = (effect: BranchPickerEffect) => {
    if (effect.type === "focus.composer") return props.onDone()

    if (effect.type === "branch.choose") return props.workspace.selection.branch(effect.branch)

    if (effect.type === "checkout.use") return props.workspace.selection.set("main")

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

    const settle = (event: BranchPickerEvent) => {
      clearTimeout(timer)
      requests.delete(attempt)
      dispatch(event)
    }

    requests.set(attempt, { controller, timer })
    props.workspace.branches("", controller.signal).then(
      (items) => settle({ type: "branches.loaded", attempt, items }),
      () => settle({ type: "branches.failed", attempt }),
    )
  }

  createComputed(() => dispatch({ type: "target.changed", directory: props.workspace.project.root() }))

  onCleanup(() => dispatch({ type: "disposed" }))

  command.register("new-session-branch", () => [
    {
      id: "session.branch.choose",
      title: language.t("command.session.branch.choose"),
      category: language.t("command.category.workspace"),
      keybind: "mod+alt+b",
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

  const label = () => {
    const branch = props.workspace.bar.branch()

    return branch
      ? language.t("session.new.workspace.fromBranch", { branch })
      : language.t("command.session.branch.choose")
  }

  const observe = (element: HTMLSpanElement) =>
    createResizeObserver(element, () => setLayout("truncated", element.scrollWidth > element.clientWidth))

  return (
    <Tooltip
      placement="top"
      openDelay={800}
      value={
        <div class="flex flex-col items-center gap-1.5">
          <div class="flex items-center gap-1.5">
            {language.t("session.location.worktree")}
            <Show when={command.keybindParts("session.location.select").length}>
              <Keybind keys={command.keybindParts("session.location.select")} variant="neutral" />
            </Show>
          </div>
          <div class="flex items-center gap-1.5">
            {language.t("command.session.branch.choose")}
            <Show when={command.keybindParts("session.branch.choose").length}>
              <Keybind keys={command.keybindParts("session.branch.choose")} variant="neutral" />
            </Show>
          </div>
          <Show when={layout.truncated}>{label()}</Show>
        </div>
      }
      class="flex min-w-0 max-w-[220px]"
      contentClass="max-w-[calc(100vw-32px)] break-all"
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
          <Icon name="outline-worktree" size="normal" class="shrink-0 text-v2-icon-icon-muted" />
          <span ref={observe} dir="auto" class="min-w-0 truncate">
            {label()}
          </span>
          <Icon name="chevron-down" class="-ms-0.5 shrink-0 text-v2-icon-icon-muted" />
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
                <Typeahead<string | typeof MAIN_CHECKOUT>
                  initial={initial()}
                  emptyQueryItem={MAIN_CHECKOUT}
                  placeholder={language.t("session.new.workspace.branch.search.placeholder")}
                  emptyLabel={language.t("palette.empty")}
                  retryLabel={language.t("common.retry")}
                  source={async (query, signal) => {
                    const directory = props.workspace.project.root()
                    const items = await props.workspace.branches(query, signal)

                    if (!query) dispatch({ type: "branches.synced", directory, items })

                    return items
                  }}
                  match={(item, query) => item !== MAIN_CHECKOUT && item.toLowerCase().includes(query.toLowerCase())}
                  delay={100}
                  key={(item) => (item === MAIN_CHECKOUT ? "checkout" : `branch:${item}`)}
                  selected={`branch:${props.workspace.bar.branch() ?? ""}`}
                  onSelect={(item) =>
                    dispatch(
                      item === MAIN_CHECKOUT
                        ? { type: "checkout.selected" }
                        : { type: "branch.selected", branch: item },
                    )
                  }
                >
                  {(item) =>
                    item === MAIN_CHECKOUT ? (
                      <>
                        <span class="shrink-0 whitespace-nowrap">
                          {language.t("session.new.workspace.useMainCheckout")}
                        </span>
                        <span dir="auto" class="min-w-0 truncate text-v2-text-text-muted">
                          {props.workspace.bar.checkout()?.branch}
                        </span>
                      </>
                    ) : (
                      <span dir="auto" class="min-w-0 truncate">
                        {item}
                      </span>
                    )
                  }
                </Typeahead>
              </Popover.Content>
            )}
          </Show>
        </Popover.Portal>
      </Popover>
    </Tooltip>
  )
}
