export const LANGUAGE_EXTENSIONS: Record<string, string> = {
  ".abap": "abap",
  ".bat": "bat",
  ".bib": "bibtex",
  ".bibtex": "bibtex",
  ".clj": "clojure",
  ".cljs": "clojure",
  ".cljc": "clojure",
  ".edn": "clojure",
  ".coffee": "coffeescript",
  ".c": "c",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".cc": "cpp",
  ".c++": "cpp",
  ".cs": "csharp",
  ".css": "css",
  ".d": "d",
  ".pas": "pascal",
  ".pascal": "pascal",
  ".diff": "diff",
  ".patch": "diff",
  ".dart": "dart",
  ".dockerfile": "dockerfile",
  ".ex": "elixir",
  ".exs": "elixir",
  ".erl": "erlang",
  ".ets": "typescript",
  ".hrl": "erlang",
  ".fs": "fsharp",
  ".fsi": "fsharp",
  ".fsx": "fsharp",
  ".fsscript": "fsharp",
  ".gitcommit": "git-commit",
  ".gitrebase": "git-rebase",
  ".go": "go",
  ".groovy": "groovy",
  ".gleam": "gleam",
  ".hbs": "handlebars",
  ".handlebars": "handlebars",
  ".hs": "haskell",
  ".lhs": "haskell",
  ".html": "html",
  ".htm": "html",
  ".ini": "ini",
  ".java": "java",
  ".jl": "julia",
  ".js": "javascript",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".jsx": "javascriptreact",
  ".json": "json",
  ".tex": "latex",
  ".latex": "latex",
  ".less": "less",
  ".lua": "lua",
  ".makefile": "makefile",
  makefile: "makefile",
  ".md": "markdown",
  ".markdown": "markdown",
  ".m": "objective-c",
  ".mm": "objective-cpp",
  ".pl": "perl",
  ".pm": "perl",
  ".pm6": "perl6",
  ".php": "php",
  ".ps1": "powershell",
  ".psm1": "powershell",
  ".pug": "jade",
  ".jade": "jade",
  ".py": "python",
  ".r": "r",
  ".cshtml": "razor",
  ".razor": "razor",
  ".rb": "ruby",
  ".rake": "ruby",
  ".gemspec": "ruby",
  ".ru": "ruby",
  ".erb": "erb",
  ".html.erb": "erb",
  ".js.erb": "erb",
  ".css.erb": "erb",
  ".json.erb": "erb",
  ".rs": "rust",
  ".scss": "scss",
  ".sass": "sass",
  ".scala": "scala",
  ".shader": "shaderlab",
  ".sh": "shellscript",
  ".bash": "shellscript",
  ".zsh": "shellscript",
  ".ksh": "shellscript",
  ".sql": "sql",
  ".svelte": "svelte",
  ".swift": "swift",
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".mts": "typescript",
  ".cts": "typescript",
  ".mtsx": "typescriptreact",
  ".ctsx": "typescriptreact",
  ".xml": "xml",
  ".xsl": "xsl",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".vue": "vue",
  ".zig": "zig",
  ".zon": "zig",
  ".astro": "astro",
  ".ml": "ocaml",
  ".mli": "ocaml",
  ".tf": "terraform",
  ".tfvars": "terraform-vars",
  ".hcl": "hcl",
  ".nix": "nix",
  ".typ": "typst",
  ".typc": "typst",
} as const

export const SHEBANG_PATTERNS: Array<{ pattern: RegExp; language: string }> = [
  { pattern: /\buv\s+run\b/, language: "python" },
  { pattern: /\bpython[23]?\b/, language: "python" },
  { pattern: /\bts-node\b/, language: "typescript" },
  { pattern: /\btsx\b/, language: "typescriptreact" },
  { pattern: /\bdeno\b/, language: "typescript" },
  { pattern: /\bnode\b/, language: "javascript" },
  { pattern: /\bbun\b/, language: "javascript" },
  { pattern: /\bnpx\b/, language: "javascript" },
  { pattern: /\byarn\b/, language: "javascript" },
  { pattern: /\bpnpm\b/, language: "javascript" },
  { pattern: /\bbash\b/, language: "shellscript" },
  { pattern: /\bzsh\b/, language: "shellscript" },
  { pattern: /\bdash\b/, language: "shellscript" },
  { pattern: /\bfish\b/, language: "shellscript" },
  { pattern: /(?<![-\w])sh(?![-\w])/, language: "shellscript" },
  { pattern: /\bruby\b/, language: "ruby" },
  { pattern: /\bperl[56]?\b/, language: "perl" },
  { pattern: /\bphp\b/, language: "php" },
  { pattern: /\blua\b/, language: "lua" },
  { pattern: /\bRscript\b/, language: "r" },
  { pattern: /\bjulia\b/, language: "julia" },
  { pattern: /\belixir\b/, language: "elixir" },
  { pattern: /\biex\b/, language: "elixir" },
]

export async function getLanguageFromShebang(filePath: string): Promise<string | undefined> {
  const file = Bun.file(filePath)
  if (!(await file.exists())) return undefined

  const stream = file.stream()
  const reader = stream.getReader()

  try {
    const { value, done } = await reader.read()
    if (done || !value) return undefined

    const decoder = new TextDecoder()
    let text = decoder.decode(value, { stream: true })

    const newlineIndex = text.indexOf("\n")
    if (newlineIndex !== -1) {
      text = text.slice(0, newlineIndex)
    }

    const line = text.trim()
    if (!line.startsWith("#!")) return undefined

    for (const { pattern, language } of SHEBANG_PATTERNS) {
      if (pattern.test(line)) {
        return language
      }
    }

    return undefined
  } finally {
    reader.releaseLock()
    await stream.cancel()
  }
}
