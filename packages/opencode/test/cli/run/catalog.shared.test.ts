import { describe, expect, test } from "bun:test"
import { runProviders } from "@/cli/cmd/run/catalog.shared"

describe("run catalog shared", () => {
  test("merges current providers and models into the footer catalog shape", () => {
    const providers = runProviders(
      [
        {
          id: "openai",
          name: "OpenAI",
          api: { type: "native", settings: {} },
          request: { headers: {}, body: {} },
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
            headers: {},
            body: {},
          },
          variants: [
            {
              id: "high",
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
