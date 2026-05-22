import type { AddChartInput, RangeRect, SetRangeValuesInput, UniverSdkRuntime } from "./index"

export type RelayRequest = {
  id: string
  op: string
  params?: unknown
  traceparent?: string
}

export type RelayResponse = {
  id: string
  ok: boolean
  result?: unknown
  error?: string
  traceparent?: string
}

type GetRangeInput = { sheetId?: string; range: RangeRect }

type Sdk = {
  getActiveDocument(): unknown
  listSheets(): unknown
  getSheetRange(input: GetRangeInput): unknown
  setRangeValues(input: SetRangeValuesInput): void
  addChart(input: AddChartInput): Promise<unknown>
  inspectFacadeCapabilities(input?: { sheetId?: string; range?: RangeRect }): unknown
}

export async function dispatchUniverOp(sdk: Sdk, runtime: UniverSdkRuntime, req: RelayRequest): Promise<RelayResponse> {
  if (!req.id || !req.op) {
    return { id: "relay", ok: false, error: "request must include id and op" }
  }

  try {
    switch (req.op) {
      case "get_active_document":
        return { id: req.id, ok: true, result: sdk.getActiveDocument() }
      case "list_sheets":
        return { id: req.id, ok: true, result: sdk.listSheets() }
      case "get_range":
        return { id: req.id, ok: true, result: sdk.getSheetRange(req.params as GetRangeInput) }
      case "set_range":
        sdk.setRangeValues(req.params as SetRangeValuesInput)
        return { id: req.id, ok: true, result: true }
      case "add_chart":
        return { id: req.id, ok: true, result: await sdk.addChart(req.params as AddChartInput) }
      case "sdk_introspect":
        return {
          id: req.id,
          ok: true,
          result: sdk.inspectFacadeCapabilities(
            req.params as { sheetId?: string; range?: RangeRect } | undefined,
          ),
        }
      case "execute_command": {
        const raw = req.params
        if (raw === null || typeof raw !== "object") {
          return { id: req.id, ok: false, error: "execute_command requires params object" }
        }
        const cmdId = Reflect.get(raw, "id")
        if (typeof cmdId !== "string") {
          return { id: req.id, ok: false, error: "execute_command requires params.id (string)" }
        }
        const cmdParams = Reflect.get(raw, "params")
        if (cmdParams !== undefined && (cmdParams === null || typeof cmdParams !== "object")) {
          return { id: req.id, ok: false, error: "execute_command params.params must be an object when set" }
        }
        const result = await runtime.univerAPI.executeCommand(
          cmdId,
          cmdParams === undefined ? undefined : cmdParams,
        )
        return { id: req.id, ok: true, result }
      }
      default:
        return { id: req.id, ok: false, error: `unsupported op: ${req.op}` }
    }
  } catch (err) {
    return {
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : "sdk operation failed",
    }
  }
}

export type VeritlyUniverBridge = {
  call(payload: string): Promise<string>
}

export function createVeritlyUniverBridge(sdk: Sdk, runtime: UniverSdkRuntime): VeritlyUniverBridge {
  return {
    async call(payload: string) {
      let req: RelayRequest
      try {
        req = JSON.parse(payload) as RelayRequest
      } catch {
        return JSON.stringify({ id: "relay", ok: false, error: "invalid json payload" } satisfies RelayResponse)
      }
      const resp = await dispatchUniverOp(sdk, runtime, req)
      return JSON.stringify(resp)
    },
  }
}

export type VeritlyUniverBridgeWindow = {
  __veritlyUniverBridge?: VeritlyUniverBridge
}
