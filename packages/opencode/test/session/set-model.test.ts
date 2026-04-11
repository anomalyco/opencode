import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import type { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"

const root = path.join(__dirname, "../..")

Log.init({ print: false })

describe("Session.setModel", () => {
  test("persists model on session", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        expect(session.model).toBeUndefined()

        const updated = await Session.setModel({
          sessionID: session.id,
          model: {
            providerID: "anthropic" as ProviderID,
            modelID: "claude-sonnet-4" as ModelID,
          },
        })

        expect(updated.model).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4" })

        const fetched = await Session.get(session.id)
        expect(fetched.model).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4" })

        await Session.remove(session.id)
      },
    })
  })

  test("persists model variant on session", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})

        const updated = await Session.setModel({
          sessionID: session.id,
          model: {
            providerID: "openai" as ProviderID,
            modelID: "gpt-4o" as ModelID,
          },
          variant: "gpt-4o-2024-08-06",
        })

        expect(updated.model).toEqual({ providerID: "openai", modelID: "gpt-4o" })
        expect(updated.modelVariant).toBe("gpt-4o-2024-08-06")

        const fetched = await Session.get(session.id)
        expect(fetched.model).toEqual({ providerID: "openai", modelID: "gpt-4o" })
        expect(fetched.modelVariant).toBe("gpt-4o-2024-08-06")

        await Session.remove(session.id)
      },
    })
  })

  test("accepts unknown models without failing the update", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})

        const updated = await Session.setModel({
          sessionID: session.id,
          model: {
            providerID: "unknown-provider" as ProviderID,
            modelID: "unknown-model" as ModelID,
          },
        })

        expect(updated.model).toEqual({ providerID: "unknown-provider", modelID: "unknown-model" })

        await Session.remove(session.id)
      },
    })
  })
})
