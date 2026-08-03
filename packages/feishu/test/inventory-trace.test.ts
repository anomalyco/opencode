import { describe, expect, test } from "bun:test"
import {
  createInventoryTrace,
  type InventoryTraceEvent,
} from "../src/inventory-trace"

function event(
  type: InventoryTraceEvent["type"],
  data: InventoryTraceEvent["data"] = {},
): InventoryTraceEvent {
  return {
    traceID: "trace-1",
    conversationID: "conversation-1",
    messageID: "message-1",
    type,
    occurredAt: 1_000,
    data,
  }
}

describe("inventory trace", () => {
  test("appends the reconstructable successful event sequence", async () => {
    const events: InventoryTraceEvent[] = []
    const trace = createInventoryTrace({
      append(value) {
        events.push(value)
      },
    })

    await trace.append(event("inventory_intent_admitted", { term: "6001ZZ" }))
    await trace.append(
      event("inventory_query_started", {
        templateVersion: "mysql-inventory-v2",
        term: "6001ZZ",
        limit: 20,
      }),
    )
    await trace.append(event("inventory_query_completed", { rowCount: 2, durationMs: 10 }))
    await trace.append(event("inventory_answer_mapped", { itemCount: 1 }))
    await trace.append(
      event("inventory_answer_delivered", {
        answer: "6001ZZ（12×28×8）（货架号：A-1-1、A-1-4）虎旺库存177",
      }),
    )

    expect(events.map((value) => value.type)).toEqual([
      "inventory_intent_admitted",
      "inventory_query_started",
      "inventory_query_completed",
      "inventory_answer_mapped",
      "inventory_answer_delivered",
    ])
    expect(events[1]?.data).toEqual({
      templateVersion: "mysql-inventory-v2",
      term: "6001ZZ",
      limit: 20,
    })
  })

  test("excludes credential keys and secret-bearing values", async () => {
    const events: InventoryTraceEvent[] = []
    const trace = createInventoryTrace({
      append(value) {
        events.push(value)
      },
    })

    await trace.append(
      event("inventory_query_failed", {
        password: "password=secret-value",
        passwordFile: "D:\\secrets\\mysql-password",
        connectionString: "mysql://user:secret@host/schema",
        reasoning: "hidden model reasoning",
        error: "mysql://user:secret@host/schema",
        status: "failed",
      } as InventoryTraceEvent["data"]),
    )

    expect(events[0]?.data).toEqual({ status: "failed" })
    expect(JSON.stringify(events)).not.toMatch(/secret-value|\\secrets\\|mysql:\/\/|reasoning/)
  })

  test("rejects nested data instead of serializing an unknown object", async () => {
    const events: InventoryTraceEvent[] = []
    const trace = createInventoryTrace({
      append(value) {
        events.push(value)
      },
    })

    const nested = Object.assign(event("inventory_answer_mapped"), {
      data: { result: { productID: "2694" } },
    })

    expect(trace.append(nested)).rejects.toThrow("inventory trace data invalid")
    expect(events).toHaveLength(0)
  })

  test("copies append-only data and links corrections without changing the original", async () => {
    const events: InventoryTraceEvent[] = []
    const trace = createInventoryTrace({
      append(value) {
        events.push(value)
      },
    })
    const shelves = ["B-11-13"]
    const original = event("inventory_answer_mapped", { shelves })

    await trace.append(original)
    const snapshot = JSON.stringify(events[0])
    shelves.push("B-11-2")
    await trace.append({
      ...event("inventory_correction", { field: "shelves", value: "B-11-2" }),
      relatedEventID: "event-1",
    })

    expect(JSON.stringify(events[0])).toBe(snapshot)
    expect(events[1]?.relatedEventID).toBe("event-1")
  })
})
