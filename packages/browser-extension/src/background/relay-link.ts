// Relays site_scripts tool calls from the opencode-browser opencode plugin to this browser. Listens on the
// server's event stream while a side panel is open; requests carry the Location of the plugin instance
// that sent them, so the answer goes back to the same one.
import { OpenCode, isRpcError, isRpcInternalError, type JsonValue } from "@opencode/client/promise"
import { RELAY_RPC_ID, type RelayCommand, type RelayControl, type RelayOutcome } from "../shared/relay-rpc"
import type { Service } from "./service"

export function createRelayLink(input: {
  service: Service
  run: (command: RelayCommand, signal: AbortSignal) => Promise<unknown>
}) {
  const running = new Map<string, AbortController>()
  let active: AbortController | undefined
  let attempts = 0

  const connect = async (signal: AbortSignal) => {
    const info = await input.service.get()
    const client = OpenCode.make({
      baseUrl: info.url,
      headers: { Authorization: `Basic ${btoa(`opencode:${info.password}`)}` },
    })
    const call = (method: "command" | "result", body: Record<string, unknown>, directory?: string) =>
      client.rpc
        .call({
          rpcID: RELAY_RPC_ID,
          method,
          input: body as JsonValue,
          ...(directory ? { location: { directory } } : {}),
        })
        .then((response) => response.output)
        .catch((cause: unknown) => {
          if (!isRpcError(cause) && !isRpcInternalError(cause)) throw cause
          throw new Error(cause.message)
        })
    const handle = async (requestID: string, directory?: string) => {
      const abort = new AbortController()
      running.set(requestID, abort)
      // Another browser profile may have claimed it first; then there is nothing to do here.
      const command = (await call("command", { requestID }, directory).catch(() => undefined)) as RelayCommand | undefined
      if (!command) return running.delete(requestID)
      const outcome: RelayOutcome = await input.run(command, abort.signal).then(
        (value) => ({ ok: true, value }),
        (cause: unknown) => ({ ok: false, message: cause instanceof Error ? cause.message : String(cause) }),
      )
      running.delete(requestID)
      await call("result", { requestID, outcome }, directory).catch((cause: unknown) =>
        console.warn("[opencode-browser] site script result failed", cause),
      )
    }
    for await (const event of client.event.subscribe({ signal })) {
      if (event.type === "server.connected") attempts = 0
      if (event.type !== `rpc.${RELAY_RPC_ID}.control`) continue
      const control = event.data as RelayControl
      if (control.type === "cancel") {
        running.get(control.requestID)?.abort()
        continue
      }
      void handle(control.requestID, event.location?.directory)
    }
  }

  const loop = async (abort: AbortController) => {
    while (!abort.signal.aborted) {
      await connect(abort.signal).catch((cause: unknown) => {
        if (!abort.signal.aborted) console.warn("[opencode-browser] site script link dropped", cause)
      })
      if (abort.signal.aborted) return
      await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, 1_000 * 2 ** attempts++)))
    }
  }

  return {
    start() {
      if (active) return
      active = new AbortController()
      void loop(active)
    },
    stop() {
      active?.abort()
      active = undefined
      running.forEach((request) => request.abort())
      running.clear()
    },
  }
}
