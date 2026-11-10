import { LogoWall } from "~/component/site/logo-wall"
import { siteSettings } from "~/component/site/settings"
import { logoWalls } from "~/lib/home-content"
import { $ } from "../dom"
import { swap } from "../solid"

/**
 * The logo row under the home hero (logo-wall.tsx): rendered again in the browser in place of the
 * server's copy, which keeps its logos unseen until then (reveal.css), so it can measure its row,
 * play its entrance and keep handing slots over to other logos.
 */
export default function logoWall(root: HTMLElement) {
  const label = $('[data-slot="label"]', root)
  const long = $('[data-slot="long"]', label ?? root)?.textContent
  const kind = root.dataset.kind === "providers" ? "providers" : "companies"
  void swap(
    () => (
      <LogoWall
        kind={kind}
        layout={siteSettings.logoLayout}
        label={long ?? label?.textContent ?? ""}
        shortLabel={$('[data-slot="short"]', root)?.textContent ?? undefined}
        items={logoWalls[kind]}
        animation={siteSettings.logoAnimation}
        tuning={siteSettings.logoTuning}
        interval={siteSettings.logoInterval}
        stagger={siteSettings.logoStagger}
        opacity={siteSettings.logoOpacity}
      />
    ),
    root,
  )
}
