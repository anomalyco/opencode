import { motionTuning } from "@opencode/ui/motion-tuning"
import { createStore } from "solid-js/store"

export type SiteIconMode = "letters" | "site"

const enabled = motionTuning.toggle("sources.enabled", {
  label: "Enabled",
  group: "Experiments",
  subsection: "Sources",
  description: "Pages a turn searched and read",
  target: '[data-component="sources-chip"]',
  experiment: true,
  value: false,
})

// A site's own icon is fetched from that site, which tells it the page was looked at; letters stay on this device.
const icons = motionTuning.choice("sources.icons", {
  label: "Site icons",
  group: "Experiments",
  subsection: "Sources",
  when: enabled,
  value: "letters",
  labels: { letters: "Letters", site: "Site icon" },
})

/** The chip fading in as its turn finishes. */
export const sourcesFade = motionTuning.spring("sources.fade", {
  label: "Fade in",
  group: "Experiments",
  subsection: "Sources",
  when: enabled,
  shipped: "smooth",
  presets: {
    snappy: { duration: 0.2, bounce: 0 },
    smooth: { duration: 0.3, bounce: 0 },
    calm: { duration: 0.45, bounce: 0 },
  },
})

/** A search opening to its results, and closing again. */
export const sourcesExpand = motionTuning.spring("sources.expand", {
  label: "Expand",
  group: "Experiments",
  subsection: "Sources",
  when: enabled,
  shipped: "smooth",
  presets: {
    snappy: { duration: 0.25, bounce: 0 },
    smooth: { duration: 0.35, bounce: 0 },
    calm: { duration: 0.45, bounce: 0 },
  },
})

const [state, setState] = createStore({ enabled: enabled(), icons: icons() })

motionTuning.subscribe(() => setState({ enabled: enabled(), icons: icons() }))

/** Experiment: a "N sources" chip under a reply that searched the web, opening the turn's searches in the side panel. */
export const sourcesExperiment = state
