// A JSON-RPC client for an `OPENCODE_DRIVE` UI endpoint (packages/protocol/src/simulation.ts), shared by P-TUI
// (parity/sim/run.ts) and the H.4 proof.
import { Schema } from "effect"
import { JsonRpc } from "@opencode/protocol/simulation"

export type DriveClient = Awaited<ReturnType<typeof connectDrive>>

export async function connectDrive(url: string, label: string) {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })
  const pending = new Map<number, (value: JsonRpc.Response) => void>()
  socket.onmessage = (event) => {
    const response = Schema.decodeUnknownSync(JsonRpc.Response)(JSON.parse(String(event.data)))
    pending.get(Number(response.id))?.(response)
  }
  let id = 0
  const send = (method: string, params: unknown, ms: number) =>
    new Promise<JsonRpc.Response | undefined>((resolve) => {
      const current = ++id
      const timer = setTimeout(() => {
        pending.delete(current)
        resolve(undefined)
      }, ms)
      pending.set(current, (response) => {
        clearTimeout(timer)
        pending.delete(current)
        resolve(response)
      })
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: current, method, ...(params === undefined ? {} : { params }) }))
    })
  // The TS endpoint never answers a `ui.matches` whose screen read meets a frame in flight (`OutputBusy` is a defect
  // its control server only logs), so a screen read that goes unanswered is sent again. Reads change nothing, so a
  // resend is safe. This is the only place that works around it.
  const call = async (method: string, params?: unknown) => {
    const read = method === "ui.matches" || method === "ui.capture"
    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await send(method, params, method === "ui.matches" ? 2_000 : read ? 5_000 : 30_000)
      if (response) return response
      if (!read) break
      console.error(`${label} ${method}: no response, sending it again`)
    }
    throw new Error(`${label} ${method}: no response`)
  }
  return { call, close: () => socket.close() }
}
