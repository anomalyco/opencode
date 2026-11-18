import { copyWithFeedback } from "~/component/site/copy-feedback"
import { checkPath, copyPath } from "~/component/site/icon-paths"
import { t } from "./dom"

/**
 * Copies with feedback in place (copy-feedback.ts), saying "Copied" in `live` if there is one, with
 * the button's copy icon drawn as a check meanwhile.
 */
export function copied(button: HTMLElement, write: () => Promise<unknown>, live?: Element | null) {
  const icon = button.querySelector<SVGPathElement>(`path[d="${copyPath}"], path[d="${checkPath}"]`)
  return copyWithFeedback(button, write, t("site.action.copied"), "", live ?? null, (check) => {
    icon?.setAttribute("d", check ? checkPath : copyPath)
    if (check) icon?.setAttribute("stroke-linecap", "square")
    if (!check) icon?.removeAttribute("stroke-linecap")
  })
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
