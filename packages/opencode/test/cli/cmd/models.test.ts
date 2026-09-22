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

// Returns the cells of the row for a model ID. Columns are separated by at least
// two spaces, and no fixture value contains two consecutive spaces.
function cells(table: string, id: string): string[] {
  const line = table.split(EOL).find((row) => row.startsWith(id + " "))
  if (!line) throw new Error(`no row for ${id}`)
  return line.split(/ {2,}/)
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
      ["large", model({ limit: { context: 1_048_576, output: 900 } })],
      [
        "capable",
        model({ capabilities: { ...model().capabilities, reasoning: true, attachment: true, toolcall: true } }),
      ],
      ["plain", model()],
    ])

    expect(cells(table, "acme/priced")).toEqual(["acme/priced", "Model", "3 / 15", "200K", "64K", "-"])
    expect(cells(table, "acme/large").slice(3, 5)).toEqual(["1M", "900"])
    expect(cells(table, "acme/capable")[5]).toBe("reasoning, tools, attachments")
    expect(cells(table, "acme/plain")[5]).toBe("-")
  })

  test("only calls a zero cost free for opencode's own models", () => {
    // A config model that declares no cost is stored as 0, which means unknown, not free.
    const zero = model({ cost: { input: 0, output: 0, cache: { read: 0, write: 0 } } })

    expect(cells(formatProviderTable("opencode", "OpenCode Zen", [["zen", zero]]), "opencode/zen")[2]).toBe("free")
    expect(cells(formatProviderTable("acme", "Acme", [["custom", zero]]), "acme/custom")[2]).toBe("-")
  })

  test("rounds token limits without overstating them", () => {
    const limits = (context: number) =>
      cells(formatProviderTable("acme", "Acme", [["m", model({ limit: { context, output: 0 } })]]), "acme/m")[3]

    expect(limits(1_500_000)).toBe("1.5M")
    expect(limits(2_000_000)).toBe("2M")
    // Rounds up into the next unit rather than printing "1000K".
    expect(limits(999_600)).toBe("1M")
    expect(limits(131_072)).toBe("131K")
    expect(limits(512)).toBe("512")
    expect(limits(0)).toBe("-")
  })

  test("keeps rows aligned when names carry tabs, newlines or wide characters", () => {
    const table = formatProviderTable("acme", "Acme", [
      // Verbatim from models.dev: this name ends in a tab.
      ["tabbed", model({ name: "DeepSeek V3 (Turbo)\t" })],
      ["split", model({ name: "two\nlines" })],
      ["wide", model({ name: "通义千问" })],
      ["plain", model({ name: "Plain" })],
    ])
    const lines = table.split(EOL)

    expect(table).not.toMatch(/\t/)
    // Two header rules, the header, the provider name, and one line per model.
    expect(lines).toHaveLength(8)
    expect(cells(table, "acme/tabbed")[1]).toBe("DeepSeek V3 (Turbo)")
    expect(cells(table, "acme/split")[1]).toBe("two lines")

    // The cost column starts at the same terminal column on every row, CJK included.
    const costColumn = (id: string) => {
      const line = lines.find((row) => row.startsWith(id + " "))!
      return Bun.stringWidth(line.slice(0, line.indexOf("3 / 15")))
    }
    expect(new Set(["acme/tabbed", "acme/split", "acme/wide", "acme/plain"].map(costColumn)).size).toBe(1)
  })

  test("renders a header-only table for a provider with no models", () => {
    const table = formatProviderTable("acme", "Acme", [])
    const lines = table.split(EOL)
    expect(lines).toHaveLength(4)
    expect(lines[2]).toContain("Capabilities")
  })
})
