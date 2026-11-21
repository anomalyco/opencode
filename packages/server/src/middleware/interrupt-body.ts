import { Effect } from "effect"
import { HttpRouter, HttpServerRequest } from "effect/http"

// POST /api/session/<sessionID>/interrupt
const INTERRUPT_PATH = /^\/api\/session\/[^/]+\/interrupt$/

// A body-less interrupt POST is the call shape every client used before the endpoint gained
// a reason, so it must still return 200. Effect's JSON codec cannot decode an absent body
// against a declared payload — an empty body never reaches the payload schema — so the
// empty body is supplied as "{}" here, before decoding, and an omitted reason then defaults
// to "user" in session execution. Non-empty bodies pass through byte-identical: only the
// text read is mapped, so malformed JSON still fails in the payload decoder exactly as for
// every other payload endpoint.
export const interruptBodyLayer = HttpRouter.middleware(
  (effect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      if (request.method !== "POST" || !INTERRUPT_PATH.test(new URL(request.url, "http://localhost").pathname)) {
        return yield* effect
      }
      // Copy the request descriptor-for-descriptor: url and friends may live on its
      // prototype or as readonly accessors, and a plain spread loses the route
      // entirely while Object.assign throws on the readonly ones. Only `text` is
      // replaced, shadowing whatever form it had.
      const wrapped = Object.defineProperties(
        Object.create(Object.getPrototypeOf(request)),
        Object.getOwnPropertyDescriptors(request),
      )
      Object.defineProperty(wrapped, "text", {
        value: request.text.pipe(Effect.map((text) => (text === "" ? "{}" : text))),
        enumerable: true,
        configurable: true,
        writable: true,
      })
      return yield* effect.pipe(Effect.provideService(HttpServerRequest.HttpServerRequest, wrapped))
    }),
  { global: true },
)
