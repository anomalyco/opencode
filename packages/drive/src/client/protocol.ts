/**
 * Public face of the canonical OpenCode simulation protocol. The schema
 * definitions live in `../simulation/protocol.ts`; protocol updates copied
 * from OpenCode land there and surface here unchanged.
 */
export { Backend, Frontend, Handshake, JsonRpc } from "../simulation/protocol.js"
export * as SimulationProtocol from "../simulation/protocol.js"
