import { join } from "node:path"
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import {
  OpenCode as OpenCodeService,
  type OpenCodeClient,
} from "@opencode-ai/client/effect"
import * as Service from "@opencode-ai/client/effect/service"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "effect/unstable/http"
import { error, type OpenCodeDriverError } from "./error.js"

export type OpenCode = OpenCodeClient

const makeWithServices = Effect.fn("OpenCode.make")(function* (
  artifacts: string,
) {
  const state = join(artifacts, "home", ".local", "state", "opencode")
  const fs = yield* FileSystem.FileSystem
  const discovered = yield* fs.readDirectory(state).pipe(
    Effect.catch(() => Effect.succeed([])),
  )
  const names = [
    "service-local.json",
    "service.json",
    ...discovered
      .filter((name) => /^service-[^.]+\.json$/.test(name))
      .sort()
      .filter((name) => name !== "service-local.json"),
  ]
  let endpoint: Service.Endpoint | undefined
  for (const name of names) {
    endpoint = yield* Service.discover({ file: join(state, name) })
    if (endpoint !== undefined) break
  }
  if (endpoint === undefined)
    return yield* Effect.fail(
      error("opencode.connect", "OpenCode service registration was not found"),
    )

  return yield* Effect.gen(function* () {
    const base = yield* HttpClient.HttpClient
    const located = base.pipe(
      HttpClient.mapRequest(
        HttpClientRequest.setHeader(
          "x-opencode-directory",
          encodeURIComponent(join(artifacts, "files")),
        ),
      ),
    )
    const http = endpoint.auth === undefined
      ? located
      : located.pipe(
          HttpClient.mapRequest(
            HttpClientRequest.basicAuth(
              endpoint.auth.username,
              endpoint.auth.password,
            ),
          ),
        )
    return yield* OpenCodeService.make({ baseUrl: endpoint.url }).pipe(
      Effect.provideService(HttpClient.HttpClient, http),
    )
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.mapError((cause) => error("opencode.connect", cause)),
  )
})

export const make = (
  artifacts: string,
): Effect.Effect<OpenCode, OpenCodeDriverError> =>
  makeWithServices(artifacts).pipe(Effect.provide(NodeFileSystem.layer))
