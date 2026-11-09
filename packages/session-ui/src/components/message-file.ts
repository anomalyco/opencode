import { getFilename } from "@opencode/util/path"
import type { PromptAttachment } from "@opencode/client/promise"

export const MIN_IMAGE_PLACEHOLDER_PX = 96

export function imageAttachmentPlaceholderStyle(input: {
  readonly width?: number
  readonly height?: number
  readonly loaded: boolean
}) {
  if (input.width && input.height && input.loaded) return { "aspect-ratio": `${input.width} / ${input.height}` }

  if (input.width && input.height) {
    return {
      "aspect-ratio": `${input.width} / ${input.height}`,
      "min-width": `${Math.min(input.width, MIN_IMAGE_PLACEHOLDER_PX)}px`,
      "min-height": `${Math.min(input.height, MIN_IMAGE_PLACEHOLDER_PX)}px`,
    }
  }

  return input.loaded
    ? undefined
    : {
        "min-width": `${MIN_IMAGE_PLACEHOLDER_PX}px`,
        "min-height": `${MIN_IMAGE_PLACEHOLDER_PX}px`,
      }
}

export function attached(file: PromptAttachment) {
  if (file.mention) return false

  const source = file.source

  if (!source || source.type === "inline") return true

  return source.uri.startsWith("data:") || source.uri.startsWith("blob:")
}

// Display names for common source extensions; any other extension is shown in upper case.
const LANGUAGE_NAMES = new Map(
  Object.entries({
    Assembly: ["asm", "s"],
    Astro: ["astro"],
    "Batch File": ["bat", "cmd"],
    C: ["c", "h"],
    "C#": ["cs"],
    "C++": ["cpp", "cc", "cxx", "hpp", "hh", "hxx"],
    Clojure: ["clj", "cljs", "cljc", "edn"],
    CSS: ["css"],
    CUDA: ["cu", "cuh"],
    Dart: ["dart"],
    Diff: ["diff", "patch"],
    Elixir: ["ex", "exs"],
    Elm: ["elm"],
    Erlang: ["erl", "hrl"],
    "F#": ["fs", "fsi", "fsx"],
    Fortran: ["f", "f77", "f90", "f95", "f03", "f08", "for"],
    GDScript: ["gd"],
    Gleam: ["gleam"],
    GLSL: ["glsl", "vert", "frag", "geom", "comp"],
    Go: ["go"],
    GraphQL: ["graphql", "gql"],
    Groovy: ["groovy", "gradle"],
    Haskell: ["hs"],
    HCL: ["hcl"],
    HLSL: ["hlsl"],
    HTML: ["html", "htm"],
    Java: ["java"],
    JavaScript: ["js", "cjs", "mjs"],
    JSON: ["json"],
    "JSON Lines": ["jsonl"],
    "JSON with Comments": ["jsonc"],
    JSON5: ["json5"],
    JSX: ["jsx"],
    Julia: ["jl"],
    Kotlin: ["kt", "kts"],
    LaTeX: ["tex", "latex"],
    Less: ["less"],
    Lua: ["lua"],
    Markdown: ["md", "markdown"],
    MDX: ["mdx"],
    Nim: ["nim"],
    Nix: ["nix"],
    OCaml: ["ml", "mli"],
    Perl: ["pl", "pm"],
    PHP: ["php"],
    PowerShell: ["ps1", "psm1"],
    "Protocol Buffer": ["proto"],
    Python: ["py", "pyi"],
    R: ["r"],
    Ruby: ["rb"],
    Rust: ["rs"],
    Sass: ["sass"],
    Scala: ["scala", "sbt"],
    SCSS: ["scss"],
    Shell: ["sh", "bash", "zsh"],
    Solidity: ["sol"],
    SQL: ["sql"],
    Svelte: ["svelte"],
    SVG: ["svg"],
    Swift: ["swift"],
    Terraform: ["tf", "tfvars"],
    TOML: ["toml"],
    TSX: ["tsx"],
    TypeScript: ["ts", "cts", "mts"],
    Vue: ["vue"],
    WebAssembly: ["wat", "wasm"],
    WGSL: ["wgsl"],
    XML: ["xml"],
    YAML: ["yaml", "yml"],
    Zig: ["zig"],
  }).flatMap(([name, extensions]) => extensions.map((extension) => [extension, name] as const)),
)

// attachments carry text/plain for all text files, so the label comes from the extension;
// filename may be an absolute path, so extract the basename before looking for one
export function typeLabel(filename: string, mime: string, fallback: string) {
  if (mime === "application/pdf") return "PDF"
  const base = getFilename(filename)
  // idx 0 is a dotfile like .gitignore, not an extension
  const idx = base.lastIndexOf(".")
  const suffix = idx <= 0 ? "" : base.slice(idx + 1).toLowerCase()

  if (!suffix) return fallback

  return LANGUAGE_NAMES.get(suffix) ?? suffix.toUpperCase()
}
