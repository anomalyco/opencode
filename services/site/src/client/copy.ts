import { checkPath, copyPath } from "~/component/site/icon-paths"
import { on, t, target, wait } from "./dom"

// Copy with feedback in place (DESIGN.md), for the static pages and their islands. The docs keep a
// smaller one (src/docs/client.ts copied), as their buttons show their state from data-state alone.

/**
 * Copies, then marks `button` with data-state "copied" (or "failed") for 1.5s, draws its copy icon as
 * a check meanwhile, and says so in `live` if there is one. A later copy from the same button owns the
 * mark; the button's own state comes back after.
 */
export async function copied(
  button: HTMLElement,
  write: () => Promise<unknown>,
  live?: Element | null,
  message = t("site.action.copied"),
) {
  const run = String(Number(button.dataset.run ?? 0) + 1)
  button.dataset.run = run
  // The state the button rests in (CopyMarkdown's "idle"), or none.
  const idle = (button.dataset.idle ??= button.dataset.state ?? "")
  const state = await Promise.resolve()
    .then(write)
    .then(
      () => "copied",
      () => "failed",
    )
  const icon = button.querySelector<SVGPathElement>(`path[d="${copyPath}"], path[d="${checkPath}"]`)
  button.dataset.state = state
  if (state === "copied") icon?.setAttribute("d", checkPath)
  if (state === "copied") icon?.setAttribute("stroke-linecap", "square")
  if (live) live.textContent = state === "copied" ? message : ""
  await wait(1500)
  if (button.dataset.run !== run) return
  if (idle) button.dataset.state = idle
  if (!idle) delete button.dataset.state
  icon?.setAttribute("d", copyPath)
  icon?.removeAttribute("stroke-linecap")
  if (live) live.textContent = ""
}

/** Copies the text a URL serves, keeping the click's user activation while it loads (Safari needs it). */
export function copyUrl(url: string) {
  return navigator.clipboard.write([
    new ClipboardItem({
      "text/plain": fetch(url)
        .then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
        .then((text) => new Blob([text], { type: "text/plain" })),
    }),
  ])
}

/** Heading links (on-this-page.tsx HeadingLink): copy the section's address and put it in the address bar. */
export function startCopy() {
  on("click", (event) => {
    const heading = target(event).closest<HTMLElement>("[data-heading-id]")
    if (!heading) return
    const id = heading.dataset.headingId!
    history.replaceState(history.state, "", `#${id}`)
    void copied(
      heading,
      () => navigator.clipboard.writeText(`${location.origin}${location.pathname}#${id}`),
      heading.nextElementSibling?.matches('[data-slot="heading-copied"]') ? heading.nextElementSibling : undefined,
      t("changelog.share.copied"),
    )
  })
}
