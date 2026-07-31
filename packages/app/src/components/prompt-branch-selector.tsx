import type { VcsBranch } from "@opencode-ai/sdk/v2/client"
import { Icon } from "@opencode-ai/ui/icon"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { createEventListener } from "@solid-primitives/event-listener"
import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  splitProps,
  type ComponentProps,
} from "solid-js"
import { createStore } from "solid-js/store"
import { entries, groupBy } from "remeda"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import type { NewSessionWorkspaceController } from "@/pages/new-session/new-session-workspace-controller"
import { errorMessage } from "@/pages/layout/helpers"
import { createMenuDismissController } from "@/utils/menu-dismiss-controller"
import { handleDocumentSearchKeydown } from "@/utils/search-keydown"
import { showToast } from "@/utils/toast"

const chipClass =
  "flex h-7 min-w-0 max-w-[220px] items-center gap-1.5 px-2 text-[13px] font-[440] leading-5 tracking-[-0.04px]"

export function PromptBranchSelector(props: { controller: NewSessionWorkspaceController; onDone: () => void }) {
  const language = useLanguage()
  const sdk = useSDK()
  const [store, setStore] = createStore({ open: false, search: "", active: "" })
  const [triggerReady, setTriggerReady] = createSignal(false)
  let searchRef: HTMLInputElement | undefined
  let contentRef: HTMLDivElement | undefined
  let triggerFrame: number | undefined
  const dismiss = createMenuDismissController(() => contentRef)

  // Floating UI requires a connected anchor; route transitions can construct this trigger before adoption.
  const setTriggerRef = (element: HTMLButtonElement) => {
    const ready = () => {
      if (!element.isConnected) {
        triggerFrame = requestAnimationFrame(ready)
        return
      }
      triggerFrame = undefined
      setTriggerReady(true)
    }
    ready()
  }

  onCleanup(() => {
    if (triggerFrame !== undefined) cancelAnimationFrame(triggerFrame)
  })

  const [branches] = createResource(
    () => (store.open ? props.controller.project.root() : undefined),
    (directory) =>
      sdk()
        .client.vcs.branches({ directory })
        .then((result) => ({ items: result.data ?? [], failed: false }))
        .catch(() => ({ items: [] as VcsBranch[], failed: true })),
    { initialValue: { items: [] as VcsBranch[], failed: false } },
  )

  const label = createMemo(() => props.controller.bar.base() ?? props.controller.bar.branch())
  const interactive = createMemo(() => props.controller.project.git() && !!label())
  const matches = (value: string) =>
    branches.latest.items.filter((item) => !value.trim() || item.ref.toLowerCase().includes(value.trim().toLowerCase()))
  const items = createMemo(() => matches(store.search))
  const groups = createMemo(() =>
    entries(groupBy(items(), (item) => item.remote ?? "")).map(([remote, items]) => ({ remote, items })),
  )
  const activeItem = () =>
    store.active ? contentRef?.querySelector<HTMLElement>(`[data-option-key="${CSS.escape(store.active)}"]`) : undefined
  const setOpen = (open: boolean) => {
    if (open) {
      dismiss.allowTriggerRestore()
      setStore({ open: true, active: "" })
      setTimeout(() => requestAnimationFrame(() => searchRef?.focus()))
      return
    }
    setStore({ open: false, search: "", active: "" })
    props.onDone()
  }
  const select = (item: VcsBranch) => {
    dismiss.preventTriggerRestore()
    setOpen(false)
    dismiss.afterClose(() => {
      const target = props.controller.bar.target()
      if (!target) {
        props.controller.bar.setBase(item.ref)
        return
      }
      void sdk()
        .client.vcs.switch({ directory: target, vcsSwitchInput: { ref: item.ref, name: item.name } })
        .catch((err) =>
          showToast({
            title: language.t("session.new.branch.switchFailed"),
            description: errorMessage(err, language.t("common.requestFailed")),
          }),
        )
    })
  }
  const selectActive = () => {
    const item = items().find((item) => item.ref === store.active)
    if (item) select(item)
  }
  const moveActive = (delta: number) => {
    const options = items()
    if (options.length === 0) return
    const index = options.findIndex((item) => item.ref === store.active)
    const start = index === -1 ? 0 : index
    setStore("active", options[(start + delta + options.length) % options.length].ref)
    queueMicrotask(() => activeItem()?.scrollIntoView({ block: "nearest" }))
  }
  const setSearch = (value: string) => {
    setStore({ search: value, active: matches(value)[0]?.ref ?? "" })
  }

  createEffect(() => {
    if (!store.open || store.active) return
    const options = items()
    if (options.length === 0) return
    const current = label()
    setStore("active", options.some((item) => item.ref === current) ? current! : options[0].ref)
    queueMicrotask(() => activeItem()?.scrollIntoView({ block: "nearest" }))
  })

  createEffect(() => {
    if (!store.open) return
    createEventListener(
      document,
      "keydown",
      (event: KeyboardEvent) => handleDocumentSearchKeydown(searchRef, event, store.search, setSearch),
      true,
    )
  })

  return (
    <Show when={interactive()} fallback={<PromptGitStatus branch={label()} noGit={!props.controller.project.git()} />}>
      <span class="hidden select-none opacity-50 sm:inline mx-1">/</span>
      <MenuV2 open={triggerReady() && store.open} modal={false} placement="bottom" gutter={4} onOpenChange={setOpen}>
        <MenuV2.Trigger as={BranchTrigger} ref={setTriggerRef} label={label() ?? ""} open={store.open} />
        <MenuV2.Portal>
          <MenuV2.Content
            ref={(element: HTMLDivElement) => (contentRef = element)}
            class="w-[243px] overflow-hidden rounded-md border-0 bg-v2-background-bg-layer-01 !p-0 shadow-[var(--v2-elevation-floating)] focus:outline-none"
            onOpenAutoFocus={(event) => event.preventDefault()}
            onPointerDownOutside={dismiss.preventTriggerRestore}
            onFocusOutside={dismiss.preventTriggerRestore}
            onCloseAutoFocus={dismiss.onCloseAutoFocus}
          >
            <div class="flex flex-col p-0.5">
              <div class="flex h-7 items-center gap-2 rounded-sm pl-3 pr-2.5 text-v2-icon-icon-muted">
                <Icon name="magnifying-glass" size="small" class="shrink-0" />
                <input
                  ref={(el) => (searchRef = el)}
                  value={store.search}
                  placeholder={language.t("session.new.branch.search")}
                  aria-autocomplete="list"
                  aria-activedescendant={store.active || undefined}
                  spellcheck={false}
                  autocorrect="off"
                  autocomplete="off"
                  autocapitalize="off"
                  class="h-7 min-w-0 flex-1 border-0 bg-transparent text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
                  onInput={(event) => setSearch(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Tab") return
                    event.stopPropagation()
                    if (event.key === "Escape") {
                      event.preventDefault()
                      dismiss.preventTriggerRestore()
                      setOpen(false)
                      return
                    }
                    if (event.altKey || event.metaKey) return
                    if (event.key === "ArrowDown") {
                      event.preventDefault()
                      moveActive(1)
                      return
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault()
                      moveActive(-1)
                      return
                    }
                    if (event.key === "Enter" && !event.isComposing) {
                      event.preventDefault()
                      selectActive()
                    }
                  }}
                />
                <Show when={store.search.trim()}>
                  <button
                    type="button"
                    class="flex size-5 items-center justify-center rounded-sm text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover"
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => setSearch("")}
                    aria-label={language.t("common.clear")}
                  >
                    <Icon name="close-small" size="small" />
                  </button>
                </Show>
              </div>
            </div>
            <div class="h-px bg-v2-border-border-muted" />
            <ScrollView class="max-h-[220px] min-h-0">
              <div class="flex flex-col p-0.5">
                <Show
                  when={items().length > 0}
                  fallback={
                    <div class="flex h-12 items-center px-3 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-faint">
                      {branches.loading
                        ? language.t("common.loading")
                        : branches.latest.failed
                          ? language.t("common.requestFailed")
                          : language.t("session.new.branch.empty")}
                    </div>
                  }
                >
                  <div class="flex h-7 select-none items-center px-3 text-[11px] font-[530] leading-none tracking-[0.05px] text-v2-text-text-faint">
                    {props.controller.bar.target()
                      ? language.t("session.new.branch.checkout")
                      : language.t("session.new.branch.base")}
                  </div>
                  <For each={groups()}>
                    {(group) => (
                      <div>
                        <div class="flex h-7 select-none items-center px-3 text-[11px] font-[530] leading-none tracking-[0.05px] text-v2-text-text-faint">
                          <span class="min-w-0 truncate">{group.remote || language.t("session.new.branch.local")}</span>
                        </div>
                        <MenuV2.RadioGroup value={label()}>
                          <For each={group.items}>
                            {(item) => (
                              <MenuV2.RadioItem
                                value={item.ref}
                                id={item.ref}
                                data-option-key={item.ref}
                                class="scroll-my-6 w-full"
                                classList={{
                                  "!bg-v2-overlay-simple-overlay-hover": store.active === item.ref,
                                }}
                                onMouseEnter={() => {
                                  setStore("active", item.ref)
                                  setTimeout(() => searchRef?.focus())
                                }}
                                onSelect={() => select(item)}
                              >
                                <span class="min-w-0 truncate leading-5">{item.name}</span>
                              </MenuV2.RadioItem>
                            )}
                          </For>
                        </MenuV2.RadioGroup>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </ScrollView>
          </MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
    </Show>
  )
}

function BranchTrigger(props: ComponentProps<"button"> & { label: string; open: boolean }) {
  const [local, rest] = splitProps(props, ["label", "open", "class", "classList"])
  return (
    <button
      {...rest}
      data-action="prompt-branch"
      type="button"
      class={`${chipClass} rounded-sm transition-colors focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none`}
      classList={{
        ...local.classList,
        "hover:bg-v2-overlay-simple-overlay-hover": !local.open,
        "bg-v2-overlay-simple-overlay-pressed text-v2-text-text-muted": local.open,
      }}
    >
      <Icon name="branch" size="small" class="shrink-0 text-v2-icon-icon-muted" />
      <span class="min-w-0 truncate">{local.label}</span>
      <Icon name="chevron-down" size="small" class="shrink-0 text-v2-icon-icon-muted" />
    </button>
  )
}

export function PromptGitStatus(props: { branch?: string; noGit?: boolean }) {
  const language = useLanguage()
  const label = createMemo(() => (props.noGit ? language.t("session.new.git.none") : props.branch))

  return (
    <Show when={label()}>
      <span class="hidden select-none opacity-50 sm:inline mx-1">/</span>
      <TooltipV2
        placement="top"
        value={label() ?? ""}
        class="min-w-0 max-w-[220px]"
        contentClass="max-w-[calc(100vw-32px)] break-all"
      >
        <div class={chipClass}>
          <Icon name="branch" size="small" class="shrink-0 text-v2-icon-icon-muted" />
          <span class="min-w-0 truncate">{label()}</span>
        </div>
      </TooltipV2>
    </Show>
  )
}
