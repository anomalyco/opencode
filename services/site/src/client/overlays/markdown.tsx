import { AgentIcon, PersonIcon } from "~/component/site/site-controls"
import { MarkdownView } from "~/component/site/markdown-view"
import { markdownKey } from "~/component/site/markdown-key"
import { $, $$, html, site, t } from "../dom"
import { mount } from "../solid"

// The Markdown view on a static page (site.tsx's on the hydrated ones): the page's own `.md`, which
// the Worker serves, shown in place of the page. It stays on for the next page and a reload
// (sessionStorage), where the page waits hidden for it (data-markdown-boot).

let dispose: (() => void) | undefined
let source: Promise<string> | undefined

const href = () => $<HTMLLinkElement>('link[rel="alternate"][type="text/markdown"]')?.getAttribute("href") ?? undefined
const load = () =>
  (source ??= fetch(`${href()}${location.search}`).then((response) =>
    response.ok ? response.text() : Promise.reject(new Error(String(response.status))),
  ))

/** Starts fetching the page's Markdown, for a pointer on the switch or the shortcut's "m". */
export function prefetch() {
  if (href()) void load().catch(() => (source = undefined))
}

/** Turns the view on or off. From the footer's switch, leaving it lands at the page's end, under the pointer. */
export async function toggle(on = !dispose, fromFooter = false) {
  if (on === !!dispose || !href()) return
  if (!on) {
    dispose?.()
    dispose = undefined
    sessionStorage.removeItem(markdownKey)
    show(false, fromFooter)
    return
  }
  const text = await load().catch(() => undefined)
  if (text === undefined || dispose) return
  const file = href()!.split("/").pop()!
  const home = $<HTMLAnchorElement>('[data-slot="logo"]')?.getAttribute("href") ?? "/"
  // Its own host after the page: disposing a render empties its host, which must not take the page.
  const host = document.createElement("div")
  host.style.display = "contents"
  $('[data-component="content"]')!.append(host)
  const unmount = await mount(
    () => <MarkdownView source={text} file={file} href={href()} home={home} onHome={() => void toggle(false)} />,
    host,
  )
  dispose = () => {
    unmount()
    host.remove()
  }
  sessionStorage.setItem(markdownKey, "1")
  show(true, fromFooter)
}

function show(on: boolean, fromFooter: boolean) {
  // A reload in the view shows it where the page was, without the swap's fade.
  const boot = site.hasAttribute("data-markdown-boot")
  delete site.dataset.markdownBoot
  site.toggleAttribute("data-markdown", on)
  if (!boot) site.toggleAttribute("data-swapped", true)
  // The switch offers the way back: a person instead of the robot.
  $$<HTMLElement>('[data-funnel^="markdown-view:"]').forEach((button) => {
    button.setAttribute("aria-label", t(on ? "site.view.person" : "site.view.markdown"))
    button.dataset.funnel = `markdown-view:${on ? "off" : "on"}`
    button.toggleAttribute("data-active", on)
    void mount(() => (on ? <PersonIcon /> : <AgentIcon />), button, true)
  })
  if (!boot) scrollTo({ top: !on && fromFooter ? html.scrollHeight : 0 })
}

/** Leaves the view for good before a link out of it (the logo) loads the next page. */
export function leave() {
  sessionStorage.removeItem(markdownKey)
}
