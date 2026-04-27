import { describe, expect, test } from "bun:test"
import type { Agent } from "@opencode-ai/sdk/v2/client"
import { hermesMeta, hermesView } from "./session-new-view-meta"

describe("session new hermes meta", () => {
  test("reads hermes startup data from agent options", () => {
    const list = [
      {
        name: "hermes",
        mode: "primary",
        permission: {},
        options: {
          hermes: {
            version: "0.11.0",
            upstream: "2182de55",
            total: 6,
            rows: [
              { id: "browser", tools: ["browser_back", "browser_click"], extra: 0 },
              { id: "file", tools: ["patch", "read_file"], extra: 2 },
            ],
          },
        },
      },
    ] as unknown as Agent[]

    expect(hermesMeta(list)).toEqual({
      version: "0.11.0",
      upstream: "2182de55",
      total: 6,
      rows: [
        { id: "browser", tools: ["browser_back", "browser_click"], extra: 0 },
        { id: "file", tools: ["patch", "read_file"], extra: 2 },
      ],
    })
  })

  test("summarizes toolsets for smaller windows", () => {
    const meta = {
      version: "0.11.0",
      upstream: "2182de55",
      total: 18,
      rows: [
        { id: "browser", tools: ["a", "b", "c", "d"], extra: 4 },
        { id: "browser-cdp", tools: ["e", "f"], extra: 0 },
        { id: "clarify", tools: ["g"], extra: 0 },
        { id: "code_execution", tools: ["h"], extra: 0 },
        { id: "cronjob", tools: ["i"], extra: 0 },
      ],
    }

    expect(hermesView(meta, { width: 900, height: 780 })).toEqual({
      cols: 1,
      rows: [
        { id: "browser", tools: ["a", "b", "c"], extra: 5 },
        { id: "browser-cdp", tools: ["e", "f"], extra: 0 },
        { id: "clarify", tools: ["g"], extra: 0 },
      ],
      shown: 3,
      total: 5,
      moreRows: 2,
      moreTools: 12,
    })
  })

  test("uses two columns on wide windows and shows more toolsets", () => {
    const meta = {
      version: "0.11.0",
      upstream: "2182de55",
      total: 18,
      rows: [
        { id: "browser", tools: ["a", "b", "c", "d"], extra: 4 },
        { id: "browser-cdp", tools: ["e", "f"], extra: 0 },
        { id: "clarify", tools: ["g"], extra: 0 },
        { id: "code_execution", tools: ["h"], extra: 0 },
        { id: "cronjob", tools: ["i"], extra: 0 },
        { id: "delegation", tools: ["j"], extra: 0 },
        { id: "file", tools: ["k", "l"], extra: 1 },
        { id: "memory", tools: ["m"], extra: 0 },
        { id: "skills", tools: ["n"], extra: 0 },
      ],
    }

    expect(hermesView(meta, { width: 1700, height: 900 })).toEqual({
      cols: 2,
      rows: [
        { id: "browser", tools: ["a", "b", "c", "d"], extra: 4 },
        { id: "browser-cdp", tools: ["e", "f"], extra: 0 },
        { id: "clarify", tools: ["g"], extra: 0 },
        { id: "code_execution", tools: ["h"], extra: 0 },
        { id: "cronjob", tools: ["i"], extra: 0 },
        { id: "delegation", tools: ["j"], extra: 0 },
        { id: "file", tools: ["k", "l"], extra: 1 },
        { id: "memory", tools: ["m"], extra: 0 },
      ],
      shown: 8,
      total: 9,
      moreRows: 1,
      moreTools: 5,
    })
  })
})
