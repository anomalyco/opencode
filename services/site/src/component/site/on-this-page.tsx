import { useI18n } from "~/context/i18n"
import "./on-this-page.css"
import { createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { activeSection, keepInRail, markStuck } from "./contents-spy"
import { Chevron } from "./icons"
import { holdOpenMenu } from "./menu-hold"
import { useVisible } from "./visible"

type ContentsItem = {
  id: string
  title: string
  level?: 2 | 3
  /** A small status dot after the title (the docs component kitchen sink's chosen / not yet reviewed marks). */
  status?: "chosen" | "review" | "progress"
}

/** The section the reader is in (contents-spy.ts), checked once a frame while the page scrolls. */
function useActiveSection(items: () => ContentsItem[]) {
  onMount(() => {
    spy.items = items
    track()
    if (spy.users++ === 0) {
      window.addEventListener("scroll", schedule, { passive: true })
      window.addEventListener("resize", schedule, { passive: true })
      window.addEventListener("hashchange", schedule)
    }
    onCleanup(() => {
      if (--spy.users) return
      cancelAnimationFrame(spy.frame)
      spy.frame = 0
      window.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
      window.removeEventListener("hashchange", schedule)
    })
  })
  return [active, setActive] as const
}

// The aside's list and the phone menu show the page's same sections, so one spy, once a frame,
// serves both.
const [active, setActive] = createSignal<string>()
const spy = { users: 0, frame: 0, items: (): ContentsItem[] => [] }

function schedule() {
  if (spy.frame) return
  spy.frame = requestAnimationFrame(() => {
    spy.frame = 0
    track()
  })
}

function track() {
  setActive(activeSection(spy.items().map((item) => item.id)))
}

/**
 * "Contents" for long pages, in the right-hand aside: pass it to <Site aside={...}>. The docs, Brand,
 * Press and legal pages all use it, so the list looks and behaves the same everywhere. The docs layout
 * hides the aside below 60rem.
 */
export function OnThisPage(props: { items: ContentsItem[] }) {
  const i18n = useI18n()
  const [active, setActive] = useActiveSection(() => props.items)
  let nav: HTMLElement | undefined
  // In the aside the rail keeps the current section in view (legal and the docs share it).
  createEffect(() => {
    if (active()) requestAnimationFrame(() => keepInRail(nav?.querySelector("[aria-current='location']")))
  })

  return (
    <nav ref={nav} data-component="on-this-page" aria-label={i18n.t("site.contents")}>
      <span data-slot="heading">{i18n.t("site.contents")}</span>
      <ul>
        <For each={props.items}>
          {(item) => (
            <li data-level={item.level === 3 ? "3" : undefined}>
              <a
                href={`#${item.id}`}
                title={item.title}
                aria-current={active() === item.id ? "location" : undefined}
                onClick={() => setActive(item.id)}
              >
                {item.title}
                <Show when={item.status}>
                  {(status) => <span data-slot="status" data-status={status()} aria-hidden="true" />}
                </Show>
              </a>
            </li>
          )}
        </For>
      </ul>
    </nav>
  )
}

/**
 * "Contents" folded up for phones, where the aside's list is hidden: put it above the first section of
 * any page that passes OnThisPage to <Site aside>. Hidden from 60rem up and in print. On phones it
 * sticks under the top bar (and any sticky bar the page adds above it). The static pages drive the same
 * markup from src/client/contents.ts, and the docs from src/docs/client.ts.
 */
export function ContentsMenu(props: { items: ContentsItem[] }) {
  const i18n = useI18n()
  const [active, setActive] = useActiveSection(() => props.items)
  let menu: HTMLDetailsElement | undefined

  // On phones it pins under the top bar and opens as a dropdown over the page: a choice, a tap
  // outside or Escape closes it.
  onMount(() => {
    const outside = (event: PointerEvent) => {
      if (menu?.open && !menu.contains(event.target as Node)) menu.open = false
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !menu?.open) return
      menu.open = false
      menu.querySelector("summary")?.focus()
    }
    document.addEventListener("pointerdown", outside)
    document.addEventListener("keydown", escape)
    onCleanup(() => {
      document.removeEventListener("pointerdown", outside)
      document.removeEventListener("keydown", escape)
      document.documentElement.removeAttribute("data-menu-hold")
    })
  })

  // Pinned under the top bar, the bar shows its lines (contents-spy.ts markStuck), measured on scroll
  // only while it is near the screen: from 60rem up it is hidden.
  const shown = useVisible(() => menu)
  createEffect(() => {
    if (!shown()) return
    let frame = 0
    const stuck = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => markStuck(menu))
    }
    window.addEventListener("scroll", stuck, { passive: true })
    window.addEventListener("resize", stuck)
    stuck()
    onCleanup(() => {
      cancelAnimationFrame(frame)
      window.removeEventListener("scroll", stuck)
      window.removeEventListener("resize", stuck)
    })
  })

  return (
    <details ref={menu} data-component="contents-menu" on:toggle={holdOpenMenu}>
      <summary>
        <span data-slot="label">{i18n.t("site.contents")}</span>
        <Chevron />
      </summary>
      <ul>
        <For each={props.items}>
          {(item) => (
            <li data-level={item.level === 3 ? "3" : undefined}>
              <a
                href={`#${item.id}`}
                aria-current={active() === item.id ? "location" : undefined}
                onClick={() => {
                  setActive(item.id)
                  if (menu) menu.open = false
                }}
              >
                {item.title}
              </a>
            </li>
          )}
        </For>
      </ul>
    </details>
  )
}

/** A section title, plain and above its section's content. Clicking it copies the section's address. */
export function SectionHeading(props: { level?: 2 | 3; id: string; title: string; label?: boolean }) {
  return props.level === 3 ? (
    <h3 id={props.id} data-component="section-heading">
      <HeadingLink id={props.id} title={props.title} />
    </h3>
  ) : (
    <h2 id={props.id} data-component="section-heading" data-slot={props.label ? "label" : undefined}>
      <HeadingLink id={props.id} title={props.title} />
    </h2>
  )
}

/**
 * The inside of a heading: a button with the title that copies the section's address and puts it in
 * the address bar, then says "Link copied" for a moment (also to screen readers). `children` replaces
 * the plain title for headings with markup of their own. Pages that never hydrate (the docs) do the
 * same from a delegated listener keyed on `data-heading-id` (src/docs/client.ts, src/client/copy.ts).
 */
export function HeadingLink(props: { id: string; title: string; children?: JSX.Element }) {
  const i18n = useI18n()
  const [copied, setCopied] = createSignal(false)
  const timer = { id: 0 }
  onCleanup(() => clearTimeout(timer.id))
  return (
    <>
      <button
        type="button"
        data-slot="heading-link"
        data-heading-id={props.id}
        title={i18n.t("site.heading.copyLink")}
        onClick={() => {
          void copyLink(props.id)
          history.replaceState(history.state, "", `#${props.id}`)
          setCopied(true)
          clearTimeout(timer.id)
          timer.id = window.setTimeout(() => setCopied(false), 1500)
        }}
      >
        {props.children ?? props.title}
      </button>
      <span data-slot="heading-copied" aria-live="polite" data-pagefind-ignore>
        {copied() ? i18n.t("changelog.share.copied") : ""}
      </span>
    </>
  )
}

/** Copies the address of a heading on the current page. */
export function copyLink(id: string) {
  return navigator.clipboard.writeText(`${location.origin}${location.pathname}#${id}`)
}

/** A heading's id: lowercase words joined by hyphens. */
export function slug(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}
