import { afterEach, describe, expect, test } from "bun:test"
import { motionGlobals, motionTuning } from "./motion-tuning"

const presets = {
  snappy: { duration: 0.15, bounce: 0 },
  smooth: { duration: 0.25, bounce: 0 },
  calm: { duration: 0.4, bounce: 0 },
}

afterEach(() => {
  motionTuning.set(motionGlobals.speed, 1)
  motionTuning.set(motionGlobals.slow, false)
})

describe("motionTuning.spring", () => {
  test("ships Snappy and keeps the other presets on the knob", () => {
    const spring = motionTuning.spring("test.shared", { label: "Spring", group: "Test", presets })
    const knob = motionTuning.list().find((item) => item.id === "test.shared")

    expect(spring()).toEqual(presets.snappy)
    expect(knob?.kind === "spring" && knob.initial).toEqual(presets.snappy)
    expect(knob?.kind === "spring" && knob.presets).toEqual(presets)
  })

  test("ships the preset a spring names", () => {
    const spring = motionTuning.spring("test.smooth", { label: "Spring", group: "Test", shipped: "smooth", presets })
    const knob = motionTuning.list().find((item) => item.id === "test.smooth")

    expect(spring()).toEqual(presets.smooth)
    expect(knob?.kind === "spring" && knob.initial).toEqual(presets.smooth)
  })

  test("runs a preset applied to its knob, stretched by the global speed and slow motion", () => {
    const spring = motionTuning.spring("test.scaled", { label: "Spring", group: "Test", presets })
    const knob = motionTuning.list().find((item) => item.id === "test.scaled")

    if (knob?.kind !== "spring") throw new Error("expected a spring knob")
    motionTuning.set(knob, knob.presets.calm)
    expect(spring()).toEqual({ duration: 0.4, bounce: 0 })

    motionTuning.set(motionGlobals.speed, 2)
    expect(spring().duration).toBeCloseTo(0.2)

    motionTuning.set(motionGlobals.slow, true)
    expect(spring().duration).toBeCloseTo(0.8)
  })
})

describe("motionTuning.choice", () => {
  test("starts on its shipped option and switches to another", () => {
    const choice = motionTuning.choice("test.choice", {
      label: "Choice",
      group: "Test",
      value: "b",
      labels: { a: "A", b: "B", c: "C" },
    })

    const knob = motionTuning.list().find((item) => item.id === "test.choice")

    if (knob?.kind !== "choice") throw new Error("expected a choice knob")

    expect(choice()).toBe("b")
    expect(knob.options).toEqual(["a", "b", "c"])

    motionTuning.set(knob, "c")
    expect(choice()).toBe("c")
  })
})
