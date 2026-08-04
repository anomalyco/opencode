export * as ServiceRegistration from "./service-registration"

import { Service, type Info } from "@opencode-ai/client/effect/service"
import path from "node:path"
import { Effect, FileSystem, Schedule, Schema } from "effect"
import { HttpServer } from "effect/unstable/http"
import { OPENCODE_VERSION } from "../version"

const infoJson = Schema.fromJsonString(Service.Info)
const encodeInfo = Schema.encodeEffect(infoJson)
const decodeInfo = Schema.decodeUnknownEffect(infoJson)

export const register = Effect.fnUntraced(function* (
  address: HttpServer.Address,
  password: string,
  id: string,
  file: string,
  shutdown: Effect.Effect<void>,
) {
  const fs = yield* FileSystem.FileSystem
  const temp = file + "." + id + ".tmp"
  yield* fs.makeDirectory(path.dirname(file), { recursive: true })
  const info = {
    id,
    version: OPENCODE_VERSION,
    url: HttpServer.formatAddress(address),
    pid: process.pid,
    password,
  }
  const encoded = yield* encodeInfo(info)
  const current = fs.readFileString(file).pipe(
    Effect.flatMap(decodeInfo),
    Effect.orElseSucceed(() => undefined),
  )
  const owns = (found: Info | undefined) =>
    found?.id === info.id &&
    found.version === info.version &&
    found.url === info.url &&
    found.pid === info.pid &&
    found.password === info.password
  yield* fs.writeFileString(temp, encoded, { mode: 0o600 }).pipe(Effect.andThen(fs.rename(temp, file)))
  yield* current.pipe(
    Effect.filterOrFail(owns),
    Effect.repeat(Schedule.spaced("5 seconds")),
    Effect.ignore,
    Effect.andThen(shutdown),
    Effect.forkScoped,
  )
  return current.pipe(
    Effect.flatMap((found) => (owns(found) ? fs.remove(file) : Effect.void)),
    Effect.ignore,
  )
})
