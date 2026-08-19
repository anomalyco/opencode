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

  // A discovery pass where the fit probe raced its abort budget (host busy —
  // which correlates with a host-paced model being loaded or generating) must
  // NOT wipe a previously-known verdict; that would re-arm the 300s deadline
  // for exactly the model that needs the 1800s floor. Fresh fit data stays
  // authoritative in both directions.
  test("a failed fit probe keeps the previous verdict; fresh data overrides", () => {
    Provider.noteHostPaced("z4", "big-moe", { hostPaced: true })
    expect(Provider.isHostPaced("z4", "big-moe")).toBe(true)

    // probe lost the race: no fit report for this pass
    Provider.noteHostPaced("z4", "big-moe", undefined)
    expect(Provider.isHostPaced("z4", "big-moe")).toBe(true)

    // re-placed fully GPU-resident: fresh data clears the flag
    Provider.noteHostPaced("z4", "big-moe", { hostPaced: false })
    expect(Provider.isHostPaced("z4", "big-moe")).toBe(false)
  })
})
