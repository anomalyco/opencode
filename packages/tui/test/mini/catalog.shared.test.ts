import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { OpenCode } from "@opencode-ai/client/promise"
import { loadRunCommands, loadRunReferences, runProviders } from "../../src/mini/catalog.shared"
import { catalogModel, catalogProvider } from "./fixture/catalog"
import { createApi, createFetch, json } from "../fixture/tui-client"

afterEach(() => {
  mock.restore()
})

describe("run catalog shared", () => {
  test("filters skill commands using the separate preference overrides", async () => {
    const location = { directory: "/project" }
    const calls = createFetch((url) => {
      if (url.pathname === "/api/command") return json({ location, data: [{ name: "review" }] })
      if (url.pathname === "/api/skill")
        return json({
          location,
          data: [
            { id: "effect", name: "Effect", location: "/skills/effect.md", content: "Guidance" },
            { id: "release", name: "Release", location: "/skills/release.md", content: "Guidance" },
          ],
        })
      if (url.pathname === "/api/preferences")
        return json([{ target: { kind: "skill.activation", id: "effect" }, value: "disabled" }])
      return undefined
    })
    expect(await loadRunCommands(createApi(calls.fetch), location)).toEqual([
      { name: "review", description: undefined },
      { name: "release", description: undefined, source: "skill" },
    ])
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
