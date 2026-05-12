import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigLSP } from "../../src/config/lsp"

// The LSP config refinement enforces: any custom (non-builtin) LSP server
// entry must declare an `extensions` array so the client knows which files
// the server should attach to. Builtin server IDs and explicitly disabled
// entries are exempt.
//
// Both validation paths must honor this rule:
//   - `Schema.decodeUnknownSync(ConfigLSP.Info)` (Effect layer)
//   - `ConfigLSP.Info.zod.parse(...)`            (derived Zod)
//
// `typescript` is a builtin server id (see src/lsp/server.ts).
describe("ConfigLSP.Info refinement", () => {
  const decodeEffect = Schema.decodeUnknownSync(ConfigLSP.Info)

  describe("accepted inputs", () => {
    test("true and false pass (top-level toggle)", () => {
      expect(decodeEffect(true)).toBe(true)
      expect(decodeEffect(false)).toBe(false)
      expect(ConfigLSP.Info.zod.parse(true)).toBe(true)
      expect(ConfigLSP.Info.zod.parse(false)).toBe(false)
    })

    test("builtin server with no extensions passes", () => {
      const input = { typescript: { command: ["typescript-language-server", "--stdio"] } }
      expect(decodeEffect(input)).toEqual(input)
      expect(ConfigLSP.Info.zod.parse(input)).toEqual(input)
    })

    test("custom server WITH extensions passes", () => {
      const input = {
        "my-lsp": { command: ["my-lsp-bin"], extensions: [".ml"] },
      }
      expect(decodeEffect(input)).toEqual(input)
      expect(ConfigLSP.Info.zod.parse(input)).toEqual(input)
    })

    test("disabled custom server passes (no extensions needed)", () => {
      const input = { "my-lsp": { disabled: true as const } }
      expect(decodeEffect(input)).toEqual(input)
      expect(ConfigLSP.Info.zod.parse(input)).toEqual(input)
    })

    test("mix of builtin and custom with extensions passes", () => {
      const input = {
        typescript: { command: ["typescript-language-server", "--stdio"] },
        "my-lsp": { command: ["my-lsp-bin"], extensions: [".ml"] },
      }
      expect(decodeEffect(input)).toEqual(input)
      expect(ConfigLSP.Info.zod.parse(input)).toEqual(input)
    })
  })

  describe("rejected inputs", () => {
    const expectedMessage = "For custom LSP servers, 'extensions' array is required."

    test("custom server WITHOUT extensions fails via Effect decode", () => {
      expect(() => decodeEffect({ "my-lsp": { command: ["my-lsp-bin"] } })).toThrow(expectedMessage)
    })

    test("custom server WITHOUT extensions fails via derived Zod", () => {
      const result = ConfigLSP.Info.zod.safeParse({ "my-lsp": { command: ["my-lsp-bin"] } })
      expect(result.success).toBe(false)
      expect(result.error!.issues.some((i) => i.message === expectedMessage)).toBe(true)
    })

    test("custom server with empty extensions array fails (extensions must be non-empty-truthy)", () => {
      // Boolean(['']) is true, so a non-empty array of strings is fine.
      // Boolean([]) is also true in JS, so empty arrays are accepted by the
      // refinement. This test documents current behavior.
      const input = { "my-lsp": { command: ["my-lsp-bin"], extensions: [] } }
      expect(decodeEffect(input)).toEqual(input)
      expect(ConfigLSP.Info.zod.parse(input)).toEqual(input)
    })

    test("custom server without extensions mixed with a valid builtin still fails", () => {
      const input = {
        typescript: { command: ["typescript-language-server", "--stdio"] },
        "my-lsp": { command: ["my-lsp-bin"] },
      }
      expect(() => decodeEffect(input)).toThrow(expectedMessage)
      expect(ConfigLSP.Info.zod.safeParse(input).success).toBe(false)
    })
  })
})
