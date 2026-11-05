import { useI18n } from "~/context/i18n"
import "./on-this-page.css"
import { createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { Chevron } from "./icons"

type ContentsItem = {
  id: string
  title: string
  level?: 2 | 3
  /** A small status dot after the title (the docs component kitchen sink's chosen / not yet reviewed marks). */
  status?: "chosen" | "review" | "progress"
}

/**
 * The section the reader is in: the last one whose heading has passed a third of the way down the
 * window. At the bottom of the page, where the last headings can't reach that line, the section the
 * address points to (a Contents link or a shared link) wins while its heading is in view, else the
 * last section in view.
 */
function useActiveSection(items: () => ContentsItem[]) {
  const [active, setActive] = createSignal<string>()

  onMount(() => {
    const track = () => {
      const list = items()
      const headings = list.flatMap((item) => {
        const heading = document.getElementById(item.id)
        return heading ? [{ id: item.id, top: heading.getBoundingClientRect().top }] : []
      })
      const passed = headings.filter((heading) => heading.top <= window.innerHeight / 3)
      const bottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2
      const visible = headings.filter((heading) => heading.top >= 0 && heading.top < window.innerHeight)
      const target = visible.find((heading) => `#${heading.id}` === decodeURIComponent(location.hash))
      setActive(
        bottom && (target ?? visible.at(-1)) ? (target ?? visible.at(-1))!.id : (passed.at(-1)?.id ?? list[0]?.id),
      )
    }
    track()
    window.addEventListener("scroll", track, { passive: true })
    window.addEventListener("resize", track, { passive: true })
    window.addEventListener("hashchange", track)
    onCleanup(() => {
      window.removeEventListener("scroll", track)
      window.removeEventListener("resize", track)
      window.removeEventListener("hashchange", track)
    })
  })

  return [active, setActive] as const
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
  // In the aside the rail scrolls on its own when the list is taller than the window (site.css):
  // keep the current section in view, 24px from the edge it went past (legal and the docs share it).
  createEffect(() => {
    if (!active()) return
    requestAnimationFrame(() => {
      const link = nav?.querySelector("[aria-current='location']")
      const box = nav?.closest("[data-component='aside'] > *")
      if (!link || !box) return
      const item = link.getBoundingClientRect()
      const view = box.getBoundingClientRect()
      if (item.top < view.top) box.scrollTop -= view.top - item.top + 24
      if (item.bottom > view.bottom) box.scrollTop += item.bottom - view.bottom + 24
    })
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
 * sticks under the top bar (and any sticky bar the page adds above it).
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
    })
  })

  return (
    <details ref={menu} data-component="contents-menu">
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
 * the plain title for headings with markup of their own.
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
      <span data-slot="heading-copied" aria-live="polite">
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
