import { NodeFileSystem } from "@effect/platform-node"
import { compile, emitEffectImported, emitPromise, write } from "@moks/httpapi-codegen"
import { ClientApi, endpointNames, groupNames, omitEndpoints } from "../src/contract"
import { Effect } from "effect"
import { fileURLToPath } from "url"

const contract = compile(ClientApi, { groupNames, endpointNames, omitEndpoints })

await Effect.runPromise(
  Effect.all(
    [
      write(
        emitPromise(contract, {
          outputTypes: {
            "events.subscribe": {
              name: "OpenCodeEventEncoded",
              import: 'import type { OpenCodeEventEncoded } from "@moks/protocol/groups/event"',
            },
          },
        }),
        fileURLToPath(new URL("../src/generated", import.meta.url)),
      ),
      write(
        emitEffectImported(contract, { module: "../contract", api: "ClientApi" }),
        fileURLToPath(new URL("../src/generated-effect", import.meta.url)),
      ),
    ],
    { concurrency: 2, discard: true },
  ).pipe(Effect.provide(NodeFileSystem.layer)),
)
