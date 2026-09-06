import { BoxRenderable, TextRenderable } from "@opentui/core"
import { Effect } from "effect"
import { SimulationActions } from "../src/frontend/actions"
import { SimulationRenderer } from "../src/frontend/renderer"

// One warmup, seven measured batches. Real mouse dispatch and rendering included.
await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const renderer = yield* SimulationRenderer.create({})
      const label = new TextRenderable(renderer, { content: "Clicks: 0" })
      let clicks = 0
      const button = new BoxRenderable(renderer, {
        width: 20,
        height: 1,
        onMouseUp: () => {
          label.content = `Clicks: ${++clicks}`
        },
      })
      button.add(label)
      renderer.root.add(button)
      const harness = SimulationActions.createHarness(renderer)
      yield* Effect.promise(() => harness.renderOnce())
      const samples: number[] = []
      for (let batch = 0; batch < 8; batch++) {
        const start = performance.now()
        for (let index = 0; index < 20; index++) {
          yield* SimulationActions.execute(harness, { type: "ui.click", target: button.num, x: 1, y: 0 })
          if (!harness.screen().includes(`Clicks: ${clicks}`)) throw new Error("click returned before painting")
          if (harness.mockMouse.getPressedButtons().length) throw new Error("click left a button held")
        }
        if (clicks !== (batch + 1) * 20) throw new Error("lost a native click")
        if (batch > 0) samples.push((performance.now() - start) / 20)
      }
      const median = samples.toSorted((a, b) => a - b)[3]
      if (median === undefined) throw new Error("missing benchmark samples")
      const mad = samples.map((value) => Math.abs(value - median)).sort((a, b) => a - b)[3]
      console.log(JSON.stringify({ metric: "simulation_click_ms", median, mad, samples, clicks }))
      console.log(`METRIC simulation_click_ms=${median.toFixed(3)}`)
    }),
  ),
)
