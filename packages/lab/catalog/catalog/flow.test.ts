import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { Driver } from "opencode-drive/driver"
import { defineTaxonomies } from "./dsl"
import { defineExecutableFlow, executeFlow, FlowStateNotReachedError } from "./flow"

const taxonomies = defineTaxonomies({
  screenLabels: {
    session: { label: "Session", items: { transcript: "Transcript" } },
  },
  uiElements: {
    status: { label: "Status", items: { message: "Message" } },
  },
})

const stateMetadata = (title: string) => ({
  screen: {
    title,
    category: "session" as const,
    screenLabels: ["transcript"] as const,
    uiElements: ["message"] as const,
    surfaces: "inline" as const,
    patterns: "status" as const,
    features: "test",
    states: "default" as const,
  },
  step: { title },
})

function fixture(trace: Array<string>) {
  return defineExecutableFlow(
    taxonomies,
    {
      id: "test-flow",
      title: "Test flow",
      group: { id: "tests", label: "Tests" },
      description: "Exercises flow checkpoints.",
    },
    ({ state, program }) => {
      const first = state("first", stateMetadata("First"))
      const second = state("second", stateMetadata("Second"))
      const third = state("third", stateMetadata("Third"))
      return program([first, second, third], ({ checkpoint }) =>
        Effect.gen(function* () {
          trace.push("first")
          yield* checkpoint(first)
          trace.push("second")
          yield* checkpoint(second)
          trace.push("third")
          yield* checkpoint(third)
        }),
      )
    },
  )
}

const driver = undefined as unknown as Driver

describe("executable catalog flows", () => {
  test("captures every declared checkpoint in program order", async () => {
    const trace: Array<string> = []
    const captured: Array<string> = []
    const flow = fixture(trace)

    await Effect.runPromise(executeFlow(flow, {
      driver,
      capture: (state) => Effect.sync(() => captured.push(state.address)),
    }))

    expect(trace).toEqual(["first", "second", "third"])
    expect(captured).toEqual([
      "test-flow/first",
      "test-flow/second",
      "test-flow/third",
    ])
  })

  test("captures one selected state and interrupts the remaining program", async () => {
    const trace: Array<string> = []
    const captured: Array<string> = []
    const flow = fixture(trace)

    await Effect.runPromise(executeFlow(flow, {
      driver,
      through: flow.states[1],
      capture: (state) => Effect.sync(() => captured.push(state.address)),
    }))

    expect(trace).toEqual(["first", "second"])
    expect(captured).toEqual(["test-flow/second"])
  })

  test("rejects a full run that does not reach every declared state", async () => {
    const incomplete = defineExecutableFlow(
      taxonomies,
      {
        id: "incomplete-flow",
        title: "Incomplete flow",
        group: { id: "tests", label: "Tests" },
        description: "Omits its final state.",
      },
      ({ state, program }) => {
        const first = state("first", stateMetadata("First"))
        const missing = state("missing", stateMetadata("Missing"))
        return program([first, missing], ({ checkpoint }) => checkpoint(first))
      },
    )

    const error = await Effect.runPromise(executeFlow(incomplete, {
      driver,
      capture: () => Effect.void,
    }).pipe(Effect.flip))

    expect(error).toBeInstanceOf(FlowStateNotReachedError)
    expect(error).toMatchObject({ address: "incomplete-flow/missing" })
  })
})
