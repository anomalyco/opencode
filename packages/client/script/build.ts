import { NodeFileSystem } from "@effect/platform-node"
import { compile, emitEffectImported, emitEffectShape, emitPromise, write } from "@opencode-ai/httpapi-codegen"
import {
  ClientApi,
  effectOmitEndpoints,
  groupNames,
  promiseOmitEndpoints,
} from "@opencode-ai/protocol/client"
import { Effect } from "effect"
import { fileURLToPath } from "url"

const promiseContract = compile(ClientApi, { groupNames, omitEndpoints: promiseOmitEndpoints })
const effectContract = compile(ClientApi, { groupNames, omitEndpoints: effectOmitEndpoints })

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
        fileURLToPath(new URL("../src/promise/generated", import.meta.url)),
      ),
      write(
        emitEffectImported(effectContract, { module: "../../contract", api: "ClientApi" }),
        fileURLToPath(new URL("../src/effect/generated", import.meta.url)),
      ),
      write(
        emitEffectShape(effectContract, { module: "../../contract", api: "ClientApi" }),
        fileURLToPath(new URL("../src/effect/api", import.meta.url)),
      ),
    ],
    { concurrency: 3, discard: true },
  ).pipe(Effect.provide(NodeFileSystem.layer)),
)
