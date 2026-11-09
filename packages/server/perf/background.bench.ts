import { bench, script } from "@hona/strobe"
import { journey, metrics } from "./journey"

const background = journey()
export default bench({
  targets: { server: script("./server.ts") },
  params: { children: { run: [13], more: [1, 6] }, exchanges: { run: [26], more: [4] } },
  setup: background.setup,
  teardown: background.teardown,
  cases: {
    "resume an idle parent": {
      primary: "count.main_thread_cpu_us",
      metrics: [...metrics, "count.peak_children", "count.parent_executions"],
      run: background.run,
      reset: background.reset,
    },
  },
})
