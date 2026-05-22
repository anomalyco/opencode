import { describe, expect, test } from "bun:test"
import { createVeritlyUniverBridge, dispatchUniverOp } from "./relay-dispatch"
import type { UniverSdkRuntime } from "./index"

function mockSdk() {
  return {
    getActiveDocument: () => ({ unitId: "u1", sheetId: "s1", sheetName: "Sheet1" }),
    listSheets: () => [{ id: "s1", name: "Sheet1" }],
    getSheetRange: () => [["a"]],
    setRangeValues: () => undefined,
    addChart: async () => ({ chartId: "c1" }),
    inspectFacadeCapabilities: () => ({ apiMethods: [] }),
  }
}

function mockRuntime(): UniverSdkRuntime {
  return {
    univerAPI: {
      executeCommand: async (id: string) => ({ id }),
    },
  } as UniverSdkRuntime
}

describe("dispatchUniverOp", () => {
  test("get_active_document", async () => {
    const resp = await dispatchUniverOp(mockSdk(), mockRuntime(), { id: "1", op: "get_active_document" })
    expect(resp.ok).toBe(true)
    expect(resp.result).toEqual({ unitId: "u1", sheetId: "s1", sheetName: "Sheet1" })
  })

  test("unsupported op", async () => {
    const resp = await dispatchUniverOp(mockSdk(), mockRuntime(), { id: "2", op: "unknown" })
    expect(resp.ok).toBe(false)
    expect(resp.error).toContain("unsupported op")
  })
})

describe("createVeritlyUniverBridge", () => {
  test("roundtrips JSON request", async () => {
    const bridge = createVeritlyUniverBridge(mockSdk(), mockRuntime())
    const raw = await bridge.call(JSON.stringify({ id: "b1", op: "list_sheets" }))
    const parsed = JSON.parse(raw) as { id: string; ok: boolean; result?: unknown }
    expect(parsed.ok).toBe(true)
    expect(parsed.id).toBe("b1")
  })
})
