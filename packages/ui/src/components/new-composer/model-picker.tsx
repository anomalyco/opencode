import { Popover as Kobalte } from "@kobalte/core/popover"
import { For, Show, createEffect, createMemo, createSignal, on } from "solid-js"
import { useI18n } from "../../context/i18n"
import { Button } from "../button"
import { Icon } from "../icon"
import { IconButton } from "../icon-button"
import { ProviderIcon } from "../provider-icon"

interface Props {
  options: string[]
  current?: string
  onSelect?: (value: string) => void
  openTick?: number
}

type Item = {
  value: string
  provider: string
  label: string
}

function parse(value: string, fallback: string): Item {
  const i = value.indexOf("/")
  if (i <= 0 || i >= value.length - 1) {
    return {
      value,
      provider: fallback,
      label: value,
    }
  }

  return {
    value,
    provider: value.slice(0, i),
    label: value.slice(i + 1),
  }
}

export function ModelPicker(props: Props) {
  const i18n = useI18n()
  const [open, setOpen] = createSignal(false)
  const [full, setFull] = createSignal(false)
  const [query, setQuery] = createSignal("")
  let input: HTMLInputElement | undefined

  const focus = () => {
    requestAnimationFrame(() => {
      input?.focus()
      input?.select()
    })
  }

  createEffect(
    on(
      () => props.openTick,
      (next, prev) => {
        if (next === undefined) return
        if (next === prev) return
        setFull(true)
        setOpen(true)
        focus()
      },
      { defer: true },
    ),
  )

  const list = createMemo(() => {
    const q = query().trim().toLowerCase()
    const fallback = i18n.t("ui.prompt.model.group.default")
    const items = props.options.map((item) => parse(item, fallback))
    if (!q) return items
    return items.filter((item) => {
      return item.label.toLowerCase().includes(q) || item.provider.toLowerCase().includes(q)
    })
  })

  const groups = createMemo(() => {
    const map = new Map<string, Item[]>()
    for (const item of list()) {
      const group = map.get(item.provider)
      if (group) {
        group.push(item)
        continue
      }
      map.set(item.provider, [item])
    }
    return Array.from(map.entries()).map(([provider, items]) => ({ provider, items }))
  })

  const label = createMemo(() => {
    const fallback = i18n.t("ui.prompt.model.group.default")
    const hit = props.options.map((item) => parse(item, fallback)).find((item) => item.value === props.current)
    if (!hit) return props.current ?? i18n.t("ui.prompt.control.model")
    return hit.label
  })

  const provider = createMemo(() => {
    const fallback = i18n.t("ui.prompt.model.group.default")
    const hit = props.options.map((item) => parse(item, fallback)).find((item) => item.value === props.current)
    if (!hit) return undefined
    if (hit.provider === fallback) return undefined
    return hit.provider.toLowerCase()
  })

  return (
    <Kobalte
      open={open()}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setQuery("")
          setFull(false)
        }
        if (next) focus()
      }}
      modal={false}
      placement="top-start"
      gutter={4}
    >
      <Kobalte.Trigger
        as={Button}
        variant="ghost"
        size="normal"
        class="min-w-0 max-w-[320px] text-13-regular group"
        style={{ height: "28px" }}
        onPointerDown={() => setFull(false)}
      >
        <Show when={provider()} fallback={<Icon name="brain" size="small" class="shrink-0" />}>
          {(id) => (
            <ProviderIcon
              id={id()}
              class="size-4 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity duration-150"
              style={{ "will-change": "opacity", transform: "translateZ(0)" }}
            />
          )}
        </Show>
        <span class="truncate">{label()}</span>
        <Icon name="chevron-down" size="small" class="shrink-0" />
      </Kobalte.Trigger>

      <Kobalte.Portal>
        <Show when={open() && full()}>
          <div class="fixed inset-0 bg-black/35 z-40" onPointerDown={() => setOpen(false)} />
        </Show>
        <Kobalte.Content
          class="flex flex-col rounded-md border border-border-base bg-surface-raised-stronger-non-alpha shadow-md z-50 outline-none overflow-hidden"
          classList={{
            "w-72 h-80 p-2": !full(),
            "w-[min(92vw,1130px)] h-[min(86vh,860px)] p-5": full(),
          }}
          style={
            full()
              ? {
                  position: "fixed",
                  left: "50%",
                  top: "50%",
                  transform: "translate(-50%, -50%)",
                }
              : undefined
          }
          onEscapeKeyDown={(event) => {
            setOpen(false)
            event.preventDefault()
            event.stopPropagation()
          }}
        >
          <Show when={full()}>
            <div class="flex items-center justify-between mb-3">
              <div class="text-35-medium text-text-strong">{i18n.t("ui.prompt.model.select")}</div>
              <Button icon="plus-small" variant="secondary" size="normal" class="text-32-medium h-10 px-4">
                {i18n.t("ui.prompt.model.connect")}
              </Button>
            </div>
          </Show>

          <div class="flex items-center gap-2 px-2 py-1.5 rounded-md bg-surface-base mb-2">
            <Icon name="magnifying-glass" size="small" class="text-icon-weak shrink-0" />
            <input
              ref={input}
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              placeholder={i18n.t("ui.prompt.model.search")}
              class="min-w-0 flex-1 bg-transparent border-none outline-none text-14-regular text-text-strong placeholder:text-text-weak"
            />
            <Show when={!full()}>
              <IconButton
                icon="plus-small"
                variant="ghost"
                iconSize="normal"
                class="size-6"
                aria-label={i18n.t("ui.prompt.model.connect")}
              />
              <IconButton
                icon="sliders"
                variant="ghost"
                iconSize="normal"
                class="size-6"
                aria-label={i18n.t("ui.prompt.model.manage")}
              />
            </Show>
          </div>

          <div class="flex-1 min-h-0 overflow-auto no-scrollbar px-1 pt-1">
            <Show
              when={groups().length > 0}
              fallback={<div class="px-2 py-1 text-13-regular text-text-weak">{i18n.t("ui.prompt.model.none")}</div>}
            >
              <For each={groups()}>
                {(group) => (
                  <div class="pb-2.5">
                    <div class="px-2 py-1.5 text-35-medium text-text-weak">{group.provider}</div>
                    <For each={group.items}>
                      {(item) => (
                        <button
                          class="w-full h-10 px-2 rounded-md flex items-center justify-between text-left"
                          classList={{ "bg-surface-raised-base-hover": props.current === item.value }}
                          onClick={() => {
                            props.onSelect?.(item.value)
                            setOpen(false)
                          }}
                        >
                          <span class="text-32-medium text-text-strong truncate">{item.label}</span>
                          <Show when={props.current === item.value}>
                            <Icon name="check-small" size="small" class="text-icon-strong-base shrink-0" />
                          </Show>
                        </button>
                      )}
                    </For>
                  </div>
                )}
              </For>
            </Show>
          </div>

          <Show when={full()}>
            <div class="pt-2 px-2 text-32-medium text-text-weak">{i18n.t("ui.prompt.model.manage")}</div>
          </Show>
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}
