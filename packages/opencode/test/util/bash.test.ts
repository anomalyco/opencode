import { describe, expect, test } from "bun:test"
import { stripEnvPrefix } from "@opencode-ai/util/bash"

describe("util.bash.stripEnvPrefix", () => {
  test("strips full Claude env prefix", () => {
    const cmd =
      "export CI=true DEBIAN_FRONTEND=noninteractive GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never HOMEBREW_NO_AUTO_UPDATE=1 GIT_EDITOR=: EDITOR=: VISUAL='' GIT_SEQUENCE_EDITOR=: GIT_MERGE_AUTOEDIT=no GIT_PAGER=cat PAGER=cat npm_config_yes=true PIP_NO_INPUT=1 YARN_ENABLE_IMMUTABLE_INSTALLS=false; git status"
    expect(stripEnvPrefix(cmd)).toBe("git status")
  })

  test("handles single quoted values", () => {
    const cmd = "export FOO='bar baz'; echo hello"
    expect(stripEnvPrefix(cmd)).toBe("echo hello")
  })

  test("handles double quoted values", () => {
    const cmd = 'export FOO="bar baz"; echo hello'
    expect(stripEnvPrefix(cmd)).toBe("echo hello")
  })

  test("handles mixed quoted values", () => {
    const cmd = "export FOO='bar' BAR=\"baz\" QUX=val; echo hello"
    expect(stripEnvPrefix(cmd)).toBe("echo hello")
  })

  test("returns command unchanged if no prefix", () => {
    const cmd = "git status"
    expect(stripEnvPrefix(cmd)).toBe("git status")
  })

  test("handles empty string", () => {
    expect(stripEnvPrefix("")).toBe("")
  })

  test("handles falsy input", () => {
    expect(stripEnvPrefix(undefined as unknown as string)).toBe(undefined)
    expect(stripEnvPrefix(null as unknown as string)).toBe(null)
  })

  test("preserves inline exports (not prefix)", () => {
    const cmd = "echo hello && export FOO=bar"
    expect(stripEnvPrefix(cmd)).toBe("echo hello && export FOO=bar")
  })

  test("handles empty value in exports", () => {
    const cmd = "export FOO='' BAR=; echo hello"
    expect(stripEnvPrefix(cmd)).toBe("echo hello")
  })

  test("handles special chars in values", () => {
    const cmd = "export FOO=':' BAR='cat'; echo hello"
    expect(stripEnvPrefix(cmd)).toBe("echo hello")
  })
})
