export * as BrowserHost from "./browser-host"

import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { BrowserControl } from "./browser-control"
import { SessionSchema } from "./session/schema"

export class RequestError extends Schema.TaggedErrorClass<RequestError>()("BrowserHost.RequestError", {
  code: Schema.Literals(BrowserControl.ERROR_CODES),
  message: Schema.String,
  retryable: Schema.Boolean,
}) {}

export interface Lease {
  readonly id: string
  readonly sessionID: SessionSchema.ID
  readonly state: BrowserControl.State
  readonly request: (command: BrowserControl.Command) => Effect.Effect<BrowserControl.Result, RequestError>
}

export interface Interface {
  readonly lease: (sessionID: SessionSchema.ID) => Effect.Effect<Option.Option<Lease>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/BrowserHost") {}

let installed: { readonly token: object; readonly control: BrowserControl.Interface } | undefined

/** Installs one process-global transport adapter without exposing that transport to model-facing tools. */
export function install(control: BrowserControl.Interface) {
  const token = {}
  installed = { token, control }
  return () => {
    if (installed?.token === token) installed = undefined
  }
}

export function make(resolve: () => BrowserControl.Interface | undefined = () => installed?.control): Interface {
  const send = Effect.fn("BrowserHost.request")(function* (
    control: BrowserControl.Interface,
    sessionID: SessionSchema.ID,
    command: BrowserControl.Command,
    lease?: string,
  ) {
    const requestID = crypto.randomUUID()
    const response = yield* Effect.callback<unknown, RequestError>((resume) => {
      const controller = new AbortController()
      let settled = false
      const complete = (effect: Effect.Effect<unknown, RequestError>) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resume(effect)
      }
      const timeout = setTimeout(
        () => {
          controller.abort()
          complete(
            Effect.fail(
              new RequestError({ code: "timeout", message: "The browser action timed out.", retryable: true }),
            ),
          )
        },
        command.type === "status" ? 300 : command.type === "navigate" ? 30_000 : 15_000,
      )
      Promise.resolve()
        .then(() =>
          control.request(
            {
              type: "desktop.browser.request",
              version: BrowserControl.VERSION,
              requestID,
              sessionID,
              ...(lease === undefined ? {} : { lease }),
              command,
            },
            controller.signal,
          ),
        )
        .then(
          (response) => complete(Effect.succeed(response)),
          (error) =>
            complete(
              Effect.fail(
                new RequestError({
                  code: controller.signal.aborted ? "aborted" : "internal",
                  message: error instanceof Error ? error.message : String(error),
                  retryable: true,
                }),
              ),
            ),
        )
      return Effect.sync(() => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        controller.abort()
      })
    })
    if (!BrowserControl.isResponse(response) || response.requestID !== requestID) {
      return yield* new RequestError({
        code: "protocol",
        message: "The browser host returned an invalid response.",
        retryable: false,
      })
    }
    if (response.error) return yield* new RequestError(response.error)
    if (response.result) return response.result
    return yield* new RequestError({
      code: "protocol",
      message: "The browser host returned an empty response.",
      retryable: false,
    })
  })

  return Service.of({
    lease: (sessionID) =>
      Effect.gen(function* () {
        const control = resolve()
        if (!control) return Option.none()
        const status = yield* send(control, sessionID, { type: "status" })
        if (status.type !== "status" || !status.attached) return Option.none()
        const id = status.lease
        const lease: Lease = {
          id,
          sessionID,
          state: status.state,
          request: (command) => send(control, sessionID, command, id),
        }
        return Option.some(lease)
      }).pipe(Effect.catchTag("BrowserHost.RequestError", () => Effect.succeed(Option.none()))),
  })
}

export const layer = Layer.succeed(Service, make())

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
