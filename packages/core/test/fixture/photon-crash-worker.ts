import { parentPort } from "node:worker_threads"

// Stands in for a photon worker whose wasm panics on its first request.
const port = parentPort
if (port) {
  port.on("message", () => {
    throw new Error("unreachable executed")
  })
  port.postMessage({ _tag: "Ready" })
}
