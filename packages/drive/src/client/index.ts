import type { Backend } from "./protocol.js"

/** Default port of the OpenCode UI simulation server. */
export const defaultPort = 40900
/** Default port of the OpenCode backend (LLM) simulation server. */
export const defaultBackendPort = 40950

export { Backend, Frontend, Handshake, JsonRpc, SimulationProtocol } from "./protocol.js"
export type BackendFinishReason = Backend.FinishReason
export type BackendItem = Backend.Item
export type OpenedExchange = Backend.OpenedExchange
