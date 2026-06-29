import { NodeFileSystem } from "@effect/platform-node"
import { compile, emitEffectImported, emitPromise, write } from "@opencode-ai/httpapi-codegen"
import { ClientApi, effectOmitEndpoints, endpointNames, groupNames, promiseOmitEndpoints } from "../src/contract"
import { Effect } from "effect"
import { fileURLToPath } from "url"

const promiseContract = compile(ClientApi, { groupNames, endpointNames, omitEndpoints: promiseOmitEndpoints })
const effectContract = compile(ClientApi, { groupNames, endpointNames, omitEndpoints: effectOmitEndpoints })

await Effect.runPromise(
  Effect.all(
    [
      write(
        emitPromise(promiseContract, {
          outputTypes: {
            "events.subscribe": {
              name: "OpenCodeEventEncoded",
              import: 'import type { OpenCodeEventEncoded } from "@opencode-ai/protocol/groups/event"',
            },
          },
        }),
        fileURLToPath(new URL("../src/generated", import.meta.url)),
      ),
      write(
        emitEffectImported(effectContract, { module: "../contract", api: "ClientApi" }),
        fileURLToPath(new URL("../src/generated-effect", import.meta.url)),
      ),
    ],
    { concurrency: 2, discard: true },
  ).pipe(Effect.provide(NodeFileSystem.layer)),
)
