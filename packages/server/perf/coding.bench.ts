import { bench, script } from "@hona/strobe"
import { journey, metrics } from "./journey"

const coding = journey()
export default bench({
  targets: { server: script("./server.ts") },
  params: { exchanges: { run: [4, 26], more: [80] } },
  setup: coding.setup,
  teardown: coding.teardown,
  cases: {
    "continue a coding session": { primary: "count.main_thread_cpu_us", metrics, run: coding.run, reset: coding.reset },
  },
})
