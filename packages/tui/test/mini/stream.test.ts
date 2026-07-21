import { describe, expect, test } from "bun:test"
import { writeSessionOutput } from "../../src/mini/stream"
import { createFooterApiFixture } from "./fixture/footer-api"

describe("run stream bridge", () => {
  test("defaults status patches to running phase", () => {
    const out = createFooterApiFixture()

    writeSessionOutput(
      {
        footer: out.api,
      },
      {
        commits: [],
        updates: [{ type: "stream.patch", patch: { status: "assistant responding" } }],
      },
    )

    expect(out.events).toEqual([
      {
        type: "stream.patch",
        patch: {
          phase: "running",
          status: "assistant responding",
        },
      },
    ])
  })

  test("delivers commits before ordered footer updates", () => {
    const out = createFooterApiFixture()

    writeSessionOutput(
      { footer: out.api },
      {
        commits: [{ kind: "assistant", source: "assistant", text: "answer", phase: "progress" }],
        updates: [
          { type: "stream.patch", patch: { phase: "idle", status: "" } },
          { type: "stream.subagent", state: { tabs: [], details: {}, permissions: [], forms: [] } },
          { type: "stream.view", view: { type: "prompt" } },
        ],
      },
    )

    expect(out.calls.map((call) => (call.type === "commit" ? "commit" : call.value.type))).toEqual([
      "commit",
      "stream.patch",
      "stream.subagent",
      "stream.view",
    ])
  })

})
