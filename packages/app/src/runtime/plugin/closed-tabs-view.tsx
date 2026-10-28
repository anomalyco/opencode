import { For, Show, createMemo, createUniqueId, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { FileIcon } from "@opencode/ui/file-icon"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Keybind } from "@opencode/ui/keybind"
import { Menu } from "@opencode/ui/menu"
import { Tooltip } from "@opencode/ui/tooltip"
import { getDirectory, getFilename } from "@opencode/util/path"
import { isIconName } from "@opencode/ui/icons/catalog"
import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import {
  closedTabsSwap,
  createModifierHeld,
  hasModifier,
  type ClosedSideTab,
  type ClosedTabsModifier,
} from "./closed-tabs"

const MENU_LIMIT = 10

const SECTION_LIMIT = 5

/** A closed tab's icon, title and, for a file, its folder. */
function ClosedTabVisual(props: { entry: ClosedSideTab }): JSX.Element {
  const detail = () => (props.entry.file ? getDirectory(props.entry.file).replace(/\/$/, "") : props.entry.detail)
  const icon = () => (props.entry.icon && isIconName(props.entry.icon) ? props.entry.icon : "file-document")

  return (
    <span class="flex min-w-0 items-center gap-1.5">
      <Show
        when={props.entry.file}
        fallback={<Icon name={icon()} size="small" class="shrink-0 text-v2-icon-icon-muted" />}
      >
        {(file) => (
          <FileIcon
            node={{ path: file(), type: "file" }}
            mono
            class="size-4 shrink-0 text-v2-icon-icon-faint group-hover/closed-tab:text-v2-icon-icon-muted"
          />
        )}
      </Show>
      <span class="min-w-0 shrink truncate text-v2-text-text-base">
        {props.entry.file ? getFilename(props.entry.file) : props.entry.title}
      </span>
      <Show when={detail()}>{(value) => <span class="min-w-0 truncate text-v2-text-text-muted">{value()}</span>}</Show>
    </span>
  )
}

function useReopenKeybind() {
  const command = useCommand()

  return createMemo(() => command.keybindParts("file.tab.reopen"))
}

/**
 * The new tab view's "Recently closed": the latest `SECTION_LIMIT` closed tabs, and every kept one once expanded. The
 * newest shows the ⌘⇧T that reopens it.
 */
export function ClosedTabsSection(props: { entries: readonly ClosedSideTab[]; onReopen: (key: string) => void }) {
  const language = useLanguage()
  const keybind = useReopenKeybind()
  const [state, setState] = createStore({ expanded: false })
  const heading = createUniqueId()
  const shown = () => (state.expanded ? props.entries : props.entries.slice(0, SECTION_LIMIT))

  return (
    <Show when={props.entries.length > 0}>
      <section data-slot="side-recently-closed" class="flex flex-col gap-1 pt-6" aria-labelledby={heading}>
        <h2 id={heading} class="px-2 pb-1 text-[13px] font-[440] text-v2-text-text-muted">
          {language.t("home.recentlyClosed")}
        </h2>
        <For each={shown()}>
          {(entry, index) => (
            <button
              type="button"
              data-slot="side-recently-closed-row"
              class="group/closed-tab flex h-8 w-full shrink-0 items-center justify-between gap-4 rounded-[6px] px-2 text-start text-[13px] font-[440] hover:bg-v2-background-bg-layer-02"
              onClick={() => props.onReopen(entry.key)}
            >
              <ClosedTabVisual entry={entry} />
              <Show when={index() === 0 && keybind().length > 0}>
                <Keybind keys={keybind()} variant="neutral" />
              </Show>
            </button>
          )}
        </For>
        <Show when={!state.expanded && props.entries.length > SECTION_LIMIT}>
          <button
            type="button"
            data-slot="side-recently-closed-more"
            class="flex h-8 w-fit items-center gap-1 rounded-[6px] px-2 text-[13px] font-[440] text-v2-text-text-muted hover:bg-v2-background-bg-layer-02 hover:text-v2-text-text-base"
            onClick={(event) => {
              const section = event.currentTarget.parentElement
              setState("expanded", true)
              // Wait for the newly revealed rows to mount before moving focus off the removed button.
              queueMicrotask(() => {
                section
                  ?.querySelectorAll<HTMLButtonElement>('[data-slot="side-recently-closed-row"]')
                  [SECTION_LIMIT]?.focus()
              })
            }}
          >
            {language.t("session.tab.showMore")}
            <Icon name="chevron-down" size="small" />
          </button>
        </Show>
      </section>
    </Show>
  )
}

