import { describe, expect, test } from "bun:test"
import { eager } from "../../../src/cli/cmd/tui/context/sync-eager"

describe("sync eager attach bootstrap", () => {
  test("skips nonessential attach bootstrap loads", () => {
    expect(eager({ transport: "attach" })).toEqual({
      session: false,
      command: false,
      resource: false,
      workspace: false,
    })
  })

  test("still preloads sessions when attach continues", () => {
    expect(eager({ transport: "attach", continue: true })).toEqual({
      session: true,
      command: false,
      resource: false,
      workspace: false,
    })
  })

  test("keeps full bootstrap for local tui", () => {
    expect(eager({ transport: "local" })).toEqual({
      session: true,
      command: true,
      resource: true,
      workspace: true,
    })
  })
})
