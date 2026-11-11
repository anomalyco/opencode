import { watchMenus } from "../menu-watch"

/**
 * The Hex promo's orb at rest (hex-promo.tsx in the app, client/overlays/orb.ts on the static pages):
 * the button in the bottom corner. While any other menu, sheet or Contents menu is open it fades out
 * (orb.css) and can't be focused. `panel` loads its pop-up (hex-panel.tsx) the first time the orb is
 * hovered, focused or pressed, and resolves with what a click does; until then a page has no
 * framework code for it. Returns the button and its stop.
 */
export function hexOrb(label: string, panel: () => Promise<() => void>) {
  const template = document.createElement("template")
  template.innerHTML = `<button type="button" data-slot="orb" data-shown="" data-resting="" tabindex="0"
    aria-haspopup="dialog" aria-expanded="false"><span data-slot="disc" aria-hidden="true"></span><svg
    data-slot="orb-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path
    d="M1.375 6H2.625V10H1.375ZM4.375 4H5.625V12H4.375ZM7.375 2H8.625V14H7.375ZM10.375 4H11.625V12H10.375ZM13.375 6H14.625V10H13.375Z"
    /></svg></button>`
  const orb = template.content.firstElementChild as HTMLButtonElement
  orb.setAttribute("aria-label", label)
  let toggle: (() => void) | undefined
  let loading: Promise<void> | undefined
  const load = () =>
    (loading ??= panel().then(
      (run) => void (toggle = run),
      () => void (loading = undefined),
    ))
  for (const type of ["pointerenter", "focus", "pointerdown"]) orb.addEventListener(type, () => void load())
  orb.addEventListener("click", () => {
    if (toggle) return toggle()
    // Pressed before the pop-up's code arrived: it opens once that has, two frames on, so it
    // animates in from its hidden state as it does later.
    void load().then(() => requestAnimationFrame(() => requestAnimationFrame(() => toggle?.())))
  })
  const stop = watchMenus("[data-component='voice-mode']", (open) => (orb.tabIndex = open ? -1 : 0))
  return { orb, stop }
}
