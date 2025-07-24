import "zod-openapi/extend"

import { describe, expect, test } from "bun:test"
import { Ripgrep } from "./ripgrep"

describe("Ripgrep.buildRipgrepCommand", () => {
  test("excludes --no-ignore when include_ignored_files is false", () => {
    const config = { include_ignored_files: false }
    const cmd = Ripgrep.buildRipgrepCommand(config, "/path/to/rg")
    expect(cmd).not.toContain("--no-ignore")
    expect(cmd).toContain("--files --follow --hidden --glob='!.git/*'")
  })

  test("includes --no-ignore when include_ignored_files is true", () => {
    const config = { include_ignored_files: true }
    const cmd = Ripgrep.buildRipgrepCommand(config, "/path/to/rg")
    expect(cmd).toContain("--no-ignore")
    expect(cmd).toContain("--files --follow --hidden --glob='!.git/*'")
  })

  test("handles missing config gracefully", () => {
    const cmd = Ripgrep.buildRipgrepCommand(undefined, "/path/to/rg")
    expect(cmd).not.toContain("--no-ignore")
    expect(cmd).toContain("--files --follow --hidden --glob='!.git/*'")
  })

  test("escapes filepath correctly", () => {
    const config = {}
    const cmd = Ripgrep.buildRipgrepCommand(config, "/path with spaces/rg")
    expect(cmd).toContain(`"/path with spaces/rg"`)
  })

  test("builds complete command string", () => {
    const config = { include_ignored_files: true }
    const cmd = Ripgrep.buildRipgrepCommand(config, "/usr/bin/rg")
    expect(cmd).toBe("/usr/bin/rg --files --follow --hidden --glob='!.git/*' --no-ignore")
  })
})
