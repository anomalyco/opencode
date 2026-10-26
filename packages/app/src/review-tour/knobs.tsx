import { motionTuning } from "@opencode/ui/motion-tuning"
import { choice, defineControls, type Field } from "knobs"
import { createEffect, createSignal, onCleanup, onMount, untrack } from "solid-js"
import {
  applyMotionPatch,
  motionFields,
  motionScopes,
  motionValues,
  sameMotion,
  storyMotion,
} from "@/components-lab/motion"
import { useLanguage } from "@/runtime/i18n/language"
import type { TourStop, TourTweak } from "./manifest"
import type { StopScope } from "./setup"
import { selectorError } from "./spotlight"

/**
 * A stop's Knobs, in a card above the floater: the knobs it names in `tune`, picked as a components-lab story picks
 * them, and its before/after `tweaks`. Knob edits go back when the stop is left, with the rest of its setup; a tweak
 * restyles only while its stop shows.
 */
export function StopKnobs(props: { stop: TourStop; scope: StopScope; onProblem: (error: string) => void }) {
  const language = useLanguage()
  let container!: HTMLDivElement
  const names = props.stop.tune ?? []
  const [motion, setMotion] = createSignal(storyMotion(names), { equals: sameMotion })
  const style = document.createElement("style")
  style.dataset.reviewTour = props.stop.id

  // A tweak whose selector or values the page can't use is reported once and left out.
  const tweaks = (props.stop.tweaks ?? []).filter((tweak) => {
    const problem = tweakError(tweak)

    if (problem) props.onProblem(problem)

    return !problem
  })

  const chosen = tweaks.map((tweak) => tweak.options[0].label)

  const restyle = () => {
    style.textContent = tweaks
      .flatMap((tweak, index) => {
        const value = tweak.options.find((option) => option.label === chosen[index])?.value

        return value === undefined ? [] : [`${tweak.selector} { ${tweak.property}: ${value} !important; }`]
      })
      .join("\n")
  }

  onMount(() => document.head.append(style))
  onCleanup(() => style.remove())

  const tweakFields = Object.fromEntries(
    tweaks.map((tweak, index): [string, Field] => [
      `tweak.${index}`,
      choice(
        tweak.options[0].label,
        [tweak.options[0].label, ...tweak.options.slice(1).map((option) => option.label)],
        { label: tweak.label, group: language.t("tour.compare") },
      ),
    ]),
  )

  createEffect(() => {
    const current = motion()
    const scopes = motionScopes(current)
    props.scope.remember([...current.knobs, ...current.globals])

    const controls = defineControls(
      "review-tour",
      { ...tweakFields, ...motionFields(current) },
      {
        storage: null,
        persist: "none",
        // Beta is a production build, where knobs resolves its production entry: the panel mounts only when shipped.
        ship: () => import("knobs/panel"),
        defaultLabel: scopes.defaultLabels,
        inPresets: { ...scopes.inPresets, [language.t("tour.compare")]: false },
        scopedPresets: scopes.scopedPresets,
        onChange: (patch) => {
          applyMotionPatch(current, patch)
          tweaks.forEach((tweak, index) => {
            const option = tweak.options.find((item) => item.label === patch[`tweak.${index}`])

            if (option) chosen[index] = option.label
          })
          restyle()
        },
      },
    )

    controls.sync({
      ...motionValues(current),
      ...Object.fromEntries(chosen.map((label, index) => [`tweak.${index}`, label])),
    })

    onCleanup(
      controls.mount(container, {
        theme: "auto",
        title: language.t("tour.knobs"),
        header: { buttons: ["reset"] },
        variants: false,
        session: false,
        toggleKey: false,
        hints: "panel",
      }),
    )

    // Edits from elsewhere, such as the debug bar's Knobs, show here too; a knob that registers or whose `when`
    // changes rebuilds the card.
    onCleanup(
      motionTuning.subscribe(() => {
        const next = storyMotion(names)

        if (!sameMotion(next, untrack(motion))) return setMotion(next)
        controls.sync(motionValues(next))
      }),
    )
  })

  return <div ref={container} data-slot="review-tour-knobs" class="w-[288px]" />
}

function tweakError(tweak: TourTweak) {
  const selector = selectorError(tweak.selector)

  if (selector) return selector

  const invalid = tweak.options.find(
    (option) => option.value !== undefined && !CSS.supports(tweak.property, option.value),
  )

  if (invalid) return `${tweak.label}: ${tweak.property} can't be ${invalid.value}`
}
