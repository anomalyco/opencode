import { NodeFileSystem } from "@effect/platform-node"
import { compile, emitEffectImported, emitPromise, write } from "@opencode-ai/httpapi-codegen"
import { Api } from "@opencode-ai/server/api"
import { Effect } from "effect"
import { HttpApi } from "effect/unstable/httpapi"
import { fileURLToPath } from "url"

const contract = compile(HttpApi.make("opencode-client").add(Api.groups["server.session"]), {
  groupNames: { "server.session": "sessions" },
})

await Effect.runPromise(
  Effect.all(
    [
      write(emitPromise(contract), fileURLToPath(new URL("../src/generated", import.meta.url))),
      write(
        emitEffectImported(contract, { module: "../contract", group: "SessionGroup" }),
        fileURLToPath(new URL("../src/generated-effect", import.meta.url)),
      ),
    ],
    { concurrency: 2, discard: true },
  ).pipe(Effect.provide(NodeFileSystem.layer)),
)
