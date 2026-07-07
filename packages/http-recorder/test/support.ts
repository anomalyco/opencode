import { NodeFileSystem } from "@effect/platform-node-shared"
import { Cause, Effect, Exit } from "effect"
import { HttpBody, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { decodeCassette, type Interaction } from "../src/cassette/model"
import { Service, fileSystem } from "../src/cassette/store"

export const tempDirectory = (prefix: string) => {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  return {
    path: directory,
    [Symbol.dispose]() {
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

export const post = (url: string, body: object) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const response = yield* http.execute(
      HttpClientRequest.post(url, {
        headers: { "content-type": "application/json" },
        body: HttpBody.text(JSON.stringify(body), "application/json"),
      }),
    )
    return yield* response.text
  })

export const readCassette = (file: string) => decodeCassette(JSON.parse(readFileSync(file, "utf8")))

export const runFileCassette = <A, E>(directory: string, effect: Effect.Effect<A, E, Service>) =>
  Effect.runPromise(effect.pipe(Effect.provide(fileSystem({ directory })), Effect.provide(NodeFileSystem.layer)))

export const seedCassetteDirectory = (directory: string, name: string, interactions: ReadonlyArray<Interaction>) =>
  runFileCassette(
    directory,
    Effect.gen(function* () {
      const cassette = yield* Service
      yield* Effect.forEach(interactions, (interaction) => cassette.append(name, interaction))
    }),
  )

export const withEnvironment = async <A>(name: string, value: string | undefined, run: () => Promise<A>) => {
  const previous = process.env[name]
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
  try {
    return await run()
  } finally {
    if (previous === undefined) delete process.env[name]
    else process.env[name] = previous
  }
}

export const failureText = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return ""
  return Cause.prettyErrors(exit.cause).join("\n")
}
