import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { javascript } from "@codemirror/lang-javascript"
import { LanguageDescription, type LanguageSupport } from "@codemirror/language"

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
  return undefined
}
