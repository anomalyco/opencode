import { describe, expect, test } from "bun:test"
import { Skill } from "@opencode/schema/skill"
import type { ImageAttachmentPart, Prompt } from "@/composer/state"
import type { FileSelection } from "@/workspaces/files/model"
import { buildPromptRequest } from "./request"

function inline(filename: string, mime: string, extra?: Partial<ImageAttachmentPart>) {
  return { type: "image" as const, id: `img_${filename}`, filename, mime, dataUrl: `data:${mime};base64,AAA`, ...extra }
}

describe("buildPromptRequest", () => {
  test("builds text, files, and agents from the prompt", () => {
    const prompt: Prompt = [
      { type: "text", content: "hello", start: 0, end: 5 },
      {
        type: "file",
        path: "src/foo.ts",
        content: "@src/foo.ts",
        start: 5,
        end: 16,
        selection: { startLine: 4, startChar: 1, endLine: 6, endChar: 1 },
      },
      { type: "agent", name: "planner", content: "@planner", start: 16, end: 24 },
    ]

    const result = buildPromptRequest({
      prompt,
      context: [{ key: "ctx:1", type: "file", path: "src/bar.ts", comment: "check this" }],
      images: [inline("a.png", "image/png"), inline("b.pdf", "application/pdf", { sourcePath: "C:\\x\\b.pdf" })],
      text: "hello @src/foo.ts @planner",
      sessionDirectory: "/repo",
    })

    expect(result.text).toContain("hello @src/foo.ts @planner")
    expect(result.text).toContain("check this")
    expect(result.displayText).toBe("hello @src/foo.ts @planner")
    expect(result.comments).toMatchObject([{ path: "src/bar.ts", comment: "check this" }])
    expect(result.agents).toEqual([{ name: "planner", mention: { start: 16, end: 24, text: "@planner" } }])
    expect(result.files).toEqual([
      {
        uri: "file:///repo/src/foo.ts?start=4&end=6",
        mime: "text/plain",
        name: "foo.ts",
        mention: { start: 5, end: 16, text: "@src/foo.ts" },
      },
      { uri: "file:///repo/src/bar.ts", mime: "text/plain", name: "bar.ts" },
      { uri: "data:image/png;base64,AAA", mime: "image/png", name: "a.png" },
      // An external attachment keeps its source path so the model can name the original file.
      { uri: "data:application/pdf;base64,AAA", mime: "application/pdf", name: "C:\\x\\b.pdf" },
    ])
  })

  test("preserves reference aliases as directory files", () => {
    const result = buildPromptRequest({
      prompt: [
        {
          type: "file",
          path: "/repo/../docs",
          content: "@docs",
          start: 0,
          end: 5,
          mime: "application/x-directory",
          filename: "docs",
        },
      ],
      context: [],
      images: [],
      text: "@docs",
      sessionDirectory: "/repo/app",
    })

    expect(result.files[0]).toEqual({
      uri: "file:///repo/../docs",
      mime: "application/x-directory",
      name: "docs",
      mention: { start: 0, end: 5, text: "@docs" },
    })
  })

  test("deduplicates context files and adds files for @mentions inside comment text", () => {
    const prompt: Prompt = [{ type: "file", path: "src/foo.ts", content: "@src/foo.ts", start: 0, end: 11 }]

    const result = buildPromptRequest({
      prompt,
      context: [
        { key: "ctx:dup", type: "file", path: "src/foo.ts" },
        { key: "ctx:comment", type: "file", path: "src/foo.ts", comment: "focus here" },
        {
          key: "ctx:comment-mention",
          type: "file",
          path: "src/review.ts",
          comment: "Compare with @src/shared.ts and @src/review.ts.",
        },
      ],
      images: [],
      text: "@src/foo.ts",
      sessionDirectory: "/repo",
    })

    expect(result.files.map((file) => file.uri)).toEqual([
      "file:///repo/src/foo.ts",
      "file:///repo/src/foo.ts",
      "file:///repo/src/review.ts",
      "file:///repo/src/shared.ts",
    ])
    expect(result.text).toContain("focus here")
  })

  test("sends an extension note with its live subject and attaches only the files it mentions", () => {
    const note = {
      type: "note" as const,
      origin: "example",
      label: "button.primary",
      icon: "select-element",
      subject:
        'the "button.primary" element in browser tab tab_00000000-0000-4000-8000-000000000000 at http://localhost:5173/settings (role button; accessible name "Save"; selector "#settings > button.primary")',
      href: "tab_00000000-0000-4000-8000-000000000000",
      live: {
        subject:
          'the "button.primary" element in browser tab tab_00000000-0000-4000-8000-000000000000 at http://localhost:5173/settings (role button; accessible name "Save"; selector "#settings > button.primary"; browser ref @e42, usable as ref in any browser tool including browser.evaluate until the page navigates)',
        href: "tab_00000000-0000-4000-8000-000000000000#e42",
      },
      comment: "Match @src/button.css",
    }
    const result = buildPromptRequest({
      prompt: [{ type: "text", content: "tidy up", start: 0, end: 7 }],
      context: [{ ...note, key: "note:example:c=1", commentID: "1" }],
      images: [],
      text: "tidy up",
      sessionDirectory: "/repo",
    })

    expect(result.text).toBe(
      'tidy up\nThe user made the following comment regarding the "button.primary" element in browser tab tab_00000000-0000-4000-8000-000000000000 at http://localhost:5173/settings (role button; accessible name "Save"; selector "#settings > button.primary"; browser ref @e42, usable as ref in any browser tool including browser.evaluate until the page navigates): Match @src/button.css',
    )
    expect(result.comments).toEqual([note])
    // A note has no file of its own; only files it mentions are attached.
    expect(result.files).toEqual([{ uri: "file:///repo/src/button.css", mime: "text/plain", name: "button.css" }])
  })

  test("keeps skill mentions out of file attachments", () => {
    const skill = {
      id: "skill-review",
      name: "review",
    }
    const result = buildPromptRequest({
      prompt: [
        {
          type: "skill",
          id: Skill.ID.make(skill.id),
          name: Skill.Name.make(skill.name),
          content: "@review",
          start: 0,
          end: 7,
        },
      ],
      context: [],
      images: [],
      text: "@review",
      sessionDirectory: "/repo",
    })

    expect(result.files).toEqual([])
    expect(result.skills).toEqual([{ id: skill.id, name: skill.name, mention: { start: 0, end: 7, text: "@review" } }])
  })

  test.each<{ dir: string; path: string; selection?: FileSelection; context?: true; uri: string }>([
    { dir: "D:\\projects\\myapp", path: "src\\foo.ts", uri: "file:///D:/projects/myapp/src/foo.ts" },
    {
      dir: "C:\\Users\\test\\Documents",
      path: "file#name.txt",
      uri: "file:///C:/Users/test/Documents/file%23name.txt",
    },
    { dir: "/home/user/project", path: "src/app.ts", uri: "file:///home/user/project/src/app.ts" },
    { dir: "C:\\current\\project", path: "D:\\other\\project\\file.ts", uri: "file:///D:/other/project/file.ts" },
    {
      dir: "C:\\project",
      path: "src\\App.tsx",
      selection: { startLine: 10, startChar: 0, endLine: 20, endChar: 5 },
      uri: "file:///C:/project/src/App.tsx?start=10&end=20",
    },
    // `..` stays for the backend to normalize.
    {
      dir: "C:\\projects\\myapp\\src",
      path: "..\\..\\shared\\util.ts",
      uri: "file:///C:/projects/myapp/src/../../shared/util.ts",
    },
    {
      dir: "D:\\workspace\\app",
      path: "src\\utils\\helper.ts",
      context: true,
      uri: "file:///D:/workspace/app/src/utils/helper.ts",
    },
  ])("resolves $path in $dir to a file URI", (row) => {
    const result = buildPromptRequest({
      prompt: row.context
        ? []
        : [
            {
              type: "file",
              path: row.path,
              content: `@${row.path}`,
              start: 0,
              end: row.path.length + 1,
              selection: row.selection,
            },
          ],
      context: row.context ? [{ key: "ctx", type: "file", path: row.path }] : [],
      images: [],
      text: row.context ? "" : `@${row.path}`,
      sessionDirectory: row.dir,
    })

    expect(result.files.map((file) => file.uri)).toEqual([row.uri])
  })
})
