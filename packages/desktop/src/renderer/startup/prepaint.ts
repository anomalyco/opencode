// The early document carries a static copy of this window's shell from the previous run, served by
// the main process as #oc-prepaint, so the user sees their UI while the renderer boots. It is
// removed when the real interface is ready to be revealed, and re-captured from the live DOM so the
// next launch shows the current state.

const prepaintID = "oc-prepaint"
const maxBytes = 1_000_000

export function hasPrepaint() {
  return document.getElementById(prepaintID) !== null
}

export function removePrepaint() {
  document.getElementById(prepaintID)?.remove()
}

let timer: number | undefined

// Captures once the renderer is idle; `delay` coalesces bursts of route changes into one capture.
export function schedulePrepaintCapture(save: (html: string) => Promise<void>, delay = 0) {
  clearTimeout(timer)
  timer = window.setTimeout(() => {
    requestIdleCallback(
      () => {
        const root = document.getElementById("root")
        const html = root && capturePrepaint(root)
        if (html) void save(html).catch(() => undefined)
      },
      { timeout: 2000 },
    )
  }, delay)
}

// Elements that hold live or transient state and would look wrong, or leak, in a static copy.
const dropped =
  "script, style, link, iframe, object, embed, canvas, video, audio, dialog, [popover], [role='dialog'], [role='menu'], [role='listbox'], [role='tooltip'], [data-component='startup-overlay']"
// Attributes that could act, be targeted, or collide with the live document once it mounts.
const stripped = new Set(["id", "href", "tabindex", "contenteditable", "autofocus", "for", "name", "action", "formaction"])

export function capturePrepaint(root: HTMLElement) {
  const clone = root.cloneNode(true) as HTMLElement
  clone.querySelectorAll(dropped).forEach((element) => element.remove())
  const symbols = new Set<string>()
  for (const element of clone.querySelectorAll("*")) {
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) element.removeAttribute("value")
    if (element.hasAttribute("contenteditable")) element.replaceChildren()
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name
      if (name.startsWith("on")) element.removeAttribute(name)
      // SVG keeps its ids and hrefs: gradients, clip paths and <use> references are local visuals.
      if (element instanceof SVGElement) {
        if (name === "href" && attribute.value.startsWith("#")) symbols.add(attribute.value.slice(1))
        continue
      }
      if (stripped.has(name)) element.removeAttribute(name)
      if (name === "src" && !/^(\.\/|\/|oc:|data:)/.test(attribute.value)) element.removeAttribute(name)
    }
  }
  const root_ = document.documentElement
  const html = `<div class="${document.body.className} flex flex-col h-dvh" lang="${root_.lang}" dir="${root_.dir}">${sprite(symbols)}${clone.innerHTML}</div>`
  return html.length <= maxBytes ? html : undefined
}

// Icons are <use href="#symbol"> into a sprite outside #root; copy only the symbols the shell uses.
function sprite(symbols: Set<string>) {
  const defs = [...symbols]
    .map((id) => document.getElementById(id))
    .filter((element) => element instanceof SVGSymbolElement)
    .map((element) => element.outerHTML)
  if (!defs.length) return ""
  return `<svg aria-hidden="true" width="0" height="0" style="position:absolute;overflow:hidden">${defs.join("")}</svg>`
}
