import { useI18n } from "@opencode/ui/context/i18n"
import { Icon } from "@opencode/ui/icon"
import { frameLoop, prefersReducedMotion, Spring } from "@opencode/ui/motion"
import { createMemo, For, onCleanup, onMount, Show } from "solid-js"
import { sourcesFade, type SiteIconMode } from "./experiment"
import { SiteIcon } from "./site-icon"
import type { TurnSources } from "./sources"
import "./sources.css"

/**
 * "N sources" under a reply, with the first three sites stacked. `appear` fades it in, for a turn that finished while
 * it was on screen; a turn that was already done shows it at rest.
 */
export function SourcesChip(props: { sources: TurnSources; icons: SiteIconMode; appear: boolean; onOpen: () => void }) {
  const i18n = useI18n()
  let button: HTMLButtonElement | undefined

  const sites = createMemo(() =>
    props.sources.sources
      .filter((source, index, all) => all.findIndex((item) => item.site === source.site) === index)
      .slice(0, 3),
  )

  onMount(() => {
    if (!props.appear || !button) return
    const el = button
    const spring = Spring.fromDuration(0, prefersReducedMotion() ? { duration: 0.15, bounce: 0 } : sourcesFade())
    spring.set(1)
    el.style.opacity = "0"

    onCleanup(
      frameLoop.add((dt) => {
        el.style.opacity = String(spring.step(dt))

        if (!spring.resting) return true
        el.style.opacity = ""

        return false
      }),
    )
  })

  return (
    <button ref={button} type="button" data-component="sources-chip" onClick={() => props.onOpen()}>
      <span data-slot="sources-chip-icons">
        <Show when={props.sources.sources.length > 0} fallback={<Icon name="globe" size="small" />}>
          <For each={sites()}>{(source) => <SiteIcon site={source.site} host={source.host} mode={props.icons} />}</For>
        </Show>
      </span>
      <span data-slot="sources-chip-label">
        {props.sources.sources.length > 0
          ? i18n.plural("ui.sources.count", props.sources.sources.length)
          : i18n.t("ui.sources.none")}
      </span>
    </button>
  )
}
