import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { OpenCode } from "@opencode-ai/client/promise"
import { loadRunReferences, runProviders, waitForDefaultModel } from "@opencode-ai/cli/mini/catalog.shared"

afterEach(() => {
  mock.restore()
})

describe("run catalog shared", () => {
  test("resolves the catalog-selected model for the footer", async () => {
    const client = OpenCode.make({ baseUrl: "https://opencode.test" })
    const selected = spyOn(client.model, "default").mockImplementation(
      () =>
        Promise.resolve({
          location: { directory: "/tmp", project: { id: "proj_1", directory: "/tmp" } },
          data: { id: "gpt-5", providerID: "openai" },
        }) as never,
    )

    await expect(waitForDefaultModel({ sdk: client, directory: "/tmp" })).resolves.toEqual({
      providerID: "openai",
      modelID: "gpt-5",
    })
    expect(selected).toHaveBeenCalledWith({ location: { directory: "/tmp" } })
  })

  test("loads visible project references from the current reference catalog", async () => {
    const client = OpenCode.make({ baseUrl: "https://opencode.test" })
    const list = spyOn(client.reference, "list").mockImplementation(
      () =>
        Promise.resolve({
          location: { directory: "/tmp", project: { id: "proj_1", directory: "/tmp" } },
          data: [
              {
                name: "effect",
                path: "/repos/effect",
                description: "Effect v4 sources",
                source: { type: "local", path: "/repos/effect" },
              },
              {
                name: "secret",
                path: "/repos/secret",
                hidden: true,
                source: { type: "local", path: "/repos/secret" },
              },
          ],
        }) as never,
    )

    const references = await loadRunReferences(client, "/tmp")

    expect(list).toHaveBeenCalledWith({ location: { directory: "/tmp" } })
    expect(references).toMatchObject([{ name: "effect", path: "/repos/effect", description: "Effect v4 sources" }])
  })

  test("merges current providers and models into the footer catalog shape", () => {
    const providers = runProviders(
      [
        {
          id: "openai",
          name: "OpenAI",
          api: { type: "native", settings: {} },
          request: { settings: {}, headers: {}, body: {} },
        },
      ],
      [
        {
          id: "gpt-5",
          providerID: "openai",
          name: "Little Frank",
          api: { id: "openai", type: "native", settings: {} },
          capabilities: {
            tools: true,
            input: ["text"],
            output: ["text"],
          },
          request: {
            settings: {},
            headers: {},
            body: {},
          },
          variants: [
            {
              id: "high",
              settings: {},
              headers: {},
              body: {},
            },
          ],
          time: {
            released: 1,
          },
          cost: [
            {
              input: 0,
              output: 0,
              cache: {
                read: 0,
                write: 0,
              },
            },
          ],
          status: "active",
          enabled: true,
          limit: {
            context: 128000,
            output: 8192,
          },
        },
      ],
    )

    expect(providers).toEqual([
      {
        id: "openai",
        name: "OpenAI",
        models: {
          "gpt-5": {
            id: "gpt-5",
            providerID: "openai",
            name: "Little Frank",
            capabilities: expect.objectContaining({ tools: true }),
            cost: {
              input: 0,
              output: 0,
              cache: {
                read: 0,
                write: 0,
              },
            },
            limit: {
              context: 128000,
              output: 8192,
            },
            status: "active",
            variants: {
              high: {},
            },
          },
        },
      },
    ])
  })
})
