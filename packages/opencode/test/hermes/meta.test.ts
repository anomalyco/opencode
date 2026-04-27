import { describe, expect, test } from "bun:test"
import { buildHermesMeta } from "../../src/hermes/meta"

describe("hermes meta", () => {
  test("groups hermes-cli tools into startup rows", () => {
    const meta = buildHermesMeta({
      version: "0.11.0",
      upstream: "2182de55",
      tools: [
        "browser_back",
        "browser_click",
        "browser_cdp",
        "browser_dialog",
        "clarify",
        "execute_code",
        "cronjob",
        "delegate_task",
        "patch",
        "read_file",
        "search_files",
        "write_file",
      ],
    })

    expect(meta.version).toBe("0.11.0")
    expect(meta.upstream).toBe("2182de55")
    expect(meta.total).toBe(12)
    expect(meta.rows).toEqual([
      { id: "browser", tools: ["browser_back", "browser_click"], extra: 0 },
      { id: "browser-cdp", tools: ["browser_cdp", "browser_dialog"], extra: 0 },
      { id: "clarify", tools: ["clarify"], extra: 0 },
      { id: "code_execution", tools: ["execute_code"], extra: 0 },
      { id: "cronjob", tools: ["cronjob"], extra: 0 },
      { id: "delegation", tools: ["delegate_task"], extra: 0 },
      { id: "file", tools: ["patch", "read_file", "search_files", "write_file"], extra: 0 },
    ])
  })
})