function ClosedTabsItems(props: { entries: readonly ClosedSideTab[]; onReopen: (key: string) => void }) {
  const language = useLanguage()
  const keybind = useReopenKeybind()

  return (
    <Menu.Group>
      <Menu.GroupLabel>{language.t("home.recentlyClosed")}</Menu.GroupLabel>
      <Show
        when={props.entries.length > 0}
        fallback={<div class="px-2 py-1.5 text-[13px] text-v2-text-text-muted">{language.t("palette.empty")}</div>}
      >
        <For each={props.entries.slice(0, MENU_LIMIT)}>
          {(entry, index) => (
            <Menu.Item
              class="group/closed-tab !gap-6 max-w-80"
              onSelect={() => props.onReopen(entry.key)}
              shortcut={
                <Show when={index() === 0 && keybind().length > 0}>
                  <Keybind keys={keybind()} variant="neutral" />
                </Show>
              }
            >
              <ClosedTabVisual entry={entry} />
            </Menu.Item>
          )}
        </For>
      </Show>
    </Menu.Group>
  )
}

const MODIFIER_LABEL = {
  mac: { alt: "⌥", shift: "⇧", ctrl: "⌃", meta: "⌘" },
  other: { alt: "Alt", shift: "Shift", ctrl: "Ctrl", meta: "Win" },
} as const

/**
 * Dev builds only, behind `opencode.dev.closedTabsModifier`: the tab strip's "+". Holding the modifier while pointing at it turns it into a chevron whose click lists the
 * recently closed tabs; a plain click still opens a new tab. Right-click and ↓ on the focused button open the list too.
 */
export function NewTabButton(props: {
  modifier: ClosedTabsModifier
  entries: readonly ClosedSideTab[]
  onReopen: (key: string) => void
  onNewTab: () => void
}) {
  const language = useLanguage()
  const modifier = props.modifier
  const global = closedTabsSwap() === "global"
  const held = createModifierHeld(modifier)
  const label = MODIFIER_LABEL[/(Mac|iPhone|iPad)/.test(navigator.platform) ? "mac" : "other"][modifier]
  const [state, setState] = createStore({ hover: false, open: false })
  const available = () => props.entries.length > 0
  const swapped = () => state.open || (available() && held() && (global || state.hover))
  // What the press that is opening the menu asked for, read when Kobalte reports the open.
  let intent: "menu" | "new" = "new"
  // A chosen entry reopens once the closing menu has returned focus, as the "+" menu does.
  let chosen: string | undefined

  return (
    <Tooltip
      value={
        swapped() ? (
          language.t("home.recentlyClosed")
        ) : (
          <span class="flex items-center gap-2">
            {language.t("session.tab.add")}
            <Show when={available()}>
              <span class="opacity-60">{language.t("session.tab.recentHint", { key: label })}</span>
            </Show>
          </span>
        )
      }
      placement="bottom"
      class="flex items-center"
    >
      <Menu
        appearance="standard"
        modal={false}
        placement="bottom-start"
        gutter={4}
        open={state.open}
        onOpenChange={(open) => {
          if (!open) return setState("open", false)

          if (intent === "menu" && available()) return setState("open", true)
          props.onNewTab()
        }}
      >
        <Menu.Trigger
          as={IconButton}
          data-slot="side-new-tab"
          data-swapped={swapped() ? "" : undefined}
          icon={<Icon name={swapped() ? "chevron-down" : "plus"} />}
          variant="ghost-muted"
          size="large"
          aria-label={swapped() ? language.t("home.recentlyClosed") : language.t("session.tab.add")}
          aria-haspopup="menu"
          onPointerEnter={() => setState("hover", true)}
          onPointerLeave={() => setState("hover", false)}
          onPointerDown={(event: PointerEvent) => {
            // The tablist redirects focus entering it to the selected tab, which counts as focus-outside and closes
            // the menu.
            event.preventDefault()
            intent = swapped() || hasModifier(event, modifier) ? "menu" : "new"
          }}
          onKeyDown={(event: KeyboardEvent) => {
            intent = event.key === "ArrowDown" || event.key === "ArrowUp" || swapped() ? "menu" : "new"
          }}
          onContextMenu={(event: MouseEvent) => {
            if (!available()) return
            event.preventDefault()
            setState("open", true)
          }}
        />
        <Menu.Portal>
          <Menu.Content
            class="min-w-64"
            onCloseAutoFocus={() => {
              const key = chosen

              if (!key) return
              chosen = undefined
              setTimeout(() => {
                if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
                props.onReopen(key)
              })
            }}
          >
            <ClosedTabsItems entries={props.entries} onReopen={(key) => (chosen = key)} />
          </Menu.Content>
        </Menu.Portal>
      </Menu>
    </Tooltip>
  )
}
