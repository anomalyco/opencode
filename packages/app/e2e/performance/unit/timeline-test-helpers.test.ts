import { expect, test } from "bun:test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { fixture } from "../timeline/session-timeline-stress.fixture"
import { stressSessionHref } from "../timeline/timeline-test-helpers"

test("builds stress session links for the benchmark server", () => {
  expect(stressSessionHref(fixture.sourceID)).toBe(
    `/server/${base64Encode("http://127.0.0.1:4096")}/session/${fixture.sourceID}`,
  )
})
