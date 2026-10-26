import { parentPort } from "node:worker_threads"
import type { Limits } from "../image.js"
import { PhotonNormalize } from "./photon-normalize.js"

export type Request = {
  readonly content: PhotonNormalize.Content
  readonly limits: Readonly<Limits>
}
export type Reply = { readonly _tag: "Ready" } | { readonly _tag: "Done"; readonly result: PhotonNormalize.Result }

const port = parentPort
if (port) {
  // A photon load failure throws out of the worker before Ready, so the server
  // falls back to resizing in-process. A throw while resizing (a wasm panic
  // leaves the instance unusable) is left uncaught so it kills the worker
  // instead of serving later requests from a poisoned heap.
  void PhotonNormalize.load().then((photon) => {
    port.on("message", (request: Request) => {
      port.postMessage({
        _tag: "Done",
        result: PhotonNormalize.normalize(photon, request.content, request.limits),
      } satisfies Reply)
    })
    port.postMessage({ _tag: "Ready" } satisfies Reply)
  })
}
