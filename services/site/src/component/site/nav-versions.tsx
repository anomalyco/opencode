import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useI18n } from "~/context/i18n"
import { siteLinks } from "./links"
import { onCloseMenus } from "./menu-open"
import { addCustomNavItem, navVersions, removedNavItems, resetNav, restoreNavItem } from "./nav-order"

/**
 * Design mode, under the nav: every version of the nav list as a chip (one click switches; ⌥[ and
 * ⌥] step through them; the active one carries an "edited" dot while the nav differs from it), and
 * a menu to save the nav as a new version, update or delete the active one, rename any saved one,
 * reset the nav and add items back. Built-in versions (Default and the presets) are read-only.
 */
// The menu is open or a version is being renamed: Design mode hides its own overlay meanwhile.
const [open, setOpen] = createSignal(false)
const [renaming, setRenaming] = createSignal<string>()
export const navVersionsBusy = () => open() || renaming() !== undefined

export function NavVersions() {
  const i18n = useI18n()
  // The known items' own labels, for the deleted ones in Add item.
  const labels = () => Object.fromEntries(siteLinks(i18n.t, (path) => path).nav.map((item) => [item.id, item.label]))
  const [adding, setAdding] = createSignal(false)
  onCloseMenus(() => setOpen(false))
  createEffect(() => {
    if (!open()) setAdding(false)
  })
  let root: HTMLDivElement | undefined
  let toggle: HTMLButtonElement | undefined
  const active = () => navVersions.active()
  const builtIn = () => navVersions.readOnly(active().id)

  const rename = (id: string) => {
    setOpen(false)
    setRenaming(id)
    queueMicrotask(() => {
      const input = root?.querySelector<HTMLInputElement>('input[data-slot="name-input"]')
      input?.focus()
      input?.select()
    })
  }
  const finish = (input: HTMLInputElement, save: boolean) => {
    const id = renaming()
    if (!id) return
    setRenaming(undefined)
    if (save) navVersions.rename(id, input.value)
  }
  const run = (action: () => void) => {
    setOpen(false)
    action()
    toggle?.focus({ preventScroll: true })
  }

  onCleanup(() => {
    setOpen(false)
    setRenaming(undefined)
  })

  onMount(() => {
    // ⌥[ and ⌥] step through the versions (by key position, as ⌥ changes the character on a Mac).
    const key = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.repeat) return
      if (event.code !== "BracketLeft" && event.code !== "BracketRight") return
      if ((event.target as HTMLElement).closest?.("input, textarea, select, [contenteditable]")) return
      event.preventDefault()
      navVersions.cycle(event.code === "BracketLeft" ? -1 : 1)
    }
    const outside = (event: PointerEvent) => {
      if (open() && !root?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("keydown", key)
    document.addEventListener("pointerdown", outside, true)
    onCleanup(() => {
      document.removeEventListener("keydown", key)
      document.removeEventListener("pointerdown", outside, true)
    })
  })

  return (
    <div
      data-component="nav-versions"
      ref={root}
      // Escape closes the menu here; Design mode stays on.
      on:keydown={(event: KeyboardEvent) => {
        if (event.key !== "Escape" || !open()) return
        event.stopPropagation()
        setOpen(false)
        toggle?.focus({ preventScroll: true })
      }}
    >
      {/* Every version as a chip, so one click switches: the active one filled, with the edited
          dot. A radio group: the arrow keys move between chips and switch. Double-click a saved
          version's chip to rename it. */}
      <div data-slot="chips" role="radiogroup" aria-label="Nav versions">
        <For each={navVersions.all()}>
          {(version, index) => (
            <Show
              when={renaming() === version.id}
              fallback={
                <button
                  type="button"
                  role="radio"
                  data-slot="chip"
                  data-version={version.id}
                  aria-checked={version.id === active().id ? "true" : "false"}
                  tabIndex={version.id === active().id ? 0 : -1}
                  title={navVersions.readOnly(version.id) ? `${version.name} (built in)` : "Double-click to rename"}
                  onClick={() => navVersions.switchTo(version.id)}
                  onDblClick={() => !navVersions.readOnly(version.id) && rename(version.id)}
                  on:keydown={(event: KeyboardEvent) => {
                    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
                    if (event.key === "F2" && !navVersions.readOnly(version.id)) {
                      event.preventDefault()
                      return rename(version.id)
                    }
                    if (!step) return
                    event.preventDefault()
                    const list = navVersions.all()
                    const next = list[(index() + step + list.length) % list.length]
                    navVersions.switchTo(next.id)
                    queueMicrotask(() =>
                      root?.querySelector<HTMLElement>(`[data-slot="chip"][data-version="${next.id}"]`)?.focus(),
                    )
                  }}
                >
                  <span data-slot="number">{index() + 1}</span>
                  <span data-slot="label">{version.name}</span>
                  <Show when={version.id === active().id && navVersions.edited()}>
                    <span
                      data-slot="edited"
                      role="img"
                      aria-label="edited"
                      title="Changed since this version was saved"
                    />
                  </Show>
                </button>
              }
            >
              <input
                data-slot="name-input"
                value={version.name}
                aria-label="Version name"
                spellcheck={false}
                on:keydown={(event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    finish(event.currentTarget, true)
                  }
                  if (event.key === "Escape") {
                    event.preventDefault()
                    event.stopPropagation()
                    finish(event.currentTarget, false)
                  }
                }}
                onBlur={(event) => finish(event.currentTarget, true)}
              />
            </Show>
          )}
        </For>
        <button
          type="button"
          data-slot="toggle"
          ref={toggle}
          aria-label="Nav version actions"
          aria-haspopup="menu"
          aria-expanded={open() ? "true" : "false"}
          onClick={() => setOpen(!open())}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
            <circle cx="2.5" cy="6" r="1" />
            <circle cx="6" cy="6" r="1" />
            <circle cx="9.5" cy="6" r="1" />
          </svg>
        </button>
      </div>
      <Show when={open()}>
        <div data-slot="menu" role="menu" aria-label="Nav versions">
          <For each={navVersions.all()}>
            {(version, index) => (
              <div data-slot="row">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={version.id === active().id ? "true" : "false"}
                  onClick={() => run(() => navVersions.switchTo(version.id))}
                >
                  <span data-slot="number">{index() + 1}</span>
                  <span data-slot="label">{version.name}</span>
                </button>
                <Show when={!navVersions.readOnly(version.id)}>
                  <button
                    type="button"
                    role="menuitem"
                    data-slot="pencil"
                    aria-label={`Rename ${version.name}`}
                    onClick={() => rename(version.id)}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M8 1.5L10.5 4L4 10.5H1.5V8L8 1.5Z" />
                    </svg>
                  </button>
                </Show>
              </div>
            )}
          </For>
          <hr />
          <button type="button" role="menuitem" onClick={() => rename(navVersions.save())}>
            Save as new version
          </button>
          <button type="button" role="menuitem" disabled={builtIn()} onClick={() => run(() => navVersions.update())}>
            Update version
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={builtIn()}
            onClick={() => run(() => navVersions.remove(active().id))}
          >
            Delete version
          </button>
          <button type="button" role="menuitem" onClick={() => run(resetNav)}>
            Reset nav
          </button>
          <hr />
          <p data-slot="heading">Add item</p>
          <For each={removedNavItems()}>
            {(entry) => (
              <button type="button" role="menuitem" onClick={() => run(() => restoreNavItem(entry.id))}>
                {entry.label ?? labels()[entry.id] ?? entry.id}
              </button>
            )}
          </For>
          <Show
            when={adding()}
            fallback={
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAdding(true)
                  queueMicrotask(() => root?.querySelector<HTMLInputElement>('input[name="nav-link-label"]')?.focus())
                }}
              >
                Custom link…
              </button>
            }
          >
            <form
              data-slot="custom"
              onSubmit={(event) => {
                event.preventDefault()
                const form = new FormData(event.currentTarget)
                if (!addCustomNavItem(String(form.get("nav-link-label")), String(form.get("nav-link-url")))) return
                setAdding(false)
                run(() => {})
              }}
            >
              <input name="nav-link-label" placeholder="Label" aria-label="Link label" required spellcheck={false} />
              <input name="nav-link-url" placeholder="URL or /path" aria-label="Link URL" required spellcheck={false} />
              <button type="submit">Add</button>
            </form>
          </Show>
          <p data-slot="hint">⌥[ ⌥] switch versions</p>
        </div>
      </Show>
    </div>
  )
}
