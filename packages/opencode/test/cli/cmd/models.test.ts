import { describe, expect, test } from "bun:test"
import { EOL } from "os"
import { formatProviderTable } from "../../../src/cli/cmd/models"
import type { Provider } from "../../../src/provider/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"

const MODALITIES = { text: true, audio: false, image: false, video: false, pdf: false }

function model(overrides: Partial<Provider.Model> = {}): Provider.Model {
  return {
    id: ModelV2.ID.make("model-id"),
    providerID: ProviderV2.ID.make("provider-id"),
    api: { id: "api", url: "https://example.com", npm: "@ai-sdk/openai" },
    name: "Model",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: false,
      input: MODALITIES,
      output: MODALITIES,
      interleaved: false,
    },
    cost: { input: 3, output: 15, cache: { read: 0, write: 0 } },
    limit: { context: 200_000, output: 64_000 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-01-01",
    ...overrides,
  }
}

describe("cli.models", () => {
  test("aligns every column and leaves no trailing whitespace", () => {
    const table = formatProviderTable("acme", "Acme", [
      ["short", model({ name: "Short" })],
      ["a/much/longer/model/id", model({ name: "Longer" })],
    ])
    const lines = table.split(EOL)

    for (const line of lines) expect(line).toBe(line.trimEnd())

    // Header, rule, and every row start the Name column at the same offset.
    const header = lines[2]
    const nameColumn = header.indexOf("Name")
    for (const line of [lines[4], lines[5]]) {
      expect(line.slice(nameColumn).startsWith("Short") || line.slice(nameColumn).startsWith("Longer")).toBe(true)
    }
    expect(lines[0]).toBe("Acme")
    expect(lines[1]).toBe("─".repeat(header.length))
    expect(lines[3]).toBe("─".repeat(header.length))
  })

  test("prefixes model ids with the provider id", () => {
    const table = formatProviderTable("acme", "Acme", [["gpt-9", model()]])
    expect(table).toContain("acme/gpt-9")
  })

  test("formats cost, limits and capabilities", () => {
    const table = formatProviderTable("acme", "Acme", [
      ["priced", model({ cost: { input: 3, output: 15, cache: { read: 0, write: 0 } } })],
      ["free", model({ cost: { input: 0, output: 0, cache: { read: 0, write: 0 } } })],
      ["big", model({ limit: { context: 1_000_000, output: 900 } })],
      [
        "capable",
        model({
          capabilities: {
            temperature: true,
            reasoning: true,
            attachment: true,
            toolcall: true,
            input: MODALITIES,
            output: MODALITIES,
            interleaved: false,
          },
        }),
      ],
    ])

    expect(table).toContain("3 / 15")
    expect(table).toContain("free")
    expect(table).toContain("200K")
    expect(table).toContain("64K")
    expect(table).toContain("1M")
    expect(table).toContain("900")
    expect(table).toContain("reasoning, tools, attachments")
    // A model with no capability flags renders a placeholder rather than an empty cell.
    expect(table).toContain("-")
  })

  test("renders a header-only table for a provider with no models", () => {
    const table = formatProviderTable("acme", "Acme", [])
    const lines = table.split(EOL)
    expect(lines).toHaveLength(4)
    expect(lines[2]).toContain("Capabilities")
  })
})
