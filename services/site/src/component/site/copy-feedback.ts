// Copy with feedback in place (DESIGN.md), with no Solid, for the pages that never hydrate: the static
// pages and their islands (src/client/copy.ts) and the docs (src/docs/client.ts). The components
// render the same from signals (CopyButton in code-frame.tsx, HeadingLink in on-this-page.tsx).

/**
 * Copies, then marks `button` with data-state "copied" (or "failed") for 1.5s, and says `copied` (or
 * `failed`) in `live` (by default the live region right after the button) if there is one. `draw`
 * hears when "copied" starts and ends (the static pages' buttons draw their copy icon as a check
 * meanwhile; the docs' have no icon). A later copy from the same button owns the mark; the state the
 * button rests in comes back after.
 */
export async function copyWithFeedback(
  button: HTMLElement,
  write: () => Promise<unknown>,
  copied: string,
  failed = "",
  live = button.nextElementSibling?.matches("[aria-live]") ? button.nextElementSibling : null,
  draw?: (copied: boolean) => void,
) {
  const run = String(Number(button.dataset.run ?? 0) + 1)
  button.dataset.run = run
  // The state the button rests in (CopyButton's "idle"), or none.
  const idle = (button.dataset.idle ??= button.dataset.state ?? "")
  const state = await Promise.resolve()
    .then(write)
    .then(
      () => "copied",
      () => "failed",
    )
  button.dataset.state = state
  if (state === "copied") draw?.(true)
  if (live) live.textContent = state === "copied" ? copied : failed
  await new Promise((done) => setTimeout(done, 1500))
  if (button.dataset.run !== run) return
  if (idle) button.dataset.state = idle
  if (!idle) delete button.dataset.state
  draw?.(false)
  if (live) live.textContent = ""
}

/**
 * Heading links (HeadingLink): a click copies the section's address and puts it in the address bar,
 * and the live region after the link says `copied` (or `failed`).
 */
export function copyHeadingLinks(copied: string, failed?: string) {
  document.addEventListener("click", (event) => {
    const heading = (event.target as Element).closest?.<HTMLElement>("[data-heading-id]")
    if (!heading) return
    const id = heading.dataset.headingId
    history.replaceState(history.state, "", `#${id}`)
    void copyWithFeedback(
      heading,
      () => navigator.clipboard.writeText(`${location.origin}${location.pathname}#${id}`),
      copied,
      failed,
    )
  })
}
