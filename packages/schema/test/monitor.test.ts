import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { EventManifest } from "../src/event-manifest.js"
import { Monitor } from "../src/monitor.js"
import { SessionID } from "../src/session-id.js"
import { Shell } from "../src/shell.js"

describe("monitor contract", () => {
  test("creates only IDs with the exact monitor prefix", () => {
    expect(Monitor.ID.create()).toStartWith("mon_")
    expect(() => Schema.decodeUnknownSync(Monitor.ID)("monitor")).toThrow()
  })

  test("omits absent lifecycle fields from the wire representation", () => {
    const info = {
      id: Monitor.ID.create(),
      sessionID: SessionID.create(),
      shellID: Shell.ID.create(),
      description: "Watch CI",
      delivery: "steer" as const,
      log: "/tmp/monitor.log",
      startedAt: 0,
      expiresAt: 300_000,
      eventCount: 0,
      outputBytes: 0,
      status: "running" as const,
    }
    expect(
      Schema.encodeSync(Monitor.Info)({
        ...info,
        pid: undefined,
        endedAt: undefined,
        reason: undefined,
        exitCode: undefined,
      }),
    ).toEqual(info)
    expect(Schema.decodeUnknownSync(Monitor.Info)({ ...info, delivery: "queue" }).delivery).toBe("queue")
    expect(() => Schema.decodeUnknownSync(Monitor.Info)({ ...info, delivery: "interrupt" })).toThrow()
  })

  test("exports canonical ephemeral lifecycle events to clients", () => {
    expect(Monitor.Event.Definitions.map((event) => event.type)).toEqual([
      "monitor.started",
      "monitor.event",
      "monitor.ended",
    ])
    for (const event of Monitor.Event.Definitions) {
      expect(EventManifest.Server.get(event.type)).toBe(event)
      expect(EventManifest.Latest.get(event.type)).toBe(event)
      expect(event.durability).toBe("ephemeral")
      expect(EventManifest.Durable.has(event.type)).toBe(false)
    }
    expect(
      [Monitor.ID, Monitor.Status, Monitor.Reason, Monitor.Info].map(
        (schema) => Schema.resolveAnnotations(schema)?.identifier,
      ),
    ).toEqual(["Monitor.ID", "Monitor.Status", "Monitor.Reason", "Monitor.Info"])
  })
})
