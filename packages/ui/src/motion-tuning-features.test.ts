import { expect, test } from "bun:test"
import { motionTuning } from "./motion-tuning"
import {
  activeFeaturePreset,
  applyFeaturePreset,
  featureChanged,
  featureControls,
  featurePresets,
  motionFeatures,
  resetFeature,
} from "./motion-tuning-features"

const presets = {
  snappy: { duration: 0.15, bounce: 0 },
  smooth: { duration: 0.25, bounce: 0 },
  calm: { duration: 0.4, bounce: 0 },
}

const feature = (area: string, name: string) => {
  const found = motionFeatures()
    .find((item) => item.area === area)
    ?.features.find((item) => item.name === name)

  if (!found) throw new Error(`no ${area} › ${name}`)

  return found
}

test("groups knobs into features under their areas, with the speed left to the debug bar", () => {
  motionTuning.spring("features.drawer", { label: "Spring", group: "Drawer", presets })
  motionTuning.toggle("features.drawer.dim", { label: "Dim", group: "Drawer", value: true })
  motionTuning.toggle("features.lightbox", {
    label: "Lightbox",
    group: "Drawer",
    subsection: "Lightbox",
    description: "Images open over the app.",
    target: "#lightbox",
    experiment: true,
    value: false,
  })
  motionTuning.choice("features.solo", { label: "Solo", group: "Solo area", value: "a", labels: { a: "A", b: "B" } })
  const stop = motionTuning.action({ id: "features.replay", label: "Open", group: "Drawer", run: () => {} })

  const drawer = motionFeatures().find((item) => item.area === "Drawer")

  expect(motionFeatures().some((item) => item.area === "Global")).toBe(false)
  expect(drawer?.features.map((item) => item.name)).toEqual(["General", "Lightbox"])
  expect(feature("Drawer", "General").actions.map((item) => item.label)).toEqual(["Open"])
  expect(feature("Drawer", "Lightbox")).toMatchObject({ description: "Images open over the app.", target: "#lightbox" })
  expect(feature("Drawer", "Lightbox").switch?.id).toBe("features.lightbox")
  // A lone knob names its area's feature.
  expect(feature("Solo area", "Solo").knobs.map((item) => item.id)).toEqual(["features.solo"])
  stop()
})

test("matches, applies and resets a feature's presets", () => {
  motionTuning.spring("presets.panel", { label: "Spring", group: "Presets", subsection: "Panel", presets })
  motionTuning.choice("presets.panel.fade", {
    label: "Fade",
    group: "Presets",
    subsection: "Panel",
    value: "edge",
    labels: { edge: "Edge", off: "Off" },
  })
  motionTuning.choice("presets.panel.style", {
    label: "Style",
    group: "Presets",
    subsection: "Panel",
    experiment: true,
    value: "a",
    labels: { a: "A", b: "B" },
  })
  const james = motionTuning.mode("presets.panel.james", { label: "James", group: "Presets", subsection: "Panel" })

  const shift = motionTuning.spring("presets.panel.james.shift", {
    label: "Shift",
    group: "Presets",
    subsection: "Panel",
    when: james,
    presets,
  })

  const panel = feature("Presets", "Panel")

  const knob = (id: string) => {
    const found = panel.knobs.find((item) => item.id === id)

    if (!found) throw new Error(`no ${id}`)

    return found
  }

  expect(featurePresets(panel)).toEqual(["shipped", "snappy", "smooth", "calm", "presets.panel.james"])
  expect(featureControls(panel).map((item) => item.id)).toEqual(["presets.panel", "presets.panel.fade", "presets.panel.style"])
  expect(activeFeaturePreset(panel)).toBe("shipped")

  // Trying an experiment's design isn't tuning.
  motionTuning.set(knob("presets.panel.style"), "b")
  expect(activeFeaturePreset(panel)).toBe("shipped")
  expect(featureChanged(panel)).toBe(true)

  applyFeaturePreset(panel, "calm")
  expect(knob("presets.panel").value).toEqual(presets.calm)
  expect(activeFeaturePreset(panel)).toBe("calm")

  // A preset sets only springs, so another knob tuned by hand is Custom.
  motionTuning.set(knob("presets.panel.fade"), "off")
  expect(activeFeaturePreset(panel)).toBeUndefined()
  motionTuning.set(knob("presets.panel.fade"), "edge")
  expect(activeFeaturePreset(panel)).toBe("calm")

  motionTuning.set(knob("presets.panel"), { duration: 0.3, bounce: 0 })
  expect(activeFeaturePreset(panel)).toBeUndefined()

  applyFeaturePreset(panel, "presets.panel.james")
  expect(james()).toBe(true)
  expect(activeFeaturePreset(panel)).toBe("presets.panel.james")
  expect(featureControls(panel).map((item) => item.id)).toContain("presets.panel.james.shift")
  expect(shift()).toEqual(presets.snappy)

  applyFeaturePreset(panel, "shipped")
  expect(james()).toBe(false)
  expect(knob("presets.panel").value).toEqual(presets.snappy)
  expect(knob("presets.panel.style").value).toBe("b")

  resetFeature(panel)
  expect(knob("presets.panel.style").value).toBe("a")
  expect(featureChanged(panel)).toBe(false)
})
