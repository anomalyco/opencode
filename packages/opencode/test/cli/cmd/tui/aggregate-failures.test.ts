/**
 * Regression test for the TUI bootstrap aggregation helper. Replaces the
 * pre-fix Promise.all behavior where the first rejection drowned every
 * sibling endpoint's failure as an unhandled rejection.
 */
import { describe, expect, test } from "bun:test"
import { aggregateFailures } from "@/cli/cmd/tui/context/aggregate-failures"
import { ConfigError } from "@/config/error"

describe("aggregateFailures", () => {
  test("returns null when every result is fulfilled", () => {
    expect(
      aggregateFailures([
        { name: "config", result: { status: "fulfilled", value: 1 } },
        { name: "providers", result: { status: "fulfilled", value: 2 } },
      ]),
    ).toBeNull()
  })

  test("names the failed endpoint when one rejects", () => {
    const err = aggregateFailures([
      { name: "config", result: { status: "fulfilled", value: 1 } },
      {
        name: "providers",
        result: { status: "rejected", reason: new Error("Service unavailable") },
      },
    ])
    expect(err).toBeInstanceOf(Error)
    expect(err!.message).toContain("1 of 2")
    expect(err!.message).toContain("providers: Service unavailable")
  })

  test("names every failed endpoint when multiple reject", () => {
    const err = aggregateFailures([
      { name: "config", result: { status: "rejected", reason: new Error("400 Bad Request") } },
      { name: "providers", result: { status: "fulfilled", value: 1 } },
      { name: "agents", result: { status: "rejected", reason: { message: "boom" } } },
    ])
    expect(err).toBeInstanceOf(Error)
    expect(err!.message).toContain("2 of 3")
    expect(err!.message).toContain("config: 400 Bad Request")
    expect(err!.message).toContain("agents: boom")
  })

  test("formats structured config errors hidden inside SDK error causes", () => {
    const configError = new ConfigError.InvalidError({
      path: "/tmp/opencode.json",
      issues: [{ message: "Expected object", path: ["provider", "anthropic", "options"] }],
    })
    const err = aggregateFailures([
      {
        name: "config.get",
        result: {
          status: "rejected",
          reason: new Error("ConfigInvalidError", {
            cause: {
              body: configError.toObject(),
            },
          }),
        },
      },
    ])

    expect(err!.message).toContain("config.get: Configuration is invalid at /tmp/opencode.json")
    expect(err!.message).toContain("Expected object provider.anthropic.options")
  })

  test("deduplicates identical failure messages across startup requests", () => {
    const reason = new Error("same config problem")
    const err = aggregateFailures([
      { name: "config.providers", result: { status: "rejected", reason } },
      { name: "provider.list", result: { status: "rejected", reason } },
      { name: "app.agents", result: { status: "rejected", reason } },
      { name: "config.get", result: { status: "rejected", reason } },
      { name: "project.sync", result: { status: "fulfilled", value: undefined } },
    ])

    expect(err!.message).toContain("4 of 5 requests failed: same config problem")
    expect(err!.message).toContain("Affected startup requests: config.providers, provider.list, app.agents, config.get")
    expect(err!.message.match(/same config problem/g)?.length).toBe(1)
  })

  test("attaches structured failure list under .cause", () => {
    const reason = new Error("nope")
    const err = aggregateFailures([{ name: "providers", result: { status: "rejected", reason } }])
    expect(err!.cause).toEqual({ failures: [{ name: "providers", reason }] })
  })

  test("falls back to String() for opaque reasons", () => {
    const err = aggregateFailures([{ name: "x", result: { status: "rejected", reason: 42 } }])
    expect(err!.message).toContain("x: 42")
  })
})
