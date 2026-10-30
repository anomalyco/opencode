import path from "node:path"

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
  ".cppm": "cpp",
  ".ccm": "cpp",
  ".cxxm": "cpp",
  ".c++m": "cpp",
  ".ixx": "cpp",
  ".cs": "csharp",
  ".csx": "csharp",
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
}

export function filetype(input?: string) {
  if (!input) return "none"
  const language = LANGUAGE_EXTENSIONS[path.extname(input)]
  if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
  return language
}

// Languages a parser is registered for but LANGUAGE_EXTENSIONS names differently.
const PARSER_FILETYPES: Record<string, string> = {
  shellscript: "bash",
  makefile: "make",
  terraform: "hcl",
  "terraform-vars": "hcl",
}

const EXTENSIONS: Record<string, string> = {
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".ksh": "bash",
  ".env": "bash",
  ".mk": "make",
  ".toml": "toml",
  ".h": "c",
  ".hh": "cpp",
  ".hpp": "cpp",
  ".hxx": "cpp",
  ".jsonc": "json",
  ".json5": "json",
  ".mdx": "markdown",
  ".plist": "xml",
  ".svg": "xml",
  ".xsd": "xml",
  ".ini": "ini",
  ".cfg": "ini",
  ".conf": "ini",
  ".properties": "ini",
  ".desktop": "ini",
  ".service": "ini",
  ".socket": "ini",
  ".timer": "ini",
  ".mount": "ini",
  ".automount": "ini",
  ".target": "ini",
  ".path": "ini",
  ".slice": "ini",
  ".scope": "ini",
  ".swap": "ini",
  ".device": "ini",
  ".network": "ini",
  ".netdev": "ini",
  ".link": "ini",
  ".container": "ini",
  ".volume": "ini",
  ".pod": "ini",
  ".kube": "ini",
  ".image": "ini",
  ".build": "ini",
  ".haml": "haml",
}

const FILENAMES: Record<string, string> = {
  dockerfile: "dockerfile",
  containerfile: "dockerfile",
  makefile: "make",
  gnumakefile: "make",
  gemfile: "ruby",
  rakefile: "ruby",
  capfile: "ruby",
  guardfile: "ruby",
  vagrantfile: "ruby",
  brewfile: "ruby",
  podfile: "ruby",
  berksfile: "ruby",
  pkgbuild: "bash",
  ".bashrc": "bash",
  ".bash_profile": "bash",
  ".bash_aliases": "bash",
  ".profile": "bash",
  ".zshrc": "bash",
  ".zshenv": "bash",
  ".zprofile": "bash",
  ".envrc": "bash",
  ".gitconfig": "ini",
  ".gitmodules": "ini",
  ".editorconfig": "ini",
}

const INTERPRETERS: Record<string, string> = {
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  dash: "bash",
  ksh: "bash",
  python: "python",
  python3: "python",
  node: "typescript",
  bun: "typescript",
  deno: "typescript",
  ruby: "ruby",
  php: "php",
  lua: "lua",
}

// The parser language for a file, beyond the extension map: Dockerfiles, dotenv files, systemd
// units and other ini-style config, file names such as Makefile and Gemfile, and for a file with no
// known language a #! line, read from its content or from a diff whose first hunk starts at line 1.
export function detectFiletype(input?: string, content?: string) {
  if (!input) return "none"
  const name = path.basename(input).toLowerCase()
  const known =
    FILENAMES[name] ??
    (name.startsWith("dockerfile.") || name.endsWith(".dockerfile") ? "dockerfile" : undefined) ??
    (/^\.env(\.|$)/.test(name) ? "bash" : undefined) ??
    EXTENSIONS[path.extname(name)]
  if (known) return known
  const language = filetype(input)
  if (language) return PARSER_FILETYPES[language] ?? language
  return content ? shebangFiletype(content) : undefined
}

function shebangFiletype(content: string) {
  const first = content.startsWith("#!")
    ? content
    : content.match(/^@@ -[01],?\d* \+1,?\d* @@[^\n]*\n[ +-](#![^\n]*)/m)?.[1]
  if (!first?.startsWith("#!")) return
  const interpreter = first
    .slice(2)
    .split("\n", 1)[0]
    .trim()
    .split(/\s+/)
    .map((word) => path.basename(word))
    .find((word) => word !== "env" && !word.startsWith("-"))
  if (!interpreter) return
  return INTERPRETERS[interpreter] ?? INTERPRETERS[interpreter.replace(/[\d.]+$/, "")]
}
