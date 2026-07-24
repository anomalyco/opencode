import { Credential } from "@opencode-ai/core/credential"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Integration } from "@opencode-ai/core/integration"
import { Context, Effect, Layer } from "effect"
import { Auth } from "."

const legacyLabel = "legacy auth.json"

export interface Interface {
  readonly sync: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AuthCredentialBridge") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const credentials = yield* Credential.Service
    const sync = Effect.fn("AuthCredentialBridge.sync")(function* () {
      const values = Object.entries(yield* auth.all().pipe(Effect.orDie)).flatMap(([providerID, info]) => {
        const value = credential(providerID, info)
        return value ? [{ integrationID: Integration.ID.make(providerID), value }] : []
      })
      const legacy = (yield* credentials.all()).filter((item) => item.label === legacyLabel)
      const active = new Set(values.map((item) => item.integrationID))

      yield* Effect.forEach(
        legacy.filter((item) => !active.has(item.integrationID)),
        (item) => credentials.remove(item.id),
        { discard: true },
      )
      yield* Effect.forEach(
        values,
        Effect.fnUntraced(function* (item) {
          const existing = (yield* credentials.list(item.integrationID)).at(-1)
          if (existing && existing.label !== legacyLabel) return
          if (!existing) {
            yield* credentials.create({ ...item, label: legacyLabel })
            return
          }
          if (JSON.stringify(existing.value) === JSON.stringify(item.value)) return
          if (
            existing.value.type === "oauth" &&
            item.value.type === "oauth" &&
            existing.value.expires >= item.value.expires
          )
            return
          yield* credentials.update(existing.id, { value: item.value })
        }),
        { discard: true },
      )
    })

    yield* sync()
    return Service.of({ sync })
  }),
)

function credential(providerID: string, info: Auth.Info): Credential.Value | undefined {
  if (info.type === "wellknown") return
  if (info.type === "api") {
    return Credential.Key.make({
      type: "key",
      key: info.key,
      metadata: info.metadata,
    })
  }
  return Credential.OAuth.make({
    type: "oauth",
    methodID: Integration.MethodID.make(providerID === "openai" ? "chatgpt-browser" : "legacy"),
    access: info.access,
    refresh: info.refresh,
    expires: info.expires,
    metadata: {
      ...(info.accountId ? { accountID: info.accountId } : {}),
      ...(info.enterpriseUrl ? { enterpriseUrl: info.enterpriseUrl } : {}),
    },
  })
}

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Auth.node, Credential.node],
})

export * as AuthCredentialBridge from "./credential-bridge"
