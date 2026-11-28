import { Socket } from "effect/socket"

// workerd exposes the standard global WebSocket constructor directly; Node proxy agents are
// unsupported and callers passing handshake headers will fail on this runtime.
export const layer = Socket.layerWebSocketConstructorGlobal
