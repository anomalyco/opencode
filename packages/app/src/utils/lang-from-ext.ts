import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { javascript } from "@codemirror/lang-javascript"
import { html } from "@codemirror/lang-html"
import { LanguageDescription, type LanguageSupport } from "@codemirror/language"

// FORK: md-editing-iter-3 矫正 ⑥ — 扩 codeLanguages 注册让常用语言 fenced code block
// 也有语法高亮(原先只 js/ts → user 反馈 python 单色不符合"代码都该有高亮"标准,2026-05-25)
const codeLanguages: LanguageDescription[] = [
  LanguageDescription.of({
    name: "javascript",
    alias: ["js", "jsx"],
    extensions: ["js", "jsx", "mjs", "cjs"],
    load: async () => javascript(),
  }),
  LanguageDescription.of({
    name: "typescript",
    alias: ["ts", "tsx"],
    extensions: ["ts", "tsx"],
    load: async () => javascript({ typescript: true }),
  }),
  LanguageDescription.of({
    name: "python",
    alias: ["py"],
    extensions: ["py"],
    load: async () => (await import("@codemirror/lang-python")).python(),
  }),
  LanguageDescription.of({
    name: "sql",
    alias: ["mysql", "postgresql", "sqlite"],
    extensions: ["sql"],
    load: async () => (await import("@codemirror/lang-sql")).sql(),
  }),
  LanguageDescription.of({
    name: "json",
    alias: ["jsonc"],
    extensions: ["json", "jsonc"],
    load: async () => (await import("@codemirror/lang-json")).json(),
  }),
  LanguageDescription.of({
    name: "yaml",
    alias: ["yml"],
    extensions: ["yaml", "yml"],
    load: async () => (await import("@codemirror/lang-yaml")).yaml(),
  }),
  LanguageDescription.of({
    name: "html",
    alias: ["htm"],
    extensions: ["html", "htm"],
    load: async () => html(),
  }),
  LanguageDescription.of({
    name: "css",
    extensions: ["css"],
    load: async () => (await import("@codemirror/lang-css")).css(),
  }),
]

export function langFromExt(path: string): LanguageSupport | undefined {
  const lower = path.toLowerCase()
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return markdown({ base: markdownLanguage, codeLanguages })
  }
  if (
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs")
  ) {
    return javascript({
      jsx: lower.endsWith(".jsx") || lower.endsWith(".tsx"),
      typescript: lower.endsWith(".ts") || lower.endsWith(".tsx"),
    })
  }
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return html()
  }
  return undefined
}
