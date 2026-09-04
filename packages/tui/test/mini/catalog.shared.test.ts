import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { OpenCode } from "@opencode-ai/client/promise"
import { loadRunReferences, runProviders } from "../../src/mini/catalog.shared"
import { catalogModel, catalogProvider } from "./fixture/catalog"

afterEach(() => {
  mock.restore()
})

describe("run catalog shared", () => {
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

    const references = await loadRunReferences(client, { directory: "/tmp" })

    expect(list).toHaveBeenCalledWith({ location: { directory: "/tmp" } })
    expect(references).toMatchObject([{ name: "effect", path: "/repos/effect", description: "Effect v4 sources" }])
  })

  test("merges current providers and models into the footer catalog shape", () => {
    const providers = runProviders(
      [catalogProvider("openai", "OpenAI")],
      [
        catalogModel({
          id: "gpt-5",
          modelID: "openai",
          providerID: "openai",
          name: "Little Frank",
          variants: ["high"],
        }),
      ],
    )

    expect(providers).toEqual([
      {
        id: "openai",
        name: "OpenAI",
        models: {
          "gpt-5": {
            name: "Little Frank",
            time: { released: 1 },
            cost: {
              input: 0,
            },
            limit: {
              context: 128_000,
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
