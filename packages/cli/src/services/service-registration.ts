export * as ServiceRegistration from "./service-registration"

import { Service, type Info } from "@opencode-ai/client/effect/service"
import path from "node:path"
import { Effect, FileSystem, Schedule, Schema } from "effect"
import { HttpServer } from "effect/unstable/http"
import { OPENCODE_VERSION } from "../version"

const infoJson = Schema.fromJsonString(Service.Info)
const encodeInfo = Schema.encodeEffect(infoJson)
const decodeInfo = Schema.decodeUnknownEffect(infoJson)

export const register = Effect.fnUntraced(function* (options: {
  readonly address: HttpServer.Address
  readonly password: string
  readonly id: string
  readonly file: string
  readonly shutdown: Effect.Effect<void>
}) {
  const fs = yield* FileSystem.FileSystem
  const temp = options.file + "." + options.id + ".tmp"
  yield* fs.makeDirectory(path.dirname(options.file), { recursive: true })
  const info = {
    id: options.id,
    version: OPENCODE_VERSION,
    url: HttpServer.formatAddress(options.address),
    pid: process.pid,
    password: options.password,
  }
  const encoded = yield* encodeInfo(info)
  const current = fs.readFileString(options.file).pipe(Effect.flatMap(decodeInfo))
  const owns = (found: Info) =>
    found.id === info.id &&
    found.version === info.version &&
    found.url === info.url &&
    found.pid === info.pid &&
    found.password === info.password
  yield* fs.writeFileString(temp, encoded, { mode: 0o600 }).pipe(Effect.andThen(fs.rename(temp, options.file)))
  yield* current.pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("managed service registration check failed; shutting down", {
        cause,
        serviceID: options.id,
        servicePID: process.pid,
        registration: options.file,
      }).pipe(Effect.andThen(Effect.failCause(cause))),
    ),
    Effect.tap((found) =>
      owns(found)
        ? Effect.void
        : Effect.logWarning("managed service registration replaced; shutting down", {
            serviceID: options.id,
            servicePID: process.pid,
            registration: options.file,
            observedServiceID: found.id,
            observedServicePID: found.pid,
            observedVersion: found.version,
            observedURL: found.url,
          }),
    ),
    Effect.filterOrFail(owns),
    Effect.repeat(Schedule.spaced("5 seconds")),
    Effect.ignore,
    Effect.andThen(options.shutdown),
    Effect.forkScoped,
  )
  return current.pipe(
    Effect.flatMap((found) => (owns(found) ? fs.remove(options.file) : Effect.void)),
    Effect.ignore,
  )
})
