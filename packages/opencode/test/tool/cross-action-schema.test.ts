import { describe, expect, test } from "bun:test"
import { LspParametersSchema } from "../../src/tool/read/lsp"
import { SearchParametersSchema } from "../../src/tool/read/search"
import { TaskAsyncParametersSchema } from "../../src/tool/task/task_async"
import { AtlasPlanFollowParametersSchema } from "../../src/tool/team-tools/atlas_plan_follow"
import {
  GitAnnotateParametersSchema,
  GitLogParametersSchema,
  GitStateParametersSchema,
  LocalGitAnnotateParametersSchema,
  LocalGitLogParametersSchema,
  LocalGitStateParametersSchema,
} from "../../src/tool/team-tools/localgit"

describe("tool cross-action schema compatibility", () => {
  test("search ignores content-only fields when action=path", () => {
    expect(() =>
      SearchParametersSchema.parse({
        action: "path",
        pattern: "**/*.ts",
        path: "src",
        context: 2,
        from_line: 10,
        to_line: 20,
        output_mode: "content",
      }),
    ).not.toThrow()
  })

  test("lsp ignores positional and query fields for documentSymbol", () => {
    expect(() =>
      LspParametersSchema.parse({
        operation: "documentSymbol",
        filePath: "src/index.ts",
        line: 12,
        character: 8,
        query: "App",
      }),
    ).not.toThrow()
  })

  test("task_async ignores irrelevant fields for status", () => {
    expect(() =>
      TaskAsyncParametersSchema.parse({
        action: "status",
        task_id: "session_123",
        description: "ignored",
        prompt: "ignored",
        subagent_type: "explorer",
        message: "ignored",
        task_ids: ["session_456"],
        timeout_ms: 60_000,
      }),
    ).not.toThrow()
  })

  test("atlas-plan-follow ignores update fields for get", () => {
    expect(() =>
      AtlasPlanFollowParametersSchema.parse({
        action: "get",
        plan_id: "pln_123",
        phase_id: "phase_1",
        task_id: "task_1",
        status: "done",
        summary: "ignored",
        evidence: ["ignored"],
      }),
    ).not.toThrow()
  })

  test("git_state ignores diff-only fields for status mode", () => {
    expect(() =>
      GitStateParametersSchema.parse({
        mode: "status",
        path: "src",
        staged: true,
        base: "main",
        head: "HEAD",
        stat: true,
        name_only: true,
        porcelain: true,
      }),
    ).not.toThrow()
  })

  test("git_log ignores unrelated fields for show mode", () => {
    expect(() =>
      GitLogParametersSchema.parse({
        mode: "show",
        ref: "HEAD",
        path: "src/index.ts",
        base: "main",
        head: "HEAD",
        since: "2026-01-01",
      }),
    ).not.toThrow()
  })

  test("git_annotate ignores blame-only and history-only fields for grep mode", () => {
    expect(() =>
      GitAnnotateParametersSchema.parse({
        mode: "grep",
        pattern: "SessionPrompt",
        filePath: "src/index.ts",
        line: 10,
        end: 12,
        since: "2026-01-01",
        until: "2026-02-01",
        all: true,
      }),
    ).not.toThrow()
  })

  test("localgit_state ignores diff-only fields for status action", () => {
    expect(() =>
      LocalGitStateParametersSchema.parse({
        action: "status",
        path: "src",
        staged: true,
        base: "main",
        head: "HEAD",
        stat: true,
        name_only: true,
        porcelain: true,
      }),
    ).not.toThrow()
  })

  test("localgit_log ignores unrelated fields for show action", () => {
    expect(() =>
      LocalGitLogParametersSchema.parse({
        action: "show",
        ref: "HEAD",
        path: "src/index.ts",
        base: "main",
        head: "HEAD",
        since: "2026-01-01",
      }),
    ).not.toThrow()
  })

  test("localgit_annotate ignores grep fields for line action", () => {
    expect(() =>
      LocalGitAnnotateParametersSchema.parse({
        action: "line",
        filePath: "src/index.ts",
        line: 10,
        end: 12,
        path: "src",
        pattern: "SessionPrompt",
        ref: "HEAD",
        since: "2026-01-01",
        until: "2026-02-01",
        all: true,
      }),
    ).not.toThrow()
  })
})
