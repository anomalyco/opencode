import { createEffect, createResource, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Popover } from "@kobalte/core/popover"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Icon } from "@opencode/ui/icon"
import { Tooltip } from "@opencode/ui/tooltip"
import { Typeahead } from "@opencode/ui/typeahead"
import { useLanguage } from "@/runtime/i18n/language"
import type { NewSessionWorkspaceController } from "./controller"

export function NewSessionBranch(props: { workspace: NewSessionWorkspaceController; onDone: () => void }) {
  const language = useLanguage()

  const [state, setState] = createStore({ open: false, truncated: false })

  let outside = false
  let trigger: HTMLButtonElement | undefined
  const creating = () => props.workspace.selection.value() === "create"

  // Fetch before opening and retain the result across closes, rather than showing a smaller loading panel.
  const [branches, branchActions] = createResource(
    () => (creating() ? props.workspace.project.root() : undefined),
    async (directory) => ({
      directory,
      ...(await props.workspace.branches("").then(
        (items) => ({ items, failed: false }),
        () => ({ items: [], failed: true }),
      )),
    }),
  )

  const initial = () => {
    if (branches.state !== "ready" && branches.state !== "refreshing") return
    const result = branches.latest

    return result?.directory === props.workspace.project.root() ? result : undefined
  }

  // Until content mounts, Kobalte has no dismissable layer to cancel a pending open.
  createEffect(() => {
    if (!state.open || initial()) return

    const close = (event: Event) => {
      if (event.target instanceof Node && trigger?.contains(event.target)) return
      setState("open", false)
    }

    makeEventListener(document, "pointerdown", close, { capture: true })
    makeEventListener(document, "focusin", close)
    makeEventListener(window, "blur", close)
    makeEventListener(
      window,
      "keydown",
      (event) => {
        if (event.key === "Escape") setState("open", false)
      },
      { capture: true },
    )
  })

  const label = () =>
    creating()
      ? language.t("session.new.workspace.fromBranch", { branch: props.workspace.bar.branch() ?? "" })
      : props.workspace.bar.branch()

  const observe = (element: HTMLSpanElement) =>
    createResizeObserver(element, () => setState("truncated", element.scrollWidth > element.clientWidth))

  return (
    <Show when={props.workspace.bar.branch()}>
      <Tooltip
        placement="top"
        value={label()}
        disabled={!state.truncated}
        class="flex min-w-0 max-w-[220px]"
        contentClass="max-w-[calc(100vw-32px)] break-all"
      >
        <Show
          when={creating()}
          fallback={
            <div class="flex h-7 min-w-0 max-w-[220px] items-center gap-1.5 ps-1.5 pe-2 text-v2-text-text-faint">
              <Icon name="branch" size="small" class="shrink-0 text-v2-icon-icon-faint" />
              <span ref={observe} dir="auto" class="min-w-0 truncate">
                {label()}
              </span>
            </div>
          }
        >
          <Popover
            open={state.open}
            onOpenChange={(open) => {
              setState("open", open)

              // Revalidate on every open, as before the preload; the loaded list stays on screen meanwhile.
              if (open && initial()) branchActions.refetch()
            }}
            placement="bottom-start"
            gutter={4}
          >
            <Popover.Trigger
              ref={trigger}
              aria-busy={branches.loading}
              class="flex h-7 min-w-0 max-w-[220px] items-center gap-1.5 rounded-sm px-1.5 text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-text-text-base focus-visible:outline-none data-[expanded]:bg-v2-overlay-simple-overlay-pressed data-[expanded]:text-v2-text-text-base"
            >
              <Icon name="branch-out" size="small" class="shrink-0 text-v2-icon-icon-muted" />
              <span ref={observe} dir="auto" class="min-w-0 truncate">
                {label()}
              </span>
              <Icon name="chevron-down" size="small" class="-ms-0.5 shrink-0 text-v2-icon-icon-muted" />
            </Popover.Trigger>
            <Popover.Portal>
              <Show when={initial()}>
                {(initial) => (
                  <Popover.Content
                    class="w-[243px] overflow-hidden rounded-lg bg-v2-background-bg-layer-01 shadow-[var(--v2-elevation-floating)] focus:outline-none"
                    onInteractOutside={() => (outside = true)}
                    onCloseAutoFocus={(event) => {
                      // An outside click keeps focus where the user put it.
                      if (event.defaultPrevented || outside) return (outside = false)
                      event.preventDefault()
                      props.onDone()
                    }}
                  >
                    <Typeahead
                      initial={initial()}
                      placeholder={language.t("session.new.workspace.branch.search.placeholder")}
                      emptyLabel={language.t("palette.empty")}
                      retryLabel={language.t("common.retry")}
                      source={async (query, signal) => {
                        const directory = props.workspace.project.root()
                        const items = await props.workspace.branches(query, signal)

                        if (!query && directory === props.workspace.project.root())
                          branchActions.mutate({ directory, items, failed: false })

                        return items
                      }}
                      match={(branch, query) => branch.toLowerCase().includes(query.toLowerCase())}
                      delay={100}
                      key={(branch) => branch}
                      selected={props.workspace.bar.branch()}
                      onSelect={(branch) => {
                        props.workspace.selection.branch(branch)
                        setState("open", false)
                      }}
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
