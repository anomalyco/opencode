import { createSignal } from "solid-js"

export type ConnectState = { status: "pending" | "error" }

const [connectState, setConnectState] = createSignal<ConnectState | undefined>()

const connectTimeoutMs = 90_000

let timeout: ReturnType<typeof setTimeout> | undefined
let pendingRequest: string | undefined

export const connectFlow = {
  state: connectState,
}

// A connect-to callback is honored only if it echoes the request id minted here, so the
// app accepts a handoff only as completion of a connection it initiated (see consumeConnect).
export function beginConnect(brokerUrl: string): string {
  const request = crypto.randomUUID()
  let launchUrl: string
  try {
    const url = new URL(brokerUrl)
    url.searchParams.set("request", request)
    launchUrl = url.toString()
  } catch {
    return brokerUrl
  }
  if (timeout) clearTimeout(timeout)
  pendingRequest = request
  setConnectState({ status: "pending" })
  timeout = setTimeout(() => {
    timeout = undefined
    pendingRequest = undefined
    setConnectState({ status: "error" })
  }, connectTimeoutMs)
  return launchUrl
}

export function consumeConnect(request: string): boolean {
  if (!request || request !== pendingRequest) return false
  clearConnect()
  return true
}

export function clearConnect() {
  if (timeout) {
    clearTimeout(timeout)
    timeout = undefined
  }
  pendingRequest = undefined
  setConnectState(undefined)
}
