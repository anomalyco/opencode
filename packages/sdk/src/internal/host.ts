export * as EmbeddedHost from "./host"

import { SdkPlugins } from "@opencode-ai/core/plugin/sdk"
import { SessionRestart } from "@opencode-ai/core/session/execution/restart"
import { Workspace } from "@opencode-ai/core/workspace"
import { WorkspaceDriver } from "@opencode-ai/core/workspace/driver"
import { createEmbeddedRoutes } from "@opencode-ai/server/routes"
import type { ServerOptions } from "@opencode-ai/server/options"
import type { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Context, Effect, Layer, ManagedRuntime, Scope } from "effect"
import { HttpEffect, HttpRouter, HttpServer, HttpServerRequest } from "effect/unstable/http"
import { context, layer, type LogOptions } from "../logging"

export interface CreateOptions extends Omit<ServerOptions, "hostname" | "port" | "password"> {
  readonly log?: LogOptions
  readonly workspaceProviders?: Readonly<Record<string, WorkspaceDriver.Interface>>
}

/** Host hooks for embedding opencode on a non-default runtime profile. */
export interface EmbedOptions {
  readonly overrides?: LayerNode.Replacements
}

export const create = Effect.fn("EmbeddedHost.create")(function* (
  options: CreateOptions = {},
  embed: EmbedOptions = {},
) {
  const { log, workspaceProviders, ...server } = options
  const runtime = ManagedRuntime.make(
    createEmbeddedRoutes(
      {
        ...server,
        app: { ...server.app, name: server.app?.name ?? "sdk" },
        database: { path: ":memory:", ...server.database },
      },
      workspaceProviders
        ? [...(embed.overrides ?? []), [WorkspaceDriver.node, WorkspaceDriver.registryNode(workspaceProviders)]]
        : embed.overrides,
    ).pipe(Layer.provide(HttpServer.layerServices), Layer.provideMerge(layer(log))),
  )

  return yield* Effect.gen(function* () {
    const services = yield* runtime.contextEffect
    // The sweep is a no-op when nothing is suspended. ManagedRuntime owns the
    // fiber so recovery never delays startup but still stops with the host.
    runtime.runFork(Context.get(services, SessionRestart.Service).resumeSuspendedSessions)
    const handler = HttpEffect.toWebHandlerWith<never, HttpServerRequest.HttpServerRequest | Scope.Scope>(
      context(services),
    )(Context.get(services, HttpRouter.HttpRouter).asHttpEffect())
    const requests = new Set<Promise<void>>()
    const controllers = new Set<AbortController>()
    const closed = new Error("OpenCode host is closed")
    let closePromise: Promise<void> | undefined
    const fetch = Object.assign(
      (input: RequestInfo | URL, init?: RequestInit) => {
        if (closePromise) return Promise.reject(closed)
        const source = new Request(input, init)
        if (source.signal.aborted) return Promise.reject(source.signal.reason)
        const controller = new AbortController()
        const request = new Request(source, { signal: AbortSignal.any([source.signal, controller.signal]) })
        const lifetime = Promise.withResolvers<void>()
        const finish = () => {
          controllers.delete(controller)
          requests.delete(lifetime.promise)
          lifetime.resolve()
        }
        controllers.add(controller)
        requests.add(lifetime.promise)

        const handled = handler(request)
        return rejectOnAbort(handled, request.signal).then(
          (response) => trackResponse(response, request.signal, finish),
          (cause) => {
            void handled.then(finish, finish)
            throw cause
          },
        )
      },
      { preconnect: () => undefined },
    ) satisfies typeof globalThis.fetch
    const close = () => {
      if (closePromise) return closePromise
      closePromise = (async () => {
        for (const controller of controllers) controller.abort(closed)
        await Promise.allSettled([...requests])
        await runtime.dispose()
      })()
      return closePromise
    }

    return {
      runtime,
      fetch,
      plugins: Context.get(services, SdkPlugins.Service),
      workspace: Context.get(services, Workspace.Service),
      close,
    }
  }).pipe(Effect.onError(() => runtime.disposeEffect))
})

export type Interface = Effect.Success<ReturnType<typeof create>>

function rejectOnAbort<A>(promise: Promise<A>, signal: AbortSignal): Promise<A> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort)
        resolve(value)
      },
      (cause) => {
        signal.removeEventListener("abort", abort)
        reject(cause)
      },
    )
  })
}

function trackResponse(response: Response, signal: AbortSignal, finish: () => void): Response {
  if (!response.body) {
    finish()
    return response
  }

  const reader = response.body.getReader()
  let done = false
  let abort = () => {}
  const complete = () => {
    if (done) return false
    done = true
    signal.removeEventListener("abort", abort)
    return true
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      abort = () => {
        if (!complete()) return
        controller.error(signal.reason)
        void reader.cancel(signal.reason).then(finish, finish)
      }
      if (signal.aborted) abort()
      else signal.addEventListener("abort", abort, { once: true })
    },
    async pull(controller) {
      try {
        const next = await reader.read()
        if (done) return
        if (!next.done) {
          controller.enqueue(next.value)
          return
        }
        if (!complete()) return
        controller.close()
        finish()
      } catch (cause) {
        if (!complete()) return
        controller.error(cause)
        finish()
      }
    },
    async cancel(reason) {
      if (!complete()) return
      try {
        await reader.cancel(reason)
      } finally {
        finish()
      }
    },
  })
  return new Response(body, response)
}
