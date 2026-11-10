export * as RemoteAccess from "./remote-access"

import { Config } from "@opencode/core/config"
import { LocationServiceMap } from "@opencode/core/location-services"
import { ManagedPolicy } from "@opencode/core/managed-policy"
import { Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { requestRef } from "../location"

/**
 * Refuses every request that arrives through the remote access tunnel while a `remote.use` policy denies it. The
 * policy is read in the request's Location like any other, so an organization's applies once its plugin loads it.
 */
export const layer = (remoteURLs: () => ReadonlyArray<string>) =>
  HttpRouter.middleware(
    Effect.gen(function* () {
      const locations = yield* LocationServiceMap.Service
      return (app) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          if (!remoteURLs().some((url) => URL.parse(url)?.host === request.headers.host)) return yield* app
          // A Location that can't be loaded has no policy to apply; its own routes reject the request.
          const entries = yield* Config.Service.use((config) => config.entries()).pipe(
            Effect.provide(locations.get(requestRef(request))),
            Effect.orElseSucceed(() => []),
          )
          const denied = ManagedPolicy.match(ManagedPolicy.statements(entries), "remote.use", "opentunnel")
          if (denied?.effect !== "deny") return yield* app
          return HttpServerResponse.jsonUnsafe(
            { _tag: "ForbiddenError", message: `${denied.message}: remote access is not allowed` },
            { status: 403 },
          )
        })
    }),
    { global: true },
  )
