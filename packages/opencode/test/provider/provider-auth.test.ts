import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Effect, Layer } from "effect"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ProviderAuth } from "../../src/provider"
import { ProviderID } from "../../src/provider/schema"
import { Auth } from "../../src/auth"

describe("provider.oauth.account-keys", () => {
  test("oauth authorize/callback stores account-scoped credentials and tracks active account", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const pluginDir = path.join(dir, ".opencode", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })

        await Bun.write(
          path.join(pluginDir, "custom-copilot-oauth.ts"),
          [
            "export default {",
            '  id: "demo.custom-copilot-oauth",',
            "  server: async () => ({",
            "    auth: {",
            '      provider: "github-copilot",',
            "      methods: [",
            "        {",
            '          type: "oauth",',
            '          label: "Custom OAuth",',
            "          authorize: async () => ({",
            '            url: "https://example.com/oauth/start",',
            '            method: "code",',
            '            instructions: "enter code",',
            "            callback: async (code) => ({",
            '              type: "success",',
            "              refresh: `refresh-${code}`,",
            "              access: `access-${code}`,",
            "              expires: 9999999999999,",
            "            }),",
            "          }),",
            "        },",
            "      ],",
            "    },",
            "  }),",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const providerAuth = yield* ProviderAuth.Service
            const auth = yield* Auth.Service
            const providerID = ProviderID.make("github-copilot")

            const first = yield* providerAuth.authorize({
              providerID,
              method: 0,
              accountKey: "work",
            })
            expect(first?.url).toBe("https://example.com/oauth/start")

            const second = yield* providerAuth.authorize({
              providerID,
              method: 0,
              accountKey: "personal",
            })
            expect(second?.method).toBe("code")

            yield* providerAuth.callback({
              providerID,
              method: 0,
              accountKey: "personal",
              code: "p1",
            })
            yield* providerAuth.callback({
              providerID,
              method: 0,
              accountKey: "work",
              code: "w1",
            })

            const accounts = yield* auth.accounts(providerID)
            expect(Object.keys(accounts).sort()).toEqual(["default", "personal", "work"])

            const personal = accounts.personal
            expect(personal?.type).toBe("oauth")
            if (personal?.type === "oauth") {
              expect(personal.access).toBe("access-p1")
              expect(personal._accountId).toBe("personal")
            }

            const work = accounts.work
            expect(work?.type).toBe("oauth")
            if (work?.type === "oauth") {
              expect(work.access).toBe("access-w1")
              expect(work._accountId).toBe("work")
            }

            const active = yield* auth.active(providerID)
            expect(active?.accountKey).toBe("work")
            expect(active?.info.type).toBe("oauth")
            if (active?.info.type === "oauth") {
              expect(active.info.access).toBe("access-w1")
            }
          }).pipe(Effect.provide(Layer.mergeAll(ProviderAuth.defaultLayer, Auth.defaultLayer))),
        )
      },
    })
  }, 30000)
})
