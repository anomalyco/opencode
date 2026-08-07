import { describe, expect, test } from "bun:test"
import { Provider } from "@/provider/provider"

// Regression: opencode abandoned a working turn on a hybrid-placed model with
// "Provider stream stalled: no events for 300s". The model was fine — measured
// on z4, 254s can pass before the FIRST token of any kind while ~50 GB of
// expert weights fault back in, and generation then runs at ~0.8 tok/s.
describe("host-paced model registry", () => {
  test("an unknown model is not host-paced", () => {
    expect(Provider.isHostPaced("nope", "nothing")).toBe(false)
  })

  // The registry is populated during model discovery from llama-skein's
  // placement.perf_class; absent placement data must never mark a model paced,
  // so a non-llama-skein provider keeps the normal deadline.
  test("absence of placement data leaves a model unpaced", () => {
    expect(Provider.isHostPaced("openai", "gpt-4")).toBe(false)
  })
})
