import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { OpencodeClient } from "@opencode-ai/sdk/v2"
import { loadRunReferences, runProviders } from "@/cli/cmd/run/catalog.shared"

afterEach(() => {
  mock.restore()
})

describe("run catalog shared", () => {
  test("loads visible project references from the current reference catalog", async () => {
    const client = new OpencodeClient()
    const list = spyOn(client.v2.reference, "list").mockImplementation(
      () =>
        Promise.resolve({
          data: {
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
          },
          error: undefined,
          request: new Request("https://opencode.test"),
          response: new Response(),
        }) as never,
    )

    const references = await loadRunReferences(client, "/tmp")

    expect(list).toHaveBeenCalledWith({ location: { directory: "/tmp" } }, { throwOnError: true })
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
