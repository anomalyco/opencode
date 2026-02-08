/**
 * Events module re-exports
 */
export { type GlobalBusPayload, type GlobalBusEvent, type EventSink } from "./types.ts";

export {
  broadcastGlobal,
  addEventSink,
  removeEventSink,
  getEventSinkCount,
} from "./bus.ts";

export {
  ensureUpstreamGlobalStream,
  touchDirectory,
  stopUpstreamStream,
  stopAllUpstreamStreams,
} from "./upstream.ts";

export {
  startBridge,
  stopBridge,
  switchBridge,
} from "./local-bridge.ts";
