import { describe, expect, test } from "bun:test"
import {
  findDrift,
  glossaryFile,
  modelVariants,
  parseTranslationArgs,
  runPool,
  sessionIDFromEvents,
  sessionModels,
  targetFiles,
  textFromEvents,
  translationConfig,
  unexpectedChanges,
} from "./translate-app"

describe("translate app", () => {
  test("parses one locale with the public model defaults", () => {
    expect(parseTranslationArgs(["fr"])).toEqual({
      target: "fr",
      concurrency: 1,
      model: "opencode/gpt-5.5",
      variant: "xhigh",
      dryRun: false,
      check: false,
      help: false,
    })
  })

  test("parses all locales with bounded concurrency overrides", () => {
    expect(
      parseTranslationArgs([
        "all",
        "--concurrency",
        "7",
        "--model",
        "opencode/gpt-5.4",
        "--variant",
        "high",
        "--dry-run",
      ]),
    ).toEqual({
      target: "all",
      concurrency: 7,
      model: "opencode/gpt-5.4",
      variant: "high",
      dryRun: true,
      check: false,
      help: false,
    })
  })

  test("rejects unsupported targets and invalid concurrency", () => {
    expect(() => parseTranslationArgs(["en"])).toThrow("Unknown locale")
    expect(() => parseTranslationArgs(["fr", "de"])).toThrow("one locale")
    expect(() => parseTranslationArgs(["all", "--concurrency", "0"])).toThrow("positive integer")
  })

  test("parses fresh-process parity checks without requesting translation", () => {
    expect(parseTranslationArgs(["fr", "--check"]).check).toBe(true)
  })

  test("limits each locale to its app surfaces", () => {
    expect(targetFiles("fr")).toEqual([
      "packages/app/src/i18n/fr.ts",
      "packages/ui/src/i18n/fr.ts",
      "packages/desktop/src/renderer/i18n/fr.ts",
    ])
    expect(targetFiles("tr")).toEqual(["packages/app/src/i18n/tr.ts", "packages/ui/src/i18n/tr.ts"])
  })

  test("maps product locale codes to their glossaries", () => {
    expect(glossaryFile("fr")).toBe(".opencode/glossary/fr.md")
    expect(glossaryFile("zh")).toBe(".opencode/glossary/zh-cn.md")
    expect(glossaryFile("zht")).toBe(".opencode/glossary/zh-tw.md")
  })

  test("finds key and placeholder drift", () => {
    expect(
      findDrift(
        { keep: "Hello {{name}}", missing: "Missing", changed: "{{one}} {{two}}" },
        { keep: "Bonjour {{name}}", extra: "Extra", changed: "{{one}}" },
      ),
    ).toEqual({ missing: ["missing"], extra: ["extra"], placeholders: ["changed"] })
  })

  test("runs work with the requested maximum concurrency", async () => {
    const active = new Set<number>()
    const peaks: number[] = []
    const result = await runPool([1, 2, 3, 4, 5], 2, async (item) => {
      active.add(item)
      peaks.push(active.size)
      await Bun.sleep(5)
      active.delete(item)
      return item * 2
    })

    expect(result).toEqual([2, 4, 6, 8, 10])
    expect(Math.max(...peaks)).toBe(2)
  })

  test("reads the actual model and variant from the completed session", () => {
    expect(sessionIDFromEvents('shared: https://example.test\n{"type":"step_start","sessionID":"ses_test"}\n')).toBe(
      "ses_test",
    )
    expect(
      sessionModels({
        messages: [
          { info: { role: "user" } },
          {
            info: {
              role: "assistant",
              providerID: "opencode",
              modelID: "gpt-5.5",
              variant: "xhigh",
            },
          },
        ],
      }),
    ).toEqual([{ model: "opencode/gpt-5.5", variant: "xhigh" }])
    expect(
      textFromEvents(
        'shared: https://example.test\n{"type":"text","sessionID":"ses_test","part":{"text":"finished"}}\n',
      ),
    ).toBe("finished")
  })

  test("resolves variants from verbose model output", () => {
    const output = `opencode/other
{"variants":{}}
opencode/gpt-5.5
{"variants":{"high":{"reasoningEffort":"high"},"xhigh":{"reasoningEffort":"xhigh"}}}
opencode/next
{"variants":{}}
`
    expect(modelVariants(output, "opencode/gpt-5.5")).toEqual({
      high: { reasoningEffort: "high" },
      xhigh: { reasoningEffort: "xhigh" },
    })
  })

  test("disables side effects and scopes edits for the translation agent", () => {
    const config = translationConfig("translate-app-fr", "opencode/gpt-5.5", ["packages/app/src/i18n/fr.ts"])
    expect(config.share).toBe("disabled")
    expect(config.formatter).toBe(false)
    expect(config.lsp).toBe(false)
    expect(config.agent["translate-app-fr"].permission.edit).toEqual({
      "*": "deny",
      "packages/app/src/i18n/fr.ts": "allow",
    })
  })

  test("detects edits outside the locale targets", () => {
    expect(
      unexpectedChanges(
        { "script/translate-app.ts": "before" },
        {
          "script/translate-app.ts": "before",
          "packages/app/src/i18n/fr.ts": "translated",
          "packages/app/src/app.tsx": "unexpected",
        },
        ["packages/app/src/i18n/fr.ts"],
      ),
    ).toEqual(["packages/app/src/app.tsx"])
    expect(unexpectedChanges({ "already-dirty.ts": "before" }, { "already-dirty.ts": "after" }, [])).toEqual([
      "already-dirty.ts",
    ])
  })
})
